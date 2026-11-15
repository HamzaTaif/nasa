import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { cities, parseClaim } from '../claims'
import { bindGlobePointer } from './globePointer'
import { formatCityCoordinates, mobileGlobeQuery } from './globeVisuals'

const WebGLEarth = lazy(() => import('./Globe'))
const CanvasEarth = lazy(() => import('./CanvasEarth'))
const keyRotations = { ArrowUp: [12, 0], ArrowDown: [-12, 0], ArrowLeft: [0, -18], ArrowRight: [0, 18] }

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

export function nearestCity({ lat, lng }, recentCities = []) {
  const radians = Math.PI / 180
  const latitude = lat * radians
  let closest = null
  let minimumDistance = Infinity

  for (const city of [...cities, ...recentCities]) {
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
  const location = city.geocoded && city.country ? `${city.name}, ${city.country}` : city.name
  const standardClaim = `Show the temperature trend in ${location}`
  if (!draft) return standardClaim
  try {
    const parsed = parseClaim(draft)
    const query = parsed.cityQuery ?? parsed.city?.name
    if (!query) return standardClaim
    const index = parsed.claim.toLocaleLowerCase('en-US').indexOf(query.toLocaleLowerCase('en-US'))
    if (index === -1) return standardClaim
    const prefill = parsed.claim.slice(0, index) + location + parsed.claim.slice(index + query.length)
    return prefill.length <= 220 ? prefill : standardClaim
  } catch {
    return standardClaim
  }
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

export default function HeroGlobe({ sectionRef, selection, clickedPoint, onLocationSelect, hasAnalysis }) {
  const [mobilePoster, setMobilePoster] = useState(() => window.matchMedia(mobileGlobeQuery).matches)
  const [renderer, setRenderer] = useState(() => mobilePoster ? 'poster' : initialGlobeRenderer())
  const [ready, setReady] = useState(false)
  const controller = useRef(null)
  const input = useRef(null)
  const label = useRef(null)
  const selectLocation = useRef(onLocationSelect)
  useEffect(() => {
    selectLocation.current = onLocationSelect
  }, [onLocationSelect])
  useEffect(() => {
    const preference = window.matchMedia(mobileGlobeQuery)
    function update(event) {
      setMobilePoster(event.matches)
      setReady(false)
      setRenderer(event.matches ? 'poster' : initialGlobeRenderer())
    }
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  const city = selection?.city
  const pinName = city?.id?.startsWith('point-')
    ? 'Selected point'
    : [city?.name, city?.country].filter(Boolean).join(', ')
  const coordinates = city && formatCityCoordinates(city)
  const interactive = ready && renderer !== 'poster'
  const Earth = renderer === 'webgl' ? WebGLEarth : CanvasEarth

  useEffect(() => {
    if (!interactive) return
    const surface = input.current
    return bindGlobePointer(surface, {
      onStart() {
        surface.dataset.pointerFocus = 'true'
        surface.focus({ preventScroll: true })
        controller.current?.start()
        surface.dataset.held = 'true'
      },
      onDrag(delta) {
        controller.current?.drag(delta, surface)
      },
      onEnd(velocity) {
        controller.current?.end(velocity, surface)
        delete surface.dataset.held
      },
      onSelect(event) {
        const location = controller.current?.pick(event)
        if (location) selectLocation.current(location)
      },
    })
  }, [interactive, renderer])

  function onGlobeKeyDown(event) {
    delete event.currentTarget.dataset.pointerFocus
    const offset = keyRotations[event.key]
    if (offset) {
      event.preventDefault()
      controller.current?.nudge(...offset)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const location = controller.current?.center()
      if (location) onLocationSelect(location)
    }
  }

  function onUnavailable() {
    setReady(false)
    setRenderer(current => current !== renderer ? current : current === 'webgl' ? 'canvas' : 'poster')
  }

  useEffect(() => {
    if (ready || renderer === 'poster') return
    let timeout
    function watchRenderer() {
      window.clearTimeout(timeout)
      if (document.hidden) return
      timeout = window.setTimeout(() => {
        setRenderer(current => current !== renderer ? current : current === 'webgl' ? 'canvas' : 'poster')
      }, 12000)
    }
    watchRenderer()
    document.addEventListener('visibilitychange', watchRenderer)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', watchRenderer)
    }
  }, [ready, renderer])

  return (
    <figure ref={sectionRef} className="hero-globe" data-renderer={renderer} aria-label="Earth globe" aria-describedby={interactive ? 'globe-keyboard' : undefined}>
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
                  clickedPoint={clickedPoint}
                  controllerRef={controller}
                  labelRef={label}
                  onReady={() => setReady(true)}
                  onUnavailable={onUnavailable}
                />
              </Suspense>
            </GlobeBoundary>
          </div>
        )}
        {city && renderer !== 'poster' && (
          <div key={selection?.key} ref={label} className="globe-pin-label" hidden aria-hidden="true">
            <span>{pinName}</span>
            <small>{coordinates}</small>
          </div>
        )}
        {interactive && (
          <div
            ref={input}
            className="globe-input-surface"
            role="group"
            aria-label="Interactive Earth globe"
            aria-describedby="globe-keyboard"
            tabIndex={0}
            onKeyDown={onGlobeKeyDown}
            onBlur={event => { delete event.currentTarget.dataset.pointerFocus }}
          />
        )}
      </div>
      <figcaption className="hero-globe-caption">
        <span className="hero-globe-selection" role="status">
          {city && (
            <>
              <span className="hero-globe-location"><MapPin size={13} aria-hidden="true" /> {pinName}</span>
              <span className="hero-globe-coordinates">
                {' · '}{coordinates.replace(' · ', ', ')}
              </span>
            </>
          )}
        </span>
        {interactive ? (
          <>
            <span className="globe-instructions">Drag to rotate · Click to select</span>
            <span className="sr-only" id="globe-keyboard">Use the arrow keys to rotate the globe. Press Enter or Space to select the center.</span>
          </>
        ) : mobilePoster ? null : renderer === 'poster' ? (
          <button className="globe-retry" type="button" onClick={() => setRenderer(initialGlobeRenderer)}>Retry interactive globe</button>
        ) : <span role="status">Loading interactive globe…</span>}
        {hasAnalysis && <a href="#analysis" className="globe-analysis-link">View analysis</a>}
      </figcaption>
    </figure>
  )
}
