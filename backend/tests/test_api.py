import pytest
from fastapi.testclient import TestClient

from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "test.sqlite3"
    monkeypatch.setattr(main, "DB_PATH", database_path)
    with TestClient(main.app) as test_client:
        yield test_client


def valid_reading(**changes):
    reading = {
        "node_id": "NODE-01",
        "sensor_id": "TEMP-01",
        "parameter": "temperature",
        "timestamp": "2026-08-15T10:30:00Z",
        "value": 28.4,
        "unit": "°C",
        "simulation": True,
    }
    reading.update(changes)
    return reading


def test_health_and_sensor_catalog(client):
    assert client.get("/health").json()["status"] == "ok"
    assert "temperature" in client.get("/sensors").json()


def test_ingest_and_read_back_from_sqlite(client):
    response = client.post("/telemetry", json=valid_reading())
    assert response.status_code == 201
    saved = response.json()
    assert saved["status"] == "VALID"
    assert saved["simulation"] is True
    assert saved["id"] == 1

    listing = client.get("/telemetry").json()
    assert listing["count"] == 1
    assert listing["items"][0]["value"] == 28.4


@pytest.mark.parametrize("changes", [
    {"node_id": "NODE-99"},
    {"sensor_id": "TEMP-99"},
    {"unit": "F"},
    {"value": 99},
    {"timestamp": "not-a-date"},
    {"unexpected": "field"},
])
def test_rejects_invalid_payloads(client, changes):
    response = client.post("/telemetry", json=valid_reading(**changes))
    assert response.status_code == 422
    assert client.get("/telemetry").json()["count"] == 0


def test_filter_and_limit(client):
    client.post("/telemetry", json=valid_reading())
    client.post("/telemetry", json=valid_reading(value=31.2))
    response = client.get("/telemetry?parameter=temperature&limit=1")
    assert response.json()["count"] == 2
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["value"] == 31.2
    assert response.json()["next_offset"] == 1
    assert client.get("/telemetry?parameter=unknown").status_code == 422


def test_delete_clears_database(client):
    client.post("/telemetry", json=valid_reading())
    response = client.delete("/telemetry")
    assert response.status_code == 204
    assert client.get("/telemetry").json()["count"] == 0


def test_api_token_is_optional_for_local_development(client, monkeypatch):
    monkeypatch.delenv("MW_SENSE_API_TOKEN", raising=False)
    assert client.get("/sensors").status_code == 200
    assert client.post("/telemetry", json=valid_reading()).status_code == 201


def test_configured_api_token_protects_data_routes(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "test-secret-token")
    assert client.get("/health").status_code == 200
    assert client.get("/sensors").status_code == 401
    assert client.get("/telemetry").status_code == 401
    assert client.post("/telemetry", json=valid_reading()).status_code == 401
    assert client.delete("/telemetry").status_code == 401


@pytest.mark.parametrize("authorization", [
    None,
    "test-secret-token",
    "Basic test-secret-token",
    "Bearer ",
    "Bearer wrong-token",
])
def test_rejects_malformed_or_invalid_bearer_headers(client, monkeypatch, authorization):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "test-secret-token")
    headers = {"Authorization": authorization} if authorization is not None else {}
    assert client.get("/sensors", headers=headers).status_code == 401


def test_bearer_scheme_is_case_insensitive(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "test-secret-token")
    response = client.get(
        "/sensors",
        headers={"Authorization": "bearer test-secret-token"},
    )
    assert response.status_code == 200


def test_valid_bearer_token_allows_data_access(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "test-secret-token")
    headers = {"Authorization": "Bearer test-secret-token"}
    assert client.get("/sensors", headers=headers).status_code == 200
    assert client.post("/telemetry", json=valid_reading(), headers=headers).status_code == 201
    assert client.get("/telemetry", headers=headers).json()["count"] == 1
    assert client.delete("/telemetry", headers=headers).status_code == 204



