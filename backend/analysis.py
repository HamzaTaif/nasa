"""
TrendProof — Statistical Analysis Engine
Determines if climate trends are statistically significant.
Uses linear regression, anomaly detection, and plain-English verdicts.
"""

import math
from calendar import monthrange
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

try:
    from scipy.stats import linregress, t
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


@dataclass
class TrendResult:
    """Result of statistical trend analysis."""
    # Regression
    slope: float = 0.0  # Change per year
    intercept: float = 0.0
    r_squared: float = 0.0  # How well the line fits (0-1)
    p_value: float = 1.0  # Statistical significance

    # Trend summary
    trend_direction: str = "stable"  # "increasing", "decreasing", "stable"
    is_significant: bool = False  # p < 0.05
    total_change: float = 0.0  # Total change over the period
    percent_change: float = 0.0  # Percentage change

    # Anomalies
    anomaly_years: List[dict] = field(default_factory=list)  # Years that are outliers

    # Latest vs historical
    latest_value: Optional[float] = None
    latest_year: Optional[int] = None
    historical_mean: float = 0.0
    historical_std: float = 0.0
    latest_deviation: float = 0.0  # How many std devs from mean
    latest_is_extreme: bool = False  # > 2 std devs

    # Comparison
    year_comparison: Optional[dict] = None  # If comparing specific years

    # Verdict
    verdict: str = "unknown"  # "confirmed", "partially_true", "not_supported"
    verdict_emoji: str = "❓"
    verdict_explanation: str = ""
    confidence_level: str = ""  # "high", "moderate", "low"

    # Data used
    years: List[int] = field(default_factory=list)
    values: List[float] = field(default_factory=list)
    unit: str = ""


def _linear_regression(x: List[float], y: List[float]) -> Tuple[float, float, float, float]:
    """
    Simple linear regression without numpy/scipy.
    Returns: (slope, intercept, r_squared, p_value_approx)
    """
    n = len(x)
    if n < 3:
        return 0.0, 0.0, 0.0, 1.0

    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_x2 = sum(xi ** 2 for xi in x)
    sum_y2 = sum(yi ** 2 for yi in y)

    denom = n * sum_x2 - sum_x ** 2
    if denom == 0:
        return 0.0, 0.0, 0.0, 1.0

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R-squared
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    mean_y = sum_y / n
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)

    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Approximate p-value using t-distribution
    if ss_res <= 0 or n <= 2:
        p_value = 0.001 if abs(r_squared) > 0.9 else 1.0
    else:
        se_slope = math.sqrt(ss_res / (n - 2)) / math.sqrt(sum((xi - sum_x / n) ** 2 for xi in x))
        if se_slope > 0:
            t_stat = abs(slope / se_slope)
            # Approximate p-value from t-statistic (two-tailed)
            # Using approximation: p ≈ 2 * e^(-0.717*t - 0.416*t^2) for df > 5
            df = n - 2
            if df > 0:
                # Better approximation using regularized incomplete beta function
                # Simplified: use t-to-p approximation
                p_value = _t_to_p_approx(t_stat, df)
            else:
                p_value = 1.0
        else:
            p_value = 1.0

    return slope, intercept, max(0, min(1, r_squared)), max(0, min(1, p_value))


def _t_to_p_approx(t: float, df: int) -> float:
    """Approximate two-tailed p-value from t-statistic and degrees of freedom."""
    if df <= 0:
        return 1.0
    if t <= 0:
        return 1.0

    # Use normal approximation for large df
    if df > 30:
        # Standard normal approximation
        z = t
        p = 2.0 * (1.0 - _normal_cdf(z))
        return max(0.0001, min(1.0, p))

    # For smaller df, use a rough approximation
    # Based on the relationship between t and p for various df
    x = df / (df + t * t)
    # Regularized incomplete beta function approximation
    if t > 6:
        return 0.0001

    # Simple lookup-style approximation
    critical_values = {
        0.1: {5: 2.015, 10: 1.812, 15: 1.753, 20: 1.725, 25: 1.708},
        0.05: {5: 2.571, 10: 2.228, 15: 2.131, 20: 2.086, 25: 2.060},
        0.01: {5: 4.032, 10: 3.169, 15: 2.947, 20: 2.845, 25: 2.787},
        0.001: {5: 6.869, 10: 4.587, 15: 4.073, 20: 3.850, 25: 3.725},
    }

    # Find closest df
    closest_df = min(critical_values[0.05].keys(), key=lambda d: abs(d - df))

    for p_val in [0.001, 0.01, 0.05, 0.1]:
        if t >= critical_values[p_val].get(closest_df, 999):
            return p_val

    return 0.5  # Not significant


