import re

from fastapi import APIRouter, Depends, HTTPException

from ..auth import CurrentUser, get_current_user
from ..services.behaviour import analyse_behaviour, compare_months
from ..services.loaders import load_user_data

router = APIRouter(prefix="/analysis", tags=["analysis"])

SECTION_TYPES = ("daily", "weekly", "monthly", "clusters", "habit_change", "income_expense")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _stored(db) -> dict:
    rows = db.table("spending_analysis").select("analysis_type,result,created_at").execute().data
    return {
        "computed_at": max((r["created_at"] for r in rows), default=None),
        "message": None,
        "sections": {r["analysis_type"]: r["result"] for r in rows},
    }


@router.get("")
def get_analysis(user: CurrentUser = Depends(get_current_user)):
    try:
        return _stored(user.db)
    except Exception as e:
        raise HTTPException(502, f"Database error: {e}")


@router.post("/run")
def run_analysis(user: CurrentUser = Depends(get_current_user)):
    try:
        txns, categories = load_user_data(user.db)
        out = analyse_behaviour(txns, categories)
        user.db.table("spending_analysis").delete().in_("analysis_type", list(SECTION_TYPES)).execute()
        rows = [
            {
                "user_id": user.id, "analysis_type": k,
                "period_start": v["period_start"], "period_end": v["period_end"], "result": v["result"],
            }
            for k, v in out["sections"].items()
        ]
        if rows:
            user.db.table("spending_analysis").insert(rows).execute()
        stored = _stored(user.db)
        stored["message"] = out["message"]
        return stored
    except Exception as e:
        raise HTTPException(502, f"Database or analysis error: {e}")


@router.get("/compare")
def compare(month_a: str, month_b: str, user: CurrentUser = Depends(get_current_user)):
    if not MONTH_RE.match(month_a) or not MONTH_RE.match(month_b):
        raise HTTPException(422, "Months must look like 2026-10")
    try:
        txns, categories = load_user_data(user.db)
    except Exception as e:
        raise HTTPException(502, f"Database error: {e}")
    return compare_months(txns, categories, month_a, month_b)