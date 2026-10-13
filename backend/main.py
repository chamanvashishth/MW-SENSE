"""MW-SENSE telemetry API."""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from . import database
from .schemas import SENSOR_RULES, TelemetryIn, TelemetryList, TelemetryOut


def require_api_token(authorization: str | None = Header(default=None)):
    """Require a bearer token when MW_SENSE_API_TOKEN is configured."""
    expected = os.getenv("MW_SENSE_API_TOKEN")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="A valid API bearer token is required.")

DB_PATH = Path(os.getenv("MW_SENSE_DB_PATH", database.DEFAULT_DB_PATH))


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize_database(DB_PATH)
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


@app.get("/telemetry", response_model=TelemetryList, dependencies=[__import__("fastapi").Depends(require_api_token)])
def get_telemetry(
    parameter: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
):
    if parameter is not None and parameter not in SENSOR_RULES:
        raise HTTPException(status_code=422, detail="Unknown telemetry parameter.")
    items = database.list_readings(DB_PATH, parameter, limit)
    return {"items": items, "count": len(items), "limit": limit}


@app.post("/telemetry", response_model=TelemetryOut, status_code=status.HTTP_201_CREATED, dependencies=[__import__("fastapi").Depends(require_api_token)])
def post_telemetry(payload: TelemetryIn):
    return database.insert_reading(payload.model_dump(), DB_PATH)


@app.delete("/telemetry", status_code=status.HTTP_204_NO_CONTENT, dependencies=[__import__("fastapi").Depends(require_api_token)])
def delete_telemetry():
    database.clear_readings(DB_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
