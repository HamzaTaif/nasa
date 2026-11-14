"""
TrendProof — Natural Language Claim Parser
Extracts city, climate variable, time period, and claim direction from text.
No external LLM required — uses pattern matching and keyword extraction.
"""

import re
from typing import Optional, List, Tuple
from dataclasses import dataclass
from cities import find_city, CITIES, ALIASES
from nasa_power import VARIABLE_MAPPING, SEASON_MONTHS


@dataclass
class ParsedClaim:
    """Structured representation of a parsed climate claim."""
    original_text: str
    city: Optional[str] = None  # City key in CITIES dict
    city_info: Optional[dict] = None  # Full city info dict
    variable: str = "T2M"  # NASA POWER parameter code
    variable_keyword: Optional[str] = None  # What user said (e.g., "hotter")
    direction: Optional[str] = None  # "increasing", "decreasing", or None
    season: Optional[str] = None  # "summer", "winter", etc.
    year: Optional[int] = None  # Specific year mentioned
    compare_year: Optional[int] = None  # "hotter than 2020"
    start_year: int = 2001  # Analysis start
    end_year: int = 2025  # Analysis end
    compare_city: Optional[str] = None  # For comparison claims
    compare_city_info: Optional[dict] = None
    confidence: float = 0.0  # How confident we are in the parse
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []

    @property
    def is_valid(self) -> bool:
        return self.city_info is not None and len(self.errors) == 0


# Direction keywords
INCREASING_KEYWORDS = [
    "hotter", "warmer", "increasing", "rising", "higher", "more",
    "growing", "getting hotter", "getting warmer", "gone up", "went up",
    "increased", "risen", "hottest", "warmest", "wetter", "humid",
    "windier", "sunnier", "rainier",
    # Urdu
    "zyada", "barh", "ziada",
    "bohat garmi", "garmi barh", "garam",
]

DECREASING_KEYWORDS = [
    "colder", "cooler", "decreasing", "falling", "lower", "less",
    "dropping", "getting colder", "getting cooler", "gone down", "went down",
    "decreased", "fallen", "coldest", "coolest", "drier", "dryer",
    # Urdu
    "kam", "ghat",
    "sardi barh", "thanda",
]

# Season keywords
SEASON_KEYWORDS = {
    "summer": ["summer", "garmi", "garmion", "june", "july", "august", "jun-aug"],
    "winter": ["winter", "sardi", "sardion", "december", "january", "february", "dec-feb"],
    "spring": ["spring", "march", "april", "may", "mar-may", "bahar"],
    "autumn": ["autumn", "fall", "september", "october", "november", "sep-nov", "khizan"],
    "monsoon": ["monsoon", "barsat", "barsaat", "july", "august", "september"],
}

# Year patterns
YEAR_PATTERN = re.compile(r'\b(19\d{2}|20[0-2]\d)\b')
THIS_YEAR_KEYWORDS = ["this year", "is saal", "is sal", "2025", "2026"]
LAST_YEAR_KEYWORDS = ["last year", "pichle saal", "pichle sal", "2024"]


def _extract_cities(text: str) -> Tuple[Optional[dict], Optional[dict]]:
    """
    Extract one or two city names from text.
    Returns (primary_city, compare_city) or (primary_city, None).
    """
    text_lower = text.lower()
    found_cities = []

    # Check all known city names and aliases (longest first to avoid partial matches)
    all_names = sorted(
        list(CITIES.keys()) + list(ALIASES.keys()),
        key=len, reverse=True
    )

    for name in all_names:
        # Use word boundary matching
        pattern = r'\b' + re.escape(name) + r'\b'
        if re.search(pattern, text_lower):
            city_info = find_city(name)
            if city_info and city_info not in found_cities:
                found_cities.append(city_info)
                if len(found_cities) >= 2:
                    break

    primary = found_cities[0] if len(found_cities) >= 1 else None
    compare = found_cities[1] if len(found_cities) >= 2 else None

    return primary, compare


def _extract_variable(text: str) -> Tuple[str, Optional[str]]:
    """
    Extract climate variable from text.
    Returns (parameter_code, keyword_found).
    """
    text_lower = text.lower()

    # Check variable keywords (longest first)
    sorted_keywords = sorted(VARIABLE_MAPPING.keys(), key=len, reverse=True)
    for keyword in sorted_keywords:
        if keyword in text_lower:
            return VARIABLE_MAPPING[keyword], keyword

    # Default: if claim mentions hot/cold → temperature, rain → precipitation
    return "T2M", None


