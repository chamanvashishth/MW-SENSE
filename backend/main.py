"""MW-SENSE telemetry API."""
import logging
import os
from time import perf_counter
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from . import database
from .schemas import SENSOR_RULES, TelemetryIn, TelemetryList, TelemetryOut


logger = logging.getLogger("mw_sense.api")

def retention_days() -> int:
    try:
        value = int(os.getenv("MW_SENSE_RETENTION_DAYS", "0"))
    except ValueError as exc:
        raise RuntimeError("MW_SENSE_RETENTION_DAYS must be a whole number.") from exc
    if value < 0:
        raise RuntimeError("MW_SENSE_RETENTION_DAYS cannot be negative.")
    return value


def require_api_token(authorization: str | None = Header(default=None)):
    """Require a bearer token when MW_SENSE_API_TOKEN is configured."""
    expected = os.getenv("MW_SENSE_API_TOKEN")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="A valid API bearer token is required.")

DB_PATH = Path(os.getenv("MW_SENSE_DB_PATH", database.DEFAULT_DB_PATH))


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize_database(DB_PATH)
    removed = database.prune_expired_readings(DB_PATH, retention_days())
    if removed:
        logger.info("startup_retention_cleanup removed=%s", removed)
    yield


app = FastAPI(
    title="MW-SENSE Telemetry API",
    description="Validated telemetry ingestion and retrieval for the MW-SENSE virtual lab.",
    version="1.0.0",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "MW_SENSE_ALLOWED_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "mw-sense-api"}


@app.get("/health/diagnostics", dependencies=[Depends(require_api_token)])
def health_diagnostics():
    diagnostics = database.get_database_diagnostics(DB_PATH)
    diagnostics["retention_days"] = retention_days()
    diagnostics["status"] = "ok" if diagnostics["integrity"] == "ok" else "degraded"
    return diagnostics


@app.get("/sensors", dependencies=[Depends(require_api_token)])
def sensors():
    return {
        key: {
            "node_id": rule["node"],
            "sensor_id": rule["sensor"],
            "unit": rule["unit"],
            "minimum": rule["min"],
            "maximum": rule["max"],
        }
        for key, rule in SENSOR_RULES.items()
    }


@app.get("/telemetry", response_model=TelemetryList, dependencies=[Depends(require_api_token)])
def get_telemetry(
    parameter: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
):
    if parameter is not None and parameter not in SENSOR_RULES:
        raise HTTPException(status_code=422, detail="Unknown telemetry parameter.")
    items, total = database.list_readings(DB_PATH, parameter, limit, offset)
    next_offset = offset + len(items) if offset + len(items) < total else None
    return {"items": items, "count": total, "limit": limit, "offset": offset, "next_offset": next_offset}


@app.post("/telemetry", response_model=TelemetryOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_token)])
def post_telemetry(payload: TelemetryIn):
    record = database.insert_reading(payload.model_dump(), DB_PATH)
    removed = database.prune_expired_readings(DB_PATH, retention_days())
    if removed:
        logger.info("ingest_retention_cleanup removed=%s", removed)
    return record


@app.delete("/telemetry", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_token)])
def delete_telemetry():
    database.clear_readings(DB_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
