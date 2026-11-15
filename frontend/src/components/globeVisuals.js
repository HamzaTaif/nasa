const textureRoot = 'https://unpkg.com/three-globe/example/img/'
export const globeTextures = {
  day: `${textureRoot}earth-blue-marble.jpg`,
  night: `${textureRoot}earth-night.jpg`,
  bump: `${textureRoot}earth-topology.png`,
  clouds: 'https://unpkg.com/globe.gl/example/clouds/clouds.png',
}

export const globeStart = { lat: 25, lng: 68, altitude: 2.2 }
export const globeFlightMs = 1500
export const globeIdleResumeMs = 5000
export const mobileGlobeQuery = '(max-width: 780px) and (pointer: coarse)'

let countryRequest
export function loadCountries() {
  countryRequest ??= fetch(`${import.meta.env.BASE_URL}globe/countries.json`)
    .then(response => {
      if (!response.ok) throw new Error('Country geometry is unavailable.')
      return response.json()
    })
    .catch(error => {
      countryRequest = undefined
      throw error
    })
  return countryRequest
}

function countryPolygons(country) {
  if (!country?.geometry) return []
  const { type, coordinates } = country.geometry
  return type === 'Polygon' ? [coordinates] : coordinates
}

export function countryRings(country) {
  return countryPolygons(country).flat()
}

const wrapLongitude = longitude => ((longitude + 180) % 360 + 360) % 360 - 180
const normalizedName = value => (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim()

function insideRing(ring, latitude, longitude) {
  let inside = false
  let previous = ring.at(-1)
  let previousLongitude = longitude + wrapLongitude(previous[0] - longitude)
  for (const vertex of ring) {
    const vertexLongitude = previousLongitude + wrapLongitude(vertex[0] - previous[0])
    if ((vertex[1] > latitude) !== (previous[1] > latitude)) {
      const intersection = vertexLongitude + (previousLongitude - vertexLongitude)
        * (latitude - vertex[1]) / (previous[1] - vertex[1])
      if (longitude < intersection) inside = !inside
    }
    previous = vertex
    previousLongitude = vertexLongitude
  }
  return inside
}

export function findCountry(countries, city) {
  if (!city) return null
  const code = (city.countryCode ?? '').toUpperCase()
  const name = normalizedName(city.country)
  const identified = countries.find(country => country.code === code && code)
    ?? countries.find(country => name && [country.name, ...(country.aliases ?? [])].some(alias => normalizedName(alias) === name))
  if (identified) return identified
  return countries.find(country => countryPolygons(country).some(([outside, ...holes]) =>
    outside?.length && insideRing(outside, city.lat, city.lon) && !holes.some(ring => ring.length && insideRing(ring, city.lat, city.lon))
  )) ?? null
}

export function formatCityCoordinates({ lat, lon }) {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`
}

export function positionGlobeLabel(label, x, y, stageWidth, stageHeight) {
  if (!label) return
  const visible = Number.isFinite(x) && Number.isFinite(y) && x >= 8 && y >= 18 && x <= stageWidth - 8 && y <= stageHeight - 12
  label.hidden = !visible
  if (!visible) return
  const width = label.offsetWidth
  const side = x + width + 30 > stageWidth ? -1 : 1
  const left = side === 1 ? x + 16 : x - width - 16
  label.dataset.side = side === 1 ? 'right' : 'left'
  label.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px) translateY(-50%)`
}
