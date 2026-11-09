"""Household waste detection.

Transparent, explainable rules over real transaction history. Nothing here
decides that a purchase IS waste: every finding is a *potential* saving for
the user to review, with the evidence that triggered it.

Rules
1. repeat_purchase       same item/merchant bought 3+ times within 7 days
2. delivery_frequency    6+ food-delivery orders in a calendar month
3. subscription_review   several active subscriptions, or a price increase
4. non_essential_growth  a non-essential category rising 3 months in a row
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

HISTORY_DAYS = 200  # how much history the rules may look at
LOOKBACK_DAYS = 90  # window for repeat purchases and delivery frequency
REPEAT_WINDOW_DAYS = 7
REPEAT_MIN_COUNT = 3
DELIVERY_MONTHLY_ORDERS = 6
DELIVERY_REDUCTION_SCENARIO = 1 / 3  # "if you ordered one third less"
SUBSCRIPTION_SUMMARY_MIN = 3
SUBSCRIPTION_ACTIVE_DAYS = 45
PRICE_INCREASE_THRESHOLD = 1.10
GROWTH_MIN_RATIO = 1.25
EXCLUDED_FROM_REPEAT = {"food delivery", "subscriptions"}  # covered by their own rules
MAX_EVIDENCE = 30


def _money(x: float) -> str:
    return f"₹{x:,.2f}"


def _iso(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def _finding(ftype, title, explanation, fingerprint, *, category_id, period_start, period_end,
             occurrences, total_amount, potential_savings, evidence) -> dict:
    return {
        "finding_type": ftype,
        "title": title,
        "explanation": explanation,
        "fingerprint": fingerprint,
        "category_id": None if category_id is None else str(category_id),
        "period_start": _iso(period_start),
        "period_end": _iso(period_end),
        "occurrences": int(occurrences),
        "total_amount": round(float(total_amount), 2),
        "potential_savings": None if potential_savings is None else round(float(potential_savings), 2),
        "evidence": evidence[:MAX_EVIDENCE],
    }


def _txn_evidence(rows: pd.DataFrame) -> list[dict]:
    return [
        {"label": f"{_iso(r.txn_date)} · {r.merchant or r.category}", "amount": round(float(r.amount), 2)}
        for r in rows.itertuples()
    ]


def _prepare(transactions: list[dict], categories: dict[str, dict], as_of: date) -> pd.DataFrame:
    df = pd.DataFrame(transactions)
    if df.empty or "kind" not in df:
        return pd.DataFrame()
    for col in ("merchant", "description", "category_id", "id", "amount", "txn_date"):
        if col not in df:
            df[col] = None
    df = df[df["kind"] == "expense"].copy()
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    df["txn_date"] = pd.to_datetime(df["txn_date"], errors="coerce")
    df = df.dropna(subset=["amount", "txn_date"])
    df = df[df["amount"] > 0]
    cutoff = pd.Timestamp(as_of - timedelta(days=HISTORY_DAYS))
    df = df[(df["txn_date"] >= cutoff) & (df["txn_date"] <= pd.Timestamp(as_of))].copy()
    if df.empty:
        return df
    df["category"] = df["category_id"].map(lambda c: categories.get(c, {}).get("name", "Unknown"))
    df["is_essential"] = df["category_id"].map(lambda c: bool(categories.get(c, {}).get("is_essential", False)))
    df["merchant"] = df["merchant"].fillna("").astype(str).str.strip()
    df["description"] = df["description"].fillna("").astype(str).str.strip()
    df["merchant_norm"] = df["merchant"].str.lower()
    df["description_norm"] = df["description"].str.lower()
    return df.sort_values(["txn_date", "id"]).reset_index(drop=True)


# ---------- Rule 1: repeated purchases ----------
def _repeat_purchases(df: pd.DataFrame, as_of: date) -> list[dict]:
    out: list[dict] = []
    recent = df[df["txn_date"] >= pd.Timestamp(as_of - timedelta(days=LOOKBACK_DAYS))]
    recent = recent[~recent["category"].str.lower().isin(EXCLUDED_FROM_REPEAT)]
    keys = ["category_id", "merchant_norm", "description_norm"]
    for (cat_id, merchant_norm, desc_norm), g in recent.groupby(keys):
        if merchant_norm == "" and desc_norm == "":
            continue
        # Essentials (groceries, rent...) are only checked when a specific item is named.
        if bool(g["is_essential"].iloc[0]) and desc_norm == "":
            continue
        g = g.sort_values("txn_date").reset_index(drop=True)
        days = (g["txn_date"] - pd.Timestamp("1970-01-01")).dt.days.to_numpy()

        flagged: set[int] = set()
        for i in range(len(days)):
            j = int(np.searchsorted(days, days[i] + REPEAT_WINDOW_DAYS - 1, side="right"))
            if j - i >= REPEAT_MIN_COUNT:
                flagged.update(range(i, j))
        if not flagged:
            continue

        runs: list[list[int]] = []
        run: list[int] = []
        for idx in sorted(flagged):
            if run and (idx != run[-1] + 1 or days[idx] - days[run[-1]] > REPEAT_WINDOW_DAYS - 1):
                runs.append(run)
                run = []
            run.append(idx)
        runs.append(run)

        for run in runs:
            rows = g.iloc[run]
            n = len(rows)
            total = float(rows["amount"].sum())
            savings = total * (n - 1) / n
            item = rows["description"].iloc[0] or rows["merchant"].iloc[0]
            seller = rows["merchant"].iloc[0] or "the same seller"
            first, last = rows["txn_date"].min(), rows["txn_date"].max()
            explanation = (
                f"You bought \"{item}\" from {seller} {n} times between {_iso(first)} and {_iso(last)}, "
                f"{_money(total)} in total. Repeating the same purchase this often in a week can mean "
                f"over-buying. If one purchase would have been enough, roughly {_money(savings)} could have been saved."
            )
            out.append(_finding(
                "repeat_purchase", f"Repeated purchase: {item}", explanation,
                f"repeat:{cat_id}:{merchant_norm}:{desc_norm}:{_iso(first)}",
                category_id=cat_id, period_start=first, period_end=last, occurrences=n,
                total_amount=total, potential_savings=savings, evidence=_txn_evidence(rows),
            ))
    return out


# ---------- Rule 2: food delivery frequency ----------
def _delivery_frequency(df: pd.DataFrame, as_of: date) -> list[dict]:
    out: list[dict] = []
    d = df[(df["category"].str.lower() == "food delivery")
           & (df["txn_date"] >= pd.Timestamp(as_of - timedelta(days=LOOKBACK_DAYS)))].copy()
    if d.empty:
        return out
    d["month"] = d["txn_date"].dt.to_period("M")
    counts = d.groupby("month").size()
    this_month = pd.Period(as_of, "M")
    for month, g in d.groupby("month"):
        n = len(g)
        if n < DELIVERY_MONTHLY_ORDERS:
            continue
        total = float(g["amount"].sum())
        savings = total * DELIVERY_REDUCTION_SCENARIO
        others = counts.drop(month)
        context = f" That is more than the {others.mean():.0f} orders per month in your other recent months." \
            if len(others) and n > others.mean() else ""
        so_far = " so far" if month == this_month else ""
        explanation = (
            f"You placed {n} food-delivery orders in {month}{so_far}, totalling {_money(total)} "
            f"(average {_money(total / n)} per order).{context} As an illustration, ordering one third "
            f"less would save about {_money(savings)}."
        )
        out.append(_finding(
            "delivery_frequency", f"Frequent food delivery in {month}", explanation,
            f"delivery:{month}", category_id=g["category_id"].iloc[0],
            period_start=g["txn_date"].min(), period_end=g["txn_date"].max(), occurrences=n,
            total_amount=total, potential_savings=savings, evidence=_txn_evidence(g),
        ))
    return out


# ---------- Rule 3: subscriptions ----------
def _subscriptions(df: pd.DataFrame, as_of: date) -> list[dict]:
    out: list[dict] = []
    s = df[(df["category"].str.lower() == "subscriptions") & (df["merchant_norm"] != "")]
    active = []
    for _, g in s.groupby("merchant_norm"):
        g = g.sort_values("txn_date")
        if g["txn_date"].dt.to_period("M").nunique() < 2:
            continue
        if (as_of - g["txn_date"].iloc[-1].date()).days > SUBSCRIPTION_ACTIVE_DAYS:
            continue
        active.append({
            "name": g["merchant"].iloc[-1], "latest": float(g["amount"].iloc[-1]),
            "first": float(g["amount"].iloc[0]), "rows": g,
            "category_id": g["category_id"].iloc[0],
        })
    if not active:
        return out

    for a in active:
        if a["latest"] >= PRICE_INCREASE_THRESHOLD * a["first"]:
            inc = a["latest"] - a["first"]
            explanation = (
                f"{a['name']} was charged {_money(a['first'])} at first and is now {_money(a['latest'])} "
                f"per charge (+{inc / a['first'] * 100:.0f}%). Check whether the plan is still worth it."
            )
            out.append(_finding(
                "subscription_review", f"Subscription price increase: {a['name']}", explanation,
                f"sub-increase:{a['name'].lower()}:{a['latest']:.2f}", category_id=a["category_id"],
                period_start=a["rows"]["txn_date"].min(), period_end=a["rows"]["txn_date"].max(),
                occurrences=len(a["rows"]), total_amount=float(a["rows"]["amount"].sum()),
                potential_savings=inc, evidence=_txn_evidence(a["rows"]),
            ))

    if len(active) >= SUBSCRIPTION_SUMMARY_MIN:
        monthly = sum(a["latest"] for a in active)
        names = ", ".join(sorted(a["name"] for a in active))
        explanation = (
            f"You have {len(active)} active subscriptions ({names}) costing about {_money(monthly)} per "
            f"month ({_money(monthly * 12)} per year). Transactions cannot show whether you still use "
            f"each one, so review them and cancel any you no longer need."
        )
        rows = pd.concat([a["rows"] for a in active])
        out.append(_finding(
            "subscription_review", "Review your active subscriptions", explanation,
            "sub-summary:" + ",".join(sorted(a["name"].lower() for a in active)),
            category_id=active[0]["category_id"], period_start=rows["txn_date"].min(),
            period_end=rows["txn_date"].max(), occurrences=len(active), total_amount=monthly,
            potential_savings=None,
            evidence=[{"label": f"{a['name']} (latest charge)", "amount": round(a["latest"], 2)} for a in active],
        ))
    return out


# ---------- Rule 4: rising non-essential spending ----------
def _non_essential_growth(df: pd.DataFrame, as_of: date) -> list[dict]:
    out: list[dict] = []
    months = pd.period_range(end=pd.Period(as_of, "M") - 1, periods=3, freq="M")
    # Need real history before the first month, otherwise a partial first month looks like growth.
    if df["txn_date"].min() > months[0].start_time + pd.Timedelta(days=7):
        return out
    ne = df[~df["is_essential"]].copy()
    ne["month"] = ne["txn_date"].dt.to_period("M")
    for cat_id, g in ne.groupby("category_id"):
        series = g.groupby("month")["amount"].sum().reindex(months, fill_value=0.0)
        m1, m2, m3 = (float(v) for v in series.to_numpy())
        if m1 > 0 and m1 < m2 < m3 and m3 >= GROWTH_MIN_RATIO * m1:
            name = g["category"].iloc[0]
            explanation = (
                f"{name} is a non-essential category and its monthly spending rose three months in a row: "
                f"{_money(m1)} ({months[0]}), {_money(m2)} ({months[1]}), {_money(m3)} ({months[2]}), "
                f"an increase of {(m3 / m1 - 1) * 100:.0f}%. Going back to the {months[0]} level would "
                f"save about {_money(m3 - m1)} per month."
            )
            out.append(_finding(
                "non_essential_growth", f"Rising spending: {name}", explanation,
                f"growth:{cat_id}:{months[-1]}", category_id=cat_id,
                period_start=months[0].start_time, period_end=months[-1].end_time,
                occurrences=3, total_amount=m1 + m2 + m3, potential_savings=m3 - m1,
                evidence=[{"label": str(m), "amount": round(float(v), 2)} for m, v in series.items()],
            ))
    return out


def detect_waste(transactions: list[dict], categories: dict[str, dict], as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    df = _prepare(transactions, categories, as_of)
    result = {"message": None, "expense_count": int(len(df)), "findings": []}
    if df.empty:
        result["message"] = "No expense transactions yet, so there is nothing to analyse."
        return result

    history_days = (as_of - df["txn_date"].min().date()).days
    if history_days < 30:
        result["message"] = (
            f"You only have {history_days} days of history. Several checks (rising spending, "
            f"subscriptions) need 2-3 months, so results will be limited."
        )

    found = (_repeat_purchases(df, as_of) + _delivery_frequency(df, as_of)
             + _subscriptions(df, as_of) + _non_essential_growth(df, as_of))
    unique = {f["fingerprint"]: f for f in found}
    result["findings"] = sorted(
        unique.values(),
        key=lambda f: -(f["potential_savings"] if f["potential_savings"] is not None else -1.0),
    )
    return result