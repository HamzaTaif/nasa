"""
TrendProof — NASA POWER API Client
Fetches climate data (temperature, rainfall, humidity, etc.) for any location on Earth.
Data available from 1981 to near real-time.
"""

import os
import requests
import httpx
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

NASA_API_KEY = os.getenv("NASA_API_KEY", "W9nnn7jzrhTBrBrBQGDWch6KMGQQPMLWFgcqHBnn")
BASE_URL = "https://power.larc.nasa.gov/api/temporal"

# Parameter descriptions for user-facing output
PARAMETER_INFO = {
    "T2M": {
        "name": "Average Temperature",
        "unit": "°C",
        "description": "Temperature at 2 meters above ground (daily average)",
        "category": "temperature",
    },
    "T2M_MAX": {
        "name": "Maximum Temperature",
        "unit": "°C",
        "description": "Maximum temperature at 2 meters above ground",
        "category": "temperature",
    },
    "T2M_MIN": {
        "name": "Minimum Temperature",
        "unit": "°C",
        "description": "Minimum temperature at 2 meters above ground",
        "category": "temperature",
    },
    "PRECTOTCORR": {
        "name": "Precipitation",
        "unit": "mm/day",
        "description": "Corrected total precipitation",
        "category": "precipitation",
    },
    "RH2M": {
        "name": "Relative Humidity",
        "unit": "%",
        "description": "Relative humidity at 2 meters",
        "category": "humidity",
    },
    "ALLSKY_SFC_SW_DWN": {
        "name": "Solar Radiation",
        "unit": "kW-hr/m²/day",
        "description": "All sky surface shortwave downward irradiance",
        "category": "solar",
    },
    "WS2M": {
        "name": "Wind Speed",
        "unit": "m/s",
        "description": "Wind speed at 2 meters",
        "category": "wind",
    },
    "T2MDEW": {
        "name": "Dew Point Temperature",
        "unit": "°C",
        "description": "Dew/frost point temperature at 2 meters",
        "category": "temperature",
    },
}

# Map common terms to NASA POWER parameter codes
VARIABLE_MAPPING = {
    # Temperature
    "temperature": "T2M",
    "temp": "T2M",
    "hot": "T2M_MAX",
    "hotter": "T2M_MAX",
    "heat": "T2M_MAX",
    "garmi": "T2M_MAX",  # Urdu
    "garam": "T2M_MAX",  # Urdu
    "cold": "T2M_MIN",
    "colder": "T2M_MIN",
    "sardi": "T2M_MIN",  # Urdu
    "thanda": "T2M_MIN",  # Urdu
    "warm": "T2M",
    "warmer": "T2M",
    "cool": "T2M_MIN",
    "cooler": "T2M_MIN",
    "max temperature": "T2M_MAX",
    "min temperature": "T2M_MIN",
    "maximum temperature": "T2M_MAX",
    "minimum temperature": "T2M_MIN",
    "heatwave": "T2M_MAX",
    "heat wave": "T2M_MAX",

    # Precipitation
    "rain": "PRECTOTCORR",
    "rainfall": "PRECTOTCORR",
    "precipitation": "PRECTOTCORR",
    "barish": "PRECTOTCORR",  # Urdu
    "baarish": "PRECTOTCORR",  # Urdu
    "monsoon": "PRECTOTCORR",
    "flood": "PRECTOTCORR",
    "drought": "PRECTOTCORR",
    "dry": "PRECTOTCORR",
    "drier": "PRECTOTCORR",
    "wet": "PRECTOTCORR",
    "wetter": "PRECTOTCORR",

    # Humidity
    "humidity": "RH2M",
    "humid": "RH2M",
    "moisture": "RH2M",
    "umass": "RH2M",  # Urdu (umas)

    # Solar
    "solar": "ALLSKY_SFC_SW_DWN",
    "sun": "ALLSKY_SFC_SW_DWN",
    "sunlight": "ALLSKY_SFC_SW_DWN",
    "sunshine": "ALLSKY_SFC_SW_DWN",
    "radiation": "ALLSKY_SFC_SW_DWN",
    "dhoop": "ALLSKY_SFC_SW_DWN",  # Urdu

    # Wind
    "wind": "WS2M",
    "windy": "WS2M",
    "windier": "WS2M",
    "hawa": "WS2M",  # Urdu
}

