"""
TrendProof — FastAPI Backend
Climate Claim Verification Engine powered by NASA POWER Satellite Data.

NASA Space Apps Challenge 2026 — "Be An Earth System Trend Detective!"
"""

import sys
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Ensure local imports work in all execution contexts
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    from .cities import find_city, search_cities, get_pakistan_cities, CITIES, METRICS
    from .nasa_power import (
        get_climate_data, resolve_variable, get_parameter_info,
        fetch_climatology, fetch_monthly, fetch_nasa_apod, NASA_API_KEY,
        PARAMETER_INFO, VARIABLE_MAPPING,
    )
    from .parser import parse_claim
    from .analysis import analyze_trend, compare_cities, annual_series, analyze_series
except ImportError:
    from cities import find_city, search_cities, get_pakistan_cities, CITIES, METRICS
    from nasa_power import (
        get_climate_data, resolve_variable, get_parameter_info,
        fetch_climatology, fetch_monthly, fetch_nasa_apod, NASA_API_KEY,
        PARAMETER_INFO, VARIABLE_MAPPING,
    )
    from parser import parse_claim
    from analysis import analyze_trend, compare_cities, annual_series, analyze_series


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=12.0) as client:
        app.state.nasa_client = client
        yield


app = FastAPI(
    title="TrendProof API",
    description="Climate claim verification engine powered by NASA POWER satellite data. Built for NASA Space Apps Challenge 2026.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend to connect (support env var or default open)
origins_env = os.getenv("TRENDPROOF_ORIGINS")
origins = [o.strip() for o in origins_env.split(",") if o.strip()] if origins_env else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True if origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== Request/Response Models ==========

class ClaimRequest(BaseModel):
    claim: str = Field(..., description="Natural language climate claim", min_length=3, max_length=500)
    start_year: Optional[int] = Field(2001, ge=1981, le=2025)
    end_year: Optional[int] = Field(2025, ge=1981, le=2026)


class CityDataRequest(BaseModel):
    city: str
    parameter: str = "T2M"
    start_year: int = 2001
    end_year: int = 2025
    season: Optional[str] = None


# ========== Routes ==========

@app.get("/")
def root():
    return {
        "name": "TrendProof API",
        "tagline": "Verify climate claims with NASA satellite data",
        "challenge": "NASA Space Apps 2026 — Be An Earth System Trend Detective!",
        "version": "1.0.0",
        "endpoints": {
            "/api/analyze": "GET — Statistical trend analysis for frontend (city, metric, start, end)",
            "/verify": "POST — Verify a natural language climate claim",
            "/city/{name}": "GET — Get climate data for a city",
            "/compare": "GET — Compare two cities",
            "/cities": "GET — Search for cities",
            "/cities/pakistan": "GET — All Pakistan cities",
            "/parameters": "GET — Available climate parameters",
            "/docs": "Swagger UI interactive API documentation",
        }
    }


@app.get("/api/analyze")
async def analyze(
    request: Request,
    city: str,
    metric: str,
    start: int,
    end: int,
    lat: Optional[float] = Query(None, description="Optional latitude for dynamic worldwide geocoded cities"),
    lon: Optional[float] = Query(None, description="Optional longitude for dynamic worldwide geocoded cities"),
):
    """
    Standard statistical analysis endpoint consumed by the frontend and CLI.
    Supports catalog cities or any dynamic global lat/lon coordinates.
    Example: /api/analyze?city=peshawar&metric=T2M&start=2001&end=2025
    """
    city_lower = city.strip().lower()
    city_info = CITIES.get(city_lower)
    if not city_info:
        city_info = find_city(city)

    if not city_info and lat is not None and lon is not None:
        city_info = {"id": city_lower, "name": city.replace('-', ' ').title(), "lat": lat, "lon": lon}

    if not city_info or metric not in METRICS:
        raise HTTPException(status_code=422, detail="Choose a supported city or provide valid coordinates, and select a valid climate metric.")

    latest_year = datetime.now(timezone.utc).year - 1
    first_year = METRICS[metric].get("firstYear", 1981)
    if start < first_year or end > latest_year or end - start + 1 < 5:
        raise HTTPException(
            status_code=422,
            detail=f"Choose at least five complete years within the metric's available range ({first_year}–{latest_year}).",
        )

    try:
        client = getattr(request.app.state, "nasa_client", None)
        if client is None:
            async with httpx.AsyncClient(timeout=12.0) as temp_client:
                values, fill = await fetch_monthly(temp_client, city_info, metric, start, end)
        else:
            values, fill = await fetch_monthly(client, city_info, metric, start, end)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"NASA POWER could not return data for this range: {exc}") from exc

    try:
        return analyze_series(annual_series(values, fill, metric, start, end))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/nasa/apod")
