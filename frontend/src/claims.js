import catalog from './catalog.json'

export const { cities, metrics } = catalog
export const examples = [
  { claim: 'Peshawar is getting hotter', label: 'Peshawar is getting hotter', metric: 'T2M' },
  { claim: 'Rainfall in Lahore is decreasing', label: 'Lahore rainfall is decreasing', metric: 'PRECTOTCORR' },
  { claim: 'Karachi is getting more humid', label: 'Karachi is getting more humid', metric: 'RH2M' },
]

const rules = [
  ['T2M_MAX_AVG', /\b(?:daily highs?|high temperatures?|maximum temperatures?|daytime temperatures?)\b/i],
  ['T2M_MIN_AVG', /\b(?:daily lows?|low temperatures?|minimum temperatures?|nighttime temperatures?)\b/i],
  ['T2M', /\b(?:temperatures?|warming|warmer|hotter|cooling|cooler|colder|heating up)\b/i],
  ['PRECTOTCORR', /\b(?:rainfall|raining|rain|precipitation|wetter|drier)\b/i],
  ['RH2M', /\b(?:humid(?:ity)?|muggy|moisture in the air)\b/i],
  ['ALLSKY_SFC_SW_DWN', /\b(?:solar (?:irradiance|radiation)|sunlight)\b/i],
  ['WS2M', /\b(?:wind speed|winds?|windier)\b/i],
]

const upward = /\b(?:increas\w*|ris\w*|rose|higher|hotter|warmer|warming|more|wetter|windier|grew|grow\w*|upward|went up|go(?:ne|ing)? up|heating up|intensif\w*)\b/i
const downward = /\b(?:decreas\w*|declin\w*|fall\w*|fell|dropp?\w*|lower|cooler|cooling|colder|less|drier|downward|went down|go(?:ne|ing)? down|weaken\w*)\b/i
const stable = /\b(?:unchanged|stable|flat|stayed (?:the same|steady)|no (?:change|trend)|steady)\b/i
const explore = /\b(?:trend|show|plot|chart|history|historical|chang\w*|data)\b/i
const unsupported = /\b(?:heat\s?waves?|hot days|cold snaps?|flood\w*|drought\w*|every year|each year|record.breaking|record (?:high|low)|hottest|coldest|wettest|driest|monsoon|spring|summer|autumn|winter|(?:in|during) fall|january|february|march|april|may to|june|july|august|september|october|november|december|this year|last year|year.to.date|caused by|because|due to|worldwide|globally)\b/i

export function parseClaim(claim, latestYear = new Date().getUTCFullYear() - 1) {
  const input = claim.trim().replace(/\s+/g, ' ')
  if (unsupported.test(input) || /\b(?:by|than|above|below|over|under)\s*[+-]?\d+(?:\.\d+)?\s*(?:°|%|mm\b|degrees?\b)/i.test(input)) {
    throw new Error('Try a long-term annual trend. This analysis supports temperature, rainfall, humidity, sunlight, and wind speed across complete years.')
  }

  const matchedCities = cities.filter(city => [city.name, ...(city.aliases ?? [])].some(name => {
    return new RegExp(`(?:^|[^a-z])${name}(?:[^a-z]|$)`, 'i').test(input)
  }))
  if (matchedCities.length > 1) throw new Error('Enter one city per claim.')
  if (!matchedCities.length) throw new Error('Name a supported city, such as Peshawar, Lahore, Karachi, or Islamabad. The full list is in Methodology.')
  if (/\b(?:hyderabad\s*,?\s+india|indian hyderabad)\b/i.test(input)) {
    throw new Error('The city catalog currently includes Hyderabad, Pakistan. Choose a listed city for this analysis.')
  }

  let matchingMetrics = rules.filter(([, pattern]) => pattern.test(input)).map(([key]) => key)
  if (matchingMetrics.includes('T2M_MAX_AVG') || matchingMetrics.includes('T2M_MIN_AVG')) {
    matchingMetrics = matchingMetrics.filter(key => key !== 'T2M')
  }
  if (matchingMetrics.length !== 1) throw new Error('Specify one climate metric, such as temperature, rainfall, or relative humidity.')

  if (/\b(?:not|never|isn.t|aren.t|hasn.t|no longer|will|forecast|predict)\b/i.test(input) || stable.test(input)) {
    throw new Error('Use a historical claim with a clear direction, such as “Lahore rainfall is decreasing”, or ask to see the trend.')
  }
  // Daily high and low are metric names. They carry no direction by themselves.
  const directionText = input.replace(/\b(?:daily (?:highs?|lows?)|high temperatures?|low temperatures?)\b/gi, '')
  const goesUp = upward.test(directionText)
  const goesDown = downward.test(directionText)
  if (goesUp && goesDown) throw new Error('Enter a single trend direction.')
  if (!goesUp && !goesDown && !explore.test(input)) {
    throw new Error('Say whether the metric is increasing or decreasing, or ask to see its trend.')
  }

  const metric = matchingMetrics[0]
  const years = [...input.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(match => Number(match[1]))
  const pastYears = input.match(/\b(?:last|past)\s+(\d{1,2})\s+years?\b/i)
  let start = 2001
  let end = latestYear
  if (years.length === 2 && /\d{4}\s*(?:to|through|and|[-–—])\s*\d{4}/i.test(input)) {
    start = years[0]
    end = years[1]
  } else if (years.length === 1 && /\b(?:since|after|from|starting(?: in)?)\s+\d{4}\b/i.test(input)) {
    start = years[0] + (/\bafter\s+\d{4}\b/i.test(input) ? 1 : 0)
  } else if (years.length === 1 && /\b(?:until|through|up to)\s+\d{4}\b/i.test(input)) {
    end = years[0]
  } else if (pastYears && !years.length) {
    start = latestYear - Number(pastYears[1]) + 1
  } else if (/\b(?:last|past) decade\b/i.test(input) && !years.length) {
    start = latestYear - 9
  } else if (years.length || /\b(?:decades|years|centur(?:y|ies)|\d{2}s)\b/i.test(input)) {
    throw new Error('Enter a clear range, such as “2001 to 2025” or “since 2010”.')
  }
  if (start < metrics[metric].firstYear) {
    throw new Error(`NASA POWER monthly data for this metric starts in ${metrics[metric].firstYear}.`)
  }
  if (end > latestYear) throw new Error(`Use complete calendar years through ${latestYear}.`)
  if (end - start + 1 < 5) throw new Error('Choose at least five years for the trend test.')

  return { claim: input, city: matchedCities[0], metric, start, end, direction: goesUp ? 1 : goesDown ? -1 : 0 }
}
