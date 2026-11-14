import { Component, lazy, Suspense, useState } from 'react'
import { MapPin } from 'lucide-react'
import { cities } from '../claims'

const WebGLEarth = lazy(() => import('./Globe'))
const CanvasEarth = lazy(() => import('./CanvasEarth'))

function initialGlobeRenderer() {
  try {
    const context = document.createElement('canvas').getContext('webgl2')
    if (context) {
      context.getExtension('WEBGL_lose_context')?.loseContext()
      return 'webgl'
    }
  } catch {
    // The software renderer also works on devices without a WebGL context.
  }
  return 'canvas'
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cityNames = cities.flatMap(city => [city.name, ...(city.aliases ?? [])].map(name => ({ name, country: city.country })))
  .sort((first, second) => second.name.length - first.name.length)
  .map(({ name, country }) => `${escapeRegExp(name)}(?:,?\\s+${escapeRegExp(country)})?`)
const cityInClaim = new RegExp(`\\b(?:${cityNames.join('|')})\\b`, 'gi')

export function nearestCity({ lat, lng }) {
  const radians = Math.PI / 180
  const latitude = lat * radians
  let closest = null
  let minimumDistance = Infinity

  for (const city of cities) {
    const cityLatitude = city.lat * radians
    const latitudeDifference = cityLatitude - latitude
    const longitudeDifference = (city.lon - lng) * radians
    const distance = Math.sin(latitudeDifference / 2) ** 2
      + Math.cos(latitude) * Math.cos(cityLatitude) * Math.sin(longitudeDifference / 2) ** 2
    if (distance < minimumDistance) {
      closest = city
      minimumDistance = distance
    }
  }

  return closest
}

export function claimForCity(claim, city) {
  const draft = claim.trim()
  const standardClaim = `Show the temperature trend in ${city.name}`
  if (!draft) return standardClaim
  const citiesInDraft = [...draft.matchAll(cityInClaim)]
  if (citiesInDraft.length > 1) return standardClaim
  const prefill = citiesInDraft.length === 1
    ? draft.replace(cityInClaim, city.name)
    : `${draft} in ${city.name}`
  return prefill.length <= 220 ? prefill : standardClaim
}

function geographicCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(2)}° ${value < 0 ? negative : positive}`
}

class GlobeBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onUnavailable()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function HeroGlobe({ selection, clickedPoint, onLocationSelect }) {
  const [renderer, setRenderer] = useState(initialGlobeRenderer)
  const [ready, setReady] = useState(false)
  const city = selection?.city
  const interactive = ready && renderer !== 'poster'
  const Earth = renderer === 'webgl' ? WebGLEarth : CanvasEarth

  function onUnavailable() {
    setReady(false)
    setRenderer(renderer === 'webgl' ? 'canvas' : 'poster')
  }

  return (
    <figure className="hero-globe" data-renderer={renderer} aria-label="Earth globe" aria-describedby={interactive ? 'globe-keyboard' : undefined}>
      <div className="hero-globe-scene">
        {!interactive && (
          <div className="hero-globe-poster" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}earth.webp`} alt="" width="920" height="920" fetchPriority="high" />
          </div>
        )}
        {renderer !== 'poster' && (
          <div className="hero-globe-interactive" data-ready={interactive} inert={!interactive}>
            <GlobeBoundary key={renderer} onUnavailable={onUnavailable}>
              <Suspense fallback={null}>
                <Earth
                  selectedCity={city}
                  selectionKey={selection?.key}
                  paused={false}
                  clickedPoint={clickedPoint}
                  onLocationSelect={onLocationSelect}
                  onReady={() => setReady(true)}
                  onUnavailable={onUnavailable}
                />
              </Suspense>
            </GlobeBoundary>
          </div>
        )}
      </div>
      <figcaption className="hero-globe-caption">
        <span className="hero-globe-selection" role="status">
          {city && (
            <>
              <span className="hero-globe-location"><MapPin size={13} aria-hidden="true" /> {city.name}, {city.country}</span>
              <span className="hero-globe-coordinates">
                {geographicCoordinate(city.lat, 'N', 'S')} <span aria-hidden="true">·</span> {geographicCoordinate(city.lon, 'E', 'W')}
              </span>
            </>
          )}
        </span>
        {interactive && (
          <>
            <span>{selection?.source === 'globe' ? 'Nearest supported city' : 'Drag to rotate · Select a location'}</span>
            <span className="sr-only" id="globe-keyboard">Use the arrow keys to rotate the globe. Press Enter or Space to select the center.</span>
          </>
        )}
      </figcaption>
    </figure>
  )
}