async def nasa_apod(request: Request):
    """Fetch NASA Astronomy Picture of the Day from api.nasa.gov using configured API key."""
    client = getattr(request.app.state, "nasa_client", None)
    if client:
        data = await fetch_nasa_apod(client)
        if data:
            return data
    async with httpx.AsyncClient(timeout=10.0) as temp_client:
        data = await fetch_nasa_apod(temp_client)
        if data:
            return data
    raise HTTPException(status_code=502, detail="NASA APOD API currently unavailable.")




@app.post("/verify")
def verify_claim(req: ClaimRequest):
    """
    Main endpoint: verify a natural language climate claim.

    Examples:
    - "Peshawar is getting hotter"
    - "Rainfall in Lahore has decreased"
    - "Is Karachi hotter than Islamabad?"
    - "Peshawar mein bohat garmi hai"
    """
    # 1. Parse the claim
    parsed = parse_claim(req.claim)

    if not parsed.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Could not parse the claim.",
                "message": "Please include a city name in your claim.",
                "errors": parsed.errors,
                "suggestion": "Try something like: 'Peshawar is getting hotter' or 'Rainfall in Lahore has decreased'",
            }
        )

    # 2. Fetch NASA data
    nasa_data = get_climate_data(
        city_name=parsed.city_info["name"],
        lat=parsed.city_info["lat"],
        lon=parsed.city_info["lon"],
        parameter=parsed.variable,
        start_year=req.start_year or parsed.start_year,
        end_year=req.end_year or parsed.end_year,
        season=parsed.season,
    )

    if nasa_data.error:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "Failed to fetch NASA data.",
                "message": nasa_data.error,
            }
        )

    # Use seasonal data if available, otherwise yearly
    trend_data = nasa_data.seasonal_data if nasa_data.seasonal_data else nasa_data.yearly_data

    if len(trend_data) < 3:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Insufficient data.",
                "message": f"Only {len(trend_data)} data points found. Need at least 3 years.",
            }
        )

    # 3. Analyze the trend
    param_info = get_parameter_info(parsed.variable)
    trend = analyze_trend(
        data=trend_data,
        unit=param_info["unit"],
        claimed_direction=parsed.direction,
        specific_year=parsed.year,
        compare_year=parsed.compare_year,
        parameter_name=param_info["name"],
    )

    # 4. Handle city comparison
    comparison = None
    if parsed.compare_city_info:
        compare_data = get_climate_data(
            city_name=parsed.compare_city_info["name"],
            lat=parsed.compare_city_info["lat"],
            lon=parsed.compare_city_info["lon"],
            parameter=parsed.variable,
            start_year=req.start_year or parsed.start_year,
            end_year=req.end_year or parsed.end_year,
            season=parsed.season,
        )
        compare_trend_data = compare_data.seasonal_data if compare_data.seasonal_data else compare_data.yearly_data

        if not compare_data.error and len(compare_trend_data) >= 3:
            comparison = compare_cities(
                data1=trend_data,
                data2=compare_trend_data,
                city1_name=parsed.city_info["name"],
                city2_name=parsed.compare_city_info["name"],
                parameter_name=param_info["name"],
                unit=param_info["unit"],
            )

    # 5. Build response
    response = {
        "claim": {
            "original": req.claim,
            "parsed": {
                "city": parsed.city_info["name"],
                "variable": parsed.variable,
                "variable_name": param_info["name"],
                "variable_keyword": parsed.variable_keyword,
                "direction": parsed.direction,
                "season": parsed.season,
                "year": parsed.year,
                "compare_year": parsed.compare_year,
                "compare_city": parsed.compare_city_info["name"] if parsed.compare_city_info else None,
                "confidence": parsed.confidence,
            }
        },
        "verdict": {
            "result": trend.verdict,
            "emoji": trend.verdict_emoji,
            "explanation": trend.verdict_explanation,
            "confidence": trend.confidence_level,
        },
        "trend": {
            "direction": trend.trend_direction,
            "is_significant": trend.is_significant,
            "slope_per_year": trend.slope,
            "slope_per_decade": round(trend.slope * 10, 3),
            "total_change": trend.total_change,
            "percent_change": trend.percent_change,
            "r_squared": trend.r_squared,
            "p_value": trend.p_value,
        },
        "statistics": {
            "mean": trend.historical_mean,
            "std_deviation": trend.historical_std,
            "latest_value": trend.latest_value,
            "latest_year": trend.latest_year,
            "latest_deviation_sigma": trend.latest_deviation,
            "latest_is_extreme": trend.latest_is_extreme,
        },
        "anomalies": trend.anomaly_years,
        "chart_data": {
            "years": trend.years,
            "values": [round(v, 2) for v in trend.values],
            "unit": trend.unit,
            "parameter": param_info["name"],
            "trend_line": {
                "start": round(trend.intercept + trend.slope * trend.years[0], 2) if trend.years else 0,
                "end": round(trend.intercept + trend.slope * trend.years[-1], 2) if trend.years else 0,
            },
        },
        "city": {
            "name": parsed.city_info["name"],
            "lat": parsed.city_info["lat"],
            "lon": parsed.city_info["lon"],
            "country": parsed.city_info.get("country", ""),
        },
        "data_source": {
            "name": "NASA POWER (Prediction of Worldwide Energy Resources)",
            "url": "https://power.larc.nasa.gov/",
            "description": "Global meteorology and solar energy data from NASA satellites and reanalysis models.",
            "resolution": "~55 km",
            "temporal_coverage": "1981–present",
        },
    }

    if comparison:
        response["comparison"] = comparison

    return response