def _normal_cdf(x: float) -> float:
    """Approximate standard normal CDF."""
    # Abramowitz and Stegun approximation
    if x < -8:
        return 0.0
    if x > 8:
        return 1.0
    b0 = 0.2316419
    b1 = 0.319381530
    b2 = -0.356563782
    b3 = 1.781477937
    b4 = -1.821255978
    b5 = 1.330274429
    t = 1.0 / (1.0 + b0 * abs(x))
    pdf = math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)
    cdf = 1.0 - pdf * (b1 * t + b2 * t**2 + b3 * t**3 + b4 * t**4 + b5 * t**5)
    return cdf if x >= 0 else 1.0 - cdf


def _detect_anomalies(years: List[int], values: List[float], threshold: float = 2.0) -> List[dict]:
    """Detect years that are statistical outliers (> threshold std devs from mean)."""
    if len(values) < 5:
        return []

    mean = sum(values) / len(values)
    std = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))

    if std == 0:
        return []

    anomalies = []
    for year, value in zip(years, values):
        z_score = (value - mean) / std
        if abs(z_score) > threshold:
            anomalies.append({
                "year": year,
                "value": round(value, 2),
                "z_score": round(z_score, 2),
                "type": "high" if z_score > 0 else "low",
                "deviation": f"{abs(z_score):.1f}σ {'above' if z_score > 0 else 'below'} average",
            })

    return sorted(anomalies, key=lambda a: abs(a["z_score"]), reverse=True)


def analyze_trend(
    data: Dict[int, float],
    unit: str = "°C",
    claimed_direction: Optional[str] = None,
    specific_year: Optional[int] = None,
    compare_year: Optional[int] = None,
    parameter_name: str = "Temperature",
) -> TrendResult:
    """
    Analyze a time series for trends and significance.

    Args:
        data: {year: value} dictionary
        unit: Unit of measurement
        claimed_direction: "increasing" or "decreasing" — what the user claims
        specific_year: A year to highlight
        compare_year: A year to compare against
        parameter_name: Human-readable parameter name
    """
    result = TrendResult(unit=unit)

    if len(data) < 3:
        result.verdict = "insufficient_data"
        result.verdict_emoji = "⚠️"
        result.verdict_explanation = "Not enough data points to determine a trend (need at least 3 years)."
        return result

    # Sort by year
    sorted_years = sorted(data.keys())
    years = [int(y) for y in sorted_years]
    values = [float(data[y]) for y in sorted_years]

    result.years = years
    result.values = values

    # Linear regression
    x = [float(y) for y in years]
    slope, intercept, r_squared, p_value = _linear_regression(x, values)

    result.slope = round(slope, 4)
    result.intercept = round(intercept, 2)
    result.r_squared = round(r_squared, 4)
    result.p_value = round(p_value, 4)
    result.is_significant = p_value < 0.05

    # Total change
    result.total_change = round(slope * (years[-1] - years[0]), 2)
    first_val = values[0] if values[0] != 0 else 0.001
    result.percent_change = round((result.total_change / abs(first_val)) * 100, 1)

    # Determine trend direction
    if result.is_significant:
        result.trend_direction = "increasing" if slope > 0 else "decreasing"
    else:
        result.trend_direction = "stable"

    # Historical stats
    result.historical_mean = round(sum(values) / len(values), 2)
    result.historical_std = round(
        math.sqrt(sum((v - result.historical_mean) ** 2 for v in values) / len(values)), 2
    )

    # Latest value analysis
    result.latest_year = years[-1]
    result.latest_value = values[-1]
    if result.historical_std > 0:
        result.latest_deviation = round(
            (result.latest_value - result.historical_mean) / result.historical_std, 2
        )
    result.latest_is_extreme = abs(result.latest_deviation) > 2.0

    # Anomaly detection
    result.anomaly_years = _detect_anomalies(years, values)

    # Year comparison
    if specific_year and compare_year:
        if specific_year in data and compare_year in data:
            diff = data[specific_year] - data[compare_year]
            result.year_comparison = {
                "year1": specific_year,
                "value1": round(data[specific_year], 2),
                "year2": compare_year,
                "value2": round(data[compare_year], 2),
                "difference": round(diff, 2),
                "direction": "higher" if diff > 0 else "lower",
            }

    # Generate verdict
    result = _generate_verdict(result, claimed_direction, parameter_name, unit)

    return result


