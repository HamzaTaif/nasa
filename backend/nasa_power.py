"""Fetch monthly point records from NASA POWER."""

import httpx

POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"


async def fetch_monthly(client, city, metric, start, end):
    response = await client.get(
        POWER_URL,
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
