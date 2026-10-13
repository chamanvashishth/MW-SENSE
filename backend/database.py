"""Small SQLite repository for validated telemetry records."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
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
        connection.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                node_id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                firmware_version TEXT,
                registered_at TEXT NOT NULL,
                last_seen_at TEXT,
                last_status TEXT NOT NULL DEFAULT 'registered'
                    CHECK (last_status IN ('registered', 'online', 'offline'))
            )
        """)
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (1, datetime.now(timezone.utc).isoformat()),
        )
        device_columns = {row["name"] for row in connection.execute("PRAGMA table_info(devices)")}
        if "credential_hash" not in device_columns:
            connection.execute("ALTER TABLE devices ADD COLUMN credential_hash TEXT")
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (2, datetime.now(timezone.utc).isoformat()),
        )
        connection.execute("""
            CREATE TABLE IF NOT EXISTS device_credential_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL,
                event TEXT NOT NULL CHECK (event IN ('issued', 'rotated', 'revoked')),
                created_at TEXT NOT NULL,
                FOREIGN KEY(node_id) REFERENCES devices(node_id)
            )
        """)
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (3, datetime.now(timezone.utc).isoformat()),
        )
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (4, datetime.now(timezone.utc).isoformat()),
        )
        device_columns = {row["name"] for row in connection.execute("PRAGMA table_info(devices)")}
        runtime_columns = {
            "uptime_seconds": "INTEGER",
            "queue_depth": "INTEGER",
            "retry_count": "INTEGER",
            "wifi_rssi_dbm": "INTEGER",
            "mqtt_connected": "INTEGER",
        }
        for column, column_type in runtime_columns.items():
            if column not in device_columns:
                connection.execute(f"ALTER TABLE devices ADD COLUMN {column} {column_type}")
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (5, datetime.now(timezone.utc).isoformat()),
        )
        device_columns = {row["name"] for row in connection.execute("PRAGMA table_info(devices)")}
        lifecycle_columns = {
            "boot_count": "INTEGER",
            "oldest_pending_timestamp": "TEXT",
        }
        for column, column_type in lifecycle_columns.items():
            if column not in device_columns:
                connection.execute(f"ALTER TABLE devices ADD COLUMN {column} {column_type}")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS device_lifecycle_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL,
                event TEXT NOT NULL CHECK (event IN ('boot', 'online', 'offline')),
                boot_count INTEGER,
                created_at TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(node_id) REFERENCES devices(node_id)
            )
        """)
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (6, datetime.now(timezone.utc).isoformat()),
        )


def insert_reading(payload: dict[str, Any], database_path: str | Path | None = None) -> dict[str, Any]:
    from datetime import datetime, timezone

    received_at = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        request_id = payload.get("request_id")
        if not payload.get("simulation", True):
            device = connection.execute(
                "SELECT node_id FROM devices WHERE node_id = ?",
                (payload["node_id"],),
            ).fetchone()
            if not device:
                raise ValueError("Physical telemetry requires a registered device node.")
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
        if not payload.get("simulation", True):
            connection.execute(
                """UPDATE devices SET last_seen_at = ?, last_status = 'online',
                firmware_version = COALESCE(?, firmware_version) WHERE node_id = ?""",
                (received_at, payload.get("firmware_version"), payload["node_id"]),
            )
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



def prune_expired_readings(
    database_path: str | Path | None = None,
    retention_days: int = 0,
) -> int:
    """Remove readings older than the configured age; zero disables retention cleanup."""
    if retention_days < 0:
        raise ValueError("retention_days cannot be negative")
    if retention_days == 0:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    with connect(database_path) as connection:
        cursor = connection.execute(
            "DELETE FROM telemetry WHERE received_at < ?",
            (cutoff,),
        )
        return cursor.rowcount


def get_database_diagnostics(database_path: str | Path | None = None) -> dict[str, Any]:
    """Return operational metrics without exposing reading contents or credentials."""
    path = Path(database_path or os.getenv("MW_SENSE_DB_PATH", DEFAULT_DB_PATH))
    with connect(path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        total = connection.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
        simulated = connection.execute(
            "SELECT COUNT(*) FROM telemetry WHERE simulation = 1"
        ).fetchone()[0]
        physical = total - simulated
        registered_devices = connection.execute(
            "SELECT COUNT(*) FROM devices"
        ).fetchone()[0]
        latest = connection.execute(
            "SELECT MAX(received_at) FROM telemetry"
        ).fetchone()[0]
        version = connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0]
    return {
        "database": path.name,
        "database_exists": path.is_file(),
        "database_size_bytes": path.stat().st_size if path.is_file() else 0,
        "integrity": integrity,
        "schema_version": version,
        "telemetry_records": total,
        "simulated_records": simulated,
        "physical_records": physical,
        "registered_devices": registered_devices,
        "latest_received_at": latest,
    }



def register_device(node_id: str, label: str, database_path: str | Path | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        connection.execute(
            """INSERT INTO devices (node_id, label, registered_at)
            VALUES (?, ?, ?)
            ON CONFLICT(node_id) DO UPDATE SET label = excluded.label""",
            (node_id, label, now),
        )
        row = connection.execute("SELECT * FROM devices WHERE node_id = ?", (node_id,)).fetchone()
    return dict(row)


def update_device_heartbeat(
    node_id: str,
    firmware_version: str | None = None,
    database_path: str | Path | None = None,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc).isoformat()
    runtime = runtime or {}
    with connect(database_path) as connection:
        previous = connection.execute(
            "SELECT boot_count, last_status FROM devices WHERE node_id = ?",
            (node_id,),
        ).fetchone()
        if not previous:
            return None
        reported_boot = runtime.get("boot_count")
        previous_boot = previous["boot_count"]
        if reported_boot is not None and reported_boot != previous_boot:
            event = "boot" if previous_boot is None or reported_boot > previous_boot else "online"
            connection.execute(
                """INSERT INTO device_lifecycle_events
                (node_id, event, boot_count, created_at, details_json)
                VALUES (?, ?, ?, ?, ?)""",
                (node_id, event, reported_boot, now, json.dumps({
                    "previous_boot_count": previous_boot,
                    "reported_boot_count": reported_boot,
                })),
            )
        connection.execute(
            """UPDATE devices SET
                last_seen_at = ?, last_status = 'online',
                firmware_version = COALESCE(?, firmware_version),
                uptime_seconds = COALESCE(?, uptime_seconds),
                queue_depth = COALESCE(?, queue_depth),
                retry_count = COALESCE(?, retry_count),
                wifi_rssi_dbm = COALESCE(?, wifi_rssi_dbm),
                mqtt_connected = COALESCE(?, mqtt_connected),
                boot_count = COALESCE(?, boot_count),
                oldest_pending_timestamp = ?
            WHERE node_id = ?""",
            (
                now, firmware_version, runtime.get("uptime_seconds"),
                runtime.get("queue_depth"), runtime.get("retry_count"),
                runtime.get("wifi_rssi_dbm"),
                int(runtime["mqtt_connected"]) if runtime.get("mqtt_connected") is not None else None,
                reported_boot, runtime.get("oldest_pending_timestamp"), node_id,
            ),
        )
        row = connection.execute("SELECT * FROM devices WHERE node_id = ?", (node_id,)).fetchone()
    return dict(row)


def list_devices(database_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(database_path) as connection:
        rows = connection.execute("SELECT * FROM devices ORDER BY node_id").fetchall()
    return [dict(row) for row in rows]


def provision_device_credential(
    node_id: str, database_path: str | Path | None = None
) -> str | None:
    """Issue or rotate a node credential and return its plaintext value once."""
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        row = connection.execute(
            "SELECT credential_hash FROM devices WHERE node_id = ?",
            (node_id,),
        ).fetchone()
        if not row:
            return None
        event = "rotated" if row["credential_hash"] else "issued"
        connection.execute(
            "UPDATE devices SET credential_hash = ? WHERE node_id = ?",
            (digest, node_id),
        )
        connection.execute(
            "INSERT INTO device_credential_events (node_id, event, created_at) VALUES (?, ?, ?)",
            (node_id, event, now),
        )
    return token


def revoke_device_credential(
    node_id: str, database_path: str | Path | None = None
) -> bool:
    """Disable the current credential and record the revocation."""
    now = datetime.now(timezone.utc).isoformat()
    with connect(database_path) as connection:
        row = connection.execute(
            "SELECT credential_hash FROM devices WHERE node_id = ?",
            (node_id,),
        ).fetchone()
        if not row:
            return False
        if not row["credential_hash"]:
            return True
        connection.execute(
            "UPDATE devices SET credential_hash = NULL WHERE node_id = ?",
            (node_id,),
        )
        connection.execute(
            "INSERT INTO device_credential_events (node_id, event, created_at) VALUES (?, 'revoked', ?)",
            (node_id, now),
        )
    return True


def list_device_credential_events(
    node_id: str, database_path: str | Path | None = None
) -> list[dict[str, Any]]:
    with connect(database_path) as connection:
        rows = connection.execute(
            """SELECT id, node_id, event, created_at
            FROM device_credential_events WHERE node_id = ?
            ORDER BY id DESC""",
            (node_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def verify_device_credential(
    node_id: str, token: str | None, database_path: str | Path | None = None
) -> bool:
    if not token:
        return False
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with connect(database_path) as connection:
        row = connection.execute(
            "SELECT credential_hash FROM devices WHERE node_id = ?",
            (node_id,),
        ).fetchone()
    return bool(
        row
        and row["credential_hash"]
        and hmac.compare_digest(row["credential_hash"], digest)
    )


def list_device_lifecycle_events(
    node_id: str, database_path: str | Path | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    with connect(database_path) as connection:
        rows = connection.execute(
            """SELECT id, node_id, event, boot_count, created_at, details_json
            FROM device_lifecycle_events WHERE node_id = ?
            ORDER BY id DESC LIMIT ?""",
            (node_id, limit),
        ).fetchall()
    return [
        {**dict(row), "details": json.loads(row["details_json"])}
        for row in rows
    ]

