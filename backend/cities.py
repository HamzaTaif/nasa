"""
TrendProof — City Coordinates Database
Pakistan cities + major world cities with lat/lon for NASA POWER API lookups.
Shares catalog definitions with the frontend.
"""

from typing import Optional, Dict, List
from pathlib import Path
import json
import difflib

# Load catalog shared with frontend if available
_catalog_path = Path(__file__).resolve().parents[1] / "frontend" / "src" / "catalog.json"
if _catalog_path.is_file():
    try:
        CATALOG = json.loads(_catalog_path.read_text(encoding="utf-8"))
    except Exception:
        CATALOG = {"cities": [], "metrics": {}}
else:
    CATALOG = {"cities": [], "metrics": {}}

# Default metrics definition fallback
METRICS = CATALOG.get("metrics") or {
    "T2M": {"name": "Mean temperature", "label": "Temperature", "unit": "°C", "slopeUnit": "°C", "digits": 1, "firstYear": 1981},
    "T2M_MAX_AVG": {"name": "Mean daily high", "label": "Daily high temperature", "unit": "°C", "slopeUnit": "°C", "digits": 1, "firstYear": 1981},
    "T2M_MIN_AVG": {"name": "Mean daily low", "label": "Daily low temperature", "unit": "°C", "slopeUnit": "°C", "digits": 1, "firstYear": 1981},
    "PRECTOTCORR": {"name": "Annual precipitation", "label": "Rainfall", "unit": "mm", "slopeUnit": "mm", "digits": 0, "firstYear": 1981},
    "RH2M": {"name": "Relative humidity", "label": "Humidity", "unit": "%", "slopeUnit": "pp", "digits": 1, "firstYear": 1981},
    "ALLSKY_SFC_SW_DWN": {"name": "Mean solar irradiance", "label": "Solar irradiance", "unit": "kWh/m²/day", "slopeUnit": "kWh/m²/day", "digits": 2, "firstYear": 1984},
    "WS2M": {"name": "Mean wind speed", "label": "Wind speed", "unit": "m/s", "slopeUnit": "m/s", "digits": 2, "firstYear": 1981},
}