def _extract_direction(text: str) -> Optional[str]:
    """Determine if the claim is about increase or decrease."""
    text_lower = text.lower()

    for kw in INCREASING_KEYWORDS:
        if kw in text_lower:
            return "increasing"

    for kw in DECREASING_KEYWORDS:
        if kw in text_lower:
            return "decreasing"

    return None


def _extract_season(text: str) -> Optional[str]:
    """Extract season mention from text."""
    text_lower = text.lower()

    for season, keywords in SEASON_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return season

    return None


def _extract_years(text: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Extract specific years mentioned.
    Returns (primary_year, compare_year).
    """
    text_lower = text.lower()

    # Check "this year" / "last year"
    primary_year = None
    for kw in THIS_YEAR_KEYWORDS:
        if kw in text_lower:
            primary_year = 2025  # Most recent full data year

    if primary_year is None:
        for kw in LAST_YEAR_KEYWORDS:
            if kw in text_lower:
                primary_year = 2024

    # Find explicit years
    years = [int(y) for y in YEAR_PATTERN.findall(text) if 1981 <= int(y) <= 2026]
    years = sorted(set(years))

    if len(years) >= 2:
        return years[-1], years[0]  # Most recent first, older as compare
    elif len(years) == 1:
        if primary_year and years[0] != primary_year:
            return primary_year, years[0]
        return years[0], None
    elif primary_year:
        return primary_year, None

    return None, None


def parse_claim(text: str) -> ParsedClaim:
    """
    Parse a natural language climate claim into structured components.

    Examples:
        "Peshawar is getting hotter" → city=peshawar, variable=T2M_MAX, direction=increasing
        "Rainfall in Lahore has decreased" → city=lahore, variable=PRECTOTCORR, direction=decreasing
        "Is Karachi hotter than Peshawar?" → city=karachi, compare=peshawar, variable=T2M_MAX
        "Summer 2025 was very hot in Multan" → city=multan, variable=T2M_MAX, season=summer, year=2025
    """
    claim = ParsedClaim(original_text=text)

    # 1. Extract cities
    primary_city, compare_city = _extract_cities(text)
    if primary_city:
        claim.city = primary_city["name"].lower()
        claim.city_info = primary_city
        claim.confidence += 0.3
    else:
        claim.errors.append("Could not identify a city in the claim.")

    if compare_city:
        claim.compare_city = compare_city["name"].lower()
        claim.compare_city_info = compare_city

    # 2. Extract climate variable
    variable, keyword = _extract_variable(text)
    claim.variable = variable
    claim.variable_keyword = keyword
    if keyword:
        claim.confidence += 0.3

    # 3. Extract direction
    claim.direction = _extract_direction(text)
    if claim.direction:
        claim.confidence += 0.2

    # 4. Extract season
    claim.season = _extract_season(text)
    if claim.season:
        claim.confidence += 0.1

    # 5. Extract years
    claim.year, claim.compare_year = _extract_years(text)
    if claim.year:
        claim.confidence += 0.1

    # Cap confidence
    claim.confidence = min(claim.confidence, 1.0)

    return claim


# Quick test
if __name__ == "__main__":
    test_claims = [
        "Peshawar is getting hotter every year",
        "Rainfall in Lahore has decreased over the last decade",
        "Is Karachi hotter than Islamabad?",
        "Summer 2025 was extremely hot in Multan",
        "Peshawar mein bohat garmi hai is saal",
        "Quetta is getting colder in winter",
        "Compare temperature of Lahore and Karachi",
        "Has humidity increased in Faisalabad?",
    ]

    for text in test_claims:
        result = parse_claim(text)
        print(f"\nClaim: {text}")
        print(f"  City: {result.city_info['name'] if result.city_info else 'UNKNOWN'}")
        print(f"  Variable: {result.variable} ({result.variable_keyword})")
        print(f"  Direction: {result.direction}")
        print(f"  Season: {result.season}")
        print(f"  Year: {result.year}, Compare: {result.compare_year}")
        if result.compare_city_info:
            print(f"  Compare City: {result.compare_city_info['name']}")
        print(f"  Confidence: {result.confidence:.0%}")
        print(f"  Valid: {result.is_valid}")
