import { useEffect, useImperativeHandle, useRef } from 'react'
import { createGlobeInertia, offsetGlobeView, stepGlobeInertia, viewAfterDrag } from './globePointer'
import {
  countryRings, findCountry, globeFlightMs, globeIdleResumeMs, globeStart, globeTextures, loadCountries, positionGlobeLabel,
} from './globeVisuals'

const toRadians = Math.PI / 180
const toDegrees = 1 / toRadians
const cameraDistance = 1 + globeStart.altitude
const cameraProjection = Math.sqrt(cameraDistance ** 2 - 1)
const textureWidth = 1536
const textureHeight = textureWidth / 2
const idleDegreesPerMillisecond = 360 / 60 / 1000 * 0.4
const frameInterval = 1000 / 30 - 2
const pulsePeriod = 1500
const fadeDuration = 500
const cloudDriftSpeed = 0.000032
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const wrap = lng => ((lng + 540) % 360) - 180
const bordersUrl = `${import.meta.env.BASE_URL}globe/country-borders.json`

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

function readTexture(image) {
  const buffer = document.createElement('canvas')
  buffer.width = textureWidth
  buffer.height = textureHeight
  const context = buffer.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, textureWidth, textureHeight)
  return context.getImageData(0, 0, textureWidth, textureHeight).data
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

function globeNormal(x, y, radius = 1) {
  const rayX = x / cameraProjection
  const rayY = y / cameraProjection
  const rayPower = 1 + rayX * rayX + rayY * rayY
  const rayTime = (cameraDistance - Math.sqrt(Math.max(0, cameraDistance ** 2 - rayPower * (cameraDistance ** 2 - radius ** 2)))) / rayPower
  return [rayX * rayTime / radius, rayY * rayTime / radius, (cameraDistance - rayTime) / radius]
}

function positionAt(x, y, basis) {
  const [screenX, screenY, depth] = globeNormal(x, y)
  const { east, north, center } = basis
  const earthX = screenX * east[0] + screenY * north[0] + depth * center[0]
  const earthY = screenY * north[1] + depth * center[1]
  const earthZ = screenX * east[2] + screenY * north[2] + depth * center[2]
  return { lat: Math.asin(clamp(earthY, -1, 1)) * toDegrees, lng: Math.atan2(earthZ, earthX) * toDegrees }
}

function createSurface(context, width, height) {
  const radius = Math.min(width, height) * 0.438
  const image = context.createImageData(width, height)
  const pixels = []
  const centerX = width / 2
  const centerY = height / 2
  const airRadius = radius * 1.09

  for (let row = Math.floor(centerY - airRadius); row <= centerY + airRadius; row += 1) {
    for (let column = Math.floor(centerX - airRadius); column <= centerX + airRadius; column += 1) {
      const x = (column + 0.5 - centerX) / radius
      const y = (centerY - row - 0.5) / radius
      const distance = x * x + y * y
      const index = (row * width + column) * 4
      if (distance >= 1) {
        const altitude = (Math.sqrt(distance) - 1) / 0.09
        if (altitude > 1) continue
        const sunHorizon = clamp(0.31 - 0.64 * x + 0.45 * y, 0, 1)
        const mist = (1 - altitude) ** 3.5
        image.data[index] = 54 + 83 * sunHorizon * mist
        image.data[index + 1] = 118 + 104 * sunHorizon * mist
        image.data[index + 2] = 253
        image.data[index + 3] = (16 + 153 * sunHorizon) * mist
        continue
      }
      const [sphereX, sphereY, sphereZ] = globeNormal(x, y)
      const [cloudX, cloudY, cloudZ] = globeNormal(x, y, 1.009)
      const sunAngle = -0.82 * sphereX + 0.53 * sphereY + 0.21 * sphereZ
      const transition = clamp((sunAngle + 0.14) / 0.42, 0, 1)
      const daylight = transition ** 2 * (3 - 2 * transition)
      const reflection = Math.max(0, 2 * sunAngle * sphereZ - 0.21) ** 28
      const facing = (cameraDistance * sphereZ - 1) / Math.hypot(sphereX, sphereY, cameraDistance - sphereZ)
      const atmosphere = (1 - facing) ** 4.8 * (0.2 + 0.8 * daylight)
      const strength = Math.max(0, sunAngle)
      image.data[index + 3] = clamp((1 - distance) * radius * 108, 115, 255)
      pixels.push(sphereX, sphereY, sphereZ, index, daylight, strength, reflection, atmosphere, cloudX, cloudY, cloudZ)
    }
  }

  return { radius, centerX, centerY, image, pixels: new Float32Array(pixels) }
}

