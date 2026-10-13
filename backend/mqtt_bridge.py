"""MQTT-to-SQLite bridge for physical MW-SENSE nodes.

Topic contract: mw-sense/{node_id}/{sensor_id}/telemetry
Run with: python -m backend.mqtt_bridge
"""
import json
import logging
import os

from pydantic import ValidationError

from .database import DEFAULT_DB_PATH, initialize_database, insert_reading, update_device_heartbeat
from .schemas import TelemetryIn

logger = logging.getLogger("mw_sense.mqtt")


def parse_mqtt_message(topic: str, body: bytes | str) -> dict:
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != "mw-sense" or parts[3] != "telemetry":
        raise ValueError("MQTT topic must be mw-sense/{node_id}/{sensor_id}/telemetry.")
    try:
        payload = json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("MQTT message must contain valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("MQTT message must be a JSON object.")
    if payload.get("node_id") != parts[1] or payload.get("sensor_id") != parts[2]:
        raise ValueError("MQTT topic identity does not match the payload.")
    if payload.get("simulation") is not False:
        raise ValueError("MQTT ingress accepts physical readings only; set simulation to false.")
    if not payload.get("request_id"):
        raise ValueError("Physical MQTT readings must include a request_id for safe redelivery.")
    try:
        reading = TelemetryIn.model_validate(payload)
    except ValidationError as exc:
        raise ValueError("MQTT telemetry failed MW-SENSE payload validation.") from exc
    return reading.model_dump()


def ingest_mqtt_message(topic: str, body: bytes | str, database_path=DEFAULT_DB_PATH) -> dict:
    payload = parse_mqtt_message(topic, body)
    return insert_reading(payload, database_path)


def ingest_mqtt_heartbeat(topic: str, body: bytes | str, database_path=DEFAULT_DB_PATH) -> dict:
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "mw-sense" or parts[2] != "status":
        raise ValueError("MQTT heartbeat topic must be mw-sense/{node_id}/status.")
    try:
        payload = json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("MQTT heartbeat must contain valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("MQTT heartbeat must be a JSON object.")
    if payload.get("node_id") != parts[1] or payload.get("event") != "heartbeat":
        raise ValueError("MQTT heartbeat identity or event does not match its topic.")
    firmware = payload.get("firmware_version")
    if firmware is not None and (not isinstance(firmware, str) or not 1 <= len(firmware) <= 64):
        raise ValueError("MQTT heartbeat firmware_version must be 1 to 64 characters.")
    device = update_device_heartbeat(parts[1], firmware, database_path)
    if not device:
        raise ValueError("MQTT heartbeat came from an unregistered node.")
    return device


def main():
    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise SystemExit(
            "MQTT support is optional. Install it with: "
            "python -m pip install -r backend/requirements-mqtt.txt"
        ) from exc

    host = os.getenv("MW_SENSE_MQTT_HOST")
    if not host:
        raise SystemExit("Set MW_SENSE_MQTT_HOST before starting the MQTT bridge.")
    port = int(os.getenv("MW_SENSE_MQTT_PORT", "8883"))
    client_id = os.getenv("MW_SENSE_MQTT_CLIENT_ID", "mw-sense-ingest")
    database_path = os.getenv("MW_SENSE_DB_PATH", str(DEFAULT_DB_PATH))
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)

    username = os.getenv("MW_SENSE_MQTT_USERNAME")
    password = os.getenv("MW_SENSE_MQTT_PASSWORD")
    if username:
        client.username_pw_set(username, password)
    if os.getenv("MW_SENSE_MQTT_TLS", "true").lower() in {"1", "true", "yes"}:
        client.tls_set()

    def on_connect(connection, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            logger.error("mqtt_connection_rejected reason=%s", reason_code)
            return
        connection.subscribe([("mw-sense/+/+/telemetry", 1), ("mw-sense/+/status", 1)])
        logger.info("mqtt_bridge_connected topics=mw-sense/+/+/telemetry,mw-sense/+/status")

    def on_message(connection, userdata, message):
        try:
            if message.topic.count("/") == 2 and message.topic.endswith("/status"):
                device = ingest_mqtt_heartbeat(message.topic, message.payload, database_path)
                logger.info("mqtt_heartbeat_received node_id=%s", device["node_id"])
                return
            record = ingest_mqtt_message(message.topic, message.payload, database_path)
            logger.info(
                "mqtt_reading_stored node_id=%s sensor_id=%s record_id=%s",
                record["node_id"], record["sensor_id"], record["id"],
            )
        except (ValueError, KeyError) as exc:
            logger.warning("mqtt_message_rejected topic=%s reason=%s", message.topic, exc)

    client.on_connect = on_connect
    client.on_message = on_message
    initialize_database(database_path)
    client.connect(host, port, keepalive=60)
    logger.info("starting_mw_sense_mqtt_bridge host=%s port=%s", host, port)
    client.loop_forever()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("MW_SENSE_LOG_LEVEL", "INFO"))
    main()
