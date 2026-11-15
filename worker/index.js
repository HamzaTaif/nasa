const publicNominatim = 'https://nominatim.openstreetmap.org/search'
const lookupTimeout = 6000
const reservationLifetime = 15000
const requestSpacing = 1100
const day = 24 * 60 * 60 * 1000
const databaseNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

async function cacheKey(provider, query) {
  const input = JSON.stringify([provider, query.normalize('NFKC').toLowerCase()])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function readCoordinate(value, max) {
  const coordinate = value?.trim()
  if (!coordinate || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(coordinate)) return null
  const number = Number(coordinate)
  return Math.abs(number) <= max ? String(number) : null
}

async function lookup(url, query, point, origin) {
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('accept-language', 'en')
  if (point) {
    url.searchParams.set('lat', point.lat)
    url.searchParams.set('lon', point.lon)
    url.searchParams.set('zoom', '10')
  } else {
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '1')
    url.searchParams.set('layer', 'address')
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrendProof/1.0', Accept: 'application/json', Referer: `${origin}/` },
    signal: AbortSignal.timeout(lookupTimeout),
    // Workers returns 3xx as-is in manual mode. Treat it as a failed lookup.
    redirect: 'manual',
  })
  if (point && (response.ok || response.status === 404)) {
    const result = await response.json()
    if (result?.error === 'Unable to geocode') return null
    if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result) || 'error' in result) {
      throw new Error('Invalid reverse geocoder response')
    }
    return result
  }
  if (!response.ok) {
    console.warn('Nominatim HTTP status', response.status)
    throw new Error('Upstream lookup failed')
  }
  const results = await response.json()
  if (!Array.isArray(results)) throw new Error('Invalid geocoder response')
  return results.slice(0, 1)
}

async function geocode(request, url, env) {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405, { Allow: 'GET' })
  const requestSite = request.headers.get('Sec-Fetch-Site')
  if (requestSite === 'cross-site' || requestSite === 'same-site') return json({ error: 'Submit the lookup from TrendProof.' }, 403)
  const reverse = url.searchParams.has('lat') || url.searchParams.has('lon')
  const point = reverse ? {
    lat: readCoordinate(url.searchParams.get('lat'), 90),
    lon: readCoordinate(url.searchParams.get('lon'), 180),
  } : null
  if (point && (point.lat === null || point.lon === null)) {
    return json({ error: 'Enter a valid latitude and longitude.' }, 400)
  }
  const query = url.searchParams.get('q')?.trim().replace(/\s+/gu, ' ') ?? ''
  if (!reverse && (query.length > 150 || query.length < 2 || !/\p{L}/u.test(query))) {
    return json({ error: 'Enter a city name.' }, 400)
  }
  const searchProvider = env.TRENDPROOF_NOMINATIM_UPSTREAM?.trim() || publicNominatim
  const reverseProvider = reverse && env.TRENDPROOF_NOMINATIM_REVERSE_UPSTREAM?.trim()
  const provider = reverseProvider || searchProvider
  if (!env.DB || searchProvider === 'off' || provider === 'off') return json({ error: 'Live city lookup is unavailable.' }, 503)

  try {
    const upstream = new URL(provider)
    if (upstream.protocol !== 'https:') return json({ error: 'Live city lookup is unavailable.' }, 503)
    if (reverse && !reverseProvider) {
      if (!/\/search(?:\.php)?\/?$/.test(upstream.pathname)) return json({ error: 'Live city lookup is unavailable.' }, 503)
      upstream.pathname = upstream.pathname.replace(/\/search(?:\.php)?\/?$/, '/reverse')
    }
    const key = await cacheKey(upstream.href, point ? `reverse:${point.lat},${point.lon}` : query)
    const now = Date.now()
    const cached = await env.DB.prepare('SELECT results FROM geocode_cache WHERE key = ? AND expires_at > ?').bind(key, now).first()
    if (cached) return json(JSON.parse(cached.results))

    // One atomic reservation across isolates. A short lease recovers if a Worker exits early.
    const token = crypto.randomUUID()
    const reservation = await env.DB.prepare(`
      INSERT INTO geocode_gate (id, token, available_at) VALUES (1, ?, ${databaseNow} + ?)
      ON CONFLICT(id) DO UPDATE SET token = excluded.token, available_at = excluded.available_at
      WHERE geocode_gate.available_at <= ${databaseNow}
      RETURNING token
    `).bind(token, reservationLifetime).first()
    if (!reservation) return json({ error: 'Live city lookup is busy.' }, 429, { 'Retry-After': '2' })

    try {
      const results = await lookup(upstream, query, point, url.origin)
      const found = reverse ? results !== null : results.length > 0
      const expiresAt = Date.now() + day * (found ? 30 : 1)
      await env.DB.prepare('INSERT OR REPLACE INTO geocode_cache (key, results, expires_at) VALUES (?, ?, ?)')
        .bind(key, JSON.stringify(results), expiresAt).run()
      return json(results)
    } finally {
      await env.DB.prepare(`UPDATE geocode_gate SET available_at = ${databaseNow} + ? WHERE id = 1 AND token = ?`)
        .bind(requestSpacing, token).run()
    }
  } catch (error) {
    console.warn('TrendProof geocoding request failed', error.name)
    return json({ error: 'Live city lookup is unavailable.' }, 503)
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/geocode') return geocode(request, url, env)
    return env.ASSETS.fetch(request)
  },
}