function shadeGlobe(surface, textures, basis, cloudDrift) {
  const { image, pixels } = surface
  const { east, north, center } = basis
  const output = image.data
  const [day, night, bump, clouds] = textures
  const longitudeScale = textureWidth / (2 * Math.PI)
  const latitudeScale = textureHeight / Math.PI

  for (let i = 0; i < pixels.length; i += 11) {
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
    let cloud = 0
    if (clouds) {
      const cloudX = pixels[i + 8]
      const cloudY = pixels[i + 9]
      const cloudZ = pixels[i + 10]
      const cloudLatitude = clamp(cloudY * north[1] + cloudZ * center[1], -1, 1)
      const cloudLongitude = Math.atan2(cloudX * east[2] + cloudY * north[2] + cloudZ * center[2], cloudX * east[0] + cloudY * north[0] + cloudZ * center[0])
      const shiftedLongitude = (cloudLongitude + Math.PI) * longitudeScale + cloudDrift
      const cloudU = shiftedLongitude >= textureWidth ? shiftedLongitude - textureWidth : shiftedLongitude
      const cloudRow = Math.min(textureHeight - 1, Math.floor((Math.PI / 2 - Math.asin(cloudLatitude)) * latitudeScale)) * textureWidth
      const cloudColumn = Math.floor(cloudU)
      const cloudBlend = cloudU - cloudColumn
      const nextColumn = cloudColumn + 1 === textureWidth ? 0 : cloudColumn + 1
      cloud = (clouds[(cloudRow + cloudColumn) * 4 + 3] * (1 - cloudBlend)
        + clouds[(cloudRow + nextColumn) * 4 + 3] * cloudBlend) / 255
    }
    const landR = day[sample]
    const landG = day[sample + 1]
    const landB = day[sample + 2]
    let relief = 0
    if (bump) {
      const eastBump = bump[(mapY * textureWidth + (mapX + 2) % textureWidth) * 4] - bump[sample]
      const northBump = bump[(Math.max(0, mapY - 2) * textureWidth + mapX) * 4] - bump[sample]
      relief = (eastBump - northBump * 0.66) * 0.0015
    }
    const sunlitSurface = 0.74 + 0.46 * strength + relief
    const cloudCover = cloud * 0.8
    const surfaceLight = sunlitSurface * (1 - cloudCover) * daylight
    const cloudLight = cloudCover * (0.56 + 0.41 * strength) * daylight
    const darkness = 1 - daylight
    const cityLight = night ? Math.max(0, night[sample] - 25) * darkness * (1 - cloud * 0.38) : 0
    const sheen = reflection * clamp((landB - landR - 4) / 29, 0, 1) * (1 - cloud) * daylight

    output[pixel] = landR * (surfaceLight + 0.071 * darkness) + 234 * cloudLight + cityLight * 1.47 + 3 * darkness + 38 * sheen + 61 * rim
    output[pixel + 1] = landG * (surfaceLight + 0.092 * darkness) + 245 * cloudLight + cityLight * 1.06 + 6 * darkness + 62 * sheen + 115 * rim
    output[pixel + 2] = landB * (surfaceLight + 0.15 * darkness) + 255 * cloudLight + cityLight * 0.53 + 11 * darkness + 111 * sheen + 184 * rim
  }
}

function projection(vector, basis, surface) {
  const depth = dot(vector, basis.center)
  const scale = cameraProjection * surface.radius / (cameraDistance - depth)
  return {
    x: surface.centerX + dot(vector, basis.east) * scale,
    y: surface.centerY - dot(vector, basis.north) * scale,
    depth,
  }
}

function drawBorders(context, paths, basis, surface) {
  context.beginPath()
  for (const path of paths) {
    let previous = null
    for (const point of path) {
      const location = projection(point, basis, surface)
      if (location.depth < 1 / cameraDistance + 0.015) {
        previous = null
      } else {
        if (previous) context.lineTo(location.x, location.y)
        else context.moveTo(location.x, location.y)
        previous = location
      }
    }
  }
  context.lineWidth = Math.max(0.6, surface.radius * 0.0032)
  context.strokeStyle = 'rgba(158, 193, 221, 0.38)'
  context.stroke()
}

