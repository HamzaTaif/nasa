import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import ReactGlobe from 'react-globe.gl'
import {
  AdditiveBlending, BackSide, CanvasTexture, CylinderGeometry, DataTexture, DoubleSide, Group, Mesh,
  MeshBasicMaterial, RepeatWrapping, RingGeometry, ShaderMaterial, SphereGeometry, Sprite,
  SpriteMaterial, SRGBColorSpace, TextureLoader, Vector3,
} from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { createGlobeInertia, offsetGlobeView, stepGlobeInertia, viewAfterDrag } from './globePointer'
import { countryRings, findCountry, globeFlightMs, globeIdleResumeMs, globeStart, globeTextures, loadCountries, positionGlobeLabel } from './globeVisuals'

const outlineFade = 500
const cyan = '#00E5FF'
const empty = []
const globeAsset = name => `${import.meta.env.BASE_URL}globe/${name}`
const rendererConfig = { alpha: true, antialias: true, powerPreference: 'high-performance' }
const pathPoints = path => path
const pathLatitude = point => point[1]
const pathLongitude = point => point[0]
const polygonGeometry = overlay => overlay.country.geometry
const polygonMaterial = overlay => overlay.fill
const noColor = () => null
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const north = new Vector3(0, 1, 0)

const sphereVertex = /* glsl */ `
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

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D heightMap;
  uniform sampler2D cloudMap;
  uniform vec2 bumpStep;
  uniform float cloudOffset;
  uniform vec3 sunDirection;
  varying vec2 earthUv;
  varying vec3 positionOnEarth;
  varying vec3 earthNormal;
  void main() {
    vec3 normal = normalize(earthNormal);
    vec3 view = normalize(cameraPosition - positionOnEarth);
    vec3 day = texture2D(dayMap, earthUv).rgb;
    vec3 night = texture2D(nightMap, earthUv).rgb;
    float shadow = texture2D(cloudMap, earthUv + vec2(cloudOffset + 0.0014, 0.0008)).a;
    float east = texture2D(heightMap, earthUv + vec2(bumpStep.x, 0.0)).r
      - texture2D(heightMap, earthUv - vec2(bumpStep.x, 0.0)).r;
    float rise = texture2D(heightMap, earthUv + vec2(0.0, bumpStep.y)).r
      - texture2D(heightMap, earthUv - vec2(0.0, bumpStep.y)).r;
    vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), normal) + vec3(0.00001, 0.0, 0.0));
    vec3 relief = normalize(normal - 0.25 * (east * tangent + rise * cross(normal, tangent)));
    float solarAngle = dot(normal, sunDirection);
    float light = smoothstep(-0.12, 0.24, solarAngle);
    float lambert = max(dot(relief, sunDirection), 0.0);
    float facing = max(dot(normal, view), 0.0);
    float ocean = smoothstep(0.007, 0.045, day.b - day.r);
    float glint = pow(max(dot(reflect(-sunDirection, normal), view), 0.0), 64.0) * ocean;
    vec3 litEarth = day * (0.29 + 0.77 * lambert) * (1.0 - 0.21 * shadow);
    litEarth += glint * vec3(0.058, 0.096, 0.15) * (1.0 - shadow);
    float cityLight = smoothstep(0.007, 0.58, max(0.0, dot(night, vec3(0.64, 0.32, 0.04)) - night.b * 0.23));
    vec3 darkEarth = day * vec3(0.012, 0.024, 0.061) + vec3(0.001, 0.003, 0.008);
    darkEarth += vec3(1.0, 0.51, 0.19) * cityLight * (1.0 - shadow * 0.75);
    vec3 earth = mix(darkEarth, litEarth, light);
    float limb = pow(1.0 - facing, 5.0);
    earth += limb * vec3(0.075, 0.23, 0.46) * (0.13 + 0.87 * light);
    earth += vec3(0.043, 0.015, 0.004) * exp(-9.0 * abs(solarAngle + 0.04));
    gl_FragColor = vec4(earth, 1.0);
    #include <colorspace_fragment>
  }
`

