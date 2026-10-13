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
    build_mqtt_callbacks,
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


def test_mqtt_heartbeat_persists_runtime_diagnostics(tmp_path):
    path, token = registered_node(tmp_path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": token,
        "uptime_seconds": 864,
        "queue_depth": 3,
        "retry_count": 7,
        "wifi_rssi_dbm": -61,
        "mqtt_connected": True,
    }
    device = ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)
    assert device["uptime_seconds"] == 864
    assert device["queue_depth"] == 3
    assert device["retry_count"] == 7
    assert device["wifi_rssi_dbm"] == -61
    assert device["mqtt_connected"] == 1


@pytest.mark.parametrize("field,value", [
    ("uptime_seconds", -1),
    ("queue_depth", -1),
    ("retry_count", -1),
    ("wifi_rssi_dbm", -128),
    ("mqtt_connected", "connected"),
])
def test_mqtt_heartbeat_rejects_invalid_runtime_metrics(tmp_path, field, value):
    path, token = registered_node(tmp_path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": token,
        field: value,
    }
    with pytest.raises(ValueError, match="runtime metric"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)


def test_mqtt_heartbeat_persists_boot_count_and_oldest_pending_time(tmp_path):
    path, token = registered_node(tmp_path)
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": token,
        "boot_count": 4,
        "oldest_pending_timestamp": "2026-10-13T09:15:00Z",
    }
    device = ingest_mqtt_heartbeat("mw-sense/NODE-01/status", json.dumps(heartbeat), path)
    assert device["boot_count"] == 4
    assert device["oldest_pending_timestamp"] == "2026-10-13T09:15:00Z"


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
    with pytest.raises(ValueError, match="authentication"):
        ingest_mqtt_heartbeat(
            "mw-sense/NODE-02/status",
            json.dumps({**heartbeat, "node_id": "NODE-02", "device_token": token}),
            path,
        )


class FakeReasonCode:
    def __init__(self, failed=False):
        self.is_failure = failed

    def __str__(self):
        return "connection-lost" if self.is_failure else "success"


class FakeMqttConnection:
    def __init__(self):
        self.subscriptions = []
        self.publications = []

    def subscribe(self, topics):
        self.subscriptions.extend(topics)
        return 0, 1

    def publish(self, topic, payload, qos=0, retain=False):
        self.publications.append((topic, json.loads(payload), qos, retain))
        return type("PublishResult", (), {"rc": 0})()


class FakeMqttMessage:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


def test_broker_callbacks_subscribe_and_ingest_physical_reading(tmp_path):
    path, token = registered_node(tmp_path)
    on_connect, _, on_message = build_mqtt_callbacks(path)
    connection = FakeMqttConnection()
    on_connect(connection, None, {}, FakeReasonCode(), None)
    assert connection.subscriptions == [
        ("mw-sense/+/+/telemetry", 1),
        ("mw-sense/+/status", 1),
    ]
    body = json.dumps(valid_payload(device_token=token)).encode("utf-8")
    message = FakeMqttMessage("mw-sense/NODE-01/TEMP-01/telemetry", body)
    on_message(connection, None, message)
    on_message(connection, None, message)
    records, count = list_readings(path)
    assert count == 1
    assert records[0]["simulation"] is False


def test_broker_callbacks_process_heartbeat_and_reject_bad_messages(tmp_path):
    path, token = registered_node(tmp_path)
    _, on_disconnect, on_message = build_mqtt_callbacks(path)
    connection = FakeMqttConnection()
    heartbeat = {
        "node_id": "NODE-01",
        "firmware_version": "0.1.0",
        "event": "heartbeat",
        "device_token": token,
    }
    on_message(connection, None, FakeMqttMessage(
        "mw-sense/NODE-01/status", json.dumps(heartbeat).encode("utf-8")
    ))
    on_message(connection, None, FakeMqttMessage(
        "mw-sense/NODE-01/TEMP-01/telemetry", b"not-json"
    ))
    on_disconnect(connection, None, None, FakeReasonCode(failed=True), None)
    from backend.database import list_devices
    device = list_devices(path)[0]
    assert device["last_status"] == "online"
    assert device["firmware_version"] == "0.1.0"


