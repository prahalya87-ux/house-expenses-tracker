import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.test_anomaly import CATS, build_dataset  # noqa: E402

out = Path(__file__).resolve().parents[2] / "sample-data" / "synthetic_test_transactions.csv"
out.parent.mkdir(exist_ok=True)

with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["date", "type", "category", "amount", "merchant", "description", "recurring"])
    for t in sorted(build_dataset(), key=lambda t: t["txn_date"]):
        w.writerow([t["txn_date"], t["kind"], CATS[t["category_id"]], t["amount"],
                    t["merchant"] or "", t["description"] or "", "no"])
print("Wrote", out)