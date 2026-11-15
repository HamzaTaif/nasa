"""Annual aggregation and OLS trend statistics."""

from calendar import monthrange
from math import isfinite, sqrt

from scipy.stats import linregress, t


def annual_series(values, fill, metric, start, end):
    points = []
    for year in range(start, end + 1):
        total = 0.0
        days = 0
        for month in range(1, 13):
            value = values.get(f"{year:04}{month:02}")
            if not isinstance(value, (int, float)) or not isfinite(value) or value == fill:
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
    observed = [point for point in points if point["value"] is not None]
    count = len(observed)
    if count < 5:
        raise ValueError(
            f"NASA POWER supplied {count} complete years for this range. "
            "Choose a wider range with at least five complete years."
        )

    years = [point["year"] for point in observed]
    values = [point["value"] for point in observed]
    fit = linregress(years, values)
    x_mean = sum(years) / count
    y_mean = sum(values) / count

    def fitted(year):
        return y_mean + fit.slope * (year - x_mean)

    error = sqrt(sum((p["value"] - fitted(p["year"])) ** 2 for p in observed) / (count - 2))
    margin = t.ppf(0.975, count - 2) * (fit.stderr if isfinite(fit.stderr) else 0.0)
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
        "slope": float(fit.slope),
        "pValue": float(fit.pvalue) if isfinite(fit.pvalue) else 1.0,
        "rSquared": float(fit.rvalue**2) if isfinite(fit.rvalue) else 0.0,
        "interval": [float(fit.slope - margin), float(fit.slope + margin)],
    }
