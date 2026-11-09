from supabase import Client


def fetch_all(db: Client, table: str, select: str = "*", page: int = 1000) -> list[dict]:
    """Fetch every row (Supabase returns at most 1000 per request)."""
    rows: list[dict] = []
    start = 0
    while True:
        res = db.table(table).select(select).order("id").range(start, start + page - 1).execute()
        rows.extend(res.data)
        if len(res.data) < page:
            break
        start += page
    return rows