def _generate_verdict(
    result: TrendResult,
    claimed_direction: Optional[str],
    parameter_name: str,
    unit: str,
) -> TrendResult:
    """Generate a human-readable verdict about the claim."""

    city_trend = result.trend_direction
    slope_per_decade = result.slope * 10

    if claimed_direction is None:
        # No specific claim — just report the trend
        if result.is_significant:
            result.verdict = "trend_found"
            result.verdict_emoji = "📊"
            result.verdict_explanation = (
                f"{parameter_name} shows a statistically significant "
                f"{'upward' if city_trend == 'increasing' else 'downward'} trend "
                f"of {abs(slope_per_decade):.2f}{unit} per decade "
                f"(p={result.p_value:.3f}, R²={result.r_squared:.2f})."
            )
            result.confidence_level = "high" if result.p_value < 0.01 else "moderate"
        else:
            result.verdict = "no_significant_trend"
            result.verdict_emoji = "➖"
            result.verdict_explanation = (
                f"No statistically significant trend in {parameter_name} "
                f"(p={result.p_value:.2f}). Natural variability dominates."
            )
            result.confidence_level = "high"
        return result

    # Check if claim matches the data
    claim_matches = (
        (claimed_direction == "increasing" and city_trend == "increasing") or
        (claimed_direction == "decreasing" and city_trend == "decreasing")
    )

    if claim_matches and result.is_significant:
        # CONFIRMED
        result.verdict = "confirmed"
        result.verdict_emoji = "✅"
        result.confidence_level = "high" if result.p_value < 0.01 else "moderate"
        result.verdict_explanation = (
            f"Confirmed. {parameter_name} has been {city_trend} at a rate of "
            f"{abs(slope_per_decade):.2f}{unit} per decade. "
            f"This trend is statistically significant (p={result.p_value:.3f}). "
            f"Total change: {'+' if result.total_change > 0 else ''}{result.total_change:.2f}{unit} "
            f"from {result.years[0]} to {result.years[-1]}."
        )

    elif claimed_direction and city_trend == "stable":
        # NOT SUPPORTED — no significant trend
        result.verdict = "not_supported"
        result.verdict_emoji = "❌"
        result.confidence_level = "moderate"
        result.verdict_explanation = (
            f"Not supported by data. While {parameter_name} shows a slight "
            f"{'upward' if result.slope > 0 else 'downward'} tendency "
            f"({'+' if result.slope > 0 else ''}{slope_per_decade:.2f}{unit}/decade), "
            f"this trend is NOT statistically significant (p={result.p_value:.2f}). "
            f"The variation is within normal range."
        )

    elif claimed_direction and not claim_matches and result.is_significant:
        # OPPOSITE of what's claimed
        result.verdict = "contradicted"
        result.verdict_emoji = "🔄"
        result.confidence_level = "high"
        opposite = "increasing" if claimed_direction == "decreasing" else "decreasing"
        result.verdict_explanation = (
            f"The data shows the opposite! {parameter_name} is actually {opposite} "
            f"at {abs(slope_per_decade):.2f}{unit} per decade (p={result.p_value:.3f}). "
            f"Total change: {'+' if result.total_change > 0 else ''}{result.total_change:.2f}{unit} "
            f"from {result.years[0]} to {result.years[-1]}."
        )

    else:
        # PARTIALLY TRUE — there's a direction but not significant
        result.verdict = "partially_true"
        result.verdict_emoji = "⚠️"
        result.confidence_level = "low"
        result.verdict_explanation = (
            f"Partially supported. There is a slight {city_trend if city_trend != 'stable' else 'upward' if result.slope > 0 else 'downward'} "
            f"tendency in {parameter_name} ({'+' if result.slope > 0 else ''}{slope_per_decade:.2f}{unit}/decade), "
            f"but it is not yet statistically significant (p={result.p_value:.2f}). "
            f"More data may be needed to confirm."
        )

    # Add context about latest value
    if result.latest_is_extreme:
        result.verdict_explanation += (
            f" Note: {result.latest_year} was an extreme year, "
            f"{abs(result.latest_deviation):.1f} standard deviations "
            f"{'above' if result.latest_deviation > 0 else 'below'} the long-term average."
        )

    return result


