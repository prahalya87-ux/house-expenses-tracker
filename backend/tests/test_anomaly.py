"""Tests for the anomaly engine.

The dataset below is SYNTHETIC test data generated in code. It is never
written to a real user's account.
"""
from datetime import date, timedelta

import numpy as np

from app.services.anomaly import MIN_EXPENSES_FOR_MODEL, detect_anomalies

CATS = {
    "c-groc": "Groceries",
    "c-elec": "Electricity",
    "c-rent": "Rent",
    "c-deliv": "Food Delivery",
    "c-sal": "Salary",
}


def _t(tid, cat, amount, d, merchant="Shop", desc=None, kind="expense"):
    return {
        "id": tid, "category_id": cat, "kind": kind, "amount": amount,
        "txn_date": d.isoformat(), "merchant": merchant, "description": desc,
        "is_recurring": False,
    }


def build_dataset():
    rng = np.random.RandomState(0)
    txns = []
    start = date(2026, 1, 1)

    for w in range(43):  # weekly groceries
        d = start + timedelta(days=7 * w)
        txns.append(_t(f"groc{w}", "c-groc", float(rng.randint(1800, 2300)), d, "Local Mart"))
    for m in range(1, 11):  # monthly rent and electricity
        txns.append(_t(f"rent{m}", "c-rent", 12000.0, date(2026, m, 1), "Landlord"))
        amt = 4300.0 if m == 10 else float(rng.randint(1500, 1700))
        tid = "spike_elec" if m == 10 else f"elec{m}"
        txns.append(_t(tid, "c-elec", amt, date(2026, m, 5), "Utility board"))
    d = start
    i = 0
    while d < date(2026, 10, 25):  # food delivery every 4-6 days
        txns.append(_t(f"deliv{i}", "c-deliv", float(rng.randint(450, 650)), d, "Swiggy"))
        d += timedelta(days=int(rng.randint(4, 7)))
        i += 1

    # injected problems
    txns.append(_t("spike_grocery", "c-groc", 9500.0, date(2026, 6, 17), "Local Mart"))
    for k, day in enumerate([10, 10, 11, 11, 12]):
        txns.append(_t(f"burst{k}", "c-deliv", float(rng.randint(450, 650)) + k, date(2026, 8, day), "Zomato"))
    txns.append(_t("dup_a", "c-deliv", 799.0, date(2026, 9, 20), "Dominos", "Order 1"))
    txns.append(_t("dup_b", "c-deliv", 799.0, date(2026, 9, 21), "Dominos", "Order 1"))
    txns.append(_t("salary", "c-sal", 90000.0, date(2026, 10, 1), "Employer", kind="income"))
    return txns


def test_model_runs_and_finds_injected_problems():
    txns = build_dataset()
    res = detect_anomalies(txns, CATS)
    assert res["model_ran"] is True
    by_id = {}
    for a in res["anomalies"]:
        by_id.setdefault(a["transaction_id"], []).append(a)

    assert "spike_grocery" in by_id
    assert "spike_elec" in by_id
    assert any(a["reason_type"] == "duplicate" for a in by_id.get("dup_b", []))
    assert any(
        a["reason_type"] == "frequency"
        for k, v in by_id.items() if k.startswith("burst") for a in v
    )


def test_expensive_but_normal_not_flagged():
    res = detect_anomalies(build_dataset(), CATS)
    flagged = {a["transaction_id"] for a in res["anomalies"]}
    assert not any(t.startswith("rent") for t in flagged), "constant rent must not be flagged"
    assert "salary" not in flagged, "income must be ignored"


def test_model_flags_stay_a_small_share():
    txns = build_dataset()
    res = detect_anomalies(txns, CATS)
    model_flags = [a for a in res["anomalies"] if a["detection_method"] == "isolation_forest"]
    assert len(model_flags) <= 0.10 * len(txns)


def test_output_fields_valid():
    res = detect_anomalies(build_dataset(), CATS)
    assert res["anomalies"]
    for a in res["anomalies"]:
        assert a["severity"] in {"low", "medium", "high"}
        assert a["reason"]
        if a["detection_method"] == "isolation_forest":
            assert 0 < a["anomaly_score"] < 1.5
        else:
            assert a["anomaly_score"] is None


def test_insufficient_data_skips_model():
    txns = build_dataset()[:10]
    assert len(txns) < MIN_EXPENSES_FOR_MODEL
    res = detect_anomalies(txns, CATS)
    assert res["model_ran"] is False
    assert "at least" in res["message"]
    assert all(a["detection_method"] == "rule" for a in res["anomalies"])


def test_no_transactions():
    res = detect_anomalies([], CATS)
    assert res["anomalies"] == [] and res["model_ran"] is False


def test_deterministic():
    a = detect_anomalies(build_dataset(), CATS)["anomalies"]
    b = detect_anomalies(build_dataset(), CATS)["anomalies"]
    assert a == b