def test_duplicate_request_id_is_idempotent(client):
    reading = valid_reading(request_id="node-01-reading-0001")
    first = client.post("/telemetry", json=reading)
    retry = client.post("/telemetry", json=reading)
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert client.get("/telemetry").json()["count"] == 1


def test_pagination_returns_total_and_next_offset(client):
    for value in (25.1, 26.2, 27.3):
        response = client.post("/telemetry", json=valid_reading(value=value))
        assert response.status_code == 201

    first_page = client.get("/telemetry?limit=2&offset=0").json()
    second_page = client.get("/telemetry?limit=2&offset=2").json()
    assert first_page["count"] == 3
    assert first_page["next_offset"] == 2
    assert [item["value"] for item in first_page["items"]] == [27.3, 26.2]
    assert second_page["next_offset"] is None
    assert [item["value"] for item in second_page["items"]] == [25.1]


def test_database_initialization_records_schema_version(client, tmp_path):
    from backend.database import initialize_database, connect

    path = tmp_path / "migration-check.sqlite3"
    initialize_database(path)
    initialize_database(path)
    with connect(path) as connection:
        versions = connection.execute("SELECT version FROM schema_migrations").fetchall()
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(telemetry)")}
        device_columns = {row["name"] for row in connection.execute("PRAGMA table_info(devices)")}
    assert [row["version"] for row in versions] == [1, 2, 3, 4, 5, 6]
    assert "request_id" in columns
    assert {"uptime_seconds", "queue_depth", "retry_count", "wifi_rssi_dbm", "mqtt_connected"} <= device_columns



def test_startup_adds_request_id_to_an_existing_database(tmp_path):
    import sqlite3
    from backend.database import initialize_database, connect

    path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute("""
            CREATE TABLE telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL,
                sensor_id TEXT NOT NULL,
                parameter TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                simulation INTEGER NOT NULL,
                received_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            )
        """)
    initialize_database(path)
    with connect(path) as connection:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(telemetry)")}
        version = connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
    assert "request_id" in columns
    assert version == 6



def test_retention_cleanup_removes_only_expired_readings(client, tmp_path):
    from datetime import datetime, timedelta, timezone
    from backend.database import connect, prune_expired_readings

    client.post("/telemetry", json=valid_reading(request_id="keep-this-reading"))
    client.post("/telemetry", json=valid_reading(value=29.1, request_id="expire-this-reading"))
    with connect(main.DB_PATH) as connection:
        old_time = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        connection.execute(
            "UPDATE telemetry SET received_at = ? WHERE request_id = ?",
            (old_time, "expire-this-reading"),
        )

    assert prune_expired_readings(main.DB_PATH, retention_days=7) == 1
    listing = client.get("/telemetry").json()
    assert listing["count"] == 1
    assert listing["items"][0]["request_id"] == "keep-this-reading"


def test_zero_retention_keeps_all_readings(client):
    from backend.database import prune_expired_readings

    client.post("/telemetry", json=valid_reading())
    assert prune_expired_readings(main.DB_PATH, retention_days=0) == 0
    assert client.get("/telemetry").json()["count"] == 1


def test_health_diagnostics_are_protected_when_token_is_configured(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "diagnostic-secret")
    assert client.get("/health").status_code == 200
    assert client.get("/health/diagnostics").status_code == 401
    response = client.get(
        "/health/diagnostics",
        headers={"Authorization": "Bearer diagnostic-secret"},
    )
    assert response.status_code == 200
    report = response.json()
    assert report["integrity"] == "ok"
    assert report["schema_version"] == 6
    assert report["telemetry_records"] == 0
    assert report["simulated_records"] == 0
    assert report["physical_records"] == 0
    assert report["registered_devices"] == 0


