from supabase import Client

from .data import fetch_all


def load_user_data(db: Client) -> tuple[list[dict], dict[str, dict]]:
    """All of the signed-in user's transactions plus category info (RLS-filtered)."""
    txns = fetch_all(
        db, "transactions",
        "id,category_id,kind,amount,txn_date,merchant,description,is_recurring",
    )
    cats = fetch_all(db, "categories", "id,name,is_essential")
    categories = {c["id"]: {"name": c["name"], "is_essential": c["is_essential"]} for c in cats}
    return txns, categories