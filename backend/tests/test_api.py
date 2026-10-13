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
    assert response.json()["next_offset"] is None
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
    assert [row["version"] for row in versions] == [1]
    assert "request_id" in columns



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
        version = connection.execute("SELECT version FROM schema_migrations").fetchone()["version"]
    assert "request_id" in columns
    assert version == 1
