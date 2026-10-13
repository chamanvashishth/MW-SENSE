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
    """Create the current schema and record the applied migration version."""
    with connect(database_path) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
        """)
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
                payload_json TEXT NOT NULL,
                request_id TEXT
            )
        """)
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(telemetry)")}
        if "request_id" not in columns:
            connection.execute("ALTER TABLE telemetry ADD COLUMN request_id TEXT")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp DESC)"
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_request_id ON telemetry(request_id) WHERE request_id IS NOT NULL"
        )
        from datetime import datetime, timezone
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (1, datetime.now(timezone.utc).isoformat()),
        )


def insert_reading(payload: dict[str, Any], database_path: str | Path | None = None) -> dict[str, Any]:
    from datetime import datetime, timezone

    received_at = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        request_id = payload.get("request_id")
        if request_id:
            existing = connection.execute(
                "SELECT id, payload_json, received_at FROM telemetry WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if existing:
                return {
                    "id": existing["id"], **json.loads(existing["payload_json"]),
                    "status": "VALID", "received_at": existing["received_at"],
                }
        cursor = connection.execute(
            """INSERT INTO telemetry
            (node_id, sensor_id, parameter, timestamp, value, unit, simulation, received_at, payload_json, request_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload["node_id"], payload["sensor_id"], payload["parameter"],
                payload["timestamp"], payload["value"], payload["unit"],
                int(payload["simulation"]), received_at, json.dumps(payload), request_id,
            ),
        )
        record_id = cursor.lastrowid
    return {"id": record_id, **payload, "status": "VALID", "received_at": received_at}


def list_readings(
    database_path: str | Path | None = None,
    parameter: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    query = "SELECT id, payload_json, received_at FROM telemetry"
    values: list[Any] = []
    if parameter:
        query += " WHERE parameter = ?"
        values.append(parameter)
    with connect(database_path) as connection:
        count_query = "SELECT COUNT(*) FROM telemetry" + (" WHERE parameter = ?" if parameter else "")
        total = connection.execute(count_query, values).fetchone()[0]
        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        rows = connection.execute(query, [*values, limit, offset]).fetchall()
    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            **json.loads(row["payload_json"]),
            "status": "VALID",
            "received_at": row["received_at"],
        })
    return results, total


def clear_readings(database_path: str | Path | None = None) -> int:
    with connect(database_path) as connection:
        cursor = connection.execute("DELETE FROM telemetry")
        return cursor.rowcount
