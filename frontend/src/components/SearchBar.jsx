import { ArrowRight, Droplets, LoaderCircle, Search, Thermometer, Waves } from 'lucide-react'
import { examples } from '../claims'

const icons = { T2M: Thermometer, PRECTOTCORR: Droplets, RH2M: Waves }

export default function SearchBar({ value, onChange, onSubmit, onExample, onReportCard, busy, invalid }) {
  return (
    <div className="claim-control">
      <form className="claim-form" onSubmit={event => {
        event.preventDefault()
        onSubmit(value)
      }}>
        <label className="sr-only" htmlFor="claim-input">Climate claim</label>
        <Search className="claim-search-icon" size={21} aria-hidden="true" />
        <input
          id="claim-input"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="e.g. Peshawar is getting hotter"
          type="search"
          maxLength={220}
          required
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'claim-error' : undefined}
        />
        <button className="primary-btn" type="submit" disabled={busy || !value.trim()}>
          {busy ? <><LoaderCircle className="spin" size={16} /> Checking</> : <>Verify claim <ArrowRight size={17} /></>}
        </button>
      </form>
      <div className="examples" aria-label="Example claims">
        <span className="examples-label">Try a claim</span>
        {examples.map(example => {
          const Icon = icons[example.metric]
          return (
            <button key={example.metric} className="example-btn" type="button" onClick={() => onExample(example.claim)}>
              <Icon size={14} aria-hidden="true" /> {example.label}
            </button>
          )
        })}
        <button className="rc-btn" type="button" disabled={busy || !value.trim()} onClick={() => onReportCard(value)}>
          📋 Full Report Card
        </button>
      </div>
    </div>
  )
}
