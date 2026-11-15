import catalog from './catalog.json'

export const { cities, metrics } = catalog
export const examples = [
  { claim: 'Peshawar is getting hotter', label: 'Peshawar is getting hotter', metric: 'T2M' },
  { claim: 'Rainfall in Lahore is decreasing', label: 'Lahore rainfall is decreasing', metric: 'PRECTOTCORR' },
  { claim: 'Karachi is getting more humid', label: 'Karachi is getting more humid', metric: 'RH2M' },
  { claim: 'Tokyo is getting hotter', label: 'Tokyo is getting hotter', metric: 'T2M' },
  { claim: 'Riyadh temperature trend', label: 'Riyadh temperature trend', metric: 'T2M' },
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
const explore = /\b(?:trends?|show|plot|chart|history|historical|chang\w*|data)\b/i
const unsupported = /\b(?:heat\s?waves?|hot days|cold snaps?|flood\w*|drought\w*|every year|each year|record.breaking|record (?:high|low)|hottest|coldest|wettest|driest|monsoon|spring|summer|autumn|winter|(?:in|during) fall|january|february|march|april|may to|june|july|august|september|october|november|december|this year|last year|year.to.date|caused by|because|due to|worldwide|globally)\b/i
const nonHistorical = /\b(?:not|never|isn.t|aren.t|hasn.t|no longer|will|would|forecast|predict)\b/i
const timePhrase = /\b(?:(?:from|between)\s+)?\d{4}\s*(?:to|through|and|[-–—])\s*\d{4}\b|\b(?:since|after|from|starting(?: in)?|until|through|up to|in|during)\s+\d{4}\b|\b(?:(?:over|for|during|in)\s+)?(?:the\s+)?(?:last|past)\s+(?:\d{1,2}\s+years?|decade)\b/gi
const climateWords = new RegExp([
  ...rules.map(([, pattern]) => pattern.source), upward.source, downward.source,
  explore.source, stable.source, unsupported.source, nonHistorical.source,
].join('|'), 'gi')
const clauseWords = /\b(?:a|an|and|annual(?:ly)?|are|average|become|becoming|been|climate|days?|did|do|does|find|for|get(?:s|ting)?|got|has|have|how|in|is|it|levels?|long.term|measur\w*|mean|much|of|on|or|over|per|please|relative|see|sharply|significantly|steadily|the|this|time|to|was|were|what|whether|with|yearly)\b/gi
const introductoryWords = /^(?:(?:please\s+)?(?:show(?: me)?|plot|chart|verify|check)(?:\s+(?:me|whether|if|that))?|in|how (?:has|have|is)|what (?:is|was)|is|are|has|have|did|does|do)\s+/i
const coordinatePair = /\bcoordinates?\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?=\s|[.!?]?$)/i

function cleanPlace(value) {
  const name = value.trim()
    .replace(/^[\s,"“‘]+|[\s,?.!;:"”’]+$/gu, '')
  return name.length >= 2 && /\p{L}/u.test(name) && !isClimateClause(name) ? name : ''
}