def test_broker_callback_does_not_subscribe_after_rejected_connection():
    on_connect, _, _ = build_mqtt_callbacks()
    connection = FakeMqttConnection()
    on_connect(connection, None, {}, FakeReasonCode(failed=True), None)
    assert connection.subscriptions == []


def test_broker_acknowledges_only_after_database_ingestion(tmp_path):
    path, token = registered_node(tmp_path)
    _, _, on_message = build_mqtt_callbacks(path)
    connection = FakeMqttConnection()
    body = json.dumps(valid_payload(device_token=token)).encode("utf-8")
    message = FakeMqttMessage("mw-sense/NODE-01/TEMP-01/telemetry", body)

    on_message(connection, None, message)
    on_message(connection, None, message)

    assert connection.publications == [
        (
            "mw-sense/NODE-01/TEMP-01/ack/mqtt-node-01-0001",
            {"request_id": "mqtt-node-01-0001", "accepted": True},
            1,
            False,
        ),
        (
            "mw-sense/NODE-01/TEMP-01/ack/mqtt-node-01-0001",
            {"request_id": "mqtt-node-01-0001", "accepted": True},
            1,
            False,
        ),
    ]
    records, count = list_readings(path)
    assert count == 1


def test_broker_does_not_acknowledge_rejected_telemetry(tmp_path):
    path, token = registered_node(tmp_path)
    _, _, on_message = build_mqtt_callbacks(path)
    connection = FakeMqttConnection()
    invalid = valid_payload(value=500, device_token=token)
    on_message(
        connection,
        None,
        FakeMqttMessage(
            "mw-sense/NODE-01/TEMP-01/telemetry",
            json.dumps(invalid).encode("utf-8"),
        ),
    )
    assert connection.publications == []
    assert list_readings(path)[1] == 0


def test_broker_does_not_claim_acknowledgement_when_publish_fails(tmp_path):
    path, token = registered_node(tmp_path)
    _, _, on_message = build_mqtt_callbacks(path)

    class FailingAckConnection(FakeMqttConnection):
        def publish(self, topic, payload, qos=0, retain=False):
            self.publications.append((topic, json.loads(payload), qos, retain))
            return type("PublishResult", (), {"rc": 4})()

    connection = FailingAckConnection()
    body = json.dumps(valid_payload(device_token=token)).encode("utf-8")
    on_message(
        connection,
        None,
        FakeMqttMessage("mw-sense/NODE-01/TEMP-01/telemetry", body),
    )
    assert len(connection.publications) == 1
    assert list_readings(path)[1] == 1



def test_mqtt_rejects_oversized_payloads_before_json_parsing(tmp_path):
    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    oversized = b" " * 4097
    with pytest.raises(ValueError, match="4096-byte limit"):
        parse_mqtt_message(topic, oversized, path)


def test_mqtt_accepts_payload_at_configured_size_limit(tmp_path):
    from backend.mqtt_bridge import MAX_MQTT_PAYLOAD_BYTES

    path, token = registered_node(tmp_path)
    topic = "mw-sense/NODE-01/TEMP-01/telemetry"
    body = json.dumps(valid_payload(device_token=token), separators=(",", ":"))
    body = body + (" " * (MAX_MQTT_PAYLOAD_BYTES - len(body.encode("utf-8"))))
    assert len(body.encode("utf-8")) == MAX_MQTT_PAYLOAD_BYTES
    parsed = parse_mqtt_message(topic, body, path)
    assert parsed["node_id"] == "NODE-01"


@pytest.mark.parametrize("topic", [
    "mw-sense/+/TEMP-01/telemetry",
    "mw-sense/NODE-01/#/telemetry",
    "mw-sense/NODE.01/TEMP-01/telemetry",
    "mw-sense//TEMP-01/telemetry",
])
def test_mqtt_rejects_wildcards_and_invalid_topic_identifiers(topic, tmp_path):
    path, token = registered_node(tmp_path)
    with pytest.raises(ValueError, match="topic"):
        parse_mqtt_message(topic, json.dumps(valid_payload(device_token=token)), path)


def test_mqtt_heartbeat_rejects_oversized_payload(tmp_path):
    path, token = registered_node(tmp_path)
    with pytest.raises(ValueError, match="4096-byte limit"):
        ingest_mqtt_heartbeat("mw-sense/NODE-01/status", b" " * 4097, path)
