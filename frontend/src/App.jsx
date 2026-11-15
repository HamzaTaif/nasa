import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, CalendarDays, CircleAlert, Database, Download, Globe2, LoaderCircle, MapPin, Satellite, X,
} from 'lucide-react'
import { examples, metrics, parseClaim } from './claims'
import { geocodeCity, reverseGeocode } from './geocode'
import { analyzeClaim, POWER_DOCS, readSnapshot } from './power'
import SearchBar from './components/SearchBar'
import TrendChart from './components/TrendChart'
import VerdictCard, { signed } from './components/VerdictCard'
import StatsPanel from './components/StatsPanel'
import HeroGlobe from './components/HeroGlobe'

const challenge = 'https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/'
const imageCredit = 'https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/'
const globeCredits = `${import.meta.env.BASE_URL}globe/credits.txt`
const mobileGlobeQuery = '(max-width: 780px) and (pointer: coarse)'

function Brand() {
  return (
    <a className="brand" href="#explore" aria-label="TrendProof home">
      <span className="brand-mark"><Satellite size={23} strokeWidth={1.7} aria-hidden="true" /></span>
      <span>Trend<span className="brand-proof">Proof</span></span>
    </a>
  )
}

function Methodology({ dialog }) {
  return (
    <dialog ref={dialog} className="method-dialog" aria-labelledby="method-title" onClick={event => {
      if (event.target === event.currentTarget) dialog.current.close()
    }}>
      <div className="method-inner">
        <button type="button" autoFocus className="quiet-icon method-close" aria-label="Close methodology" onClick={() => dialog.current.close()}><X size={21} /></button>
        <div className="method-icon"><Database size={20} /></div>
        <h2 id="method-title">Methodology</h2>
        <h3>What the claim tests</h3>
        <p>Rule-based parsing extracts a city, one climate variable, a time window, and an optional trend direction. The default starts in 2001 and ends with the last complete calendar year. Try “Show the Seoul temperature trend since 2010”.</p>
        <h3>How annual values are built</h3>
        <p>NASA POWER supplies monthly values at the model grid cell covering the city coordinates. TrendProof requires all 12 months, weights monthly means by days, and sums corrected precipitation in millimeters. Meteorological estimates use NASA MERRA-2 reanalysis.</p>
        <h3>How the verdict works</h3>
        <p>Ordinary least squares fits the annual values over time. A two-sided Student t-test checks the zero-slope hypothesis at p &lt; 0.05. Confirmed means the slope agrees with the claim and passes the test. Partially true means the slope agrees and evidence is inconclusive. Not supported means the fitted slope is flat or points the other way.</p>
        <p>The test assumes independent residuals with constant variance. Serial correlation can affect the p-value. Unusual years are flagged when their residual exceeds twice the residual standard error. A trend describes the data within the selected years. Identifying its cause requires a separate study.</p>
        <h3>Worldwide city lookup</h3>
        <p>For cities outside the catalog, TrendProof looks up coordinates with Nominatim using data from <a className="text-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> and falls back to <a className="text-link" href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>. Add a country or region when several cities share a name.</p>
        <details><summary>Supported climate metrics ({Object.keys(metrics).length})</summary><p>{Object.values(metrics).map(metric => metric.name).join(', ')}.</p></details>
        <a className="text-link" href={POWER_DOCS} target="_blank" rel="noreferrer">NASA POWER documentation <ArrowUpRight size={16} /></a>
      </div>
    </dialog>
  )
}

