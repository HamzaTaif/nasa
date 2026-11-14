import { useEffect, useRef, useState } from 'react'

const toRadians = Math.PI / 180
const toDegrees = 1 / toRadians
const initialView = { lat: 24, lng: 63 }
const textureWidth = 1536
const textureHeight = textureWidth / 2
const pulsePeriod = 1600
const pulseDuration = 2 * pulsePeriod
const asset = file => `${import.meta.env.BASE_URL}globe/${file}`
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const wrap = lng => ((lng + 540) % 360) - 180

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = asset(file)
  })
}

function readTextures(images) {
  const buffer = document.createElement('canvas')
  buffer.width = textureWidth
  buffer.height = textureHeight
  const context = buffer.getContext('2d', { willReadFrequently: true })
  return images.map(image => {
    context.clearRect(0, 0, textureWidth, textureHeight)
    context.drawImage(image, 0, 0, textureWidth, textureHeight)
    return context.getImageData(0, 0, textureWidth, textureHeight).data
  })
}

function direction(lat, lng) {
  const latitude = lat * toRadians
  const longitude = lng * toRadians
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.sin(longitude),
  ]
}

function viewBasis({ lat, lng }) {
  const latitude = lat * toRadians
  const longitude = lng * toRadians
  const sinLat = Math.sin(latitude)
  const cosLat = Math.cos(latitude)
  const sinLon = Math.sin(longitude)
  const cosLon = Math.cos(longitude)
  return {
    east: [-sinLon, 0, cosLon],
    north: [-sinLat * cosLon, cosLat, -sinLat * sinLon],
    center: [cosLat * cosLon, sinLat, cosLat * sinLon],
  }
}

function dot(vector, axis) {
  return vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2]
}

function positionAt(x, y, basis) {
  const depth = Math.sqrt(Math.max(0, 1 - x * x - y * y))
  const { east, north, center } = basis
  const earthX = x * east[0] + y * north[0] + depth * center[0]
  const earthY = y * north[1] + depth * center[1]
  const earthZ = x * east[2] + y * north[2] + depth * center[2]
  return { lat: Math.asin(clamp(earthY, -1, 1)) * toDegrees, lng: Math.atan2(earthZ, earthX) * toDegrees }
}

function createSurface(context, width, height) {
  const radius = Math.min(width, height) * 0.438
  const image = context.createImageData(width, height)
  const pixels = []
  const centerX = width / 2
  const centerY = height / 2

  for (let row = Math.floor(centerY - radius); row <= centerY + radius; row += 1) {
    for (let column = Math.floor(centerX - radius); column <= centerX + radius; column += 1) {
      const x = (column + 0.5 - centerX) / radius
      const y = (centerY - row - 0.5) / radius
      const distance = x * x + y * y
      if (distance >= 1) continue
      const z = Math.sqrt(1 - distance)
      const sunAngle = -0.67 * x + 0.48 * y + 0.565 * z
      const transition = clamp((sunAngle + 0.12) / 0.34, 0, 1)
      const daylight = transition ** 2 * (3 - 2 * transition)
      const reflection = Math.max(0, 2 * sunAngle * z - 0.565) ** 28
      const atmosphere = (1 - z) ** 4.4 * (0.10 + 0.90 * daylight)
      const strength = Math.max(0, sunAngle)
      const index = (row * width + column) * 4
      image.data[index + 3] = clamp((1 - distance) * radius * 150, 0, 255)
      pixels.push(x, y, z, index, daylight, strength, reflection, atmosphere)
    }
  }

  return { radius, centerX, centerY, image, pixels: new Float32Array(pixels) }
}

