# TrendProof

TrendProof tests local climate claims against NASA POWER for the 2026 NASA Space Apps Challenge, [Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/).

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm. No NASA API key is needed.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. For a production build, run `npm run build`. `npm run preview` serves `dist/client/`, which also works on a static host with the bundled city index. The hosted application additionally runs the geocoding gateway in `dist/server/`.

## Try the demo

- Peshawar is getting hotter
- Rainfall in Lahore is decreasing
- Karachi is getting more humid
- Riyadh is getting hotter
- Moscow temperature trend
- São Paulo humidity is increasing
- Jakarta is getting hotter
- Show the annual rainfall trend in Islamabad from 1990 to 2020
- Daily highs in London are increasing since 1990

Use one city and metric per claim. The Methodology dialog lists the available metrics. For cities with shared names, add a country or region after a comma, such as “Paris, Texas”. The rules extract the variable, direction, and year range locally. The NASA POWER request contains city coordinates, a parameter, and the years. Built-in cities resolve directly. Other cities use a bundled [GeoNames](https://www.geonames.org/) index covering more than 226,000 populated places. Only the needed lookup shard is downloaded. TrendProof supports annual trends over at least five complete years.

## Data and statistics

- [NASA POWER Monthly API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/) provides model-grid point values. Meteorological parameters come from [NASA MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/).
- TrendProof drops years with missing months and ignores NASA's annual summary field. It weights monthly means by the days in each month. For corrected precipitation, it converts each monthly daily rate to a monthly total and sums precipitation in millimeters per year.
- Ordinary least squares fits the annual values. A two-sided Student t-test tests the zero-slope hypothesis at p < 0.05. The chart marks years whose residual exceeds twice the residual standard error. The inference assumes independent residuals and constant error variance. Serial correlation can affect the reported significance. Causal attribution requires a separate study.
- The opening example uses a saved NASA POWER response. Submitted claims request NASA POWER live. If that request fails, bundled responses can cover 1984–2025 for Peshawar, Lahore, Karachi, Islamabad, and Jakarta. Saved results show their retrieval date and link to the original request.
- The Earth image is NASA Goddard's [Blue Marble (2002), Eastern Hemisphere](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/), by Reto Stöckli with enhancements by Robert Simmon. Geist and Instrument Sans include their font licenses.

## Optional FastAPI + SciPy backend

The default frontend can run on its own. To run trend calculations in Python, create an environment with Python 3.11 or newer and run the following from the project root.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000
```

In another terminal, run:

```bash
VITE_BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

Set `TRENDPROOF_ORIGINS` to a comma-separated list if your frontend runs on a different origin. The endpoint takes a city ID, NASA POWER metric, and complete year range.

```text
GET /api/analyze?city=peshawar&metric=T2M&start=2001&end=2025
```

## Interactive Earth globe

Drag the globe to rotate it, or use the arrow keys while it is focused. Click or tap a point, or press Enter or Space to select the center. TrendProof fills the claim with the nearest city in its catalog. Submit a valid claim to fly to that city's coordinates and highlight its country. The globe resumes idle rotation after five seconds of inactivity. Use **Clear highlight** to reset the selection.

The hero loads the globe on demand. It uses WebGL when available and has an interactive Canvas fallback. A static Earth image is displayed on phones and if interactive rendering fails. The interactive globe downloads the imagery from UNPKG and respects reduced-motion settings. NASA imagery is archival. The globe's lighting is set for the visualization. [Image and boundary credits](frontend/public/globe/credits.txt).

## Worldwide city lookup

The hosted `/api/geocode` gateway identifies itself to Nominatim as `TrendProof/1.0`, caches matches, and limits upstream requests across users. The browser sends only the extracted city name on submission. If the gateway is unavailable or has no match, the app searches the bundled GeoNames index. Set the gateway's `TRENDPROOF_NOMINATIM_UPSTREAM` environment variable to switch providers, or to `off` to disable upstream lookups.

For local use with Nominatim, the optional FastAPI server includes `GET /api/geocode?q=...` as a single-process gateway. Give that server `TRENDPROOF_NOMINATIM_UPSTREAM` and `TRENDPROOF_GEOCODER_CONTACT`, and set `VITE_NOMINATIM_URL` to the gateway's URL. Follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) when using the public OpenStreetMap endpoint.

GeoNames data is licensed under CC BY 4.0. See [geocoding data credits](frontend/public/geocoding/credits.txt).