@app.get("/city/{city_name}")
def get_city_data(
    city_name: str,
    parameter: str = Query("T2M", description="NASA POWER parameter code"),
    start_year: int = Query(2001, ge=1981, le=2025),
    end_year: int = Query(2025, ge=1981, le=2026),
    season: Optional[str] = Query(None, description="Season filter: summer, winter, monsoon, etc."),
):
    """Get raw climate data for a specific city."""
    city = find_city(city_name)
    if not city:
        raise HTTPException(status_code=404, detail=f"City '{city_name}' not found.")

    nasa_data = get_climate_data(
        city_name=city["name"],
        lat=city["lat"],
        lon=city["lon"],
        parameter=parameter,
        start_year=start_year,
        end_year=end_year,
        season=season,
    )

    if nasa_data.error:
        raise HTTPException(status_code=502, detail=nasa_data.error)

    param_info = get_parameter_info(parameter)
    trend_data = nasa_data.seasonal_data if nasa_data.seasonal_data else nasa_data.yearly_data
    trend = analyze_trend(
        data=trend_data,
        unit=param_info["unit"],
        parameter_name=param_info["name"],
    )

    return {
        "city": city,
        "parameter": param_info,
        "yearly_data": {str(k): v for k, v in sorted(nasa_data.yearly_data.items())},
        "seasonal_data": {str(k): v for k, v in sorted(nasa_data.seasonal_data.items())} if nasa_data.seasonal_data else None,
        "season": nasa_data.season_name,
        "trend": {
            "direction": trend.trend_direction,
            "is_significant": trend.is_significant,
            "slope_per_decade": round(trend.slope * 10, 3),
            "p_value": trend.p_value,
            "r_squared": trend.r_squared,
        },
        "chart_data": {
            "years": trend.years,
            "values": [round(v, 2) for v in trend.values],
        },
    }


@app.get("/compare")
def compare_cities_endpoint(
    city1: str = Query(..., description="First city name"),
    city2: str = Query(..., description="Second city name"),
    parameter: str = Query("T2M", description="NASA POWER parameter code"),
    start_year: int = Query(2001, ge=1981, le=2025),
    end_year: int = Query(2025, ge=1981, le=2026),
):
    """Compare climate trends between two cities."""
    c1 = find_city(city1)
    c2 = find_city(city2)

    if not c1:
        raise HTTPException(status_code=404, detail=f"City '{city1}' not found.")
    if not c2:
        raise HTTPException(status_code=404, detail=f"City '{city2}' not found.")

    data1 = get_climate_data(c1["name"], c1["lat"], c1["lon"], parameter, start_year, end_year)
    data2 = get_climate_data(c2["name"], c2["lat"], c2["lon"], parameter, start_year, end_year)

    if data1.error:
        raise HTTPException(status_code=502, detail=f"NASA API error for {c1['name']}: {data1.error}")
    if data2.error:
        raise HTTPException(status_code=502, detail=f"NASA API error for {c2['name']}: {data2.error}")

    param_info = get_parameter_info(parameter)
    result = compare_cities(
        data1.yearly_data, data2.yearly_data,
        c1["name"], c2["name"],
        param_info["name"], param_info["unit"],
    )

    return result


@app.get("/cities")
def search_cities_endpoint(
    q: str = Query("", description="Search query"),
    limit: int = Query(10, ge=1, le=50),
):
    """Search for cities by name."""
    if not q:
        return {"cities": []}
    results = search_cities(q, limit=limit)
    return {"query": q, "count": len(results), "cities": results}


@app.get("/cities/pakistan")
def pakistan_cities():
    """List all Pakistan cities in the database."""
    cities = get_pakistan_cities()
    return {"count": len(cities), "cities": cities}


@app.get("/parameters")
def list_parameters():
    """List all available climate parameters."""
    return {
        "parameters": {
            code: info for code, info in PARAMETER_INFO.items()
        },
        "variable_keywords": {
            keyword: code for keyword, code in sorted(VARIABLE_MAPPING.items())
        },
    }


# ========== Error Handlers ==========

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc),
            "tip": "If this persists, try a different city or parameter.",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
