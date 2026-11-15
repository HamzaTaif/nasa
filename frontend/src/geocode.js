// The hosted app sets a same-origin Nominatim gateway in geocoding/config.json.
// The gateway identifies TrendProof to Nominatim and coordinates its request rate.
const dataRoot = `${import.meta.env.BASE_URL}geocoding/`
const endpointOverride = import.meta.env.VITE_NOMINATIM_URL?.trim()
const publicNominatim = 'https://nominatim.openstreetmap.org/search'
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
const osmSettlements = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'borough', 'suburb', 'locality'])
const cityCache = new Map()
const reverseCache = new Map()
const shardCache = new Map()
let configPromise
let publicRequests = Promise.resolve()
let nextPublicRequest = 0

const countryAliases = {
  GB: ['UK', 'Great Britain', 'Britain'],
  US: ['USA', 'US', 'United States of America'],
  KR: ['Republic of Korea', 'Korea'],
  RU: ['Russian Federation'],
  PS: ['Palestine', 'State of Palestine', 'Palestinian Territories'],
  CZ: ['Czech Republic'],
  CI: ['Ivory Coast'],
  TR: ['Turkey', 'Türkiye'],
  TW: ['Taiwan'],
  VN: ['Viet Nam'],
}

function normalize(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function countryLabel(code) {
  return code === 'PS' ? 'Palestine' : countryNames.of(code)
}

function validCoordinates(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function configuredNominatim() {
  if (endpointOverride) return Promise.resolve(endpointOverride)
  // This static asset is read at runtime so the provider can be switched without changing app code.
  return configPromise ??= fetch(`${dataRoot}config.json`, { signal: AbortSignal.timeout(2500) })
    .then(response => response.ok && response.headers.get('content-type')?.includes('json') ? response.json() : {})
    .then(config => typeof config.nominatimUrl === 'string' ? config.nominatimUrl.trim() : undefined)
    .catch(() => undefined)
}

async function searchNominatim(endpoint, query) {
  const url = new URL(endpoint, window.location.origin)
  const params = {
    q: query,
    format: 'json',
    limit: '1',
    addressdetails: '1',
    layer: 'address',
    'accept-language': 'en',
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
  // A static copy may serve its HTML shell or a 404 at the gateway URL.
  if (url.origin === window.location.origin && (response.status === 404
    || response.headers.get('content-type')?.includes('text/html'))) return undefined
  if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}.`)
  const results = await response.json()
  if (!Array.isArray(results)) throw new Error('Nominatim returned an invalid response.')

  const result = results[0]
  if (!result || typeof result !== 'object') return null
  const name = result.name || result.display_name?.split(',')[0]?.trim()
  const address = result.address ?? {}
  const code = address.country_code?.toUpperCase()
  const countryCode = /^[A-Z]{2}$/.test(code ?? '') ? code : undefined
  const country = countryCode ? countryLabel(countryCode) : address.country
  // The json format can report a city boundary as administrative. Its address
  // identifies the settlement even when the result has no addresstype field.
  const normalizedName = normalize(name)
  const cityState = ['SG', 'MC', 'VA'].includes(countryCode) && normalizedName === normalize(country)
  const isSettlement = osmSettlements.has(result.addresstype ?? result.type)
    || [...osmSettlements].some(type => address[type] && normalize(address[type]) === normalizedName)
  if (!name || (!isSettlement && !cityState)) return null

  const lat = Number.parseFloat(result.lat)
  const lon = Number.parseFloat(result.lon)
  const id = result.osm_id ?? result.place_id
  if (!validCoordinates(lat, lon) || !country || !id) return null
  return { id: `osm-${result.osm_type ?? 'place'}-${id}`, name, lat, lon, country, countryCode, geocoded: true, provider: 'nominatim' }
}

function queuePublicLookup(lookup) {
  // The hosted app uses the shared gateway. This covers older standalone copies.
  const request = publicRequests.then(async () => {
    const delay = nextPublicRequest - performance.now()
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    nextPublicRequest = performance.now() + 1100
    return lookup()
  })
  publicRequests = request.catch(() => null)
  return request
}

function searchPublicNominatim(query) {
  return queuePublicLookup(() => searchNominatim(publicNominatim, query))
}

export async function reverseGeocode(lat, lon, signal) {
  signal?.throwIfAborted()
  if (!validCoordinates(lat, lon)) throw new Error('This globe point has invalid coordinates.')
  const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6) })
  const key = params.toString()
  if (reverseCache.has(key)) return reverseCache.get(key)

  function request(url) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(6500)
    return fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
      referrerPolicy: 'strict-origin-when-cross-origin',
    })
  }

  const gateway = `/api/geocode?${params}`
  let response = await request(gateway)
  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    response = await request(gateway)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if ((response.status === 404 || response.ok) && !contentType.includes('json')) {
    // A static checkout has no gateway. Its browser identifies the app by referrer.
    const url = new URL('reverse', publicNominatim)
    url.search = new URLSearchParams({ ...Object.fromEntries(params), format: 'json', zoom: '10', 'accept-language': 'en' })
    response = await queuePublicLookup(() => request(url))
  }

  const data = await response.json().catch(() => undefined)
  signal?.throwIfAborted()
  if (data?.error === 'Unable to geocode' || (response.ok && data === null)) {
    reverseCache.set(key, null)
    return null
  }
  if (!response.ok || !data || Array.isArray(data) || typeof data !== 'object' || data.error) {
    throw new Error('Could not find a place name for this point. Try clicking again.')
  }

  const address = data.address ?? {}
  const name = [address.city, address.town, address.village, address.municipality, address.hamlet, address.state, data.name]
    .find(value => typeof value === 'string' && value.trim())?.trim()
    .replace(/\s+Municipal Corporation$/i, '')
  const code = address.country_code?.toUpperCase()
  const countryCode = /^[A-Z]{2}$/.test(code ?? '') ? code : undefined
  const country = countryCode ? countryLabel(countryCode) : address.country || ''
  const place = name ? { name, country, countryCode, lat, lon } : null
  reverseCache.set(key, place)
  return place
}

function readIndex(path, gzip = false) {
  if (!shardCache.has(path)) {
    const pending = fetch(`${dataRoot}${path}`, { signal: AbortSignal.timeout(12000) }).then(async response => {
      if (gzip && (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))) return {}
      if (!response.ok) throw new Error('The worldwide city index could not be loaded.')
      if (!gzip) return response.json()
      const bytes = new Uint8Array(await response.arrayBuffer())
      // Check the gzip magic bytes because browser fetch may have already decoded HTTP content encoding.
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes))
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      return new Response(stream).json()
    }).catch(error => {
      shardCache.delete(path)
      throw error
    })
    shardCache.set(path, pending)
  }
  return shardCache.get(path)
}

function qualifierMatches(row, qualifiers, admins) {
  const [, , code, , , , adminCode] = row
  const admin = admins[`${code}.${adminCode}`] ?? []
  const names = [code, countryLabel(code), ...(countryAliases[code] ?? []), ...admin].map(normalize)
  if (/^[A-Z]{2,3}$/.test(adminCode)) names.push(adminCode.toLowerCase())
  return qualifiers.every(qualifier => names.includes(qualifier)
    || (/^[a-z]( [a-z]){1,2}$/.test(qualifier) && names.includes(qualifier.replaceAll(' ', ''))))
}

async function searchGeoNames(query) {
  const [name, ...qualifiers] = query.split(',').map(normalize).filter(Boolean)
  if (!name) return null
  const bucket = name.match(/^[a-z]{1,2}/)?.[0] ?? 'u' + (name.codePointAt(0) >> 8).toString(16)
  const shard = await readIndex(`${bucket}.json.gz`, true)
  if (!Object.hasOwn(shard, name)) return null
  const records = shard[name]

  const admins = qualifiers.length ? await readIndex('admin1.json') : {}
  const city = records.find(row => qualifierMatches(row, qualifiers, admins))
  if (!city) return null

  const [id, displayName, code, lat, lon] = city
  if (!validCoordinates(lat, lon)) return null
  return { id: `geonames-${id}`, name: displayName, country: countryLabel(code), countryCode: code, lat, lon, geocoded: true, provider: 'geonames' }
}

async function lookupCity(query) {
  const endpoint = await configuredNominatim()
  let needsPublicLookup = endpoint === undefined
  let city
  let providerError
  if (endpoint) {
    try {
      city = endpoint === publicNominatim ? await searchPublicNominatim(query) : await searchNominatim(endpoint, query)
      needsPublicLookup = city === undefined
    } catch (error) {
      providerError = error
    }
  }

  if (!city) {
    try {
      city = await searchGeoNames(query)
    } catch (error) {
      providerError ??= error
    }
  }
  if (!city && needsPublicLookup) {
    try {
      city = await searchPublicNominatim(query)
    } catch (error) {
      providerError ??= error
    }
  }
  if (!city) {
    if (providerError) throw new Error('The geocoder is unavailable and the bundled city index had no match. Try again or check the city spelling.')
    throw new Error(`Could not find “${query}”. Check the spelling or add a country or state after a comma.`)
  }
  return city
}

export async function geocodeCity(cityQuery, signal) {
  const query = cityQuery.trim().replace(/\s+/g, ' ')
  const key = query.split(',').map(normalize).filter(Boolean).join(',')
  signal?.throwIfAborted()
  if (!key || query.length > 150) throw new Error('Enter a city name, optionally followed by its state or country.')

  // Keep an in-flight lookup shared across repeated submissions. Each caller
  // checks its own abort signal before using the result.
  if (!cityCache.has(key)) {
    cityCache.set(key, lookupCity(query).catch(error => {
      cityCache.delete(key)
      throw error
    }))
  }
  const city = await cityCache.get(key)
  signal?.throwIfAborted()
  return city
}
