import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..services.loaders import load_user_data
from ..services.waste import detect_waste

router = APIRouter(prefix="/waste", tags=["waste"])

Status = Literal["open", "reviewed", "dismissed"]

INSERT_FIELDS = (
    "fingerprint", "finding_type", "title", "explanation", "category_id", "period_start",
    "period_end", "occurrences", "total_amount", "potential_savings", "evidence",
)


class StatusUpdate(BaseModel):
    status: Status


@router.post("/run")
def run_waste_detection(user: CurrentUser = Depends(get_current_user)):
    try:
        txns, categories = load_user_data(user.db)
        result = detect_waste(txns, categories)
        run_id = str(uuid.uuid4())
        # Replace previous OPEN findings; keep ones the user already reviewed or dismissed.
        user.db.table("waste_findings").delete().eq("status", "open").execute()
        rows = [
            {**{k: f[k] for k in INSERT_FIELDS}, "user_id": user.id, "run_id": run_id}
            for f in result["findings"]
        ]
        for i in range(0, len(rows), 100):
            user.db.table("waste_findings").upsert(
                rows[i:i + 100], on_conflict="user_id,fingerprint", ignore_duplicates=True
            ).execute()
    except Exception as e:
        raise HTTPException(502, f"Database or analysis error: {e}")

    return {
        "run_id": run_id,
        "message": result["message"],
        "expense_count": result["expense_count"],
        "finding_count": len(result["findings"]),
    }


@router.get("")
def list_waste(
    status: Status | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        q = user.db.table("waste_findings").select("*")
        if status:
            q = q.eq("status", status)
        rows = q.execute().data
        cats = user.db.table("categories").select("id,name").execute().data
    except Exception as e:
        raise HTTPException(502, f"Database error: {e}")

    names = {c["id"]: c["name"] for c in cats}
    out = [
        {
            **{k: r[k] for k in (
                "id", "status", "finding_type", "title", "explanation", "period_start", "period_end",
                "occurrences", "total_amount", "potential_savings", "evidence", "created_at")},
            "category": names.get(r["category_id"]),
        }
        for r in rows
    ]
    out.sort(key=lambda f: -(f["potential_savings"] if f["potential_savings"] is not None else -1.0))
    return out


@router.patch("/{finding_id}")
def update_status(
    finding_id: uuid.UUID,
    body: StatusUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    res = (
        user.db.table("waste_findings")
        .update({"status": body.status})
        .eq("id", str(finding_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Finding not found")
    return res.data[0]