function drawGlobe(context, surface, textures, basis) {
  const { image, pixels, centerX, centerY, radius } = surface
  const { east, north, center } = basis
  const output = image.data
  const [day, night, clouds] = textures
  const longitudeScale = textureWidth / (2 * Math.PI)
  const latitudeScale = textureHeight / Math.PI

  for (let i = 0; i < pixels.length; i += 8) {
    const x = pixels[i]
    const y = pixels[i + 1]
    const z = pixels[i + 2]
    const pixel = pixels[i + 3]
    const daylight = pixels[i + 4]
    const strength = pixels[i + 5]
    const reflection = pixels[i + 6]
    const rim = pixels[i + 7]
    const v = clamp(y * north[1] + z * center[1], -1, 1)
    const u = Math.atan2(x * east[2] + y * north[2] + z * center[2], x * east[0] + y * north[0] + z * center[0])
    const mapX = Math.min(textureWidth - 1, Math.floor((u + Math.PI) * longitudeScale))
    const mapY = Math.min(textureHeight - 1, Math.floor((Math.PI / 2 - Math.asin(v)) * latitudeScale))
    const sample = (mapY * textureWidth + mapX) * 4
    const cloud = clouds[sample + 3] / 255
    const landR = day[sample]
    const landG = day[sample + 1]
    const landB = day[sample + 2]
    const sunlitSurface = 0.67 + 0.53 * strength
    const cloudCover = cloud * 0.72
    const surfaceLight = sunlitSurface * (1 - cloudCover) * daylight
    const cloudLight = cloudCover * (0.56 + 0.41 * strength) * daylight
    const darkness = 1 - daylight
    const cityLight = Math.max(0, night[sample] - 40) * darkness * (1 - cloud * 0.67)
    const sheen = reflection * clamp((landB - landR - 4) / 29, 0, 1) * (1 - cloud) * daylight

    output[pixel] = landR * (surfaceLight + 0.064 * darkness) + 229 * cloudLight + cityLight * 1.01 + 3 * darkness + 38 * sheen + 17 * rim
    output[pixel + 1] = landG * (surfaceLight + 0.085 * darkness) + 242 * cloudLight + cityLight * 0.78 + 6 * darkness + 62 * sheen + 56 * rim
    output[pixel + 2] = landB * (surfaceLight + 0.14 * darkness) + 255 * cloudLight + cityLight * 0.49 + 11 * darkness + 111 * sheen + 110 * rim
  }

  context.putImageData(image, 0, 0)
  const air = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.065)
  air.addColorStop(0, 'rgba(39, 87, 216, 0)')
  air.addColorStop(0.928, 'rgba(48, 94, 221, 0)')
  air.addColorStop(0.942, 'rgba(121, 185, 252, .22)')
  air.addColorStop(0.958, 'rgba(63, 133, 244, .10)')
  air.addColorStop(1, 'rgba(39, 87, 216, 0)')
  context.fillStyle = air
  context.fillRect(0, 0, image.width, image.height)
}

function projection(vector, basis, surface) {
  return {
    x: surface.centerX + dot(vector, basis.east) * surface.radius,
    y: surface.centerY - dot(vector, basis.north) * surface.radius,
    depth: dot(vector, basis.center),
  }
}

function drawBorders(context, paths, basis, surface) {
  context.beginPath()
  for (const path of paths) {
    let previous = null
    for (const point of path) {
      const location = projection(point, basis, surface)
      if (location.depth < 0.035) {
        previous = null
      } else {
        if (previous) context.lineTo(location.x, location.y)
        else context.moveTo(location.x, location.y)
        previous = location
      }
    }
  }
  context.lineWidth = Math.max(0.6, surface.radius * 0.0032)
  context.strokeStyle = 'rgba(166, 204, 228, 0.29)'
  context.stroke()
}

function drawPin(context, point, basis, surface, time, started, temporary, reducedMotion) {
  const { x, y, depth } = projection(direction(point.lat, point.lng), basis, surface)
  if (depth < 0.02) return
  const dotSize = clamp(surface.radius / 43, 2.5, 5.5)
  const elapsed = time - started
  if (!temporary && !reducedMotion && elapsed >= 0 && elapsed < pulseDuration) {
    const phase = (elapsed % pulsePeriod) / pulsePeriod
    context.beginPath()
    context.arc(x, y, dotSize * (1.2 + 3.25 * phase), 0, 2 * Math.PI)
    context.strokeStyle = `rgba(63,227,255,${(1 - phase) * 0.9})`
    context.lineWidth = 1.4
    context.stroke()
  }
  const glow = context.createRadialGradient(x, y, 0, x, y, dotSize * 3.2)
  glow.addColorStop(0, 'rgba(135,251,255,.9)')
  glow.addColorStop(0.35, 'rgba(25,229,255,.47)')
  glow.addColorStop(1, 'rgba(25,179,255,0)')
  context.fillStyle = glow
  context.fillRect(x - dotSize * 3.2, y - dotSize * 3.2, dotSize * 6.4, dotSize * 6.4)
  context.beginPath()
  context.arc(x, y, temporary ? dotSize * 0.63 : dotSize, 0, 2 * Math.PI)
  context.fillStyle = temporary ? '#b7f1ff' : '#24e9fc'
  context.fill()
  context.strokeStyle = '#ebfeff'
  context.lineWidth = 0.8
  context.stroke()
}