function isClimateClause(value) {
  return !value.replace(climateWords, ' ').replace(clauseWords, ' ').replace(/[\s,.:?!’'"“”()\-]+/g, '')
}

function splitClimateSuffix(value) {
  for (const split of value.matchAll(/[\s,:]+(?=\S)/g)) {
    const climate = value.slice(split.index + split[0].length)
    if (!isClimateClause(climate)) continue
    const place = value.slice(0, split.index)
    const hasPossessive = !/^(?:is|are|was|were|has|have|did|does|got|get(?:s|ting)?)\b/i.test(climate)
      && !/^st\.?\s/i.test(place)
    const cityQuery = cleanPlace(hasPossessive ? place.replace(/[’']s$/i, '') : place)
    if (cityQuery) return { cityQuery, climate }
  }
  return null
}

function splitPlace(text) {
  // Keep the location as a contiguous phrase, including words inside its name.
  for (const match of [...text.matchAll(/\b(?:in|for|of|at|across)\s+/gi)].reverse()) {
    const prefix = text.slice(0, match.index)
    if (!prefix || !isClimateClause(prefix)) continue
    const rest = text.slice(match.index + match[0].length)
    const location = splitClimateSuffix(rest) ?? { cityQuery: cleanPlace(rest), climate: '' }
    if (location.cityQuery) return { cityQuery: location.cityQuery, climate: `${prefix} ${location.climate}` }
  }

  const introduction = text.match(introductoryWords)?.[0] ?? ''
  const location = splitClimateSuffix(text.slice(introduction.length))
  if (location) return { cityQuery: location.cityQuery, climate: `${introduction} ${location.climate}` }

  // Accept compact searches with the metric first, e.g. "temperature trend Moscow".
  for (const split of [...text.matchAll(/\s+(?=\S)/g)].reverse()) {
    const climate = text.slice(0, split.index)
    if (!isClimateClause(climate)) continue
    const cityQuery = cleanPlace(text.slice(split.index + split[0].length))
    if (cityQuery) return { cityQuery, climate }
  }
  return null
}

function extractCity(input) {
  const text = input.replace(timePhrase, ' ').replace(/\s+/g, ' ').trim()
  return splitPlace(text)
}

function matchCatalogCity(query) {
  const normalized = query.replace(/[,()]/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase()
  return cities.find(city => [city.name, ...(city.aliases ?? [])].some(name => {
    const alias = name.toLowerCase()
    return normalized === alias || normalized === `${alias} ${city.country.toLowerCase()}`
  }))
}

function coordinateLocation(match) {
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Enter a latitude from −90 to 90 and a longitude from −180 to 180.')
  }
  const name = `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? 'W' : 'E'}`
  return { id: `point-${lat}-${lon}`, name, lat, lon, geocoded: true }
}

export function parseClaim(claim, latestYear = new Date().getUTCFullYear() - 1) {
  const input = claim.normalize('NFC').trim().replace(/\s+/g, ' ')
  const coordinates = input.match(coordinatePair)
  const point = coordinates ? coordinateLocation(coordinates) : null
  const trendText = point ? input.replace(coordinatePair, '') : input
  const location = point ? { cityQuery: point.name, climate: trendText } : extractCity(input)
  const bareCity = !location && /^[\p{L}][\p{L}\p{M}\p{N} ,.'’()&-]{1,149}$/u.test(input) ? cleanPlace(input) : ''
  const climate = location?.climate ?? (bareCity ? '' : input)
  if (unsupported.test(climate) || /\b(?:caused by|because|due to)\b/i.test(input) || /\b(?:by|than|above|below|over|under)\s*[+-]?\d+(?:\.\d+)?\s*(?:°|%|mm\b|degrees?\b)/i.test(input)) {
    throw new Error('Try a long-term annual trend. This analysis supports temperature, rainfall, humidity, sunlight, and wind speed across complete years.')
  }

  let matchingMetrics = rules.filter(([, pattern]) => pattern.test(climate)).map(([key]) => key)
  if (bareCity) matchingMetrics = ['T2M']
  if (matchingMetrics.includes('T2M_MAX_AVG') || matchingMetrics.includes('T2M_MIN_AVG')) {
    matchingMetrics = matchingMetrics.filter(key => key !== 'T2M')
  }
  if (matchingMetrics.length !== 1) throw new Error('Specify one climate metric, such as temperature, rainfall, or relative humidity.')

  if (nonHistorical.test(climate) || stable.test(climate)) {
    throw new Error('Use a historical claim with a clear direction, such as “Lahore rainfall is decreasing”, or ask to see the trend.')
  }
  // Daily high and low are metric names. They carry no direction by themselves.
  const directionText = climate.replace(/\b(?:daily (?:highs?|lows?)|high temperatures?|low temperatures?)\b/gi, '')
  const goesUp = upward.test(directionText)
  const goesDown = downward.test(directionText)
  if (goesUp && goesDown) throw new Error('Enter a single trend direction.')

  const metric = matchingMetrics[0]
  const years = [...trendText.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(match => Number(match[1]))
  const pastYears = trendText.match(/\b(?:last|past)\s+(\d{1,2})\s+years?\b/i)
  let start = 2001
  let end = latestYear
  if (years.length === 2 && /\d{4}\s*(?:to|through|and|[-–—])\s*\d{4}/i.test(trendText)) {
    start = years[0]
    end = years[1]
  } else if (years.length === 1 && /\b(?:since|after|from|starting(?: in)?)\s+\d{4}\b/i.test(trendText)) {
    start = years[0] + (/\bafter\s+\d{4}\b/i.test(trendText) ? 1 : 0)
  } else if (years.length === 1 && /\b(?:until|through|up to)\s+\d{4}\b/i.test(trendText)) {
    end = years[0]
  } else if (pastYears && !years.length) {
    start = latestYear - Number(pastYears[1]) + 1
  } else if (/\b(?:last|past) decade\b/i.test(trendText) && !years.length) {
    start = latestYear - 9
  } else if (years.length || /\b(?:decades|years|centur(?:y|ies)|\d{2}s)\b/i.test(trendText)) {
    throw new Error('Enter a clear range, such as “2001 to 2025” or “since 2010”.')
  }
  if (start < metrics[metric].firstYear) {
    throw new Error(`NASA POWER monthly data for this metric starts in ${metrics[metric].firstYear}.`)
  }
  if (end > latestYear) throw new Error(`Use complete calendar years through ${latestYear}.`)
  if (end - start + 1 < 5) throw new Error('Choose at least five years for the trend test.')

  const cityQuery = location?.cityQuery || bareCity
  if (!cityQuery) throw new Error('Please include a city name, such as “Riyadh is getting hotter”.')
  const city = point ?? matchCatalogCity(cityQuery) ?? null
  if (!city && /\b(?:vs\.?|versus|compared to)\s|\s\/\s/i.test(cityQuery)) throw new Error('Enter one city per claim.')
  if (!city && cityQuery.split(/\s+(?:and|or)\s+/i).filter(part => matchCatalogCity(part)).length > 1) {
    throw new Error('Enter one city per claim.')
  }
  return { claim: input, city, cityQuery, needsGeocode: !city, metric, start, end, direction: goesUp ? 1 : goesDown ? -1 : 0 }
}