const cloudFragment = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDirection;
  varying vec2 earthUv;
  varying vec3 positionOnEarth;
  varying vec3 earthNormal;
  void main() {
    float mask = texture2D(cloudMap, earthUv).a;
    vec3 normal = normalize(earthNormal);
    float solarAngle = dot(normal, sunDirection);
    float daylight = smoothstep(-0.24, 0.48, solarAngle);
    float facing = max(dot(normal, normalize(cameraPosition - positionOnEarth)), 0.0);
    vec3 cloud = mix(vec3(0.029, 0.047, 0.091), vec3(0.91, 0.94, 1.0), daylight);
    float alpha = pow(mask, 0.91) * (0.26 + 0.58 * daylight) * smoothstep(0.02, 0.23, facing);
    gl_FragColor = vec4(cloud, alpha);
    #include <colorspace_fragment>
  }
`

const atmosphereFragment = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float solidRadius;
  varying vec3 positionOnEarth;
  varying vec3 earthNormal;
  void main() {
    vec3 ray = normalize(positionOnEarth - cameraPosition);
    vec3 nearest = cameraPosition - ray * dot(cameraPosition, ray);
    float altitude = (length(nearest) - solidRadius) / solidRadius;
    float outside = smoothstep(-0.003, 0.0014, altitude);
    float shear = exp(-max(altitude, 0.0) * 93.0) * (1.0 - smoothstep(0.028, 0.089, altitude));
    float light = smoothstep(-0.39, 0.50, dot(normalize(nearest), sunDirection));
    vec3 tint = mix(vec3(0.09, 0.38, 0.98), vec3(0.73, 0.9, 1.0), exp(-max(altitude, 0.0) * 411.0));
    gl_FragColor = vec4(tint, shear * outside * (0.12 + 0.61 * light));
    #include <colorspace_fragment>
  }
`

const beamVertex = /* glsl */ `
  varying vec2 beamUV;
  void main() {
    beamUV = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const beamFragment = /* glsl */ `
  varying vec2 beamUV;
  void main() {
    gl_FragColor = vec4(0.08, 0.83, 1.0, pow(1.0 - beamUV.y, 1.8) * 0.42);
    #include <colorspace_fragment>
  }
