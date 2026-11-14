import { ArrowUpRight } from 'lucide-react'
import { metrics } from '../claims'
import { formatPValue, signed } from './VerdictCard'

export default function StatsPanel({ result, onMethodology }) {
  const metric = metrics[result.metric]
  return (
    <section className="panel stats-panel" aria-labelledby="stats-title">
      <div className="stats-header">
        <h3 id="stats-title">Key statistics</h3>
        <button type="button" className="quiet-icon" aria-label="How the statistics are calculated" onClick={onMethodology}><ArrowUpRight size={17} /></button>
      </div>
      <dl>
        <div><dt>Slope</dt><dd>{signed(result.slope * 10)} {metric.slopeUnit}/decade</dd></div>
        <div className="p-value-row">
          <dt>p-value</dt><dd>{formatPValue(result.pValue)}</dd>
          <p>{result.pValue < 0.05 ? 'Statistically significant at p < 0.05' : 'Insufficient evidence of a linear trend'}</p>
        </div>
        <div><dt>Complete years</dt><dd>{result.count} of {result.end - result.start + 1}</dd></div>
      </dl>
    </section>
  )
}