# Format: "city_name_lowercase": {"name": "Display Name", "lat": float, "lon": float, "country": "XX"}
CITIES: Dict[str, dict] = {
    # ===== PAKISTAN (extensive) =====
    "peshawar": {"name": "Peshawar", "lat": 34.01, "lon": 71.52, "country": "PK", "province": "KPK"},
    "islamabad": {"name": "Islamabad", "lat": 33.69, "lon": 73.04, "country": "PK", "province": "ICT"},
    "rawalpindi": {"name": "Rawalpindi", "lat": 33.60, "lon": 73.05, "country": "PK", "province": "Punjab"},
    "lahore": {"name": "Lahore", "lat": 31.55, "lon": 74.35, "country": "PK", "province": "Punjab"},
    "karachi": {"name": "Karachi", "lat": 24.86, "lon": 67.01, "country": "PK", "province": "Sindh"},
    "faisalabad": {"name": "Faisalabad", "lat": 31.42, "lon": 73.08, "country": "PK", "province": "Punjab"},
    "multan": {"name": "Multan", "lat": 30.20, "lon": 71.45, "country": "PK", "province": "Punjab"},
    "quetta": {"name": "Quetta", "lat": 30.18, "lon": 66.99, "country": "PK", "province": "Balochistan"},
    "hyderabad": {"name": "Hyderabad", "lat": 25.40, "lon": 68.37, "country": "PK", "province": "Sindh"},
    "sialkot": {"name": "Sialkot", "lat": 32.50, "lon": 74.53, "country": "PK", "province": "Punjab"},
    "gujranwala": {"name": "Gujranwala", "lat": 32.19, "lon": 74.19, "country": "PK", "province": "Punjab"},
    "bahawalpur": {"name": "Bahawalpur", "lat": 29.39, "lon": 71.68, "country": "PK", "province": "Punjab"},
    "sargodha": {"name": "Sargodha", "lat": 32.08, "lon": 72.67, "country": "PK", "province": "Punjab"},
    "sukkur": {"name": "Sukkur", "lat": 27.70, "lon": 68.86, "country": "PK", "province": "Sindh"},
    "larkana": {"name": "Larkana", "lat": 27.56, "lon": 68.21, "country": "PK", "province": "Sindh"},
    "mardan": {"name": "Mardan", "lat": 34.20, "lon": 72.05, "country": "PK", "province": "KPK"},
    "abbottabad": {"name": "Abbottabad", "lat": 34.15, "lon": 73.21, "country": "PK", "province": "KPK"},
    "mingora": {"name": "Mingora", "lat": 34.78, "lon": 72.36, "country": "PK", "province": "KPK"},
    "swat": {"name": "Swat", "lat": 35.22, "lon": 72.34, "country": "PK", "province": "KPK"},
    "dera ismail khan": {"name": "Dera Ismail Khan", "lat": 31.83, "lon": 70.90, "country": "PK", "province": "KPK"},
    "dera ghazi khan": {"name": "Dera Ghazi Khan", "lat": 30.05, "lon": 70.64, "country": "PK", "province": "Punjab"},
    "sahiwal": {"name": "Sahiwal", "lat": 30.66, "lon": 73.11, "country": "PK", "province": "Punjab"},
    "okara": {"name": "Okara", "lat": 30.81, "lon": 73.45, "country": "PK", "province": "Punjab"},
    "jhang": {"name": "Jhang", "lat": 31.27, "lon": 72.32, "country": "PK", "province": "Punjab"},
    "gwadar": {"name": "Gwadar", "lat": 25.12, "lon": 62.33, "country": "PK", "province": "Balochistan"},
    "turbat": {"name": "Turbat", "lat": 26.00, "lon": 63.07, "country": "PK", "province": "Balochistan"},
    "gilgit": {"name": "Gilgit", "lat": 35.92, "lon": 74.31, "country": "PK", "province": "GB"},
    "skardu": {"name": "Skardu", "lat": 35.30, "lon": 75.63, "country": "PK", "province": "GB"},
    "chitral": {"name": "Chitral", "lat": 35.85, "lon": 71.79, "country": "PK", "province": "KPK"},
    "muzaffarabad": {"name": "Muzaffarabad", "lat": 34.37, "lon": 73.47, "country": "PK", "province": "AJK"},
    "mirpur": {"name": "Mirpur", "lat": 33.15, "lon": 73.75, "country": "PK", "province": "AJK"},
    "nowshera": {"name": "Nowshera", "lat": 34.02, "lon": 71.97, "country": "PK", "province": "KPK"},
    "charsadda": {"name": "Charsadda", "lat": 34.15, "lon": 71.74, "country": "PK", "province": "KPK"},
    "kohat": {"name": "Kohat", "lat": 33.59, "lon": 71.44, "country": "PK", "province": "KPK"},
    "bannu": {"name": "Bannu", "lat": 32.99, "lon": 70.60, "country": "PK", "province": "KPK"},
    "mansehra": {"name": "Mansehra", "lat": 34.33, "lon": 73.20, "country": "PK", "province": "KPK"},
    "haripur": {"name": "Haripur", "lat": 33.99, "lon": 72.93, "country": "PK", "province": "KPK"},
    "jacobabad": {"name": "Jacobabad", "lat": 28.28, "lon": 68.44, "country": "PK", "province": "Sindh"},
    "nawabshah": {"name": "Nawabshah", "lat": 26.25, "lon": 68.41, "country": "PK", "province": "Sindh"},
    "khuzdar": {"name": "Khuzdar", "lat": 27.80, "lon": 66.62, "country": "PK", "province": "Balochistan"},
    "zhob": {"name": "Zhob", "lat": 31.35, "lon": 69.45, "country": "PK", "province": "Balochistan"},
    "waziristan": {"name": "Waziristan", "lat": 32.30, "lon": 69.87, "country": "PK", "province": "KPK"},
    "taxila": {"name": "Taxila", "lat": 33.75, "lon": 72.83, "country": "PK", "province": "Punjab"},
    "murree": {"name": "Murree", "lat": 33.91, "lon": 73.39, "country": "PK", "province": "Punjab"},
    "naran": {"name": "Naran", "lat": 34.90, "lon": 73.65, "country": "PK", "province": "KPK"},
    "hunza": {"name": "Hunza", "lat": 36.32, "lon": 74.65, "country": "PK", "province": "GB"},

    # ===== MAJOR WORLD CITIES =====
    "new york": {"name": "New York", "lat": 40.71, "lon": -74.01, "country": "US"},
    "los angeles": {"name": "Los Angeles", "lat": 34.05, "lon": -118.24, "country": "US"},
    "chicago": {"name": "Chicago", "lat": 41.88, "lon": -87.63, "country": "US"},
    "houston": {"name": "Houston", "lat": 29.76, "lon": -95.37, "country": "US"},
    "phoenix": {"name": "Phoenix", "lat": 33.45, "lon": -112.07, "country": "US"},
    "london": {"name": "London", "lat": 51.51, "lon": -0.13, "country": "GB"},
    "paris": {"name": "Paris", "lat": 48.86, "lon": 2.35, "country": "FR"},
    "berlin": {"name": "Berlin", "lat": 52.52, "lon": 13.40, "country": "DE"},
    "tokyo": {"name": "Tokyo", "lat": 35.68, "lon": 139.69, "country": "JP"},
    "beijing": {"name": "Beijing", "lat": 39.90, "lon": 116.40, "country": "CN"},
    "shanghai": {"name": "Shanghai", "lat": 31.23, "lon": 121.47, "country": "CN"},
    "mumbai": {"name": "Mumbai", "lat": 19.08, "lon": 72.88, "country": "IN"},
    "delhi": {"name": "Delhi", "lat": 28.61, "lon": 77.21, "country": "IN"},
    "new delhi": {"name": "New Delhi", "lat": 28.61, "lon": 77.21, "country": "IN"},
    "bangalore": {"name": "Bangalore", "lat": 12.97, "lon": 77.59, "country": "IN"},
    "chennai": {"name": "Chennai", "lat": 13.08, "lon": 80.27, "country": "IN"},
    "kolkata": {"name": "Kolkata", "lat": 22.57, "lon": 88.36, "country": "IN"},
    "dubai": {"name": "Dubai", "lat": 25.20, "lon": 55.27, "country": "AE"},
    "riyadh": {"name": "Riyadh", "lat": 24.71, "lon": 46.67, "country": "SA"},
    "istanbul": {"name": "Istanbul", "lat": 41.01, "lon": 28.98, "country": "TR"},
    "cairo": {"name": "Cairo", "lat": 30.04, "lon": 31.24, "country": "EG"},
    "moscow": {"name": "Moscow", "lat": 55.76, "lon": 37.62, "country": "RU"},
    "sydney": {"name": "Sydney", "lat": -33.87, "lon": 151.21, "country": "AU"},
    "toronto": {"name": "Toronto", "lat": 43.65, "lon": -79.38, "country": "CA"},
    "singapore": {"name": "Singapore", "lat": 1.35, "lon": 103.82, "country": "SG"},
    "bangkok": {"name": "Bangkok", "lat": 13.76, "lon": 100.50, "country": "TH"},
    "jakarta": {"name": "Jakarta", "lat": -6.21, "lon": 106.85, "country": "ID"},
    "seoul": {"name": "Seoul", "lat": 37.57, "lon": 126.98, "country": "KR"},
    "nairobi": {"name": "Nairobi", "lat": -1.29, "lon": 36.82, "country": "KE"},
    "lagos": {"name": "Lagos", "lat": 6.52, "lon": 3.38, "country": "NG"},
    "cape town": {"name": "Cape Town", "lat": -33.93, "lon": 18.42, "country": "ZA"},
    "sao paulo": {"name": "São Paulo", "lat": -23.55, "lon": -46.63, "country": "BR"},
    "mexico city": {"name": "Mexico City", "lat": 19.43, "lon": -99.13, "country": "MX"},
    "buenos aires": {"name": "Buenos Aires", "lat": -34.60, "lon": -58.38, "country": "AR"},
    "kabul": {"name": "Kabul", "lat": 34.53, "lon": 69.17, "country": "AF"},
    "tehran": {"name": "Tehran", "lat": 35.69, "lon": 51.39, "country": "IR"},
    "baghdad": {"name": "Baghdad", "lat": 33.31, "lon": 44.37, "country": "IQ"},
    "dhaka": {"name": "Dhaka", "lat": 23.81, "lon": 90.41, "country": "BD"},
    "kathmandu": {"name": "Kathmandu", "lat": 27.72, "lon": 85.32, "country": "NP"},
    "colombo": {"name": "Colombo", "lat": 6.93, "lon": 79.85, "country": "LK"},
}