`

async function loadGlobe(signal) {
  const loader = new TextureLoader()
  const textures = []
  let disposed = false
  async function texture(url, colored = false) {
    const map = await loader.loadAsync(url)
    if (signal.aborted || disposed) {
      map.dispose()
      throw signal.reason
    }
    if (colored) map.colorSpace = SRGBColorSpace
    map.wrapS = RepeatWrapping
    textures.push(map)
    return map
  }
  const { day, night, bump, clouds } = globeTextures
  const cloudPromise = texture(clouds).catch(() => null)
  const results = await Promise.allSettled([
    texture(day, true), texture(night, true), texture(bump),
    fetch(globeAsset('country-borders.json'), { signal })
      .then(response => response.ok ? response.json() : empty)
      .catch(() => empty),
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure || signal.aborted) {
    disposed = true
    textures.forEach(map => map.dispose())
    throw failure?.reason ?? signal.reason
  }
  const [dayMap, nightMap, heightMap, borders] = results.map(result => result.value)
  const placeholder = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  placeholder.needsUpdate = true
  const cloudMap = { value: placeholder }
  cloudPromise.then(map => {
    if (map && !disposed) cloudMap.value = map
  })
  const sunDirection = { value: new Vector3(0, 0, 1) }
  const material = new ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap }, nightMap: { value: nightMap }, heightMap: { value: heightMap },
      cloudMap, cloudOffset: { value: 0 },
      bumpStep: { value: [1 / heightMap.image.width, 1 / heightMap.image.height] }, sunDirection,
    },
    vertexShader: sphereVertex,
    fragmentShader: earthFragment,
    toneMapped: false,
  })
  return {
    material, borders, textures, cloudMap, sunDirection,
    dispose() {
      disposed = true
      placeholder.dispose()
      material.dispose()
      textures.forEach(map => map.dispose())
    },
  }
}

function makeShell(radius, fragmentShader, uniforms, options = {}) {
  return new Mesh(
    new SphereGeometry(radius, 128, 64),
    new ShaderMaterial({ vertexShader: sphereVertex, fragmentShader, uniforms, transparent: true, depthWrite: false, toneMapped: false, ...options }),
  )
}

function makePin() {
  const group = new Group()
  const image = document.createElement('canvas')
  image.width = image.height = 128
  const context = image.getContext('2d')
  const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, '#f1ffff')
  glow.addColorStop(0.13, '#e4ffff')
  glow.addColorStop(0.19, '#00e5ff')
  glow.addColorStop(0.24, '#00d6f5')
  glow.addColorStop(0.32, 'rgba(0,207,255,0.44)')
  glow.addColorStop(0.57, 'rgba(0,182,255,0.15)')
  glow.addColorStop(1, 'rgba(0,132,255,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, 128, 128)
  const map = new CanvasTexture(image)
  map.colorSpace = SRGBColorSpace
  const head = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }))
  head.scale.set(8.5, 8.5, 1)
  head.position.y = 0.12
  head.renderOrder = 16
  const beam = new Mesh(new CylinderGeometry(0.06, 0.78, 5.8, 16, 1, true), new ShaderMaterial({
    vertexShader: beamVertex, fragmentShader: beamFragment, side: DoubleSide,
    transparent: true, depthWrite: false, toneMapped: false, blending: AdditiveBlending,
  }))
  beam.position.y = 2.9
  beam.renderOrder = 14
  const ring = new Mesh(new RingGeometry(0.94, 1.06, 56), new MeshBasicMaterial({
    color: cyan, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, toneMapped: false,
  }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -0.3
  ring.renderOrder = 15
  group.add(beam, ring, head)
  group.visible = false
  return { group, ring, head, beam, map }
}

function disposeMesh(mesh) {
  mesh.geometry?.dispose()
  mesh.material?.dispose()
}

function outlinePositions(instance, points) {
  const positions = []
  const start = new Vector3()
  const end = new Vector3()
  const position = new Vector3()
  const radius = instance.getGlobeRadius() * 1.007
  for (const [index, [lng, lat]] of points.entries()) {
    const target = instance.getCoords(lat, lng, 0.007)
    end.set(target.x, target.y, target.z)
    const steps = index ? Math.max(1, Math.ceil(start.angleTo(end) * 180 / Math.PI)) : 1
    if (index) {
      for (let i = 1; i <= steps; i += 1) {
        position.lerpVectors(start, end, i / steps).setLength(radius)
        positions.push(position.x, position.y, position.z)
      }
    } else positions.push(end.x, end.y, end.z)
    start.copy(end)
  }
  return positions
}

function makeCountryOverlay(instance, country) {
  const outlines = new Group()
  const fill = new MeshBasicMaterial({ color: cyan, opacity: 0, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false })
  const glow = new LineMaterial({ color: cyan, linewidth: 5.8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  const dash = new LineMaterial({ color: cyan, linewidth: 1.85, dashed: true, dashSize: 1.12, gapSize: 0.92, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  for (const points of countryRings(country)) {
    if (points.length < 3) continue
    const positions = outlinePositions(instance, points)
    const geometry = new LineGeometry().setPositions(positions)
    const haloLine = new Line2(geometry, glow)
    const dashLine = new Line2(geometry, dash)
    haloLine.renderOrder = 11
    dashLine.renderOrder = 12
    dashLine.computeLineDistances()
    outlines.add(haloLine, dashLine)
  }
  instance.scene().add(outlines)
  return {
    country, fill, outlines, intensity: 0, target: 1,
    draw(dt, reduced) {
      this.intensity = reduced ? this.target : clamp(this.intensity + (this.target ? dt : -dt) / outlineFade, 0, 1)
      fill.opacity = 0.08 * this.intensity
      glow.opacity = 0.15 * this.intensity
      dash.opacity = 0.89 * this.intensity
      if (!reduced) dash.dashOffset = (dash.dashOffset - dt * 0.0021) % 2.04
    },
    dispose() {
      outlines.removeFromParent()
      for (let i = 0; i < outlines.children.length; i += 2) outlines.children[i].geometry.dispose()
      fill.dispose()
      glow.dispose()
      dash.dispose()
    },
  }
}

export default function Globe({ selectedCity, selectionKey, clickedPoint, controllerRef, labelRef, onReady, onUnavailable }) {
  const host = useRef(null)
  const globe = useRef(null)
  const gestures = useRef(null)
  const current = useRef(null)
  const selectionVisuals = useRef(null)
  const idleTimer = useRef()
  const flight = useRef(null)
  const inertia = useRef(null)
  const coastFrame = useRef()
  const [dimensions, setDimensions] = useState(null)
  const measured = Boolean(dimensions)
  const [resource, setResource] = useState(null)
  const [countries, setCountries] = useState(empty)
  const [overlays, setOverlays] = useState(empty)
  const [initialized, setInitialized] = useState(false)
  const [moving, setMoving] = useState(false)
  const [motionReduced, setMotionReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [inView, setInView] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const visible = inView && tabVisible
  current.current = { onReady, onUnavailable, selectedCity, visible, motionReduced, dimensions, labelRef }

  useEffect(() => {
    const element = host.current
    const measure = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width && height) setDimensions({ width: Math.round(width), height: Math.round(height) })
    })
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const setPreference = event => setMotionReduced(event.matches)
    const onVisibilityChange = () => setTabVisible(!document.hidden)
    measure.observe(element)
    intersection.observe(element)
    motionPreference.addEventListener('change', setPreference)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      measure.disconnect()
      intersection.disconnect()
      motionPreference.removeEventListener('change', setPreference)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let loaded
    const timeout = window.setTimeout(() => {
      controller.abort()
      current.current.onUnavailable?.('webgl-assets-timeout')
    }, 12000)
    loadGlobe(controller.signal).then(result => {
      if (controller.signal.aborted) result.dispose()
      else {
        loaded = result
        setResource(result)
      }
    }).catch(() => {
      if (!controller.signal.aborted) current.current.onUnavailable?.('assets-unavailable')
    }).finally(() => window.clearTimeout(timeout))
    loadCountries().then(data => {
      if (!controller.signal.aborted) setCountries(data)
    }).catch(() => {})
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
      loaded?.dispose()
    }
  }, [])

  useLayoutEffect(() => {
    if (!resource || !measured) return
    const instance = globe.current
    const controls = instance?.controls()
    const renderer = instance?.renderer()
    if (!controls || !renderer || renderer.getContext().isContextLost()) {
      current.current.onUnavailable?.('webgl-unavailable')
      return
    }
    const camera = instance.camera()
    const radius = instance.getGlobeRadius()
    const canvas = renderer.domElement
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85))
    resource.textures.forEach(map => { map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()) })
    camera.fov = 42
    camera.updateProjectionMatrix()
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.4
    controls.enableZoom = false
    controls.enablePan = false
    controls.disconnect()

    const clouds = makeShell(radius * 1.0045, cloudFragment, { cloudMap: resource.cloudMap, sunDirection: resource.sunDirection })
    clouds.renderOrder = 4
    const air = makeShell(radius * 1.09, atmosphereFragment, { solidRadius: { value: radius }, sunDirection: resource.sunDirection }, { side: BackSide, blending: AdditiveBlending })
    air.renderOrder = 5
    const pin = makePin()
    instance.scene().add(clouds, air, pin.group)
    const activeOverlays = new Map()
    let arrivedAt = null
    let clock = 0
    let lastFrame
    let frame = 0
    let drewSurface = false
    let shaderFailed = false
    let surfaceMesh
    let originalAfterRender
    let dragOrigin
    const pinNormal = new Vector3()
    const pinPosition = new Vector3()
    const vectorToCamera = new Vector3()
    const projected = new Vector3()
    const material = resource.material
    const originalBeforeRender = material.onBeforeRender
    const originalShaderError = renderer.debug.onShaderError
    const hideLabel = () => positionGlobeLabel(current.current.labelRef?.current, null)

    selectionVisuals.current = {
      country(country) {
        for (const overlay of activeOverlays.values()) overlay.target = Number(overlay.country === country)
        if (country && !activeOverlays.has(country)) activeOverlays.set(country, makeCountryOverlay(instance, country))
        setOverlays([...activeOverlays.values()])
      },
      arrived() {
        arrivedAt = clock
      },
    }

    function drawPin(city, reduced, frameCamera, stage) {
      pin.group.visible = Boolean(city && (arrivedAt !== null || reduced))
      if (!pin.group.visible) {
        hideLabel()
        return
      }
      const elapsed = reduced ? Infinity : clock - arrivedAt
      const drop = 4.1 * (1 - clamp(elapsed / 425, 0, 1)) ** 3
      const point = instance.getCoords(city.lat, city.lon)
      pinNormal.set(point.x, point.y, point.z).normalize()
      pinPosition.copy(pinNormal).multiplyScalar(radius + 0.64)
      pin.group.position.copy(pinPosition)
      pin.group.quaternion.setFromUnitVectors(north, pinNormal)
      pin.head.position.y = 0.18 + drop
      pin.head.material.opacity = 0.38 + 0.62 * clamp(elapsed / 260, 0, 1)
      const weight = clamp(frameCamera.position.length() / (radius * 3.1), 0.8, 1.13)
      pin.head.scale.set(8.5 * weight, 8.5 * weight, 1)
      pin.beam.visible = elapsed > 150
      const phase = reduced ? 0 : (elapsed % 1500) / 1500
      pin.ring.visible = !reduced
      pin.ring.scale.setScalar(1.5 + 7.8 * phase)
      pin.ring.material.opacity = reduced ? 0 : 0.82 * (1 - phase) ** 2
      vectorToCamera.copy(frameCamera.position).sub(pinPosition)
      if (pinNormal.dot(vectorToCamera) <= radius * 0.06 || !stage) {
        hideLabel()
        return
      }
      projected.copy(pinPosition).addScaledVector(pinNormal, drop + 1.1).project(frameCamera)
      positionGlobeLabel(current.current.labelRef?.current, (projected.x + 1) * stage.width / 2, (1 - projected.y) * stage.height / 2, stage.width, stage.height)
    }

    material.onBeforeRender = (_renderer, _scene, frameCamera, _geometry, mesh) => {
      const { selectedCity: city, motionReduced: reduced, dimensions: stage } = current.current
      const time = performance.now()
      const delta = lastFrame === undefined ? 0 : Math.min(80, time - lastFrame)
      lastFrame = time
      clock += delta
      resource.sunDirection.value.set(-0.81, 0.36, 0.45).normalize().applyQuaternion(frameCamera.quaternion)
      clouds.rotation.y = -Math.PI / 2 + (reduced ? 0 : clock * -0.000012)
      material.uniforms.cloudOffset.value = -(clouds.rotation.y + Math.PI / 2) / (Math.PI * 2)
      for (const [country, overlay] of activeOverlays) {
        overlay.draw(delta, reduced)
        if (overlay.target === 0 && overlay.intensity <= 0) {
          activeOverlays.delete(country)
          overlay.dispose()
          setOverlays([...activeOverlays.values()])
        }
      }
      drawPin(city, reduced, frameCamera, stage)
      if (!surfaceMesh) {
        surfaceMesh = mesh
        originalAfterRender = mesh.onAfterRender
        mesh.onAfterRender = (...args) => {
          originalAfterRender?.apply(mesh, args)
          drewSurface = true
          mesh.onAfterRender = originalAfterRender
        }
      }
    }
    renderer.debug.onShaderError = (...args) => {
      shaderFailed = true
      originalShaderError?.(...args)
    }

    const readyDeadline = performance.now() + 2500
    function checkFirstDraw(now) {
      if (shaderFailed || renderer.getContext().isContextLost()) current.current.onUnavailable?.('webgl-render-failed')
      else if (drewSurface) {
        setInitialized(true)
        current.current.onReady?.()
      } else if (now >= readyDeadline) current.current.onUnavailable?.('webgl-render-timeout')
      else frame = window.requestAnimationFrame(checkFirstDraw)
    }

    function stopInertia() {
      window.cancelAnimationFrame(coastFrame.current)
      inertia.current = null
    }
    function cancelFlight() {
      if (flight.current && arrivedAt === null) arrivedAt = clock
      flight.current = null
    }
    function engage() {
      window.clearTimeout(idleTimer.current)
      controls.autoRotate = false
      setMoving(true)
    }
    function cooldown() {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setMoving(false), globeIdleResumeMs)
    }
    function moveTo(view) {
      instance.pointOfView(view, 0)
      controls.update(0)
    }
    function startCoast(velocity, element) {
      const state = current.current.motionReduced || !velocity || !element ? null : createGlobeInertia(velocity, element)
      if (!state) return
      inertia.current = state
      let lastTime
      function coast(now) {
        if (!inertia.current || !current.current.visible || current.current.motionReduced) {
          inertia.current = null
          return
        }
        const result = stepGlobeInertia(inertia.current, lastTime === undefined ? 0 : Math.min(50, now - lastTime))
        lastTime = now
        moveTo(offsetGlobeView(instance.pointOfView(), result.latitude, result.longitude))
        if (result.done) inertia.current = null
        else coastFrame.current = window.requestAnimationFrame(coast)
      }
      coastFrame.current = window.requestAnimationFrame(coast)
    }
    const onContextLost = event => {
      event.preventDefault()
      current.current.onUnavailable?.('webgl-context-lost')
    }
    gestures.current = {
      start() {
        cancelFlight()
        stopInertia()
        engage()
        dragOrigin = instance.pointOfView()
      },
      drag(delta, input) {
        if (dragOrigin) moveTo(viewAfterDrag(dragOrigin, delta, input))
      },
      pick(event) {
        const bounds = canvas.getBoundingClientRect()
        controls.update(0)
        camera.updateMatrixWorld()
        return instance.toGlobeCoords(event.clientX - bounds.left, event.clientY - bounds.top)
      },
      center() {
        return instance.pointOfView()
      },
      nudge(latitude, longitude) {
        cancelFlight()
        stopInertia()
        engage()
        moveTo(offsetGlobeView(instance.pointOfView(), latitude, longitude))
        cooldown()
      },
      end(velocity, element) {
        dragOrigin = null
        startCoast(velocity, element)
        cooldown()
      },
      startFlight() {
        arrivedAt = null
        stopInertia()
        engage()
      },
      endFlight() {
        selectionVisuals.current?.arrived()
        cooldown()
      },
      resume() {
        cancelFlight()
        stopInertia()
        window.clearTimeout(idleTimer.current)
        setMoving(false)
      },
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    moveTo(globeStart)
    frame = window.requestAnimationFrame(checkFirstDraw)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(idleTimer.current)
      stopInertia()
      gestures.current = null
      selectionVisuals.current = null
      canvas.removeEventListener('webglcontextlost', onContextLost)
      material.onBeforeRender = originalBeforeRender
      if (surfaceMesh) surfaceMesh.onAfterRender = originalAfterRender
      renderer.debug.onShaderError = originalShaderError
      for (const mesh of [clouds, air, pin.group]) mesh.removeFromParent()
      for (const mesh of [clouds, air, pin.beam, pin.ring]) disposeMesh(mesh)
      pin.head.material.dispose()
      pin.map.dispose()
      activeOverlays.forEach(overlay => overlay.dispose())
      hideLabel()
    }
  }, [resource, measured])

  useEffect(() => {
    if (!initialized) return
    selectionVisuals.current?.country(findCountry(countries, selectedCity))
  }, [initialized, countries, selectedCity])

  useEffect(() => {
    if (!initialized) return
    const instance = globe.current
    instance.controls().autoRotate = visible && !moving && !motionReduced && !flight.current
    if (visible) instance.resumeAnimation()
    else instance.pauseAnimation()
  }, [initialized, visible, moving, motionReduced])

  useEffect(() => {
    flight.current = null
    if (!initialized || !selectedCity) {
      if (initialized) gestures.current?.resume()
      return
    }
    const instance = globe.current
    gestures.current?.startFlight()
    const target = { lat: selectedCity.lat, lng: selectedCity.lon, altitude: 2.03 }
    if (motionReduced) {
      instance.pointOfView(target, 0)
      gestures.current?.endFlight()
      return
    }
    const origin = instance.pointOfView()
    const longitudeTravel = (target.lng - origin.lng + 540) % 360 - 180
    flight.current = { origin, target, longitudeTravel, elapsed: 0 }
  }, [initialized, selectedCity, selectionKey, motionReduced])

  useEffect(() => {
    if (!initialized || !visible || !flight.current) return
    const instance = globe.current
    let frame
    let previousTime
    function advance(time) {
      const journey = flight.current
      if (!journey) return
      if (previousTime !== undefined) journey.elapsed += Math.min(80, time - previousTime)
      previousTime = time
      const progress = Math.min(journey.elapsed / globeFlightMs, 1)
      if (progress === 1) {
        instance.pointOfView(journey.target, 0)
        flight.current = null
        gestures.current?.endFlight()
        return
      }
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress)
      const { origin, target, longitudeTravel } = journey
      instance.pointOfView({
        lat: origin.lat + (target.lat - origin.lat) * eased,
        lng: origin.lng + longitudeTravel * eased,
        altitude: origin.altitude + (target.altitude - origin.altitude) * eased,
      }, 0)
      frame = window.requestAnimationFrame(advance)
    }
    frame = window.requestAnimationFrame(advance)
    return () => window.cancelAnimationFrame(frame)
  }, [initialized, visible, selectedCity, selectionKey, motionReduced])

  useImperativeHandle(controllerRef, () => ({
    start: (...args) => gestures.current?.start(...args),
    drag: (...args) => gestures.current?.drag(...args),
    end: (...args) => gestures.current?.end(...args),
    pick: (...args) => gestures.current?.pick(...args),
    center: () => gestures.current?.center(),
    nudge: (...args) => gestures.current?.nudge(...args),
    resume: () => gestures.current?.resume(),
  }), [])

  return (
    <div ref={host} className="trendproof-globe" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
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
          globeCurvatureResolution={1.8}
          showAtmosphere={false}
          enablePointerInteraction={false}
          pathsData={resource.borders}
          pathPoints={pathPoints}
          pathPointLat={pathLatitude}
          pathPointLng={pathLongitude}
          pathPointAlt={0.0017}
          pathColor="rgba(161, 198, 229, 0.37)"
          pathResolution={1}
          pathTransitionDuration={0}
          polygonsData={overlays}
          polygonGeoJsonGeometry={polygonGeometry}
          polygonCapMaterial={polygonMaterial}
          polygonSideColor={noColor}
          polygonStrokeColor={noColor}
          polygonAltitude={0.003}
          polygonCapCurvatureResolution={2}
          polygonsTransitionDuration={0}
          pointsData={clickedPoint ? [clickedPoint] : empty}
          pointRadius={0.63}
          pointAltitude={0.013}
          pointColor="#b0eeff"
          pointsTransitionDuration={0}
        />
      )}
    </div>
  )
}
