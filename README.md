# TrendProof — Climate Claim Verification with NASA Data

> **NASA Space Apps Challenge 2026** — *Be An Earth System Trend Detective!*  
> Challenge details: [NASA Space Apps Challenge](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)

---

## Overview

**TrendProof** is a climate verification engine that tests natural language climate statements against decades of satellite-derived observations from **NASA POWER** (Prediction of Worldwide Energy Resources).

Instead of subjective verdicts or simple binary answers, TrendProof applies rigorous statistical hypothesis testing (Ordinary Least Squares regression, two-tailed Student's t-test, 95% confidence intervals, and residual outlier detection) to determine whether real-world Earth observation data confirms, partially supports, or contradicts a claim.

---

## Key Features

- **Natural Language Parsing**: Accepts everyday phrases such as *"Peshawar is getting hotter"* or *"Rainfall in Lahore is decreasing since 2000"*, automatically detecting city coordinates, target climate parameters, and time horizons.
- **NASA POWER Satellite & Reanalysis Data**: Direct access to monthly meteorological metrics derived from **NASA MERRA-2** assimilation models covering 1981 through the latest complete year.
- **Statistically Rigorous Verdicts**:
  - **Confirmed**: Trend direction matches the claim with $p < 0.05$.
  - **Partially True**: Direction aligns, but sample variance or effect size yields inconclusive statistical significance.
  - **Not Supported**: Data demonstrates a flat slope or trend in the opposite direction.
- **Anomaly Detection**: Flags years where residuals exceed twice the residual standard error ($> 2\sigma$).
- **Offline / Resilient Fallbacks**: Pre-cached satellite snapshots ensure zero-downtime demonstrations for key metropolitan centers even if external APIs experience transient rate limits.
- **Data Export**: One-click CSV download of annual time series, linear trend lines, and outlier classifications.

---

## Architecture

```text
[ User Natural Language Claim ]
              │
              ▼
   ┌──────────────────────┐
   │ Claim Parser (NLP)   │ ── Extracts city, metric, direction, & range
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │ NASA POWER Client    │ ── Fetches monthly satellite observations
   └──────────────────────┘    (Fallback to local snapshots if offline)
              │
              ▼
   ┌──────────────────────┐
   │ Statistical Engine   │ ── OLS regression, t-test, confidence intervals
   └──────────────────────┘    (Browser JS jStat or FastAPI SciPy backend)
              │
              ▼
┌────────────────────────────┐
│ Interactive Visualization  │ ── Verdict card, trend chart & CSV export
└────────────────────────────┘
```

---

## Supported Climate Metrics

| Parameter | Name | Units | Source | Available From |
| :--- | :--- | :--- | :--- | :--- |
| `T2M` | Mean Surface Temperature | °C | MERRA-2 | 1981 |
| `T2M_MAX_AVG` | Mean Daily High Temperature | °C | MERRA-2 | 1981 |
| `T2M_MIN_AVG` | Mean Daily Low Temperature | °C | MERRA-2 | 1981 |
| `PRECTOTCORR` | Annual Corrected Precipitation | mm | MERRA-2 | 1981 |
| `RH2M` | Relative Humidity | % | MERRA-2 | 1981 |
| `ALLSKY_SFC_SW_DWN` | Solar Irradiance | kWh/m²/day | Satellite | 1984 |
| `WS2M` | Wind Speed | m/s | MERRA-2 | 1981 |

---

## Quickstart (Local Development)

### 1. Frontend (Standalone)

The React client can run entirely standalone by contacting NASA POWER directly from the browser:

```bash
# Install workspace dependencies
npm install

# Start Vite dev server
npm run dev

# Build production bundle to dist/
npm run build

# Preview production build
npm run preview
```

### 2. Full-Stack Mode (FastAPI + SciPy Backend)

To enable server-side Python statistical analysis:

```bash
# Setup backend dependencies
cd backend
pip install -r requirements.txt

# Start FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8000
```

In another terminal, connect the frontend:

```bash
VITE_BACKEND_URL=http://localhost:8000 npm run dev
```

---

## Deployment Options

### Option A — Frontend Only (Recommended & Instant)
- Build the static assets: `npm run build`
- Deploy the resulting `dist/` directory to **Vercel** (`npx vercel --prod`) or **Netlify** (via drag-and-drop on Netlify Drop or Netlify CLI).

### Option B — Full-Stack
- Deploy the `backend/` folder to **Render** or **Railway**:
  - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - Set Environment Variable: `TRENDPROOF_ORIGINS=https://your-frontend.vercel.app`
- Deploy frontend to Vercel with: `VITE_BACKEND_URL=https://your-backend.onrender.com`

---

## Demo Claims to Try

1. *"Peshawar is getting hotter"* (Tests long-term warming trend in Khyber Pakhtunkhwa)
2. *"Rainfall in Lahore is decreasing"* (Examines multi-decade precipitation trends)
3. *"Karachi is getting more humid"* (Tests 2-meter relative humidity variations)
4. *"Islamabad rainfall trend since 1990"* (Custom baseline analysis)
5. *"London daily highs are increasing"* (Global comparative check)

---

## NASA Earth Science Data Attribution

- Data provided via the **NASA Langley Research Center POWER Project** funded through the NASA Earth Science / Applied Science Program.
- Meteorology parameters based on the **NASA Global Modeling and Assimilation Office (GMAO) MERRA-2** reanalysis model.
- Earth imagery courtesy of **NASA Goddard Space Flight Center Blue Marble Collection**.

---

## License

This project is licensed under the MIT License.
