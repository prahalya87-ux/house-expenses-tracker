"""Household expense anomaly detection.

Two layers:
1. Isolation Forest on category-relative features (needs enough history).
   A model flag only becomes an anomaly when it can be explained by a clear
   deviation from that category's own baseline, so a purchase that is merely
   expensive (e.g. monthly rent) is not reported.
2. Transparent rules: possible duplicate transactions and month-level
   category spikes.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

MIN_EXPENSES_FOR_MODEL = 30  # total expense rows needed before the model runs
MIN_CATEGORY_HISTORY = 4  # rows a category needs to have its own baseline
MIN_PRIOR_MONTHS = 3  # months of history needed for the monthly-spike rule
CONTAMINATION = 0.05  # model may nominate at most ~5% of transactions
RANDOM_STATE = 42
UTILITY_CATEGORIES = {"electricity", "water"}
GROCERY_CATEGORIES = {"groceries"}
SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3}

FEATURE_COLUMNS = ["f_log_ratio", "f_robust_z", "f_count_ratio", "f_log_amount", "f_gap"]


def _money(x: float) -> str:
    return f"₹{x:,.2f}"


def _severity_from_score(score: float) -> str:
    if score >= 0.65:
        return "high"
    if score >= 0.58:
        return "medium"
    return "low"


def _finding(row, reason_type, method, score, severity, baseline, difference, reason) -> dict:
    return {
        "transaction_id": str(row["id"]),
        "reason_type": reason_type,
        "detection_method": method,
        "anomaly_score": None if score is None else round(float(score), 4),
        "severity": severity,
        "baseline_amount": None if baseline is None else round(float(baseline), 2),
        "difference_amount": round(float(difference), 2),
        "reason": reason,
    }


def prepare_expenses(transactions: list[dict], category_names: dict[str, str]) -> pd.DataFrame:
    """Clean raw rows: expenses only, valid amounts/dates, readable category names."""
    df = pd.DataFrame(transactions)
    if df.empty or "kind" not in df:
        return pd.DataFrame()
    for col in ("merchant", "description", "category_id", "id", "amount", "txn_date"):
        if col not in df:
            df[col] = None
    df = df[df["kind"] == "expense"].copy()
    if df.empty:
        return df
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    df["txn_date"] = pd.to_datetime(df["txn_date"], errors="coerce")
    df = df.dropna(subset=["amount", "txn_date"])
    df = df[df["amount"] > 0]
    df["category"] = df["category_id"].map(category_names).fillna("Unknown")
    df["merchant_norm"] = df["merchant"].fillna("").astype(str).str.strip().str.lower()
    df["description_norm"] = df["description"].fillna("").astype(str).str.strip().str.lower()
    return df.sort_values(["txn_date", "id"]).reset_index(drop=True)


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Category-relative features, so each category is judged against its own history."""
    df = df.copy()
    global_median = float(df["amount"].median())
    global_mad = float(np.median(np.abs(df["amount"] - global_median)))
    for col in ("cat_median", "cat_scale", "typ_count", "typ_spend", "count_7d", "spend_7d", "gap_days"):
        df[col] = np.nan
    df["has_baseline"] = False

    for _, g in df.groupby("category"):
        amounts = g["amount"].to_numpy(float)
        days = (g["txn_date"] - pd.Timestamp("1970-01-01")).dt.days.to_numpy()
        has = len(g) >= MIN_CATEGORY_HISTORY
        med = float(np.median(amounts)) if has else global_median
        mad = float(np.median(np.abs(amounts - med))) if has else global_mad
        # floor the scale so constant bills (rent) don't get an infinite z-score
        scale = max(1.4826 * mad, 0.1 * med, 1e-6)

        lower = np.searchsorted(days, days - 6, side="left")
        upper = np.searchsorted(days, days, side="right")
        cum = np.concatenate([[0.0], np.cumsum(amounts)])
        counts = (upper - lower).astype(float)
        spends = cum[upper] - cum[lower]

        df.loc[g.index, "count_7d"] = counts
        df.loc[g.index, "spend_7d"] = spends
        df.loc[g.index, "gap_days"] = np.diff(days.astype(float), prepend=np.nan)
        df.loc[g.index, "cat_median"] = med
        df.loc[g.index, "cat_scale"] = scale
        df.loc[g.index, "typ_count"] = float(np.median(counts)) if has else 1.0
        df.loc[g.index, "typ_spend"] = float(np.median(spends)) if has else float(np.median(amounts))
        df.loc[g.index, "has_baseline"] = has

    gap_fill = df["gap_days"].median()
    df["gap_days"] = df["gap_days"].fillna(30.0 if pd.isna(gap_fill) else gap_fill)

    df["f_log_ratio"] = np.log(df["amount"] / df["cat_median"].clip(lower=1e-6))
    df["f_robust_z"] = ((df["amount"] - df["cat_median"]) / df["cat_scale"]).clip(-10, 10)
    df["f_count_ratio"] = df["count_7d"] / df["typ_count"].clip(lower=1)
    df["f_log_amount"] = np.log(df["amount"])
    df["f_gap"] = np.log1p(df["gap_days"].clip(lower=0))
    return df


