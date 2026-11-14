import { useEffect, useMemo, useRef, useState } from 'react'
import ReactGlobe from 'react-globe.gl'
import { ShaderMaterial, SRGBColorSpace, TextureLoader, Vector3 } from 'three'

const asset = name => `${import.meta.env.BASE_URL}globe/${name}`
const startView = { lat: 24, lng: 63, altitude: 1.45 }
const empty = []
const rendererConfig = { alpha: true, antialias: true, powerPreference: 'low-power' }
const pathPoints = path => path
const pathLatitude = point => point[1]
const pathLongitude = point => point[0]
const pointerEventsFilter = object => object.__globeObjType === 'globe'
const ringColors = ['rgba(180, 255, 255, 0.9)', 'rgba(62, 223, 255, 0.5)', 'rgba(39, 157, 255, 0)']

const vertexShader = /* glsl */ `
  varying vec2 earthUv;
  varying vec3 positionOnEarth;
  varying vec3 earthNormal;
  void main() {
    earthUv = uv;
    positionOnEarth = (modelMatrix * vec4(position, 1.0)).xyz;
    earthNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D cloudMap;
  uniform sampler2D heightMap;
  uniform vec3 sunPosition;
  varying vec2 earthUv;
  varying vec3 positionOnEarth;
  varying vec3 earthNormal;

  void main() {
    vec3 normal = normalize(earthNormal);
    vec3 view = normalize(cameraPosition - positionOnEarth);
    vec3 daylight = texture2D(dayMap, earthUv).rgb;
    vec3 nightLights = texture2D(nightMap, earthUv).rgb;
    float cloud = texture2D(cloudMap, earthUv).a;
    float heightX = texture2D(heightMap, earthUv + vec2(0.00049, 0.0)).r
      - texture2D(heightMap, earthUv - vec2(0.00049, 0.0)).r;
    float heightY = texture2D(heightMap, earthUv + vec2(0.0, 0.00098)).r
      - texture2D(heightMap, earthUv - vec2(0.0, 0.00098)).r;
    vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), normal) + vec3(0.00001, 0.0, 0.0));
    vec3 north = normalize(cross(normal, tangent));
    vec3 reliefNormal = normalize(normal - 0.22 * (heightX * tangent + heightY * north));
    float solarAngle = dot(normal, sunPosition);
    float sunlit = smoothstep(-0.11, 0.22, solarAngle);
    float reliefLight = max(dot(reliefNormal, sunPosition), 0.0);
    float facing = max(dot(normal, view), 0.0);
    float rim = pow(1.0 - facing, 3.3);

    vec3 litEarth = daylight * (0.50 + 0.63 * reliefLight);
    vec3 cloudColor = mix(vec3(0.44, 0.58, 0.78), vec3(0.88, 0.93, 0.98), reliefLight);
    litEarth = mix(litEarth, cloudColor, cloud * 0.64);
    float nightLight = max(0.0, nightLights.r - nightLights.b * 0.38 - 0.012);
    vec3 darkEarth = daylight * vec3(0.025, 0.046, 0.079)
      + vec3(0.0035, 0.008, 0.017)
      + vec3(1.0, 0.78, 0.52) * nightLight * (1.0 - cloud * 0.7);
    float ocean = smoothstep(0.008, 0.044, daylight.b - daylight.r);
    vec3 reflected = reflect(-sunPosition, normal);
    float sheen = pow(max(dot(reflected, view), 0.0), 34.0) * ocean * (1.0 - cloud);
    vec3 earth = mix(darkEarth, litEarth, sunlit);
    earth += vec3(0.17, 0.25, 0.38) * sheen * sunlit;
    earth += rim * vec3(0.026, 0.125, 0.33) * (0.20 + 0.8 * sunlit);

    gl_FragColor = vec4(earth, 1.0);
    #include <colorspace_fragment>
  }
`