def test_diagnostics_distinguish_physical_readings_from_registered_devices(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "diagnostic-secret")
    headers = {"Authorization": "Bearer diagnostic-secret"}
    assert client.post("/telemetry", json=valid_reading(), headers=headers).status_code == 201

    registered = client.post(
        "/devices",
        json={"node_id": "NODE-01", "label": "Lab node"},
        headers=headers,
    )
    assert registered.status_code == 201
    physical = valid_reading(
        simulation=False,
        request_id="physical-diagnostic-reading",
        firmware_version="0.1.0",
    )
    assert client.post("/telemetry", json=physical, headers=headers).status_code == 201

    report = client.get("/health/diagnostics", headers=headers).json()
    assert report["telemetry_records"] == 2
    assert report["simulated_records"] == 1
    assert report["physical_records"] == 1
    assert report["registered_devices"] == 1
    assert "credential" not in str(report).lower()


def test_negative_retention_configuration_is_rejected(monkeypatch):
    monkeypatch.setenv("MW_SENSE_RETENTION_DAYS", "-2")
    with pytest.raises(RuntimeError, match="cannot be negative"):
        main.retention_days()


def test_invalid_retention_configuration_is_rejected(monkeypatch):
    monkeypatch.setenv("MW_SENSE_RETENTION_DAYS", "one-week")
    with pytest.raises(RuntimeError, match="whole number"):
        main.retention_days()



