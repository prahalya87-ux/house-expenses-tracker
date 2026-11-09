from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import analysis, anomalies, system, waste

app = FastAPI(title="SmartSpend AI API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api")
app.include_router(anomalies.router, prefix="/api")
app.include_router(waste.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")