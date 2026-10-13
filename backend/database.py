"""Small SQLite repository for validated telemetry records."""
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "mw_sense.db"


def connect(database_path: str | Path | None = None) -> sqlite3.Connection:
    path = Path(database_path or os.getenv("MW_SENSE_DB_PATH", DEFAULT_DB_PATH))
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def initialize_database(database_path: str | Path | None = None) -> None:
    with connect(database_path) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL,
                sensor_id TEXT NOT NULL,
                parameter TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                simulation INTEGER NOT NULL CHECK (simulation IN (0, 1)),
                received_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            )
        """)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp DESC)"
        )


def insert_reading(payload: dict[str, Any], database_path: str | Path | None = None) -> dict[str, Any]:
    from datetime import datetime, timezone

    received_at = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        cursor = connection.execute(
            """INSERT INTO telemetry
            (node_id, sensor_id, parameter, timestamp, value, unit, simulation, received_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload["node_id"], payload["sensor_id"], payload["parameter"],
                payload["timestamp"], payload["value"], payload["unit"],
                int(payload["simulation"]), received_at, json.dumps(payload),
            ),
        )
        record_id = cursor.lastrowid
    return {"id": record_id, **payload, "status": "VALID", "received_at": received_at}


def list_readings(
    database_path: str | Path | None = None,
    parameter: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    query = "SELECT id, payload_json, received_at FROM telemetry"
    values: list[Any] = []
    if parameter:
        query += " WHERE parameter = ?"
        values.append(parameter)
    query += " ORDER BY id DESC LIMIT ?"
    values.append(limit)
    with connect(database_path) as connection:
        rows = connection.execute(query, values).fetchall()
    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            **json.loads(row["payload_json"]),
            "status": "VALID",
            "received_at": row["received_at"],
        })
    return results


def clear_readings(database_path: str | Path | None = None) -> int:
    with connect(database_path) as connection:
        cursor = connection.execute("DELETE FROM telemetry")
        return cursor.rowcount
