import { ArrowDownRight, ArrowUpRight, Check, CircleHelp, Minus, TriangleAlert, X } from 'lucide-react'
import { getVerdict } from '../analysis'
import { metrics } from '../claims'

const icons = { confirmed: Check, partial: TriangleAlert, unsupported: X, explore: CircleHelp }

export const formatPValue = p => p < 0.001 ? '<0.001' : p.toFixed(3)
export const signed = number => `${number >= 0 ? '+' : '−'}${Math.abs(number).toFixed(2)}`

export function slopeUnit(metric) {
  const unit = metrics[metric].slopeUnit
  return unit === 'pp' ? 'percentage points' : unit
}

export default function VerdictCard({ result }) {
  const verdict = getVerdict(result, result.direction)
  const Icon = icons[verdict.key]
  const metric = metrics[result.metric]
  const isSignificant = result.pValue < 0.05
  const units = slopeUnit(result.metric)
  const action = result.slope > 0 ? 'rose' : 'fell'
  const change = Math.abs(result.slope * 10).toFixed(2)
  const trendText = result.slope === 0
    ? `${metric.name} was flat in the fitted trend.`
    : `${metric.name} ${action} by an estimated ${change} ${units} per decade in ${result.city.name}.`
  const significanceText = isSignificant
    ? 'The trend meets the 5% significance threshold.'
    : 'The evidence falls short of the 5% significance threshold.'
  const directionText = result.direction && result.slope && Math.sign(result.slope) !== result.direction
    ? 'The fitted trend runs in the opposite direction to the claim. ' : ''
  const Direction = result.slope > 0 ? ArrowUpRight : result.slope < 0 ? ArrowDownRight : Minus

  return (
    <section className={`panel verdict-panel verdict-${verdict.key}`} aria-labelledby="verdict-title">
      <div className="verdict-top"><span className="verdict-icon"><Icon size={21} aria-hidden="true" /></span><span>Claim verdict</span></div>
      <h3 id="verdict-title">{verdict.label}</h3>
      <p>{directionText}{trendText} {significanceText}</p>
      <div className="verdict-rate"><Direction size={18} aria-hidden="true" /><strong>{signed(result.slope * 10)} {metric.slopeUnit}</strong><span>per decade</span></div>
    </section>
  )
}
