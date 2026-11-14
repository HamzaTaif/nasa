/**
 * Geocoding client using OpenStreetMap Nominatim with local in-memory caching
 * and 1 request/second rate-limiting compliance.
 */

const geocodeCache = new Map()
let lastRequestTime = 0

/**
 * Geocode a city name into lat/lon coordinates.
 * @param {string} name - City name (e.g. "Berlin", "Chicago", "Tokyo")
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<{id: string, name: string, country: string, lat: number, lon: number, isGeocoded: boolean}>}
 */
export async function geocodeCity(name, signal) {
  const query = name.trim()
  if (!query) {
    throw new Error('City name is empty.')
  }

  const cacheKey = query.toLowerCase()
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)
  }

  // Comply with Nominatim policy: max 1 request/sec
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed))
  }
  lastRequestTime = Date.now()

  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    addressdetails: '1',
  })}`

  let response
  try {
    response = await fetch(url, {
      signal,
      headers: {
        'Accept': 'application/json',
      },
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error(`Could not reach the geocoding service to locate "${query}". Please check your internet connection.`)
  }

  if (!response.ok) {
    throw new Error(`Geocoding service returned HTTP ${response.status}.`)
  }

  const results = await response.json()
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Could not locate "${query}" on Earth. Please check the spelling or try a nearby major city.`)
  }

  const match = results[0]
  const lat = parseFloat(match.lat)
  const lon = parseFloat(match.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid geographic coordinates received for "${query}".`)
  }

  const address = match.address || {}
  const displayName = address.city || address.town || address.village || address.municipality || address.state || match.name || query
  const country = address.country || match.display_name?.split(',').pop()?.trim() || ''

  const city = {
    id: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'city',
    name: displayName,
    country: country,
    lat: Number(lat.toFixed(2)),
    lon: Number(lon.toFixed(2)),
    isGeocoded: true,
  }

  geocodeCache.set(cacheKey, city)
  return city
}
