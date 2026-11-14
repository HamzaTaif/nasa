import jStat from 'jstat'

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function annualSeries(payload, { metric, start, end }) {
  const values = payload.properties?.parameter?.[metric]
  if (!values) throw new Error('NASA POWER returned no records for this metric.')
  const fill = payload.header?.fill_value ?? -999
  const points = []
  for (let year = start; year <= end; year += 1) {
    let total = 0
    let days = 0
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}${String(month).padStart(2, '0')}`
      const value = values[key]
      if (!Number.isFinite(value) || value === fill) break
      const monthDays = daysInMonth(year, month)
      total += value * monthDays
      days += monthDays
    }
    points.push({
      year,
      value: days === (daysInMonth(year, 2) === 29 ? 366 : 365)
        ? (metric === 'PRECTOTCORR' ? total : total / days)
        : null,
    })
  }
  return points
}

export function linearTrend(series) {
  const observations = series.filter(point => Number.isFinite(point.value))
  const count = observations.length
  if (count < 5) throw new Error(`NASA POWER supplied ${count} complete years for this range. Choose a wider range with at least five complete years.`)
  const xMean = observations.reduce((sum, point) => sum + point.year, 0) / count
  const yMean = observations.reduce((sum, point) => sum + point.value, 0) / count
  const sumXX = observations.reduce((sum, point) => sum + (point.year - xMean) ** 2, 0)
  const sumXY = observations.reduce((sum, point) => sum + (point.year - xMean) * (point.value - yMean), 0)
  const slope = sumXY / sumXX
  const fit = year => yMean + slope * (year - xMean)
  const sumSquaredError = observations.reduce((sum, point) => sum + (point.value - fit(point.year)) ** 2, 0)
  const sumSquaredTotal = observations.reduce((sum, point) => sum + (point.value - yMean) ** 2, 0)
  const degreesOfFreedom = count - 2
  const residualError = Math.sqrt(sumSquaredError / degreesOfFreedom)
  const standardError = residualError / Math.sqrt(sumXX)
  const pValue = standardError === 0
    ? (slope === 0 ? 1 : 0)
    : Math.min(1, Math.max(0, 2 * jStat.studentt.cdf(-Math.abs(slope / standardError), degreesOfFreedom)))
  const margin = jStat.studentt.inv(0.975, degreesOfFreedom) * standardError
  const firstYear = observations[0].year
  const lastYear = observations.at(-1).year
  const points = series.map(point => ({
    ...point,
    trend: point.year >= firstYear && point.year <= lastYear ? fit(point.year) : null,
    anomaly: point.value !== null && residualError > 0 && Math.abs(point.value - fit(point.year)) > 2 * residualError,
  }))

  return {
    points, count, firstYear, lastYear, slope, pValue,
    rSquared: sumSquaredTotal === 0 ? 0 : Math.max(0, 1 - sumSquaredError / sumSquaredTotal),
    interval: [slope - margin, slope + margin],
  }
}

export function getVerdict(analysis, direction) {
  const { slope, pValue } = analysis
  const significant = pValue < 0.05
  if (!direction) return { key: 'explore', label: significant ? 'Significant trend' : 'Inconclusive trend' }
  if (Math.sign(slope) !== direction) return { key: 'unsupported', label: 'Not supported by data' }
  return significant
    ? { key: 'confirmed', label: 'Confirmed' }
    : { key: 'partial', label: 'Partially true' }
}