def compare_cities(
    data1: Dict[int, float],
    data2: Dict[int, float],
    city1_name: str,
    city2_name: str,
    parameter_name: str,
    unit: str,
) -> dict:
    """Compare climate trends between two cities."""
    # Find common years
    common_years = sorted(set(data1.keys()) & set(data2.keys()))

    if len(common_years) < 3:
        return {
            "error": "Not enough overlapping data years to compare.",
            "city1": city1_name,
            "city2": city2_name,
        }

    values1 = [data1[y] for y in common_years]
    values2 = [data2[y] for y in common_years]

    mean1 = sum(values1) / len(values1)
    mean2 = sum(values2) / len(values2)

    # Trends for each
    x = [float(y) for y in common_years]
    slope1, _, r2_1, p1 = _linear_regression(x, values1)
    slope2, _, r2_2, p2 = _linear_regression(x, values2)

    latest_year = common_years[-1]
    diff_latest = data1[latest_year] - data2[latest_year]

    return {
        "city1": {
            "name": city1_name,
            "mean": round(mean1, 2),
            "latest": round(data1[latest_year], 2),
            "slope_per_decade": round(slope1 * 10, 2),
            "trend_significant": p1 < 0.05,
            "trend_direction": "increasing" if slope1 > 0 else "decreasing",
        },
        "city2": {
            "name": city2_name,
            "mean": round(mean2, 2),
            "latest": round(data2[latest_year], 2),
            "slope_per_decade": round(slope2 * 10, 2),
            "trend_significant": p2 < 0.05,
            "trend_direction": "increasing" if slope2 > 0 else "decreasing",
        },
        "comparison": {
            "years": common_years,
            "mean_difference": round(mean1 - mean2, 2),
            "latest_difference": round(diff_latest, 2),
            "warmer_city": city1_name if mean1 > mean2 else city2_name,
            "faster_warming": city1_name if slope1 > slope2 else city2_name,
        },
        "parameter": parameter_name,
        "unit": unit,
        "latest_year": latest_year,
    }


def annual_series(values, fill, metric, start, end):
    """Calculate annual values from monthly NASA POWER data."""
    points = []
    for year in range(start, end + 1):
        total = 0.0
        days = 0
        for month in range(1, 13):
            value = values.get(f"{year:04}{month:02}")
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value == fill:
                points.append({"year": year, "value": None})
                break
            month_days = monthrange(year, month)[1]
            total += value * month_days
            days += month_days
        else:
            annual = total if metric == "PRECTOTCORR" else total / days
            points.append({"year": year, "value": annual})
    return points


def analyze_series(points):
    """SciPy-backed (with pure-Python fallback) linear trend and anomaly analysis."""
    observed = [point for point in points if point["value"] is not None]
    count = len(observed)
    if count < 5:
        raise ValueError(
            f"NASA POWER supplied {count} complete years for this range. "
            "Choose a wider range with at least five complete years."
        )

    years = [point["year"] for point in observed]
    values = [point["value"] for point in observed]

    if HAS_SCIPY:
        fit = linregress(years, values)
        slope = float(fit.slope)
        stderr = float(fit.stderr) if math.isfinite(fit.stderr) else 0.0
        p_val = float(fit.pvalue) if math.isfinite(fit.pvalue) else 1.0
        r_squared = float(fit.rvalue ** 2) if math.isfinite(fit.rvalue) else 0.0
        margin = float(t.ppf(0.975, count - 2) * stderr)
    else:
        x_m = sum(years) / count
        y_m = sum(values) / count
        ss_xx = sum((x - x_m) ** 2 for x in years)
        ss_xy = sum((x - x_m) * (y - y_m) for x, y in zip(years, values))
        slope = ss_xy / ss_xx if ss_xx != 0 else 0.0
        intercept = y_m - slope * x_m
        ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(years, values))
        ss_tot = sum((y - y_m) ** 2 for y in values)
        r_squared = max(0.0, 1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
        stderr = math.sqrt(ss_res / (count - 2)) / math.sqrt(ss_xx) if ss_xx > 0 and count > 2 else 0.0
        t_stat = abs(slope / stderr) if stderr > 0 else 0.0
        df = count - 2
        t_crit = 2.0 + 1.2 / max(1, df)
        margin = t_crit * stderr
        p_val = max(0.0001, min(1.0, 2.0 * math.exp(-0.717 * t_stat - 0.416 * t_stat ** 2))) if t_stat > 0 else 1.0

    x_mean = sum(years) / count
    y_mean = sum(values) / count

    def fitted(year):
        return y_mean + slope * (year - x_mean)

    error = math.sqrt(sum((p["value"] - fitted(p["year"])) ** 2 for p in observed) / (count - 2))
    first, last = years[0], years[-1]
    for point in points:
        year, value = point["year"], point["value"]
        trend = fitted(year) if first <= year <= last else None
        point["trend"] = float(trend) if trend is not None else None
        point["anomaly"] = bool(value is not None and error > 0 and abs(value - trend) > 2 * error)

    return {
        "points": points,
        "count": count,
        "firstYear": first,
        "lastYear": last,
        "slope": float(slope),
        "pValue": float(p_val),
        "rSquared": float(r_squared),
        "interval": [float(slope - margin), float(slope + margin)],
    }

