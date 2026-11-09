from datetime import date, timedelta

AS_OF = date(2026, 11, 5)

CATEGORIES = {
    "groceries": {"name": "Groceries", "is_essential": True},
    "rent": {"name": "Rent", "is_essential": True},
    "electricity": {"name": "Electricity", "is_essential": True},
    "delivery": {"name": "Food Delivery", "is_essential": False},
    "subscriptions": {"name": "Subscriptions", "is_essential": False},
    "entertainment": {"name": "Entertainment", "is_essential": False},
    "salary": {"name": "Salary", "is_essential": False},
}


def household_dataset() -> tuple[list[dict], dict[str, dict], date]:
    transactions: list[dict] = []
    sequence = 0

    def add(
        category_id: str,
        amount: float,
        txn_date: date,
        *,
        kind: str = "expense",
        merchant: str | None = None,
        description: str | None = None,
        recurring: bool = False,
    ) -> None:
        nonlocal sequence
        sequence += 1
        transactions.append({
            "id": f"household-{sequence}",
            "category_id": category_id,
            "kind": kind,
            "amount": amount,
            "txn_date": txn_date.isoformat(),
            "merchant": merchant,
            "description": description,
            "is_recurring": recurring,
        })

    for month in range(7, 12):
        first = date(2026, month, 1)
        add("salary", 60000.0, first, kind="income", merchant="Employer")
        add("rent", 15000.0, first, merchant="Landlord", recurring=True)
        add("electricity", 1800.0, date(2026, month, 5), merchant="Electricity Board", recurring=True)

        netflix = 649.0 if month == 11 else 499.0
        for name, amount in (
            ("Netflix", netflix),
            ("Spotify", 119.0),
            ("Prime", 299.0),
            ("Cloud Storage", 130.0),
        ):
            add("subscriptions", amount, first, merchant=name, recurring=True)

    grocery_day = date(2026, 7, 2)
    while grocery_day <= AS_OF:
        add("groceries", 2100.0, grocery_day, merchant="Local Grocer")
        grocery_day += timedelta(days=7)

    for month, amount in ((7, 500.0), (8, 700.0), (9, 900.0), (10, 1200.0)):
        add("entertainment", amount, date(2026, month, 18), merchant="Cinema and games")

    for month in (7, 8, 9):
        for day in (9, 19, 29):
            add("delivery", 500.0, date(2026, month, day), merchant="Food delivery")

    for day in (2, 5, 8, 11, 14, 17, 20, 23, 26):
        add("delivery", 500.0, date(2026, 10, day), merchant="Food delivery")

    for day in (3, 4, 5, 6):
        add("groceries", 180.0, date(2026, 10, day), merchant="Cafe", description="cold coffee")

    return transactions, CATEGORIES, AS_OF