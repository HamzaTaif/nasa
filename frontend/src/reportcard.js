/**
 * Report Card — runs all 7 climate metrics for a city in parallel
 * and returns a compact summary of trends.
 */

import { annualSeries, linearTrend } from './analysis.js'
import { metrics } from './claims'

const endpoint = 'https://power.larc.nasa.gov/api/temporal/monthly/point'
const snapshotCities = new Set(['peshawar', 'lahore', 'karachi', 'islamabad'])

const metricEmoji = {
  T2M: '🌡️',
  T2M_MAX_AVG: '🔥',
  T2M_MIN_AVG: '❄️',
  PRECTOTCORR: '🌧️',
  RH2M: '💧',
  ALLSKY_SFC_SW_DWN: '☀️',
  WS2M: '💨',
}

const metricOrder = ['T2M', 'T2M_MAX_AVG', 'T2M_MIN_AVG', 'PRECTOTCORR', 'RH2M', 'ALLSKY_SFC_SW_DWN', 'WS2M']

export { metricEmoji, metricOrder }

function buildMetricResult(metricKey, meta, start, end, result) {
  const slopePerDecade = result.slope * 10
  const significant = result.pValue < 0.05
  const absSlopePerDecade = Math.abs(slopePerDecade)
  const stableThreshold = metricKey === 'PRECTOTCORR' ? 1 : 0.02

  let direction = 'stable'
  let arrow = '→'
  if (absSlopePerDecade > stableThreshold) {
    direction = slopePerDecade > 0 ? 'increasing' : 'decreasing'
    arrow = slopePerDecade > 0 ? '↑' : '↓'
  }

  return {
    metricKey,
    meta,
    direction,
    arrow,
    significant,
    slopePerDecade,
    pValue: result.pValue,
    rSquared: result.rSquared,
    start,
    end,
  }
}

async function loadSnapshotIfAvailable(city, signal) {
  if (snapshotCities.has(city?.id)) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/${city.id}.json`, { signal })
      if (res.ok) return await res.json()
    } catch {}
  }
  return null
}

/**
 * Fetch and analyze a single metric for a city.
 * Returns a result object or an error marker.
 */
async function analyzeMetric(city, metricKey, start, end, signal, snapshot) {
  const meta = metrics[metricKey]
  const adjustedStart = Math.max(start, meta?.firstYear ?? 1984)

  if (end - adjustedStart + 1 < 5) {
    return { metricKey, error: 'Insufficient range', meta }
  }

  // 1. Try local snapshot if available
  if (snapshot?.properties?.parameter?.[metricKey]) {
    try {
      const series = annualSeries(snapshot, { metric: metricKey, start: adjustedStart, end })
      const result = linearTrend(series)
      return buildMetricResult(metricKey, meta, adjustedStart, end, result)
    } catch {
      // Fallback to network
    }
  }

  const backend = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '')

  try {
    let result
    if (backend) {
      const apiUrl = `${backend}/api/analyze?${new URLSearchParams({
        city: city.id || 'custom',
        metric: metricKey,
        start: adjustedStart,
        end,
        lat: city.lat.toFixed(2),
        lon: city.lon.toFixed(2),
      })}`
      const response = await fetch(apiUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      result = await response.json()
    } else {
      const url = `${endpoint}?${new URLSearchParams({
        parameters: metricKey,
        community: 'RE',
        latitude: city.lat.toFixed(2),
        longitude: city.lon.toFixed(2),
        start: String(adjustedStart),
        end: String(end),
        format: 'JSON',
      })}`
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const series = annualSeries(payload, { metric: metricKey, start: adjustedStart, end })
      result = linearTrend(series)
    }

    return buildMetricResult(metricKey, meta, adjustedStart, end, result)
  } catch (err) {
    if (signal?.aborted) throw err
    return { metricKey, meta, error: err.message }
  }
}

/**
 * Generate a full report card for a city.
 * Runs all 7 metrics in parallel via Promise.allSettled.
 */
export async function generateReportCard(city, start, end, signal, onProgress) {
  const snapshot = await loadSnapshotIfAvailable(city, signal)

  const promises = metricOrder.map((metricKey, index) =>
    analyzeMetric(city, metricKey, start, end, signal, snapshot).then(result => {
      if (onProgress) onProgress(index + 1, metricOrder.length)
      return result
    })
  )

  const results = await Promise.allSettled(promises)

  const rows = results.map((settled, i) => {
    if (settled.status === 'fulfilled') return settled.value
    return { metricKey: metricOrder[i], meta: metrics[metricOrder[i]], error: settled.reason?.message || 'Failed' }
  })

  const successful = rows.filter(r => !r.error)
  const significantCount = successful.filter(r => r.significant).length

  return {
    city,
    start,
    end,
    rows,
    summary: {
      total: metricOrder.length,
      successful: successful.length,
      significant: significantCount,
    },
  }
}
