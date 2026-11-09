from fastapi import APIRouter, Depends

from ..auth import CurrentUser, get_current_user

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    profile = user.db.table("profiles").select("*").eq("id", user.id).single().execute()
    categories = user.db.table("categories").select("id", count="exact").execute()
    return {
        "id": user.id,
        "email": user.email,
        "profile": profile.data,
        "category_count": categories.count,
    }