def test_device_registration_and_heartbeat_lifecycle(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    headers = {"Authorization": "Bearer device-admin"}
    registered = client.post(
        "/devices",
        json={"node_id": "NODE-01", "label": "North wing sensor node"},
        headers=headers,
    )
    assert registered.status_code == 201
    assert registered.json()["last_status"] == "registered"
    assert client.get("/devices", headers=headers).json()[0]["node_id"] == "NODE-01"

    heartbeat = client.post(
        "/devices/NODE-01/heartbeat",
        json={"firmware_version": "1.2.0"},
        headers=headers,
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["last_status"] == "online"
    assert heartbeat.json()["firmware_version"] == "1.2.0"
    assert heartbeat.json()["last_seen_at"]


def test_device_heartbeat_accepts_and_returns_runtime_metrics(client):
    client.post("/devices", json={"node_id": "NODE-02", "label": "Air node"})
    response = client.post(
        "/devices/NODE-02/heartbeat",
        json={
            "firmware_version": "1.3.0",
            "uptime_seconds": 7200,
            "queue_depth": 4,
            "retry_count": 9,
            "wifi_rssi_dbm": -58,
            "mqtt_connected": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["uptime_seconds"] == 7200
    assert body["queue_depth"] == 4
    assert body["retry_count"] == 9
    assert body["wifi_rssi_dbm"] == -58
    assert body["mqtt_connected"] is True


def test_device_heartbeat_rejects_out_of_range_runtime_metrics(client):
    client.post("/devices", json={"node_id": "NODE-03", "label": "Soil node"})
    response = client.post(
        "/devices/NODE-03/heartbeat",
        json={"queue_depth": -1},
    )
    assert response.status_code == 422


def test_device_heartbeat_records_boot_history_and_pending_age(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    headers = {"Authorization": "Bearer device-admin"}
    client.post("/devices", json={"node_id": "NODE-01", "label": "North wing"}, headers=headers)

    first = client.post(
        "/devices/NODE-01/heartbeat",
        headers=headers,
        json={
            "boot_count": 1,
            "oldest_pending_timestamp": "2026-10-13T10:00:00Z",
        },
    )
    assert first.status_code == 200
    assert first.json()["boot_count"] == 1
    assert first.json()["oldest_pending_timestamp"] == "2026-10-13T10:00:00Z"

    second = client.post(
        "/devices/NODE-01/heartbeat",
        headers=headers,
        json={"boot_count": 2, "oldest_pending_timestamp": None},
    )
    assert second.status_code == 200
    events = client.get("/devices/NODE-01/lifecycle-events", headers=headers)
    assert events.status_code == 200
    assert [event["event"] for event in events.json()] == ["boot", "boot"]
    assert [event["boot_count"] for event in events.json()] == [2, 1]


def test_lifecycle_events_require_admin_and_known_node(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    assert client.get("/devices/NODE-01/lifecycle-events").status_code == 401
    response = client.get(
        "/devices/NODE-99/lifecycle-events",
        headers={"Authorization": "Bearer device-admin"},
    )
    assert response.status_code == 404


def test_device_heartbeat_rejects_invalid_boot_count_and_pending_timestamp(client):
    client.post("/devices", json={"node_id": "NODE-02", "label": "Air node"})
    assert client.post(
        "/devices/NODE-02/heartbeat", json={"boot_count": 0}
    ).status_code == 422
    assert client.post(
        "/devices/NODE-02/heartbeat",
        json={"oldest_pending_timestamp": "not-a-timestamp"},
    ).status_code == 422
    assert client.post(
        "/devices/NODE-02/heartbeat",
        json={"oldest_pending_timestamp": "2026-10-13T10:00:00"},
    ).status_code == 422


def test_device_health_warnings_cover_queue_retries_wifi_and_mqtt(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_QUEUE_WARNING_DEPTH", "4")
    monkeypatch.setenv("MW_SENSE_RETRY_WARNING_COUNT", "3")
    monkeypatch.setenv("MW_SENSE_WEAK_WIFI_RSSI_DBM", "80")
    client.post("/devices", json={"node_id": "NODE-01", "label": "North wing"})
    heartbeat = client.post(
        "/devices/NODE-01/heartbeat",
        json={
            "queue_depth": 4,
            "retry_count": 3,
            "wifi_rssi_dbm": -86,
            "mqtt_connected": False,
        },
    )
    assert heartbeat.status_code == 200
    device = client.get("/devices").json()[0]
    assert device["health_state"] == "warning"
    assert len(device["health_warnings"]) == 4
    assert any("Offline queue" in warning for warning in device["health_warnings"])
    assert any("retried delivery" in warning for warning in device["health_warnings"])
    assert any("Wi-Fi signal is weak" in warning for warning in device["health_warnings"])
    assert any("MQTT is disconnected" in warning for warning in device["health_warnings"])


def test_offline_and_recovery_transitions_are_recorded_once(client):
    from datetime import datetime, timedelta, timezone

    client.post("/devices", json={"node_id": "NODE-01", "label": "North wing"})
    client.post("/devices/NODE-01/heartbeat", json={"boot_count": 1})
    stale_time = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    with main.database.connect(main.DB_PATH) as connection:
        connection.execute(
            "UPDATE devices SET last_seen_at = ? WHERE node_id = ?",
            (stale_time, "NODE-01"),
        )

    offline = client.get("/devices").json()[0]
    assert offline["last_status"] == "offline"
    assert offline["health_state"] == "critical"
    assert any("No heartbeat" in warning for warning in offline["health_warnings"])

    # Repeated registry reads must not create duplicate offline events.
    client.get("/devices")
    client.post("/devices/NODE-01/heartbeat", json={"boot_count": 1})
    events = client.get("/devices/NODE-01/lifecycle-events").json()
    transitions = [event["event"] for event in events if event["event"] in {"offline", "online"}]
    assert transitions == ["online", "offline"]


def test_device_registration_rejects_unknown_node(client):
    response = client.post(
        "/devices",
        json={"node_id": "NODE-99", "label": "Unknown node"},
    )
    assert response.status_code == 422


def test_heartbeat_requires_registered_device(client):
    response = client.post(
        "/devices/NODE-03/heartbeat",
        json={"firmware_version": "0.1"},
    )
    assert response.status_code == 404


def test_physical_telemetry_requires_registration_and_updates_heartbeat(client):
    physical = valid_reading(simulation=False, request_id="physical-reading-01", firmware_version="0.9.1")
    rejected = client.post("/telemetry", json=physical)
    assert rejected.status_code == 409

    client.post("/devices", json={"node_id": "NODE-01", "label": "Lab node"})
    accepted = client.post("/telemetry", json=physical)
    assert accepted.status_code == 201
    assert accepted.json()["simulation"] is False
    assert accepted.json()["firmware_version"] == "0.9.1"

    device = client.get("/devices").json()[0]
    assert device["last_status"] == "online"
    assert device["firmware_version"] == "0.9.1"
    assert device["last_seen_at"]


def test_device_routes_require_configured_api_token(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "private")
    assert client.get("/devices").status_code == 401
    assert client.post(
        "/devices",
        json={"node_id": "NODE-01", "label": "Lab node"},
    ).status_code == 401



def test_device_credential_can_only_be_provisioned_by_admin_and_is_not_listed(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    headers = {"Authorization": "Bearer device-admin"}
    registered = client.post(
        "/devices",
        json={"node_id": "NODE-01", "label": "Lab node"},
        headers=headers,
    )
    assert registered.status_code == 201
    assert "credential_hash" not in registered.json()

    assert client.post("/devices/NODE-01/credentials").status_code == 401
    issued = client.post("/devices/NODE-01/credentials", headers=headers)
    assert issued.status_code == 200
    credential = issued.json()["credential"]
    assert credential
    assert issued.json()["node_id"] == "NODE-01"
    assert "credential" not in client.get("/devices", headers=headers).json()[0]


def test_rotating_device_credential_invalidates_previous_value(client, monkeypatch):
    from backend.database import verify_device_credential

    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    headers = {"Authorization": "Bearer device-admin"}
    client.post("/devices", json={"node_id": "NODE-02", "label": "Air node"}, headers=headers)
    first = client.post("/devices/NODE-02/credentials", headers=headers).json()["credential"]
    second = client.post("/devices/NODE-02/credentials", headers=headers).json()["credential"]
    assert first != second
    assert not verify_device_credential("NODE-02", first, main.DB_PATH)
    assert verify_device_credential("NODE-02", second, main.DB_PATH)


def test_cannot_provision_credential_for_unknown_node(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    response = client.post(
        "/devices/NODE-99/credentials",
        headers={"Authorization": "Bearer device-admin"},
    )
    assert response.status_code == 404


def test_device_credential_can_be_revoked_and_audited(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    headers = {"Authorization": "Bearer device-admin"}
    client.post("/devices", json={"node_id": "NODE-03", "label": "Soil node"}, headers=headers)
    issued = client.post("/devices/NODE-03/credentials", headers=headers).json()["credential"]
    assert client.get("/devices", headers=headers).json()[0]["credential_active"] is True

    revoked = client.delete("/devices/NODE-03/credentials", headers=headers)
    assert revoked.status_code == 200
    assert revoked.json()["credential_active"] is False

    from backend.database import verify_device_credential
    assert not verify_device_credential("NODE-03", issued, main.DB_PATH)

    events = client.get("/devices/NODE-03/credential-events", headers=headers)
    assert events.status_code == 200
    assert [event["event"] for event in events.json()] == ["revoked", "issued"]
    assert all("credential" not in event for event in events.json())


def test_revoking_unknown_device_returns_not_found(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    response = client.delete(
        "/devices/NODE-99/credentials",
        headers={"Authorization": "Bearer device-admin"},
    )
    assert response.status_code == 404


def test_device_audit_route_requires_admin_and_known_node(client, monkeypatch):
    monkeypatch.setenv("MW_SENSE_API_TOKEN", "device-admin")
    assert client.get("/devices/NODE-01/credential-events").status_code == 401
    response = client.get(
        "/devices/NODE-99/credential-events",
        headers={"Authorization": "Bearer device-admin"},
    )
    assert response.status_code == 404
