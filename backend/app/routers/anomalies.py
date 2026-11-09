import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..services.anomaly import SEVERITY_RANK, detect_anomalies
from ..services.data import fetch_all

router = APIRouter(prefix="/anomalies", tags=["anomalies"])

Status = Literal["open", "reviewed", "dismissed"]

INSERT_FIELDS = (
    "transaction_id", "anomaly_score", "severity", "reason_type",
    "baseline_amount", "difference_amount", "reason", "detection_method",
)


class StatusUpdate(BaseModel):
    status: Status


@router.post("/run")
def run_detection(user: CurrentUser = Depends(get_current_user)):
    try:
        txns = fetch_all(
            user.db, "transactions",
            "id,category_id,kind,amount,txn_date,merchant,description,is_recurring",
        )
        cats = fetch_all(user.db, "categories", "id,name")
        result = detect_anomalies(txns, {c["id"]: c["name"] for c in cats})

        run_id = str(uuid.uuid4())
        # Replace previous OPEN findings; keep ones the user already reviewed or dismissed.
        user.db.table("anomaly_detections").delete().eq("status", "open").execute()
        rows = [
            {**{k: a[k] for k in INSERT_FIELDS}, "user_id": user.id, "run_id": run_id}
            for a in result["anomalies"]
        ]
        for i in range(0, len(rows), 200):
            user.db.table("anomaly_detections").upsert(
                rows[i:i + 200],
                on_conflict="user_id,transaction_id,reason_type",
                ignore_duplicates=True,
            ).execute()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Database or analysis error: {e}")

    return {
        "run_id": run_id,
        "model_ran": result["model_ran"],
        "message": result["message"],
        "expense_count": result["expense_count"],
        "detected_count": len(result["anomalies"]),
    }


@router.get("")
def list_anomalies(
    status: Status | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        q = user.db.table("anomaly_detections").select("*").order("detected_at", desc=True)
        if status:
            q = q.eq("status", status)
        rows = q.execute().data

        txn_map: dict[str, dict] = {}
        ids = list({r["transaction_id"] for r in rows})
        for i in range(0, len(ids), 100):
            res = (
                user.db.table("transactions")
                .select("id,txn_date,amount,merchant,description,category_id")
                .in_("id", ids[i:i + 100])
                .execute()
            )
            txn_map.update({t["id"]: t for t in res.data})
        cats = {c["id"]: c["name"] for c in fetch_all(user.db, "categories", "id,name")}
    except Exception as e:
        raise HTTPException(502, f"Database error: {e}")

    out = []
    for r in rows:
        t = txn_map.get(r["transaction_id"])
        out.append({
            **{k: r[k] for k in (
                "id", "status", "severity", "reason_type", "detection_method", "anomaly_score",
                "baseline_amount", "difference_amount", "reason", "detected_at")},
            "transaction": None if t is None else {
                "id": t["id"], "txn_date": t["txn_date"], "amount": t["amount"],
                "merchant": t["merchant"], "description": t["description"],
                "category": cats.get(t["category_id"], "Unknown"),
            },
        })
    out.sort(key=lambda a: (-SEVERITY_RANK[a["severity"]], -(a["anomaly_score"] or 0.0)))
    return out


@router.patch("/{anomaly_id}")
def update_status(
    anomaly_id: uuid.UUID,
    body: StatusUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    res = (
        user.db.table("anomaly_detections")
        .update({"status": body.status})
        .eq("id", str(anomaly_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Anomaly not found")
    return res.data[0]