const clickTimeLimit = 500
const velocityWindow = 90
const staleVelocityTime = 70
const coastTime = 175
const minimumCoastSpeed = 0.006
const maximumCoastSpeed = 0.25

export function bindGlobePointer(element, { onStart, onDrag, onSelect, onEnd }) {
  const owner = element.ownerDocument
  const browser = owner.defaultView
  let gesture

  function start(event) {
    if (event.button !== 0 || event.isPrimary === false) return
    const mouseEvent = event.type === 'mousedown'
    const mouse = mouseEvent || event.pointerType === 'mouse'
    // Keep compatibility mouse events available if a browser drops pointer moves.
    if (mouseEvent || !mouse) event.preventDefault()
    if (gesture) return
    gesture = {
      id: mouseEvent ? null : event.pointerId,
      mouse,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      dragging: false,
      samples: [{ x: 0, y: 0, time: event.timeStamp }],
    }
    if (!mouseEvent) {
      try {
        element.setPointerCapture(event.pointerId)
      } catch {
        // Document listeners can track the gesture if capture is unavailable.
      }
    }
    onStart()
  }

  function matches(event) {
    return gesture && (event.type.startsWith('mouse') ? gesture.mouse : gesture.id === event.pointerId)
  }

  function update(event) {
    if (!matches(event)) return
    if (gesture.mouse && event.type.endsWith('move') && !(event.buttons & 1)) {
      finish()
      return
    }
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (event.type.endsWith('move')) {
      const samples = gesture.samples
      const last = samples.at(-1)
      if (event.timeStamp > last.time && (dx !== last.x || dy !== last.y)) {
        const cutoff = event.timeStamp - velocityWindow
        while (samples.length > 1 && samples[1].time <= cutoff) samples.shift()
        samples.push({ x: dx, y: dy, time: event.timeStamp })
      }
    }
    const threshold = gesture.mouse ? 2 : 5
    if (!gesture.dragging && Math.hypot(dx, dy) < threshold) {
      const samples = event.getCoalescedEvents?.() ?? []
      if (!samples.some(point => Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) >= threshold)) return
    }
    if (gesture.dx === dx && gesture.dy === dy) return
    gesture.dragging = true
    gesture.dx = dx
    gesture.dy = dy
    onDrag({ dx, dy })
  }

  function finish(event) {
    if (!gesture || (event && !matches(event))) return
    const released = event?.type === 'mouseup' || event?.type === 'pointerup'
    if (released && event.button !== 0) return
    if (released) update(event)
    const { dragging, time, id, samples } = gesture
    const velocity = released && dragging ? releaseVelocity(samples, event.timeStamp) : null
    gesture = null
    if (id !== null && element.hasPointerCapture(id)) element.releasePointerCapture(id)
    onEnd(velocity)
    if (released && !dragging && event.timeStamp - time <= clickTimeLimit) onSelect(event)
  }

  const cancel = () => finish()
  element.addEventListener('mousedown', start)
  element.addEventListener('pointerdown', start)
  owner.addEventListener('mousemove', update, true)
  owner.addEventListener('pointermove', update, true)
  owner.addEventListener('mouseup', finish, true)
  owner.addEventListener('pointerup', finish, true)
  owner.addEventListener('pointercancel', finish, true)
  element.addEventListener('lostpointercapture', finish)
  browser.addEventListener('blur', cancel)
  return () => {
    cancel()
    element.removeEventListener('mousedown', start)
    element.removeEventListener('pointerdown', start)
    owner.removeEventListener('mousemove', update, true)
    owner.removeEventListener('pointermove', update, true)
    owner.removeEventListener('mouseup', finish, true)
    owner.removeEventListener('pointerup', finish, true)
    owner.removeEventListener('pointercancel', finish, true)
    element.removeEventListener('lostpointercapture', finish)
    browser.removeEventListener('blur', cancel)
  }
}

function releaseVelocity(samples, releaseTime) {
  const last = samples.at(-1)
  const releaseDelay = releaseTime - last.time
  if (samples.length < 2 || releaseDelay < 0 || releaseDelay > staleVelocityTime) return null

  const cutoff = last.time - velocityWindow
  const first = samples.findLast(sample => sample.time >= cutoff && sample.time <= last.time - 35)
    ?? samples.find(sample => sample.time >= cutoff)
  if (first === last) return null
  const elapsed = Math.max(12, last.time - first.time)
  return { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed }
}

export function offsetGlobeView(view, latitude, longitude) {
  return {
    ...view,
    lat: Math.max(-85, Math.min(85, view.lat + latitude)),
    lng: ((view.lng + longitude + 180) % 360 + 360) % 360 - 180,
  }
}

export function viewAfterDrag(view, { dx, dy }, element) {
  const scale = angularScale(element)
  return offsetGlobeView(view, dy * scale, -dx * scale)
}

function angularScale(element) {
  return 240 / Math.max(1, Math.min(element.clientWidth, element.clientHeight))
}

export function createGlobeInertia(velocity, element) {
  if (!velocity) return null
  const scale = angularScale(element)
  const speed = Math.hypot(velocity.x, velocity.y) * scale
  if (!Number.isFinite(speed) || speed < minimumCoastSpeed) return null
  const gain = scale * Math.min(1, maximumCoastSpeed / speed)
  return { latitude: velocity.y * gain, longitude: -velocity.x * gain }
}

export function stepGlobeInertia(inertia, elapsed) {
  const frameTime = Math.max(0, Math.min(elapsed, 48))
  const damping = Math.exp(-frameTime / coastTime)
  const travel = coastTime * (1 - damping)
  const latitude = inertia.latitude * travel
  const longitude = inertia.longitude * travel
  inertia.latitude *= damping
  inertia.longitude *= damping
  const done = Math.hypot(inertia.latitude, inertia.longitude) < minimumCoastSpeed
  return { latitude, longitude, done }
}