function drawCountry(context, entry, basis, surface, time, reducedMotion) {
  if (!entry) return
  const opacity = entry.exiting === undefined || reducedMotion ? 1 : 1 - (time - entry.exiting) / fadeDuration
  if (opacity <= 0) return
  const horizon = 1 / cameraDistance + 0.006
  const paths = entry.paths.map(path => path.map(point => projection(point, basis, surface)))

  context.save()
  context.globalAlpha = opacity
  context.beginPath()
  for (const path of paths) {
    if (path.length < 4 || path.some(point => point.depth < horizon)) continue
    context.moveTo(path[0].x, path[0].y)
    for (const point of path.slice(1)) context.lineTo(point.x, point.y)
    context.closePath()
  }
  context.fillStyle = 'rgba(0, 229, 255, 0.08)'
  context.fill('evenodd')

  context.beginPath()
  for (const path of paths) {
    let previous
    for (const point of path) {
      if (point.depth < horizon) previous = null
      else {
        if (previous) context.lineTo(point.x, point.y)
        else context.moveTo(point.x, point.y)
        previous = point
      }
    }
  }
  const scale = clamp(surface.radius / 200, 0.66, 1.2)
  context.strokeStyle = 'rgba(0, 217, 255, .23)'
  context.lineWidth = 3.5 * scale
  context.stroke()
  context.lineWidth = 1.3 * scale
  context.setLineDash([3.75 * scale, 2.8 * scale])
  context.lineDashOffset = reducedMotion ? 0 : -(time * 0.018) % (6.55 * scale)
  context.strokeStyle = '#52f6ff'
  context.shadowColor = '#00e5ff'
  context.shadowBlur = 5 * scale
  context.stroke()
  context.restore()
}

function drawPin(context, point, basis, surface, time, started, temporary, reducedMotion) {
  const location = projection(direction(point.lat, point.lng), basis, surface)
  if (location.depth < 1 / cameraDistance + 0.02) return null
  const { x, y } = location
  const dotSize = clamp(surface.radius / 29, 3.1, 7.5)
  const elapsed = time - started
  const drop = temporary || reducedMotion ? 0 : dotSize * 5.1 * (1 - clamp(elapsed / 440, 0, 1)) ** 3
  const pinY = y - drop
  if (!temporary) {
    const beamTop = y - dotSize * 7.1
    const beam = context.createLinearGradient(x, beamTop, x, y)
    beam.addColorStop(0, 'rgba(0,229,255,0)')
    beam.addColorStop(0.54, 'rgba(37,230,255,.18)')
    beam.addColorStop(1, 'rgba(131,251,255,.86)')
    context.fillStyle = beam
    context.beginPath()
    context.moveTo(x - 0.5, beamTop)
    context.lineTo(x + 0.5, beamTop)
    context.lineTo(x + dotSize * 0.56, y)
    context.lineTo(x - dotSize * 0.56, y)
    context.fill()
    if (!reducedMotion && elapsed >= 0) {
      const phase = (elapsed % pulsePeriod) / pulsePeriod
      context.beginPath()
      context.arc(x, y, dotSize * (1.1 + 3.65 * phase), 0, 2 * Math.PI)
      context.strokeStyle = `rgba(63,227,255,${(1 - phase) * 0.9})`
      context.lineWidth = 1.65
      context.stroke()
    }
  }
  const glow = context.createRadialGradient(x, pinY, 0, x, pinY, dotSize * 3.2)
  glow.addColorStop(0, 'rgba(135,251,255,.9)')
  glow.addColorStop(0.35, 'rgba(25,229,255,.47)')
  glow.addColorStop(1, 'rgba(25,179,255,0)')
  context.fillStyle = glow
  context.fillRect(x - dotSize * 3.2, pinY - dotSize * 3.2, dotSize * 6.4, dotSize * 6.4)
  context.beginPath()
  context.arc(x, pinY, temporary ? dotSize * 0.53 : dotSize * 0.77, 0, 2 * Math.PI)
  context.fillStyle = temporary ? '#b7f1ff' : '#00E5FF'
  context.fill()
  context.strokeStyle = '#ebfeff'
  context.lineWidth = 1.2
  context.stroke()
  return location
}

