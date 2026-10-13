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
    assert response.json()["count"] == 1
    assert response.json()["items"][0]["value"] == 31.2
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
