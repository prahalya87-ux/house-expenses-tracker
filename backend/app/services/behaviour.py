"""Spending behaviour analysis (Pandas, NumPy, K-Means).

Everything is computed from the user's real transactions. K-Means is only
used when there are enough days with spending to cluster meaningfully.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

HISTORY_DAYS = 365
MIN_CLUSTER_DAYS = 30
MAX_CLUSTERS = 4
MIN_DAYS_PER_CLUSTER = 10
RANDOM_STATE = 42
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
CLUSTER_LABELS = {
    2: ["Lower-spend days", "Higher-spend days"],
    3: ["Lower-spend days", "Typical days", "Higher-spend days"],
    4: ["Lower-spend days", "Moderate days", "Elevated days", "Highest-spend days"],
}


def _f(x, nd: int = 2) -> float:
    return round(float(x), nd)


def _pct(new: float, old: float) -> float | None:
    return None if old == 0 else _f((new - old) / old * 100, 1)


def _prepare(transactions: list[dict], categories: dict[str, dict], as_of: date) -> pd.DataFrame:
    df = pd.DataFrame(transactions)
    if df.empty or "kind" not in df:
        return pd.DataFrame()
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    df["txn_date"] = pd.to_datetime(df["txn_date"], errors="coerce")
    df = df.dropna(subset=["amount", "txn_date"])
    df = df[df["amount"] > 0]
    lo = pd.Timestamp(as_of - timedelta(days=HISTORY_DAYS))
    df = df[(df["txn_date"] >= lo) & (df["txn_date"] <= pd.Timestamp(as_of))].copy()
    if df.empty:
        return df
    df["category"] = df["category_id"].map(lambda c: categories.get(c, {}).get("name", "Unknown"))
    df["is_essential"] = df["category_id"].map(lambda c: bool(categories.get(c, {}).get("is_essential", False)))
    return df


def _daily_series(exp: pd.DataFrame, as_of: date) -> pd.Series:
    idx = pd.date_range(exp["txn_date"].min().normalize(), pd.Timestamp(as_of), freq="D")
    return exp.groupby(exp["txn_date"].dt.normalize())["amount"].sum().reindex(idx, fill_value=0.0)


def _daily_section(exp: pd.DataFrame, daily: pd.Series) -> dict:
    highest = []
    for day, total in daily.nlargest(5).items():
        if total <= 0:
            continue
        on_day = exp[exp["txn_date"].dt.normalize() == day]
        top_cat = on_day.groupby("category")["amount"].sum().idxmax()
        highest.append({"date": day.strftime("%Y-%m-%d"), "total": _f(total), "top_category": str(top_cat)})
    recent = daily.tail(90)
    return {
        "average_daily": _f(daily.mean()),
        "median_daily": _f(daily.median()),
        "days_in_range": int(len(daily)),
        "days_with_spending": int((daily > 0).sum()),
        "highest_days": highest,
        "series": [{"date": d.strftime("%Y-%m-%d"), "total": _f(v)} for d, v in recent.items()],
    }


def _weekly_section(daily: pd.Series) -> dict:
    by_weekday = daily.groupby(daily.index.dayofweek).mean().reindex(range(7), fill_value=0.0)
    week_start = daily.index - pd.to_timedelta(daily.index.dayofweek, unit="D")
    grouped = daily.groupby(week_start)
    totals, sizes = grouped.sum(), grouped.size()
    return {
        "weekly_totals": [
            {"week_start": d.strftime("%Y-%m-%d"), "total": _f(totals[d]), "days": int(sizes[d])}
            for d in totals.index
        ],
        "weekday_average": [{"weekday": WEEKDAYS[i], "average": _f(v)} for i, v in by_weekday.items()],
        "peak_weekday": WEEKDAYS[int(by_weekday.idxmax())],
    }


def _monthly_tables(df: pd.DataFrame):
    exp = df[df["kind"] == "expense"]
    inc = df[df["kind"] == "income"]
    exp_m = exp.groupby(exp["txn_date"].dt.to_period("M"))["amount"].sum()
    inc_m = inc.groupby(inc["txn_date"].dt.to_period("M"))["amount"].sum()
    months = exp_m.index.union(inc_m.index).sort_values()
    return exp_m.reindex(months, fill_value=0.0), inc_m.reindex(months, fill_value=0.0)


def _monthly_section(df: pd.DataFrame, exp: pd.DataFrame, as_of: date) -> dict:
    exp_m, inc_m = _monthly_tables(df)
    current = pd.Period(as_of, "M")
    rows, prev = [], None
    for m in exp_m.index:
        e, i = float(exp_m[m]), float(inc_m[m])
        rows.append({
            "month": str(m), "expenses": _f(e), "income": _f(i), "savings": _f(i - e),
            "savings_rate": None if i == 0 else _f((i - e) / i * 100, 1),
            "mom_change_pct": None if prev is None else _pct(e, prev),
            "is_partial": bool(m == current),
        })
        prev = e
    cats = exp.groupby("category")["amount"].sum().sort_values(ascending=False)
    total = float(cats.sum())
    return {
        "months": rows,
        "category_totals": [
            {"category": str(c), "total": _f(v), "share_pct": _f(v / total * 100, 1)} for c, v in cats.items()
        ],
    }


def _income_expense_section(df: pd.DataFrame, as_of: date) -> dict:
    exp_m, inc_m = _monthly_tables(df)
    current = pd.Period(as_of, "M")
    complete = [m for m in exp_m.index if m < current]
    use = complete if complete else list(exp_m.index)
    basis = "complete months" if complete else "current (partial) month"
    avg_e = float(exp_m.loc[use].mean())
    avg_i = float(inc_m.loc[use].mean())
    total_i, total_e = float(inc_m.sum()), float(exp_m.sum())
    return {
        "total_income": _f(total_i), "total_expense": _f(total_e),
        "expense_to_income_ratio": None if total_i == 0 else _f(total_e / total_i, 3),
        "avg_monthly_income": _f(avg_i), "avg_monthly_expense": _f(avg_e),
        "months_analysed": len(use), "basis": basis,
    }


def _habit_change_section(exp: pd.DataFrame, as_of: date) -> dict:
    exp = exp.copy()
    exp["month"] = exp["txn_date"].dt.to_period("M")
    current = pd.Period(as_of, "M")
    first = exp["month"].min()
    complete = [m for m in sorted(exp["month"].unique()) if m < current]
    if len(complete) < 2:
        return {"available": False,
                "reason": "Habit comparison needs at least 2 complete months of expenses."}
    latest = complete[-1]
    baseline_range = pd.period_range(start=first, end=latest - 1, freq="M")[-3:]
    pivot = exp.groupby(["category", "month"])["amount"].sum().unstack(fill_value=0.0)
    rows = []
    for cat in pivot.index:
        cur = float(pivot.loc[cat].get(latest, 0.0))
        base = float(np.mean([pivot.loc[cat].get(m, 0.0) for m in baseline_range]))
        rows.append({"category": str(cat), "latest": _f(cur), "baseline_avg": _f(base),
                     "change": _f(cur - base), "change_pct": _pct(cur, base)})
    rows.sort(key=lambda r: -abs(r["change"]))
    cur_total = float(exp[exp["month"] == latest]["amount"].sum())
    base_total = float(np.mean([exp[exp["month"] == m]["amount"].sum() for m in baseline_range]))
    return {
        "available": True, "latest_month": str(latest),
        "baseline_months": [str(m) for m in baseline_range],
        "overall": {"latest": _f(cur_total), "baseline_avg": _f(base_total), "change_pct": _pct(cur_total, base_total)},
        "categories": rows,
    }


def _cluster_section(exp: pd.DataFrame) -> dict:
    day = exp["txn_date"].dt.normalize()
    ess = exp.assign(_ess=np.where(exp["is_essential"], exp["amount"], 0.0))
    days = ess.groupby(day).agg(total=("amount", "sum"), n=("amount", "size"), ess=("_ess", "sum"))
    days["ess_share"] = days["ess"] / days["total"]
    n = len(days)
    if n < MIN_CLUSTER_DAYS:
        return {"available": False,
                "reason": f"K-Means needs at least {MIN_CLUSTER_DAYS} days with spending (you have {n})."}

    X = StandardScaler().fit_transform(
        np.column_stack([np.log1p(days["total"]), days["n"], days["ess_share"]])
    )
    best = None
    for k in range(2, min(MAX_CLUSTERS, n // MIN_DAYS_PER_CLUSTER) + 1):
        labels = KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE).fit_predict(X)
        if len(set(labels)) < 2:
            continue
        score = float(silhouette_score(X, labels))
        if best is None or score > best[0]:
            best = (score, k, labels)
    if best is None:
        return {"available": False, "reason": "Spending days were too similar to form distinct groups."}

    score, k, labels = best
    days = days.assign(cluster=labels)
    grand = float(days["total"].sum())
    stats = []
    for c, g in days.groupby("cluster"):
        stats.append({"days": int(len(g)), "avg_spend": float(g["total"].mean()),
                      "avg_transactions": float(g["n"].mean()), "ess": float(g["ess_share"].mean()),
                      "share": float(g["total"].sum()) / grand})
    stats.sort(key=lambda s: s["avg_spend"])
    names = CLUSTER_LABELS[k]
    return {
        "available": True, "k": int(k), "silhouette": _f(score, 3), "spending_days": int(n),
        "clusters": [
            {"label": names[i], "days": s["days"], "avg_spend": _f(s["avg_spend"]),
             "avg_transactions": _f(s["avg_transactions"], 1),
             "essential_share_pct": _f(s["ess"] * 100, 1), "share_of_spend_pct": _f(s["share"] * 100, 1)}
            for i, s in enumerate(stats)
        ],
    }


def analyse_behaviour(transactions: list[dict], categories: dict[str, dict], as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    df = _prepare(transactions, categories, as_of)
    exp = df[df["kind"] == "expense"] if not df.empty else df
    if exp.empty:
        return {"message": "No expense transactions yet, so there is nothing to analyse.", "sections": {}}

    daily = _daily_series(exp, as_of)
    start = exp["txn_date"].min().strftime("%Y-%m-%d")
    end = as_of.strftime("%Y-%m-%d")
    results = {
        "daily": _daily_section(exp, daily),
        "weekly": _weekly_section(daily),
        "monthly": _monthly_section(df, exp, as_of),
        "income_expense": _income_expense_section(df, as_of),
        "habit_change": _habit_change_section(exp, as_of),
        "clusters": _cluster_section(exp),
    }
    return {
        "message": None,
        "sections": {k: {"period_start": start, "period_end": end, "result": v} for k, v in results.items()},
    }


def compare_months(transactions: list[dict], categories: dict[str, dict], month_a: str, month_b: str) -> dict:
    """Category-by-category expense comparison of two months (YYYY-MM)."""
    df = pd.DataFrame(transactions)
    empty = {"month_a": month_a, "month_b": month_b, "total_a": 0.0, "total_b": 0.0,
             "total_diff": 0.0, "total_pct": None, "categories": []}
    if df.empty or "kind" not in df:
        return empty
    df = df[df["kind"] == "expense"].copy()
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    df["txn_date"] = pd.to_datetime(df["txn_date"], errors="coerce")
    df = df.dropna(subset=["amount", "txn_date"])
    df["month"] = df["txn_date"].dt.strftime("%Y-%m")
    df["category"] = df["category_id"].map(lambda c: categories.get(c, {}).get("name", "Unknown"))
    pivot = df[df["month"].isin([month_a, month_b])].groupby(["category", "month"])["amount"].sum().unstack(fill_value=0.0)
    for m in (month_a, month_b):
        if m not in pivot.columns:
            pivot[m] = 0.0
    rows = [
        {"category": str(cat), "a": _f(r[month_a]), "b": _f(r[month_b]),
         "diff": _f(r[month_b] - r[month_a]), "pct": _pct(float(r[month_b]), float(r[month_a]))}
        for cat, r in pivot.iterrows()
    ]
    rows.sort(key=lambda r: -abs(r["diff"]))
    ta, tb = float(pivot[month_a].sum()), float(pivot[month_b].sum())
    return {"month_a": month_a, "month_b": month_b, "total_a": _f(ta), "total_b": _f(tb),
            "total_diff": _f(tb - ta), "total_pct": _pct(tb, ta), "categories": rows}