async function loadGlobe(signal) {
  const loader = new TextureLoader()
  const textures = []
  try {
    const results = await Promise.allSettled([
      ...['earth-day.webp', 'earth-night.webp', 'clouds-alpha.webp', 'earth-height.webp'].map(async name => {
        const texture = await loader.loadAsync(asset(name))
        textures.push(texture)
        return texture
      }),
      fetch(asset('country-borders.json'), { signal }).then(response => {
        if (!response.ok) throw new Error('Country boundaries are unavailable.')
        return response.json()
      }),
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
    if (signal.aborted) throw signal.reason
    const [day, night, clouds, height, borders] = results.map(result => result.value)
    day.colorSpace = SRGBColorSpace
    night.colorSpace = SRGBColorSpace
    clouds.colorSpace = SRGBColorSpace
    const material = new ShaderMaterial({
      uniforms: {
        dayMap: { value: day },
        nightMap: { value: night },
        cloudMap: { value: clouds },
        heightMap: { value: height },
        sunPosition: { value: new Vector3(0, 0, 1) },
      },
      vertexShader,
      fragmentShader,
      toneMapped: false,
    })
    return {
      material,
      borders,
      dispose() {
        material.dispose()
        textures.forEach(texture => texture.dispose())
      },
    }
  } catch (error) {
    textures.forEach(texture => texture.dispose())
    throw error
  }
}

export default function Globe({ selectedCity, selectionKey, paused, clickedPoint, onLocationSelect, onReady, onUnavailable }) {
  const host = useRef(null)
  const globe = useRef(null)
  const callbacks = useRef({ onReady, onUnavailable })
  const idleTimer = useRef()
  const [dimensions, setDimensions] = useState(null)
  const [resource, setResource] = useState(null)
  const [initialized, setInitialized] = useState(false)
  const [moving, setMoving] = useState(false)
  const [motionReduced, setMotionReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [inView, setInView] = useState(true)

  useEffect(() => {
    callbacks.current = { onReady, onUnavailable }
  }, [onReady, onUnavailable])

  useEffect(() => {
    const element = host.current
    const measure = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width && height) {
        setDimensions({ width: Math.round(width), height: Math.round(height) })
      }
    })
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const setPreference = event => setMotionReduced(event.matches)
    measure.observe(element)
    intersection.observe(element)
    motionPreference.addEventListener('change', setPreference)
    return () => {
      measure.disconnect()
      intersection.disconnect()
      motionPreference.removeEventListener('change', setPreference)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let loaded
    loadGlobe(controller.signal)
      .then(result => {
        if (controller.signal.aborted) {
          result.dispose()
          return
        }
        loaded = result
        setResource(result)
      })
      .catch(() => {
        if (!controller.signal.aborted) callbacks.current.onUnavailable?.('assets-unavailable')
      })
    return () => {
      controller.abort()
      loaded?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!initialized || !resource) return

    const instance = globe.current
    const controls = instance.controls()
    const renderer = instance.renderer()
    const canvas = renderer.domElement
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    controls.autoRotateSpeed = 0.5
    controls.enableZoom = false
    controls.enablePan = false

    const sun = resource.material.uniforms.sunPosition.value
    const updateSun = () => sun.set(-0.57, 0.53, 0.72).normalize().applyQuaternion(instance.camera().quaternion)
    const startInteraction = () => {
      window.clearTimeout(idleTimer.current)
      controls.autoRotate = false
      setMoving(true)
    }
    const endInteraction = () => {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => {
        setMoving(false)
      }, 2200)
    }
    const onContextLost = event => {
      event.preventDefault()
      callbacks.current.onUnavailable?.('webgl-context-lost')
    }
    controls.addEventListener('change', updateSun)
    controls.addEventListener('start', startInteraction)
    controls.addEventListener('end', endInteraction)
    canvas.addEventListener('webglcontextlost', onContextLost)
    instance.pointOfView(startView, 0)
    updateSun()
    const readyFrame = requestAnimationFrame(() => callbacks.current.onReady?.())

    return () => {
      cancelAnimationFrame(readyFrame)
      window.clearTimeout(idleTimer.current)
      controls.removeEventListener('change', updateSun)
      controls.removeEventListener('start', startInteraction)
      controls.removeEventListener('end', endInteraction)
      canvas.removeEventListener('webglcontextlost', onContextLost)
    }
  }, [initialized, resource])

  useEffect(() => {
    if (!initialized) return
    const instance = globe.current
    instance.controls().autoRotate = inView && !paused && !selectedCity && !moving && !motionReduced
    if (inView) instance.resumeAnimation()
    else instance.pauseAnimation()
  }, [initialized, inView, paused, selectedCity, moving, motionReduced])

  useEffect(() => {
    if (!initialized || !selectedCity) return
    const instance = globe.current
    instance.controls().autoRotate = false
    instance.pointOfView({
      lat: selectedCity.lat,
      lng: selectedCity.lon,
      altitude: 1.5,
    }, motionReduced ? 0 : 1350)
  }, [initialized, selectedCity, selectionKey, motionReduced])

  function onKeyDown(event) {
    if (!initialized) return
    const instance = globe.current
    const current = instance.pointOfView()
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onLocationSelect?.({ lat: current.lat, lng: current.lng })
      return
    }

    const offsets = { ArrowUp: [9, 0], ArrowDown: [-9, 0], ArrowLeft: [0, -12], ArrowRight: [0, 12] }
    const offset = offsets[event.key]
    if (!offset) return
    event.preventDefault()
    instance.controls().autoRotate = false
    setMoving(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setMoving(false), 2200)
    instance.pointOfView({
      lat: Math.max(-85, Math.min(85, current.lat + offset[0])),
      lng: ((current.lng + offset[1] + 540) % 360) - 180,
    }, 0)
  }

  const latitude = selectedCity?.lat
  const longitude = selectedCity?.lon
  const cityPin = useMemo(() => latitude === undefined ? empty : [{ lat: latitude, lng: longitude }], [latitude, longitude])
  const pins = useMemo(() => clickedPoint ? [...cityPin, { ...clickedPoint, clicked: true }] : cityPin, [cityPin, clickedPoint])

  return (
    <div
      ref={host}
      className="trendproof-globe"
      style={{ position: 'absolute', inset: 0, cursor: 'grab', userSelect: 'none' }}
      role="group"
      aria-label="Interactive Earth globe"
      aria-describedby="globe-keyboard"
      tabIndex={initialized ? 0 : -1}
      onKeyDown={onKeyDown}
    >
      {resource && dimensions && (
        <ReactGlobe
          ref={globe}
          width={dimensions.width}
          height={dimensions.height}
          rendererConfig={rendererConfig}
          animateIn={false}
          waitForGlobeReady={false}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={resource.material}
          globeCurvatureResolution={2}
          atmosphereColor="#4287e9"
          atmosphereAltitude={0.082}
          showAtmosphere
          onGlobeReady={() => setInitialized(true)}
          pointerEventsFilter={pointerEventsFilter}
          showPointerCursor={false}
          onGlobeClick={coords => onLocationSelect?.(coords)}
          pathsData={resource.borders}
          pathPoints={pathPoints}
          pathPointLat={pathLatitude}
          pathPointLng={pathLongitude}
          pathPointAlt={0.0016}
          pathColor="rgba(150, 185, 215, 0.43)"
          pathResolution={1}
          pathTransitionDuration={0}
          pointsData={pins}
          pointRadius={point => point.clicked ? 0.45 : 0.72}
          pointAltitude={0.009}
          pointColor={point => point.clicked ? '#a0e9ff' : '#00e5ff'}
          pointResolution={16}
          pointsTransitionDuration={0}
          ringsData={motionReduced ? empty : cityPin}
          ringAltitude={0.009}
          ringColor={ringColors}
          ringMaxRadius={4.4}
          ringPropagationSpeed={2.4}
          ringRepeatPeriod={1700}
        />
      )}
    </div>
  )
}
