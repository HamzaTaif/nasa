import { useId, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ChartNoAxesCombined } from 'lucide-react'
import { metrics } from '../claims'

const number = (value, digits) => value.toLocaleString('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
})

function TrendTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null
  const observation = payload[0]?.payload
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {Number.isFinite(observation.value) && <span>Annual value <b>{number(observation.value, metric.digits)} {metric.unit}</b></span>}
      {payload.some(item => item.dataKey === 'trend') && <span>Linear fit <b>{number(observation.trend, metric.digits)} {metric.unit}</b></span>}
      {observation.anomaly && <small>Unusual year</small>}
    </div>
  )
}

function tickYears(first, last, count) {
  const step = Math.max(1, Math.ceil((last - first) / (count - 1)))
  const years = [first]
  for (let year = first + step; year < last - step / 2; year += step) years.push(year)
  if (last !== first) years.push(last)
  return years
}

export default function TrendChart({ result }) {
  const gradient = useId()
  const [width, setWidth] = useState(700)
  const [showTrend, setShowTrend] = useState(true)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const metric = metrics[result.metric]
  const anomalies = result.points.filter(point => point.anomaly)
  const min = Math.min(...result.points.flatMap(point => [point.value, point.trend].filter(Number.isFinite)))
  const max = Math.max(...result.points.flatMap(point => [point.value, point.trend].filter(Number.isFinite)))
  const padding = ((max - min) || Math.max(1, Math.abs(max) / 20)) * 0.15
  const yDomain = [min - padding, max + padding]

  const compact = width < 490

  function renderChart() {
    return (
      <ComposedChart data={result.points}
        margin={{ left: 0, right: compact ? 15 : 24, top: 12, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8b8aff" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#7771f2" stopOpacity={0.015} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#28324a" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="year" type="number" domain={[result.start, result.end]} ticks={tickYears(result.start, result.end, compact ? 5 : 8)}
          axisLine={{ stroke: '#263248' }} tickLine={false} tickMargin={11} tick={{ fill: '#8996af', fontSize: 11 }} />
        <YAxis domain={yDomain} tickCount={6} width={compact ? 44 : 48} axisLine={false} tickLine={false}
          tickMargin={8} tickFormatter={value => number(value, metric.digits)} tick={{ fill: '#8996af', fontSize: 11 }} />
        <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ stroke: '#707aa1', strokeDasharray: '3 4' }} isAnimationActive={false} />
        <Area type="linear" dataKey="value" baseValue={yDomain[0]} stroke="#a49bff" strokeWidth={2.35}
          fill={`url(#${gradient})`} isAnimationActive={false}
          dot={{ r: compact ? 2 : 2.7, fill: '#b3a9ff', stroke: '#131b2f', strokeWidth: 1 }}
          activeDot={{ r: 5, fill: '#ded9ff', stroke: '#8d7afc', strokeWidth: 2 }} />
        {showTrend && <Line type="linear" dataKey="trend" stroke="#70ddc8" strokeWidth={2}
          strokeDasharray="6 5" dot={false} activeDot={false} isAnimationActive={false} />}
        {showAnomalies && anomalies.map(point => <ReferenceDot key={point.year} x={point.year} y={point.value}
          r={5} fill="#111a2b" stroke="#f3b76c" strokeWidth={2} isFront />)}
      </ComposedChart>
    )
  }

  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="chart-header">
        <div className="chart-title-group">
          <span className="chart-icon"><ChartNoAxesCombined size={19} aria-hidden="true" /></span>
          <div><h3 id="chart-title">{metric.name} in {result.city.name}</h3><p>Annual values · {result.start} to {result.end}</p></div>
        </div>
        <span className="metric-tag">{result.metric}</span>
      </div>
      <div className="plot-unit">{metric.unit}</div>
      <div className="plot" aria-label={`${metric.name} in ${result.city.name} from ${result.start} to ${result.end}, in ${metric.unit}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={1} onResize={setWidth}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
      <div className="chart-legend" aria-label="Chart controls">
        <span><i className="legend-observed" /> Annual values</span>
        <button type="button" aria-pressed={showTrend} onClick={() => setShowTrend(!showTrend)}>
          <i className="legend-trend" /> Linear trend
        </button>
        <button type="button" aria-pressed={showAnomalies} onClick={() => setShowAnomalies(!showAnomalies)}>
          <i className="legend-anomaly" /> Unusual years ({anomalies.length})
        </button>
      </div>
    </section>
  )
}
