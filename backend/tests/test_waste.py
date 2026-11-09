import json

from app.services.waste import detect_waste
from tests.datasets import AS_OF, CATEGORIES, household_dataset


def _run():
    txns, cats, as_of = household_dataset()
    return detect_waste(txns, cats, as_of)


def _by_type(res, ftype):
    return [f for f in res["findings"] if f["finding_type"] == ftype]


def test_food_delivery_flagged_only_for_heavy_month():
    res = _run()
    deliv = _by_type(res, "delivery_frequency")
    assert [f["fingerprint"] for f in deliv] == ["delivery:2026-10"]
    f = deliv[0]
    assert f["occurrences"] == 9 and f["total_amount"] == 4500.0
    assert f["potential_savings"] == 1500.0  # one third of 4500


def test_repeat_purchase_found_and_weekly_groceries_not():
    res = _run()
    rep = _by_type(res, "repeat_purchase")
    assert len(rep) == 1
    assert "cold coffee" in rep[0]["title"] and rep[0]["occurrences"] == 4
    assert rep[0]["total_amount"] == 720.0
    assert rep[0]["potential_savings"] == 540.0  # 3 of 4 purchases
    assert not any("grocer" in f["title"].lower() for f in res["findings"])


def test_subscriptions_summary_and_price_increase():
    res = _run()
    subs = _by_type(res, "subscription_review")
    titles = [f["title"] for f in subs]
    assert "Review your active subscriptions" in titles
    inc = [f for f in subs if "price increase" in f["title"]]
    assert len(inc) == 1 and "Netflix" in inc[0]["title"]
    assert inc[0]["potential_savings"] == 150.0
    summary = [f for f in subs if f["title"].startswith("Review")][0]
    assert summary["potential_savings"] is None  # no claimed saving for a pure review
    assert summary["total_amount"] == 649 + 119 + 299 + 130


def test_non_essential_growth():
    res = _run()
    g = _by_type(res, "non_essential_growth")
    assert len(g) == 1 and "Entertainment" in g[0]["title"]
    assert g[0]["potential_savings"] == 500.0  # 1200 - 700


def test_essentials_never_flagged():
    res = _run()
    text = " ".join(f["title"] + f["explanation"] for f in res["findings"]).lower()
    for word in ("rent", "electricity", "landlord"):
        assert word not in text


def test_findings_complete_and_serialisable():
    res = _run()
    assert res["findings"]
    fps = [f["fingerprint"] for f in res["findings"]]
    assert len(fps) == len(set(fps))
    for f in res["findings"]:
        assert f["explanation"] and f["evidence"]
        assert f["period_start"] <= f["period_end"]
    json.dumps(res)


def test_limited_history_message():
    txns, cats, _ = household_dataset()
    few = [t for t in txns if t["txn_date"] >= "2026-10-20"]
    res = detect_waste(few, cats, AS_OF)
    assert res["message"] and "days of history" in res["message"]


def test_empty():
    assert detect_waste([], CATEGORIES, AS_OF)["findings"] == []