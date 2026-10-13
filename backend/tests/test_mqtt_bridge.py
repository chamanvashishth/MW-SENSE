import json

import pytest

from backend.mqtt_bridge import ingest_mqtt_heartbeat, ingest_mqtt_message, parse_mqtt_message
from backend.database import initialize_database, list_readings, register_device


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
    }
    payload.update(changes)
    return payload


def test_parse_mqtt_message_checks_topic_and_payload_identity():
    parsed = parse_mqtt_message(
        "mw-sense/NODE-01/TEMP-01/telemetry",
        json.dumps(valid_payload()),
    )
    assert parsed["node_id"] == "NODE-01"
    assert parsed["simulation"] is False
    assert parsed["firmware_version"] == "1.0.0"


@pytest.mark.parametrize("topic", [
    "mw-sense/NODE-01/TEMP-01",
    "mw-sense/NODE-01/TEMP-01/status",
    "other/NODE-01/TEMP-01/telemetry",
])
def test_rejects_topics_outside_the_mw_sense_contract(topic):
    with pytest.raises(ValueError, match="topic"):
        parse_mqtt_message(topic, json.dumps(valid_payload()))


def test_rejects_topic_identity_mismatch():
    with pytest.raises(ValueError, match="identity"):
        parse_mqtt_message(
            "mw-sense/NODE-02/TEMP-01/telemetry",
            json.dumps(valid_payload()),
        )


def test_rejects_simulated_or_non_idempotent_mqtt_messages():
    with pytest.raises(ValueError, match="physical"):
        parse_mqtt_message(
            "mw-sense/NODE-01/TEMP-01/telemetry",
            json.dumps(valid_payload(simulation=True)),
        )
    with pytest.raises(ValueError, match="request_id"):
        parse_mqtt_message(
            "mw-sense/NODE-01/TEMP-01/telemetry",
            json.dumps(valid_payload(request_id=None)),
        )


def test_rejects_invalid_json_and_sensor_values():
    with pytest.raises(ValueError, match="JSON"):
        parse_mqtt_message("mw-sense/NODE-01/TEMP-01/telemetry", b"{")
    with pytest.raises(ValueError, match="validation"):
        parse_mqtt_message(
            "mw-sense/NODE-01/TEMP-01/telemetry",
            json.dumps(valid_payload(value=500)),
        )


def test_mqtt_ingestion_requires_registered_device_and_is_idempotent(tmp_path):
    path = tmp_path / "mqtt.sqlite3"
    initialize_database(path)
    register_device("NODE-01", "MQTT lab node", path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    body = json.dumps(valid_payload())
    first = ingest_mqtt_message(topic, body, path)
    second = ingest_mqtt_message(topic, body, path)
    records, count = list_readings(path)
    assert first["id"] == second["id"]
    assert count == 1
    assert records[0]["simulation"] is False



def test_mqtt_heartbeat_updates_registered_node(tmp_path):
    path = tmp_path / "heartbeat.sqlite3"
    initialize_database(path)
    register_device("NODE-01", "ESP32 lab node", path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
    }
    device = ingest_mqtt_heartbeat(
        "mw-sense/NODE-01/status",
        json.dumps(heartbeat),
        path,
    )
    assert device["last_status"] == "online"
    assert device["firmware_version"] == "0.1.0"
    assert device["last_seen_at"]


def test_mqtt_heartbeat_rejects_wrong_topic_or_unregistered_node(tmp_path):
    path = tmp_path / "heartbeat.sqlite3"
    initialize_database(path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
    }
    with pytest.raises(ValueError, match="topic"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/telemetry", json.dumps(heartbeat), path)
    with pytest.raises(ValueError, match="unregistered"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)
