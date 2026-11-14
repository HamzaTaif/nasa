import { MapPin, CalendarDays, AlertTriangle } from 'lucide-react'
import { metricEmoji } from '../reportcard'
import { metrics } from '../claims'

function arrowColor(arrow) {
  if (arrow === '↑') return '#7ee8c7'
  if (arrow === '↓') return '#ff9ea1'
  return '#8e9bb5'
}

function sigBadge(significant, direction) {
  if (direction === 'stable') return { label: 'Stable', cls: 'rc-badge-stable' }
  if (significant) return { label: 'Significant', cls: 'rc-badge-sig' }
  return { label: 'Not significant', cls: 'rc-badge-ns' }
}

function formatSlope(row) {
  const meta = metrics[row.metricKey]
  const abs = Math.abs(row.slopePerDecade)
  const unit = meta?.slopeUnit ?? meta?.unit ?? ''
  if (row.direction === 'stable') return 'Stable'
  const sign = row.slopePerDecade > 0 ? '+' : '\u2212'
  return `${sign}${abs.toFixed(2)} ${unit}/decade`
}

export default function ReportCard({ data, progress }) {
  if (!data && progress) {
    return (
      <div className="rc-loading">
        <div className="rc-loading-bar">
          <div className="rc-loading-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
        <p>Analyzing metric {progress.done} of {progress.total}...</p>
      </div>
    )
  }
  if (!data) return null

  const { city, start, end, rows, summary } = data

  return (
    <div className="rc-container">
      <div className="rc-header">
        <div className="rc-header-top">
          <span className="rc-tag">📋 Climate Report Card</span>
        </div>
        <h2 className="rc-city">{city.name?.toUpperCase()} CLIMATE REPORT CARD</h2>
        <div className="rc-meta">
          <span><MapPin size={13} /> {city.name}, {city.country}</span>
          <span><CalendarDays size={13} /> {start}–{end}</span>
        </div>
      </div>

      <div className="rc-grid">
        <div className="rc-grid-head">
          <span>Metric</span>
          <span>Trend</span>
          <span>Rate</span>
          <span>Status</span>
        </div>
        {rows.map(row => {
          if (row.error) {
            return (
              <div key={row.metricKey} className="rc-row rc-row-error">
                <span className="rc-metric">
                  <span className="rc-emoji">{metricEmoji[row.metricKey]}</span>
                  {metrics[row.metricKey]?.name ?? row.metricKey}
                </span>
                <span className="rc-error-msg" style={{ gridColumn: 'span 3' }}>
                  <AlertTriangle size={13} /> {row.error}
                </span>
              </div>
            )
          }
          const badge = sigBadge(row.significant, row.direction)
          return (
            <div key={row.metricKey} className="rc-row">
              <span className="rc-metric">
                <span className="rc-emoji">{metricEmoji[row.metricKey]}</span>
                {row.meta?.name ?? row.metricKey}
              </span>
              <span className="rc-arrow" style={{ color: arrowColor(row.arrow) }}>
                {row.arrow}
                <span className="rc-dir">{row.direction === 'stable' ? 'Stable' : row.direction === 'increasing' ? 'Rising' : 'Falling'}</span>
              </span>
              <span className="rc-slope">{formatSlope(row)}</span>
              <span className={`rc-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          )
        })}
      </div>

      <div className="rc-summary">
        <strong>{summary.significant} of {summary.total}</strong> metrics show significant trends
        {summary.successful < summary.total && <span className="rc-summary-note"> · {summary.total - summary.successful} could not be analyzed</span>}
      </div>
    </div>
  )
}