MONTH_NAMES = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr",
    5: "May", 6: "Jun", 7: "Jul", 8: "Aug",
    9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

SEASON_MONTHS = {
    "summer": [6, 7, 8],
    "winter": [12, 1, 2],
    "spring": [3, 4, 5],
    "autumn": [9, 10, 11],
    "fall": [9, 10, 11],
    "monsoon": [7, 8, 9],
    "garmi": [6, 7, 8],  # Urdu: summer
    "sardi": [12, 1, 2],  # Urdu: winter
}


@dataclass
class NASADataResult:
    """Structured result from NASA POWER API."""
    city_name: str
    latitude: float
    longitude: float
    parameter: str
    parameter_name: str
    parameter_unit: str
    temporal_resolution: str  # "monthly" or "daily"
    start_year: int
    end_year: int
    # Monthly data: {"YYYYMM": value}
    raw_data: Dict[str, float] = field(default_factory=dict)
    # Yearly aggregated: {"YYYY": value}
    yearly_data: Dict[int, float] = field(default_factory=dict)
    # Seasonal aggregated (if season filter applied): {"YYYY": value}
    seasonal_data: Dict[int, float] = field(default_factory=dict)
    season_name: Optional[str] = None
    error: Optional[str] = None


def fetch_monthly_data(
    lat: float,
    lon: float,
    parameters: List[str],
    start_year: int = 2001,
    end_year: int = 2025,
    community: str = "RE",
) -> Dict[str, Dict[str, float]]:
    """
    Fetch monthly data from NASA POWER API.
    Returns: {"T2M": {"202301": 5.6, "202302": 8.1, ...}, ...}
    """
    url = f"{BASE_URL}/monthly/point"
    params = {
        "parameters": ",".join(parameters),
        "community": community,
        "latitude": lat,
        "longitude": lon,
        "start": start_year,
        "end": end_year,
        "format": "JSON",
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()

    data = resp.json()
    result = {}
    for param in parameters:
        param_data = data["properties"]["parameter"].get(param, {})
        # Filter out -999 (missing data marker)
        result[param] = {
            k: v for k, v in param_data.items()
            if v != -999 and k != "ANN" and len(k) == 6  # YYYYMM format
        }

    return result


def fetch_daily_data(
    lat: float,
    lon: float,
    parameters: List[str],
    start_date: str,  # YYYYMMDD
    end_date: str,  # YYYYMMDD
    community: str = "RE",
) -> Dict[str, Dict[str, float]]:
    """
    Fetch daily data from NASA POWER API.
    Returns: {"T2M": {"20230101": 5.6, ...}, ...}
    Note: Max range is 366 days per request.
    """
    url = f"{BASE_URL}/daily/point"
    params = {
        "parameters": ",".join(parameters),
        "community": community,
        "latitude": lat,
        "longitude": lon,
        "start": start_date,
        "end": end_date,
        "format": "JSON",
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()

    data = resp.json()
    result = {}
    for param in parameters:
        param_data = data["properties"]["parameter"].get(param, {})
        result[param] = {
            k: v for k, v in param_data.items()
            if v != -999
        }

    return result


def fetch_climatology(
    lat: float,
    lon: float,
    parameters: List[str],
    community: str = "RE",
) -> Dict[str, Dict[str, float]]:
    """
    Fetch climatology normals (long-term averages) from NASA POWER API.
    Returns monthly averages (JAN, FEB, ..., DEC, ANN).
    """
    url = f"{BASE_URL}/climatology/point"
    params = {
        "parameters": ",".join(parameters),
        "community": community,
        "latitude": lat,
        "longitude": lon,
        "format": "JSON",
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()

    data = resp.json()
    result = {}
    for param in parameters:
        param_data = data["properties"]["parameter"].get(param, {})
        result[param] = {k: v for k, v in param_data.items() if v != -999}

    return result


def get_climate_data(
    city_name: str,
    lat: float,
    lon: float,
    parameter: str = "T2M",
    start_year: int = 2001,
    end_year: int = 2025,
    season: Optional[str] = None,
) -> NASADataResult:
    """
    High-level function: fetch climate data for a city, aggregate yearly and seasonally.
    """
    param_info = PARAMETER_INFO.get(parameter, {
        "name": parameter,
        "unit": "?",
        "description": parameter,
    })

    result = NASADataResult(
        city_name=city_name,
        latitude=lat,
        longitude=lon,
        parameter=parameter,
        parameter_name=param_info["name"],
        parameter_unit=param_info["unit"],
        temporal_resolution="monthly",
        start_year=start_year,
        end_year=end_year,
    )

    try:
        monthly_data = fetch_monthly_data(
            lat=lat, lon=lon,
            parameters=[parameter],
            start_year=start_year,
            end_year=end_year,
        )
        result.raw_data = monthly_data.get(parameter, {})
    except Exception as e:
        result.error = str(e)
        return result

    # Aggregate to yearly averages
    yearly_sums: Dict[int, List[float]] = {}
    for key, value in result.raw_data.items():
        year = int(key[:4])
        month = int(key[4:6])
        if year not in yearly_sums:
            yearly_sums[year] = []
        yearly_sums[year].append(value)

    for year, values in yearly_sums.items():
        if len(values) >= 10:  # Need at least 10 months for a valid yearly average
            if parameter == "PRECTOTCORR":
                # For precipitation, sum instead of average (total annual rainfall)
                result.yearly_data[year] = round(sum(values) * 30.44, 2)  # mm/day → approx mm/month * 12
            else:
                result.yearly_data[year] = round(sum(values) / len(values), 2)

    # Seasonal aggregation
    if season:
        season_lower = season.lower()
        months = SEASON_MONTHS.get(season_lower, [6, 7, 8])  # Default to summer
        result.season_name = season

        seasonal_sums: Dict[int, List[float]] = {}
        for key, value in result.raw_data.items():
            year = int(key[:4])
            month = int(key[4:6])
            if month in months:
                if year not in seasonal_sums:
                    seasonal_sums[year] = []
                seasonal_sums[year].append(value)

        for year, values in seasonal_sums.items():
            if len(values) >= len(months) - 1:  # Allow 1 missing month
                if parameter == "PRECTOTCORR":
                    result.seasonal_data[year] = round(sum(values) * 30.44, 2)
                else:
                    result.seasonal_data[year] = round(sum(values) / len(values), 2)

    return result


def resolve_variable(text: str) -> str:
    """Map natural language variable descriptions to NASA POWER parameter codes."""
    text = text.strip().lower()
    return VARIABLE_MAPPING.get(text, "T2M")  # Default to temperature


def get_parameter_info(param_code: str) -> dict:
    """Get human-readable info about a parameter."""
    return PARAMETER_INFO.get(param_code, {
        "name": param_code,
        "unit": "?",
        "description": param_code,
        "category": "unknown",
    })


POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"


async def fetch_monthly(client, city, metric, start, end):
    """Fetch monthly point records from NASA POWER using httpx client."""
    headers = {"X-Api-Key": NASA_API_KEY} if NASA_API_KEY else {}
    response = await client.get(
        POWER_MONTHLY_URL,
        headers=headers,
        params={
            "parameters": metric,
            "community": "RE",
            "latitude": f"{city['lat']:.2f}",
            "longitude": f"{city['lon']:.2f}",
            "start": start,
            "end": end,
            "format": "JSON",
        },
    )
    response.raise_for_status()
    try:
        payload = response.json()
        values = payload["properties"]["parameter"][metric]
        if not isinstance(values, dict):
            raise ValueError("Invalid monthly series")
    except (KeyError, TypeError, ValueError) as exc:
        raise httpx.DecodingError("Invalid NASA POWER response") from exc
    return values, payload.get("header", {}).get("fill_value", -999)


async def fetch_nasa_apod(client: httpx.AsyncClient):
    """Fetch Astronomy / Earth Image of the Day from api.nasa.gov using configured API key."""
    url = "https://api.nasa.gov/planetary/apod"
    try:
        response = await client.get(url, params={"api_key": NASA_API_KEY})
        if response.status_code == 200:
            return response.json()
    except Exception:
        pass
    return None


