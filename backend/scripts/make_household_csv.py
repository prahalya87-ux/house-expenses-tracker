import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.datasets import CATEGORIES, household_dataset  # noqa: E402

txns, _, _ = household_dataset()
out = Path(__file__).resolve().parents[2] / "sample-data" / "synthetic_household_transactions.csv"
out.parent.mkdir(exist_ok=True)

with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["date", "type", "category", "amount", "merchant", "description", "recurring"])
    for t in sorted(txns, key=lambda t: t["txn_date"]):
        w.writerow([t["txn_date"], t["kind"], CATEGORIES[t["category_id"]]["name"], t["amount"],
                    t["merchant"], t["description"], "no"])
print("Wrote", out)