export default function CanvasEarth({ selectedCity, selectionKey, clickedPoint, controllerRef, labelRef, onReady, onUnavailable }) {
  const canvas = useRef(null)
  const engine = useRef(null)
  const current = useRef(null)
  current.current = { selectedCity, selectionKey, clickedPoint, onReady, onUnavailable }
  useImperativeHandle(controllerRef, () => ({
    start: (...args) => engine.current?.start(...args),
    drag: (...args) => engine.current?.drag(...args),
    end: (...args) => engine.current?.end(...args),
    pick: (...args) => engine.current?.pick(...args),
    center: () => engine.current?.center(),
    nudge: (...args) => engine.current?.nudge(...args),
    resume: () => engine.current?.resume(),
  }), [])

  useEffect(() => {
    const element = canvas.current
    const context = element.getContext('2d', { alpha: true })
    if (!context) {
      current.current.onUnavailable?.('canvas-unavailable')
      return undefined
    }

    const controller = new AbortController()
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let intersecting = true
    let visible = !document.hidden
    let hiddenSince = visible ? null : performance.now()
    let surface
    const textures = [null, null, null, null]
    let borders = []
    let countries = []
    let highlightedCountry
    let outgoingCountry
    let view = globeStart
    let previousCity
    let previousKey
    let markerStarted = null
    let shadedView
    let nextCloudPaint = 0
    let cloudDrift = 0
    let stageWidth = 0
    let stageHeight = 0
    let transition
    let inertia
    let frame = 0
    let needsPaint = true
    let previousFrame = 0
    let announced = false
    let drag
    let holdUntil = 0

    function requestFrame() {
      if (!frame && surface && textures[0] && visible) frame = requestAnimationFrame(paint)
    }

    function invalidate() {
      needsPaint = true
      if (!announced && surface && textures[0]) {
        drawScene(performance.now())
        announced = true
        current.current.onReady?.()
      }
      requestFrame()
    }

    function updateSelection() {
      const { selectedCity: city, selectionKey: key } = current.current
      if (city !== previousCity || key !== previousKey) {
        previousCity = city
        previousKey = key
        markerStarted = null
        transition = null
        inertia = null
        holdRotation()
        if (city) {
          const target = { lat: city.lat, lng: city.lon }
          if (preference.matches) {
            view = target
            markerStarted = performance.now()
          } else {
            transition = { start: null, initial: view, target }
          }
        }
      }
      const country = city ? findCountry(countries, city) : null
      if (country !== (highlightedCountry?.country ?? null)) {
        outgoingCountry = highlightedCountry && !preference.matches
          ? { ...highlightedCountry, exiting: performance.now() }
          : null
        highlightedCountry = country
          ? { country, paths: countryRings(country).map(path => path.map(([lng, lat]) => direction(lat, lng))) }
          : null
      }
      invalidate()
    }

    function paint(time) {
      frame = 0
      if (!visible || !textures[0] || !surface) return
      const animate = !preference.matches
      const spinning = animate && !drag && !transition && time >= holdUntil
      if (!needsPaint && time - previousFrame < frameInterval) {
        if (animate) requestFrame()
        return
      }
      const delta = previousFrame ? Math.min(60, time - previousFrame) : 0
      if (transition) {
        transition.start ??= time
        const progress = clamp((time - transition.start) / globeFlightMs, 0, 1)
        const eased = 0.5 - Math.cos(Math.PI * progress) * 0.5
        const { initial, target } = transition
        view = {
          lat: initial.lat + (target.lat - initial.lat) * eased,
          lng: wrap(initial.lng + wrap(target.lng - initial.lng) * eased),
        }
        if (progress === 1) {
          view = target
          transition = null
          markerStarted = time
          holdRotation(time)
        }
      } else if (inertia && delta) {
        const { latitude, longitude, done } = stepGlobeInertia(inertia, delta)
        view = offsetGlobeView(view, latitude, longitude)
        if (done) inertia = null
      } else if (spinning && delta) {
        view = { ...view, lng: wrap(view.lng - delta * idleDegreesPerMillisecond) }
      }
      if (animate) cloudDrift = (cloudDrift + delta * cloudDriftSpeed) % textureWidth
      previousFrame = time
      needsPaint = false
      drawScene(time)
      if (animate) requestFrame()
    }

    function drawScene(time) {
      const { selectedCity: city, clickedPoint: click } = current.current
      const basis = viewBasis(view)
      if (shadedView !== view || (textures[3] && !preference.matches && time >= nextCloudPaint)) {
        shadeGlobe(surface, textures, basis, cloudDrift)
        shadedView = view
        nextCloudPaint = time + 320
      }
      context.putImageData(surface.image, 0, 0)
      drawBorders(context, borders, basis, surface)
      drawCountry(context, outgoingCountry, basis, surface, time, preference.matches)
      if (outgoingCountry && time - outgoingCountry.exiting >= fadeDuration) outgoingCountry = null
      if (!transition) drawCountry(context, highlightedCountry, basis, surface, time, preference.matches)
      if (click) drawPin(context, click, basis, surface, time, 0, true, preference.matches)
      const marker = city && markerStarted !== null && !transition
        ? drawPin(context, { lat: city.lat, lng: city.lon }, basis, surface, time, markerStarted, false, preference.matches)
        : null
      const stageX = marker ? marker.x * stageWidth / surface.image.width : null
      const stageY = marker ? marker.y * stageHeight / surface.image.height : null
      if (labelRef?.current) positionGlobeLabel(labelRef.current, stageX, stageY, stageWidth, stageHeight)
    }

    function resize() {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      stageWidth = width
      stageHeight = height
      const scale = Math.min(window.devicePixelRatio || 1, 1.25, 500 / Math.max(width, height))
      const bitmapWidth = Math.round(width * scale)
      const bitmapHeight = Math.round(height * scale)
      if (!surface || element.width !== bitmapWidth || element.height !== bitmapHeight) {
        element.width = bitmapWidth
        element.height = bitmapHeight
        surface = createSurface(context, bitmapWidth, bitmapHeight)
        shadedView = null
      }
      invalidate()
    }

    function holdRotation(time = performance.now()) {
      holdUntil = time + globeIdleResumeMs
    }

    const controls = {
      start() {
        if (transition) markerStarted = performance.now()
        transition = null
        inertia = null
        drag = view
        holdRotation()
      },
      drag(delta, input) {
        if (!drag) return
        view = viewAfterDrag(drag, delta, input)
        invalidate()
      },
      end(velocity, element) {
        drag = null
        inertia = preference.matches ? null : createGlobeInertia(velocity, element)
        holdRotation()
        invalidate()
      },
      pick(event) {
        if (!surface) return null
        const box = element.getBoundingClientRect()
        const x = ((event.clientX - box.left) * (element.width / box.width) - surface.centerX) / surface.radius
        const y = (surface.centerY - (event.clientY - box.top) * (element.height / box.height)) / surface.radius
        return x * x + y * y <= 1 ? positionAt(x, y, viewBasis(view)) : null
      },
      center() {
        return view
      },
      nudge(latitude, longitude) {
        if (transition) markerStarted = performance.now()
        transition = null
        inertia = null
        view = offsetGlobeView(view, latitude, longitude)
        holdRotation()
        invalidate()
      },
      resume() {
        if (transition) markerStarted = performance.now()
        transition = null
        inertia = null
        holdUntil = 0
        invalidate()
      },
    }

    function updateVisibility() {
      const nextVisible = intersecting && !document.hidden
      if (visible === nextVisible) return
      visible = nextVisible
      const now = performance.now()
      if (!visible) {
        hiddenSince = now
        cancelAnimationFrame(frame)
        frame = 0
        previousFrame = 0
        return
      }
      const hiddenTime = now - hiddenSince
      if (transition?.start != null) transition.start += hiddenTime
      if (markerStarted !== null) markerStarted += hiddenTime
      if (outgoingCountry) outgoingCountry.exiting += hiddenTime
      hiddenSince = null
      invalidate()
    }

    const observer = new ResizeObserver(resize)
    const intersection = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting
      updateVisibility()
    })
    function motionChange() {
      if (preference.matches && transition) {
        view = transition.target
        transition = null
        markerStarted = performance.now()
        holdRotation()
      }
      if (preference.matches) {
        inertia = null
        outgoingCountry = null
      }
      invalidate()
    }

    engine.current = { updateSelection, ...controls }
    observer.observe(element)
    intersection.observe(element)
    document.addEventListener('visibilitychange', updateVisibility)
    preference.addEventListener('change', motionChange)

    const maps = [globeTextures.day, globeTextures.night, globeTextures.bump, globeTextures.clouds]
    maps.forEach((url, index) => {
      loadImage(url)
        .then(image => {
          if (controller.signal.aborted) return
          textures[index] = readTexture(image)
          shadedView = null
          invalidate()
        })
        .catch(() => {
          if (index === 0 && !controller.signal.aborted) current.current.onUnavailable?.('canvas-assets-unavailable')
        })
    })
    fetch(bordersUrl, { signal: controller.signal })
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
    loadCountries().then(result => {
      if (controller.signal.aborted) return
      countries = result
      updateSelection()
    }).catch(() => {})

    return () => {
      controller.abort()
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', updateVisibility)
      preference.removeEventListener('change', motionChange)
      cancelAnimationFrame(frame)
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.updateSelection()
  }, [selectedCity, selectionKey, clickedPoint])

  return (
    <canvas
      ref={canvas}
      className="trendproof-globe"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  )
}
