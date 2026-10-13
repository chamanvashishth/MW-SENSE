"""MW-SENSE telemetry API."""
import logging
import os
from time import perf_counter
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from . import database
from .schemas import (SENSOR_RULES, DeviceHeartbeat, DeviceOut, DeviceRegistration, TelemetryIn, TelemetryList, TelemetryOut)


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


@app.post("/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_token)])
def register_device(payload: DeviceRegistration):
    supported_nodes = {rule["node"] for rule in SENSOR_RULES.values()}
    if payload.node_id not in supported_nodes:
        raise HTTPException(status_code=422, detail="Node ID is not part of the configured sensor catalogue.")
    return database.register_device(payload.node_id, payload.label, DB_PATH)


@app.post("/devices/{node_id}/credentials", dependencies=[Depends(require_api_token)])
def rotate_device_credential(node_id: str):
    """Issue a new MQTT credential; the plaintext value is returned only once."""
    token = database.provision_device_credential(node_id, DB_PATH)
    if not token:
        raise HTTPException(status_code=404, detail="Device node is not registered.")
    logger.info("device_credential_rotated node_id=%s", node_id)
    return {
        "node_id": node_id,
        "credential": token,
        "note": "Copy this value into the node's private firmware config. It will not be shown again.",
    }


@app.delete("/devices/{node_id}/credentials", dependencies=[Depends(require_api_token)])
def revoke_device_credential(node_id: str):
    if not database.revoke_device_credential(node_id, DB_PATH):
        raise HTTPException(status_code=404, detail="Device node is not registered.")
    logger.info("device_credential_revoked node_id=%s", node_id)
    return {"node_id": node_id, "credential_active": False}


@app.get("/devices/{node_id}/credential-events", dependencies=[Depends(require_api_token)])
def get_device_credential_events(node_id: str):
    if not any(device["node_id"] == node_id for device in database.list_devices(DB_PATH)):
        raise HTTPException(status_code=404, detail="Device node is not registered.")
    return database.list_device_credential_events(node_id, DB_PATH)


@app.get("/devices", response_model=list[DeviceOut], dependencies=[Depends(require_api_token)])
def get_devices():
    from datetime import datetime, timedelta, timezone

    try:
        offline_after = int(os.getenv("MW_SENSE_DEVICE_OFFLINE_SECONDS", "120"))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="MW_SENSE_DEVICE_OFFLINE_SECONDS must be a whole number.") from exc
    if offline_after < 1:
        raise HTTPException(status_code=500, detail="MW_SENSE_DEVICE_OFFLINE_SECONDS must be positive.")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=offline_after)
    devices = database.list_devices(DB_PATH)
    for device in devices:
        device["credential_active"] = bool(device.get("credential_hash"))
        seen = device["last_seen_at"]
        if seen and datetime.fromisoformat(seen.replace("Z", "+00:00")) < cutoff:
            device["last_status"] = "offline"
    return devices


@app.post("/devices/{node_id}/heartbeat", response_model=DeviceOut, dependencies=[Depends(require_api_token)])
def device_heartbeat(node_id: str, payload: DeviceHeartbeat):
    device = database.update_device_heartbeat(node_id, payload.firmware_version, DB_PATH)
    if not device:
        raise HTTPException(status_code=404, detail="Device node is not registered.")
    return device


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
    try:
        record = database.insert_reading(payload.model_dump(), DB_PATH)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    removed = database.prune_expired_readings(DB_PATH, retention_days())
    if removed:
        logger.info("ingest_retention_cleanup removed=%s", removed)
    return record


@app.delete("/telemetry", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_token)])
def delete_telemetry():
    database.clear_readings(DB_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
