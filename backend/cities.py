"""City coordinates and metric metadata shared with the frontend."""

import json
from pathlib import Path

CATALOG = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend/src/catalog.json").read_text(
        encoding="utf-8"
    )
)
CITIES = {city["id"]: city for city in CATALOG["cities"]}
METRICS = CATALOG["metrics"]