# Common aliases and alternate spellings
ALIASES: Dict[str, str] = {
    "pindi": "rawalpindi",
    "isb": "islamabad",
    "lhr": "lahore",
    "khi": "karachi",
    "pew": "peshawar",
    "nyc": "new york",
    "la": "los angeles",
    "sf": "san francisco",
    "dc": "washington",
    "fsd": "faisalabad",
    "rwp": "rawalpindi",
    "mux": "multan",
    "skt": "sialkot",
    "bwp": "bahawalpur",
    "di khan": "dera ismail khan",
    "dg khan": "dera ghazi khan",
    "d.i. khan": "dera ismail khan",
    "d.g. khan": "dera ghazi khan",
    "bombay": "mumbai",
    "calcutta": "kolkata",
    "madras": "chennai",
    "peking": "beijing",
    "constantinople": "istanbul",
}


def find_city(query: str) -> Optional[dict]:
    """
    Find a city by name, alias, or fuzzy match.
    Returns city dict with name, lat, lon, country or None.
    """
    query = query.strip().lower()

    # Direct match
    if query in CITIES:
        return CITIES[query]

    # Alias match
    if query in ALIASES:
        return CITIES[ALIASES[query]]

    # Fuzzy match — find closest city name
    all_names = list(CITIES.keys()) + list(ALIASES.keys())
    matches = difflib.get_close_matches(query, all_names, n=1, cutoff=0.6)
    if matches:
        match = matches[0]
        if match in ALIASES:
            match = ALIASES[match]
        return CITIES.get(match)

    return None


def search_cities(query: str, limit: int = 10) -> List[dict]:
    """Search cities by partial name match."""
    query = query.strip().lower()
    results = []
    for key, city in CITIES.items():
        if query in key or query in city["name"].lower():
            results.append(city)
            if len(results) >= limit:
                break
    return results


# Merge catalog cities by ID for frontend API compatibility
for _c in CATALOG.get("cities", []):
    _cid = _c.get("id")
    if _cid:
        CITIES[_cid] = _c
        if _c.get("name"):
            CITIES.setdefault(_c["name"].lower(), _c)


def get_pakistan_cities() -> List[dict]:
    """Return all Pakistan cities."""
    return [c for c in CITIES.values() if c.get("country") == "PK"]
