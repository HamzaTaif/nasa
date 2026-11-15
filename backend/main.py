"""Optional SciPy-backed API for TrendProof."""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from .analysis import analyze_series, annual_series
from .cities import CITIES, METRICS
from .geocode import Geocoder
from .nasa_power import fetch_monthly


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(timeout=8.0) as client:
        app.state.nasa_client = client
        app.state.geocoder = Geocoder(client)
        yield


app = FastAPI(title="TrendProof", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "TRENDPROOF_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(","),
    allow_methods=["GET"],
)


@app.get("/api/geocode")
async def geocode(request: Request, q: str = Query(min_length=2, max_length=120)):
    return await request.app.state.geocoder.search(q)


@app.get("/api/analyze")
async def analyze(request: Request, city: str, metric: str, start: int, end: int):
    if city not in CITIES or metric not in METRICS:
        raise HTTPException(422, "Choose a supported city and climate metric.")
    latest_year = datetime.now(timezone.utc).year - 1
    if start < METRICS[metric]["firstYear"] or end > latest_year or end - start + 1 < 5:
        raise HTTPException(422, "Choose at least five complete years within the metric's available range.")
    try:
        values, fill = await fetch_monthly(request.app.state.nasa_client, CITIES[city], metric, start, end)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "NASA POWER could not return data for this range.") from exc
    try:
        return analyze_series(annual_series(values, fill, metric, start, end))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
