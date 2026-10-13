import json

import pytest

from backend.database import (
    initialize_database,
    list_readings,
    provision_device_credential,
    register_device,
)
from backend.mqtt_bridge import (
    ingest_mqtt_heartbeat,
    ingest_mqtt_message,
    parse_mqtt_message,
)


def valid_payload(**changes):
    payload = {
        "node_id": "NODE-01",
        "sensor_id": "TEMP-01",
        "parameter": "temperature",
        "timestamp": "2026-10-13T10:30:00Z",
        "value": 27.8,
        "unit": "°C",
        "simulation": False,
        "request_id": "mqtt-node-01-0001",
        "firmware_version": "1.0.0",
        "device_token": "not-provisioned",
    }
    payload.update(changes)
    return payload


def registered_node(tmp_path):
    path = tmp_path / "mqtt.sqlite3"
    initialize_database(path)
    register_device("NODE-01", "MQTT lab node", path)
    token = provision_device_credential("NODE-01", path)
    return path, token


def test_parse_mqtt_message_checks_topic_identity_and_authentication(tmp_path):
    path, token = registered_node(tmp_path)
    parsed = parse_mqtt_message(
        "mw-sense/NODE-01/TEMP-01/telemetry",
        json.dumps(valid_payload(device_token=token)),
        path,
    )
    assert parsed["node_id"] == "NODE-01"
    assert parsed["simulation"] is False
    assert parsed["firmware_version"] == "1.0.0"
    assert "device_token" not in parsed


@pytest.mark.parametrize("topic", [
    "mw-sense/NODE-01/TEMP-01",
    "mw-sense/NODE-01/TEMP-01/status",
    "other/NODE-01/TEMP-01/telemetry",
])
def test_rejects_topics_outside_the_mw_sense_contract(topic, tmp_path):
    path, token = registered_node(tmp_path)
    with pytest.raises(ValueError, match="topic"):
        parse_mqtt_message(topic, json.dumps(valid_payload(device_token=token)), path)


def test_rejects_topic_identity_mismatch(tmp_path):
    path, token = registered_node(tmp_path)
    with pytest.raises(ValueError, match="identity"):
        parse_mqtt_message(
            "mw-sense/NODE-02/TEMP-01/telemetry",
            json.dumps(valid_payload(device_token=token)),
            path,
        )


def test_rejects_missing_or_invalid_device_credential(tmp_path):
    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    for presented in (None, "wrong-token"):
        with pytest.raises(ValueError, match="authentication"):
            parse_mqtt_message(topic, json.dumps(valid_payload(device_token=presented)), path)


def test_rejects_simulated_or_non_idempotent_mqtt_messages(tmp_path):
    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    with pytest.raises(ValueError, match="physical"):
        parse_mqtt_message(topic, json.dumps(valid_payload(simulation=True, device_token=token)), path)
    with pytest.raises(ValueError, match="request_id"):
        parse_mqtt_message(topic, json.dumps(valid_payload(request_id=None, device_token=token)), path)


def test_rejects_invalid_json_and_sensor_values(tmp_path):
    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    with pytest.raises(ValueError, match="JSON"):
        parse_mqtt_message(topic, b"{", path)
    with pytest.raises(ValueError, match="validation"):
        parse_mqtt_message(topic, json.dumps(valid_payload(value=500, device_token=token)), path)


def test_mqtt_ingestion_requires_registration_authentication_and_is_idempotent(tmp_path):
    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    body = json.dumps(valid_payload(device_token=token))
    first = ingest_mqtt_message(topic, body, path)
    second = ingest_mqtt_message(topic, body, path)
    records, count = list_readings(path)
    assert first["id"] == second["id"]
    assert count == 1
    assert records[0]["simulation"] is False
    assert "device_token" not in records[0]


def test_mqtt_heartbeat_requires_device_credential_and_updates_node(tmp_path):
    path, token = registered_node(tmp_path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": token,
    }
    device = ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)
    assert device["last_status"] == "online"
    assert device["firmware_version"] == "0.1.0"
    assert device["last_seen_at"]


def test_mqtt_heartbeat_rejects_bad_credentials_topics_and_unknown_nodes(tmp_path):
    path, token = registered_node(tmp_path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": "wrong-token",
    }
    with pytest.raises(ValueError, match="topic"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/telemetry", json.dumps(heartbeat), path)
    with pytest.raises(ValueError, match="authentication"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)
    with pytest.raises(ValueError, match="unregistered"):
        ingest_mqtt_heartbeat(
            "mw-sense/NODE-02/status",
            json.dumps({**heartbeat, "node_id": "NODE-02", "device_token": token}),
            path,
        )