function downloadCsv(result) {
  const metric = metrics[result.metric]
  const contents = [
    `Year,${metric.name} (${metric.unit}),Linear trend (${metric.unit}),Unusual year`,
    ...result.points.map(point => [
      point.year, point.value?.toFixed(5) ?? '', point.trend?.toFixed(5) ?? '', Number(point.anomaly),
    ].join(',')),
  ].join('\n')
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `trendproof-${result.city.id}-${result.metric.toLowerCase()}-${result.start}-${result.end}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Investigation({ result, onMethodology }) {
  const metric = metrics[result.metric]
  const direction = result.direction > 0 ? 'Increase' : result.direction < 0 ? 'Decrease' : 'Explore'
  const interval = result.interval.map(value => signed(value * 10)).join(' to ')
  return (
    <>
      <div className="investigation-header">
        <div>
          <h2 className="investigation-title">Trend analysis</h2>
          <p className="investigated-claim">“{result.claim}”</p>
        </div>
        <button className="download-btn" type="button" onClick={() => downloadCsv(result)}><Download size={16} aria-hidden="true" /> Download CSV</button>
      </div>
      <div className="claim-meta" aria-label="Parsed claim">
        <span><MapPin size={15} aria-hidden="true" /> {result.city.name}{result.city.country ? `, ${result.city.country}` : ''}</span>
        <span><CalendarDays size={15} aria-hidden="true" /> {result.start}–{result.end}</span>
        <span><Globe2 size={15} aria-hidden="true" /> {metric.label} / {direction}</span>
      </div>
      <div className="result-grid">
        <TrendChart key={result.url} result={result} />
        <div className="result-sidebar">
          <VerdictCard result={result} />
          <StatsPanel result={result} onMethodology={onMethodology} />
        </div>
      </div>
      <div className="result-source">
        <div><Database size={15} aria-hidden="true" />
          {result.snapshot
            ? <>Saved NASA POWER data <span>· Retrieved {result.snapshot.retrieved}</span></>
            : <>NASA POWER API <span>· Monthly point data</span></>}
        </div>
        <div className="source-link-group">
          <span>95% slope interval {interval} {metric.slopeUnit}/decade</span>
          <a href={result.snapshot?.url ?? result.url} target="_blank" rel="noreferrer">View source <ArrowUpRight size={14} /></a>
        </div>
      </div>
    </>
  )
}

export default function App() {
  const [claim, setClaim] = useState('')
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [globeSelection, setGlobeSelection] = useState(null)
  const [clickedPoint, setClickedPoint] = useState(null)
  const globeSection = useRef(null)
  const activeRequest = useRef(null)
  const methodDialog = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = controller
    const parsed = parseClaim(examples[0].claim)
    async function loadExample() {
      try {
        const preview = await readSnapshot(parsed, controller.signal) ?? await analyzeClaim(parsed, controller.signal)
        if (!controller.signal.aborted) setResult(preview)
      } catch {
        if (!controller.signal.aborted) setError({ message: 'The example could not load. Try submitting a claim.', input: false })
      }
    }
    loadExample()
    return () => {
      controller.abort()
      activeRequest.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!clickedPoint) return undefined
    const timeout = setTimeout(() => setClickedPoint(null), 2200)
    return () => clearTimeout(timeout)
  }, [clickedPoint])

  function updateClaim(value) {
    if (pending?.locatingPoint) {
      activeRequest.current?.abort()
      setPending(null)
    }
    setClaim(value)
    setError(null)
  }

  function selectGlobeCity(city, source) {
    setGlobeSelection(previous => ({ city, source, key: (previous?.key ?? 0) + 1 }))
  }

  function onGlobeClick({ lat, lng }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const query = `Temperature trend at coordinates ${lat.toFixed(6)}, ${lng.toFixed(6)}`
    void verify(query, { point: { lat, lng } })
  }

  async function verify(value, { prefill = false, point = null } = {}) {
    if (prefill) setClaim(value)
    let parsed
    try {
      parsed = parseClaim(value)
    } catch (issue) {
      setError({ message: issue.message, input: true })
      return
    }

    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setClickedPoint(null)
    setError(null)
    let locatingPoint = Boolean(point)
    setPending(point ? { locatingPoint } : { claim: parsed.claim, cityQuery: parsed.needsGeocode ? parsed.cityQuery : null })

    try {
      if (point) {
        const place = await reverseGeocode(parsed.city.lat, parsed.city.lon, controller.signal)
        if (controller.signal.aborted) return
        const claim = place ? `${place.name} temperature trend` : 'Temperature trend at this location'
        parsed = {
          ...parsed,
          claim,
          city: { ...parsed.city, ...place, id: `reverse-${parsed.city.id}`, name: place?.name ?? 'Unmapped location' },
        }
        locatingPoint = false
        setClaim(place ? claim : '')
        setClickedPoint(point)
        setPending({ claim })
      }
      if (parsed.needsGeocode) {
        const city = await geocodeCity(parsed.cityQuery, controller.signal)
        if (controller.signal.aborted) return
        parsed = { ...parsed, city: { ...city, geocoded: true }, needsGeocode: false }
        setPending({ claim: parsed.claim, cityQuery: null })
      }

      selectGlobeCity(parsed.city, point ? 'globe' : 'claim')
      if (!point && window.matchMedia('(max-width: 780px)').matches && !window.matchMedia(mobileGlobeQuery).matches) {
        requestAnimationFrame(() => {
          if (controller.signal.aborted) return
          globeSection.current?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            block: 'center',
          })
        })
      }

      const verified = await analyzeClaim(parsed, controller.signal)
      if (!controller.signal.aborted) setResult(verified)
    } catch (issue) {
      if (!controller.signal.aborted) {
        const message = locatingPoint ? 'Could not look up this location. Try clicking again.' : issue.message
        setError({ message, input: !parsed.city })
      }
    } finally {
      if (!controller.signal.aborted) setPending(null)
    }
  }

  const locatingStatus = pending?.locatingPoint ? 'Locating the clicked point' : pending?.cityQuery && `Locating ${pending.cityQuery}`
  const openMethodology = () => methodDialog.current.showModal()

  return (
    <>
      <a className="skip-link" href="#claim-input">Skip to claim input</a>
      <header className="site-header">
        <div className="site-header-inner page-shell">
          <Brand />
          <nav aria-label="Main navigation">
            <a className="nav-active" href="#explore">Explore</a>
            <button type="button" onClick={openMethodology}>Methodology</button>
          </nav>
          <a className="challenge-link" href={challenge} target="_blank" rel="noreferrer"><span className="challenge-dot" /> NASA Space Apps 2026 <ArrowUpRight size={14} aria-hidden="true" /></a>
        </div>
      </header>

      <main>
        <section id="explore" className="hero">
          <div className="art-stars" aria-hidden="true" />
          <div className="page-shell hero-inner">
            <div className="hero-content">
              <a href={POWER_DOCS} className="data-pill" target="_blank" rel="noreferrer"><Satellite size={14} aria-hidden="true" /> Powered by NASA POWER</a>
              <h1>Put climate claims<br className="hero-break" /> to the test.</h1>
              <p className="hero-copy">Enter a claim about a city anywhere in the world and see what NASA climate data says.</p>
              <SearchBar value={claim} onChange={updateClaim} onSubmit={verify} onExample={value => verify(value, { prefill: true })} busy={Boolean(pending)} invalid={error?.input} />
              {error && <div className="claim-error" id="claim-error" role="alert"><CircleAlert size={17} /> {error.message}</div>}
            </div>
            <HeroGlobe
              sectionRef={globeSection}
              selection={globeSelection}
              clickedPoint={clickedPoint}
              onLocationSelect={onGlobeClick}
              hasAnalysis={!pending && Boolean(result)}
            />
          </div>
        </section>

        <section id="analysis" className="page-shell investigation" aria-label="Investigation results" aria-busy={Boolean(pending)}>
          <span className="sr-only" role="status">{pending ? (locatingStatus || `Checking ${pending.claim}`) : result ? `Analysis ready. ${result.city.name}, ${result.start} to ${result.end}.` : ''}</span>
          {pending
            ? <div className="panel loading-panel"><LoaderCircle size={26} className="spin" /><h2>{locatingStatus || 'Checking the claim'}</h2>{pending.claim && <p>“{pending.claim}”</p>}</div>
            : result && <Investigation result={result} onMethodology={openMethodology} />}
        </section>
      </main>

      <footer className="page-shell site-footer">
        <span>TrendProof · NASA Space Apps Challenge 2026</span>
        <div><a href={imageCredit} target="_blank" rel="noreferrer">Earth image credit</a><a href={globeCredits} target="_blank" rel="noreferrer">Globe data credits</a><button type="button" onClick={openMethodology}>Methodology</button></div>
      </footer>
      <Methodology dialog={methodDialog} />
    </>
  )
}
