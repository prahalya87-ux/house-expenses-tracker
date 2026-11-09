import json

from app.services.behaviour import analyse_behaviour, compare_months
from tests.datasets import AS_OF, CATEGORIES, household_dataset


def _sections():
    txns, cats, as_of = household_dataset()
    out = analyse_behaviour(txns, cats, as_of)
    return txns, {k: v["result"] for k, v in out["sections"].items()}


def _expense_total(txns, prefix=""):
    return round(sum(t["amount"] for t in txns if t["kind"] == "expense" and t["txn_date"].startswith(prefix)), 2)


def test_all_sections_present_and_json_safe():
    txns, s = _sections()
    assert set(s) == {"daily", "weekly", "monthly", "income_expense", "habit_change", "clusters"}
    json.dumps(s)


def test_monthly_numbers_match_manual_calculation():
    txns, s = _sections()
    months = {m["month"]: m for m in s["monthly"]["months"]}
    assert months["2026-10"]["expenses"] == _expense_total(txns, "2026-10")
    assert months["2026-10"]["income"] == 60000.0
    assert months["2026-10"]["savings"] == round(60000 - _expense_total(txns, "2026-10"), 2)
    assert months["2026-11"]["is_partial"] is True and months["2026-10"]["is_partial"] is False
    sep = months["2026-09"]["expenses"]
    assert months["2026-10"]["mom_change_pct"] == round((months["2026-10"]["expenses"] - sep) / sep * 100, 1)


def test_totals_consistent_across_views():
    txns, s = _sections()
    total = _expense_total(txns)
    assert abs(sum(w["total"] for w in s["weekly"]["weekly_totals"]) - total) < 0.5
    assert abs(sum(c["total"] for c in s["monthly"]["category_totals"]) - total) < 0.5
    assert abs(sum(c["share_pct"] for c in s["monthly"]["category_totals"]) - 100) < 0.5
    assert s["income_expense"]["total_expense"] == total
    assert s["income_expense"]["total_income"] == 300000.0


def test_daily_and_weekday():
    txns, s = _sections()
    d = s["daily"]
    assert d["highest_days"][0]["total"] >= d["highest_days"][-1]["total"]
    assert d["days_with_spending"] <= d["days_in_range"]
    assert len(s["weekly"]["weekday_average"]) == 7
    # average over all calendar days equals total / days
    assert abs(d["average_daily"] - _expense_total(txns) / d["days_in_range"]) < 0.01


def test_habit_change_entertainment():
    _, s = _sections()
    h = s["habit_change"]
    assert h["available"] and h["latest_month"] == "2026-10"
    assert h["baseline_months"] == ["2026-07", "2026-08", "2026-09"]
    ent = [c for c in h["categories"] if c["category"] == "Entertainment"][0]
    assert ent["latest"] == 1200.0 and ent["baseline_avg"] == 700.0 and ent["change_pct"] == 71.4


def test_kmeans_clusters():
    txns, s = _sections()
    c = s["clusters"]
    assert c["available"] and 2 <= c["k"] <= 4 and -1 <= c["silhouette"] <= 1
    assert sum(x["days"] for x in c["clusters"]) == c["spending_days"]
    assert abs(sum(x["share_of_spend_pct"] for x in c["clusters"]) - 100) < 0.5
    spends = [x["avg_spend"] for x in c["clusters"]]
    assert spends == sorted(spends)  # labelled low -> high


def test_clusters_unavailable_with_little_data():
    txns, cats, _ = household_dataset()
    few = [t for t in txns if t["txn_date"] >= "2026-10-15"]
    out = analyse_behaviour(few, cats, AS_OF)
    assert out["sections"]["clusters"]["result"]["available"] is False
    assert out["sections"]["habit_change"]["result"]["available"] is False


def test_compare_months():
    txns, cats, _ = household_dataset()
    r = compare_months(txns, cats, "2026-09", "2026-10")
    assert r["total_a"] == _expense_total(txns, "2026-09") and r["total_b"] == _expense_total(txns, "2026-10")
    assert r["total_diff"] == round(r["total_b"] - r["total_a"], 2)
    ent = [c for c in r["categories"] if c["category"] == "Entertainment"][0]
    assert ent["a"] == 900.0 and ent["b"] == 1200.0 and ent["diff"] == 300.0
    r2 = compare_months(txns, cats, "2025-01", "2026-10")
    assert r2["total_a"] == 0.0 and r2["total_pct"] is None


def test_empty():
    out = analyse_behaviour([], CATEGORIES, AS_OF)
    assert out["sections"] == {} and out["message"]