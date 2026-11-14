import { annualSeries, linearTrend } from './analysis.js'

export const POWER_DOCS = 'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/'
const endpoint = 'https://power.larc.nasa.gov/api/temporal/monthly/point'
const snapshotCities = new Set(['peshawar', 'lahore', 'karachi', 'islamabad'])
const cache = new Map()

export function sourceUrl(parsed) {
  return `${endpoint}?${new URLSearchParams({
    parameters: parsed.metric,
    community: 'RE',
    latitude: parsed.city.lat.toFixed(2),
    longitude: parsed.city.lon.toFixed(2),
    start: String(parsed.start),
    end: String(parsed.end),
    format: 'JSON',
  })}`
}

function analyzePayload(payload, parsed, snapshot) {
  return {
    ...parsed,
    ...linearTrend(annualSeries(payload, parsed)),
    url: sourceUrl(parsed),
    snapshot,
  }
}

export async function readSnapshot(parsed, signal) {
  if (!snapshotCities.has(parsed.city.id) || parsed.start < 1984 || parsed.end > 2025) return null
  const response = await fetch(`${import.meta.env.BASE_URL}data/${parsed.city.id}.json`, { signal })
  if (!response.ok) return null
  const payload = await response.json()
  return analyzePayload(payload, parsed, payload.trendproof_snapshot)
}

export async function analyzeClaim(parsed, signal) {
  const url = sourceUrl(parsed)
  if (cache.has(url)) return { ...cache.get(url), ...parsed }

  const backend = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '')
  let result
  try {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(11000)])
    const apiUrl = backend ? `${backend}/api/analyze?${new URLSearchParams({
      city: parsed.city.id, metric: parsed.metric, start: parsed.start, end: parsed.end,
    })}` : url
    const response = await fetch(apiUrl, { signal: requestSignal })
    if (!response.ok) {
      const issue = backend ? await response.json().catch(() => null) : null
      throw new Error(issue?.detail ?? `NASA POWER returned HTTP ${response.status}.`)
    }
    const payload = await response.json()
    result = backend ? { ...parsed, ...payload, url, snapshot: null } : analyzePayload(payload, parsed, null)
  } catch (error) {
    if (signal.aborted) throw error
    try {
      result = await readSnapshot(parsed, signal)
    } catch (snapshotError) {
      if (signal.aborted) throw snapshotError
    }
    if (!result) {
      if (error.message.startsWith('NASA POWER supplied')) throw error
      throw new Error('NASA POWER could not return this range right now. Retry, or try one of the saved example claims.')
    }
  }
  if (!result.snapshot) cache.set(url, result)
  return result
}