export default function CanvasEarth({ selectedCity, selectionKey, paused, clickedPoint, onLocationSelect, onReady, onUnavailable }) {
  const canvas = useRef(null)
  const engine = useRef(null)
  const current = useRef(null)
  current.current = { selectedCity, selectionKey, paused, clickedPoint, onLocationSelect, onReady, onUnavailable }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const element = canvas.current
    const context = element.getContext('2d', { alpha: true })
    if (!context) {
      current.current.onUnavailable?.('canvas-unavailable')
      return undefined
    }

    const controller = new AbortController()
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = true
    let surface
    let textures
    let borders = []
    let view = initialView
    let previousCity
    let previousKey
    let markerStarted = -Infinity
    let transition
    let frame = 0
    let needsPaint = true
    let previousFrame = 0
    let wasPulsing = false
    let announced = false
    let drag
    let holdUntil = 0
    let idleTimer

    function requestFrame() {
      if (!frame && surface && textures && visible) frame = requestAnimationFrame(paint)
    }

    function invalidate() {
      needsPaint = true
      requestFrame()
    }

    function updateSelection() {
      const { selectedCity: city, selectionKey: key } = current.current
      if (city && (city !== previousCity || key !== previousKey)) {
        previousCity = city
        previousKey = key
        markerStarted = performance.now()
        const target = { lat: city.lat, lng: city.lon }
        if (preference.matches) view = target
        else transition = { start: markerStarted, initial: view, target }
      }
      invalidate()
    }

    function paint(time) {
      frame = 0
      if (!visible || !textures || !surface) return
      const { selectedCity: city, paused: idlePaused, clickedPoint: click } = current.current
      const spinning = !city && !idlePaused && !preference.matches && !drag && time >= holdUntil
      const pulsing = Boolean(city && !preference.matches && time - markerStarted < pulseDuration)
      if (!needsPaint && wasPulsing === pulsing && time - previousFrame < 42) {
        if (transition || spinning || pulsing) requestFrame()
        return
      }
      wasPulsing = pulsing
      if (transition) {
        const progress = clamp((time - transition.start) / 1350, 0, 1)
        const eased = 0.5 - Math.cos(Math.PI * progress) * 0.5
        const { initial, target } = transition
        view = {
          lat: initial.lat + (target.lat - initial.lat) * eased,
          lng: wrap(initial.lng + wrap(target.lng - initial.lng) * eased),
        }
        if (progress === 1) transition = null
      } else if (spinning && previousFrame) {
        view = { ...view, lng: wrap(view.lng + Math.min(80, time - previousFrame) * 0.0025) }
      }
      previousFrame = time
      needsPaint = false
      const basis = viewBasis(view)
      drawGlobe(context, surface, textures, basis)
      drawBorders(context, borders, basis, surface)
      if (click) drawPin(context, click, basis, surface, time, markerStarted, true, preference.matches)
      if (city) drawPin(context, { lat: city.lat, lng: city.lon }, basis, surface, time, markerStarted, false, preference.matches)
      if (!announced) {
        announced = true
        setReady(true)
        current.current.onReady?.()
      }
      if (transition || spinning || pulsing) requestFrame()
    }

    function resize() {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      const scale = Math.min(window.devicePixelRatio || 1, 1.25, 500 / Math.max(width, height))
      const bitmapWidth = Math.round(width * scale)
      const bitmapHeight = Math.round(height * scale)
      if (surface && element.width === bitmapWidth && element.height === bitmapHeight) return
      element.width = bitmapWidth
      element.height = bitmapHeight
      surface = createSurface(context, bitmapWidth, bitmapHeight)
      invalidate()
    }

    function holdRotation() {
      holdUntil = performance.now() + 1800
      clearTimeout(idleTimer)
      idleTimer = setTimeout(invalidate, 1810)
    }

    function pointerDown(event) {
      if (!announced || !event.isPrimary || event.button !== 0) return
      transition = null
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view, moved: false }
      element.setPointerCapture(event.pointerId)
      element.style.cursor = 'grabbing'
      holdRotation()
    }

    function pointerMove(event) {
      if (drag?.id !== event.pointerId) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (Math.hypot(dx, dy) > 4) drag.moved = true
      if (!drag.moved) return
      const gain = 180 / Math.min(element.clientWidth, element.clientHeight)
      view = { lat: clamp(drag.view.lat + dy * gain, -85, 85), lng: wrap(drag.view.lng - dx * gain) }
      invalidate()
    }

    function pointerEnd(event) {
      if (drag?.id !== event.pointerId) return
      const { moved } = drag
      drag = null
      element.style.cursor = 'grab'
      holdRotation()
      if (event.type !== 'pointerup' || moved) return
      const box = element.getBoundingClientRect()
      const x = ((event.clientX - box.left) * (element.width / box.width) - surface.centerX) / surface.radius
      const y = (surface.centerY - (event.clientY - box.top) * (element.height / box.height)) / surface.radius
      if (x * x + y * y <= 1) current.current.onLocationSelect?.(positionAt(x, y, viewBasis(view)))
    }

    function keyDown(event) {
      if (!announced) return
      const offsets = { ArrowUp: [9, 0], ArrowDown: [-9, 0], ArrowLeft: [0, -12], ArrowRight: [0, 12] }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        current.current.onLocationSelect?.({ ...view })
      } else if (offsets[event.key]) {
        event.preventDefault()
        const [lat, lng] = offsets[event.key]
        transition = null
        view = { lat: clamp(view.lat + lat, -85, 85), lng: wrap(view.lng + lng) }
        holdRotation()
        invalidate()
      }
    }

    const observer = new ResizeObserver(resize)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) invalidate()
      else cancelAnimationFrame(frame)
      if (!visible) frame = 0
    })
    function motionChange() {
      if (preference.matches && transition) {
        view = transition.target
        transition = null
      }
      invalidate()
    }

    engine.current = { updateSelection, keyDown }
    observer.observe(element)
    intersection.observe(element)
    preference.addEventListener('change', motionChange)
    element.addEventListener('pointerdown', pointerDown)
    element.addEventListener('pointermove', pointerMove)
    element.addEventListener('pointerup', pointerEnd)
    element.addEventListener('pointercancel', pointerEnd)
    element.addEventListener('lostpointercapture', pointerEnd)

    Promise.all(['earth-day.webp', 'earth-night.webp', 'clouds-alpha.webp'].map(loadImage))
      .then(images => {
        if (controller.signal.aborted) return
        textures = readTextures(images)
        updateSelection()
      })
      .catch(() => {
        if (!controller.signal.aborted) current.current.onUnavailable?.('canvas-assets-unavailable')
      })
    fetch(asset('country-borders.json'), { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Country borders are unavailable.')
        return response.json()
      })
      .then(paths => {
        if (controller.signal.aborted) return
        borders = paths.map(path => path.map(([lng, lat]) => direction(lat, lng)))
        invalidate()
      })
      .catch(() => {})

    return () => {
      controller.abort()
      observer.disconnect()
      intersection.disconnect()
      preference.removeEventListener('change', motionChange)
      element.removeEventListener('pointerdown', pointerDown)
      element.removeEventListener('pointermove', pointerMove)
      element.removeEventListener('pointerup', pointerEnd)
      element.removeEventListener('pointercancel', pointerEnd)
      element.removeEventListener('lostpointercapture', pointerEnd)
      cancelAnimationFrame(frame)
      clearTimeout(idleTimer)
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.updateSelection()
  }, [selectedCity, selectionKey, paused, clickedPoint])

  return (
    <canvas
      ref={canvas}
      className="trendproof-globe"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      role="group"
      aria-label="Interactive Earth globe"
      aria-describedby="globe-keyboard"
      tabIndex={ready ? 0 : -1}
      onKeyDown={event => engine.current?.keyDown(event)}
    />
  )
}