def _model_findings(df: pd.DataFrame) -> list[dict]:
    feats = _build_features(df)
    X = feats[FEATURE_COLUMNS].to_numpy(float)
    iso = IsolationForest(n_estimators=200, contamination=CONTAMINATION, random_state=RANDOM_STATE)
    iso.fit(X)
    scores = -iso.score_samples(X)  # higher = more anomalous (roughly 0..1)
    flagged = iso.predict(X) == -1

    out: list[dict] = []
    for i in np.flatnonzero(flagged):
        row = feats.iloc[i]
        if not bool(row["has_baseline"]):
            continue  # no reliable baseline for this category yet
        score = float(scores[i])
        severity = _severity_from_score(score)
        cat = str(row["category"])
        who = row["merchant"] if isinstance(row["merchant"], str) and row["merchant"].strip() else cat
        date = row["txn_date"].strftime("%Y-%m-%d")

        # Explainable reason 1: amount far above this category's usual range
        if row["f_robust_z"] >= 3 and row["amount"] >= 1.5 * row["cat_median"]:
            if cat.lower() in UTILITY_CATEGORIES:
                rtype = "utility_spike"
            elif cat.lower() in GROCERY_CATEGORIES:
                rtype = "grocery_spike"
            else:
                rtype = "high_amount"
            ratio = row["amount"] / row["cat_median"]
            reason = (
                f"{_money(row['amount'])} at {who} on {date} is {ratio:.1f}x the typical "
                f"{cat} transaction ({_money(row['cat_median'])}) and far outside its usual range."
            )
            out.append(_finding(row, rtype, "isolation_forest", score, severity,
                                row["cat_median"], row["amount"] - row["cat_median"], reason))

        # Explainable reason 2: unusually many purchases in a 7-day window
        if (row["count_7d"] >= 3
                and row["count_7d"] >= row["typ_count"] + 2
                and row["count_7d"] >= 2 * row["typ_count"]):
            reason = (
                f"{int(row['count_7d'])} {cat} purchases within 7 days up to {date} "
                f"(typically {row['typ_count']:.0f}), totalling {_money(row['spend_7d'])} "
                f"versus a usual {_money(row['typ_spend'])} per week."
            )
            out.append(_finding(row, "frequency", "isolation_forest", score, severity,
                                row["typ_spend"], row["spend_7d"] - row["typ_spend"], reason))
    return out


def _detect_duplicates(df: pd.DataFrame) -> list[dict]:
    """Same category, amount, merchant and description within 2 days."""
    out: list[dict] = []
    d = df[(df["merchant_norm"] != "") | (df["description_norm"] != "")]
    keys = ["category_id", "amount", "merchant_norm", "description_norm"]
    for _, g in d.groupby(keys):
        if len(g) < 2:
            continue
        rows = g.sort_values("txn_date").to_dict("records")
        for prev, cur in zip(rows, rows[1:]):
            gap = (cur["txn_date"] - prev["txn_date"]).days
            if gap <= 2:
                when = "the same day" if gap == 0 else f"{gap} day(s) earlier"
                reason = (
                    f"Possible duplicate: an identical {cur['category']} transaction of "
                    f"{_money(cur['amount'])} was recorded {when} "
                    f"({prev['txn_date'].strftime('%Y-%m-%d')}). Review whether it was charged twice."
                )
                out.append(_finding(cur, "duplicate", "rule", None, "medium", None, cur["amount"], reason))
    return out


def _detect_category_month_spikes(df: pd.DataFrame) -> list[dict]:
    """Monthly category total much higher than that category's recent months."""
    out: list[dict] = []
    d = df.copy()
    d["month"] = d["txn_date"].dt.to_period("M")
    monthly = d.groupby(["category", "month"])["amount"].sum().reset_index()
    for cat, g in monthly.groupby("category"):
        g = g.sort_values("month").reset_index(drop=True)
        for i in range(MIN_PRIOR_MONTHS, len(g)):
            prior = g["amount"].iloc[max(0, i - 6):i]
            base = float(prior.median())
            cur = float(g["amount"].iloc[i])
            if base <= 0 or cur < 1.5 * base:
                continue
            ratio = cur / base
            severity = "high" if ratio >= 2.5 else "medium" if ratio >= 2.0 else "low"
            month = g["month"].iloc[i]
            top = d[(d["category"] == cat) & (d["month"] == month)].nlargest(1, "amount").iloc[0]
            reason = (
                f"{cat} spending in {month} was {_money(cur)}, versus a typical month of "
                f"{_money(base)} (+{(ratio - 1) * 100:.0f}%). Shown on the largest {cat} purchase of that month."
            )
            out.append(_finding(top, "category_spike", "rule", None, severity, base, cur - base, reason))
    return out


def _dedupe(findings: list[dict]) -> list[dict]:
    best: dict[tuple[str, str], dict] = {}
    for f in findings:
        key = (f["transaction_id"], f["reason_type"])
        if key not in best or SEVERITY_RANK[f["severity"]] > SEVERITY_RANK[best[key]["severity"]]:
            best[key] = f
    return sorted(
        best.values(),
        key=lambda f: (-SEVERITY_RANK[f["severity"]], -(f["anomaly_score"] or 0.0)),
    )


def detect_anomalies(transactions: list[dict], category_names: dict[str, str]) -> dict:
    df = prepare_expenses(transactions, category_names)
    result = {"model_ran": False, "message": None, "expense_count": int(len(df)), "anomalies": []}
    if df.empty:
        result["message"] = "No expense transactions yet, so there is nothing to analyse."
        return result

    found = _detect_duplicates(df) + _detect_category_month_spikes(df)
    if len(df) >= MIN_EXPENSES_FOR_MODEL:
        found += _model_findings(df)
        result["model_ran"] = True
    else:
        result["message"] = (
            f"The Isolation Forest model needs at least {MIN_EXPENSES_FOR_MODEL} expense transactions "
            f"(you have {len(df)}). Only the rule-based checks (duplicates, monthly category spikes) were run."
        )
    result["anomalies"] = _dedupe(found)
    return result