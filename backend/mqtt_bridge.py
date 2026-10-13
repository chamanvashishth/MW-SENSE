"""MQTT-to-SQLite bridge for physical MW-SENSE nodes.

Topic contract: mw-sense/{node_id}/{sensor_id}/telemetry
Run with: python -m backend.mqtt_bridge
"""
import json
import logging
import os

from pydantic import ValidationError

from .database import DEFAULT_DB_PATH, initialize_database, insert_reading, update_device_heartbeat, verify_device_credential
from .schemas import DeviceHeartbeat, TelemetryIn

logger = logging.getLogger("mw_sense.mqtt")


MAX_MQTT_PAYLOAD_BYTES = 4096


def _decode_json_object(body: bytes | str, message_type: str) -> dict:
    """Decode a bounded MQTT JSON object before schema validation."""
    if isinstance(body, bytes):
        if len(body) > MAX_MQTT_PAYLOAD_BYTES:
            raise ValueError(f"MQTT {message_type} exceeds the {MAX_MQTT_PAYLOAD_BYTES}-byte limit.")
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"MQTT {message_type} must contain valid UTF-8 JSON.") from exc
    elif isinstance(body, str):
        if len(body.encode("utf-8")) > MAX_MQTT_PAYLOAD_BYTES:
            raise ValueError(f"MQTT {message_type} exceeds the {MAX_MQTT_PAYLOAD_BYTES}-byte limit.")
        text = body
    else:
        raise ValueError(f"MQTT {message_type} must be bytes or text.")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"MQTT {message_type} must contain valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"MQTT {message_type} must be a JSON object.")
    return payload


def _validate_topic_segment(value: str, label: str) -> None:
    if not value or len(value) > 64 or any(
        character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
        for character in value
    ):
        raise ValueError(f"MQTT topic {label} is invalid.")


def parse_mqtt_message(topic: str, body: bytes | str, database_path=DEFAULT_DB_PATH) -> dict:
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != "mw-sense" or parts[3] != "telemetry":
        raise ValueError("MQTT topic must be mw-sense/{node_id}/{sensor_id}/telemetry.")
    _validate_topic_segment(parts[1], "node_id")
    _validate_topic_segment(parts[2], "sensor_id")
    payload = _decode_json_object(body, "message")
    if payload.get("node_id") != parts[1] or payload.get("sensor_id") != parts[2]:
        raise ValueError("MQTT topic identity does not match the payload.")
    if payload.get("simulation") is not False:
        raise ValueError("MQTT ingress accepts physical readings only; set simulation to false.")
    credential = payload.pop("device_token", None)
    if not verify_device_credential(parts[1], credential, database_path):
        raise ValueError("MQTT device authentication failed.")
    if not payload.get("request_id"):
        raise ValueError("Physical MQTT readings must include a request_id for safe redelivery.")
    try:
        reading = TelemetryIn.model_validate(payload)
    except ValidationError as exc:
        raise ValueError("MQTT telemetry failed MW-SENSE payload validation.") from exc
    return reading.model_dump()


def ingest_mqtt_message(topic: str, body: bytes | str, database_path=DEFAULT_DB_PATH) -> dict:
    payload = parse_mqtt_message(topic, body, database_path)
    return insert_reading(payload, database_path)


def ingest_mqtt_heartbeat(topic: str, body: bytes | str, database_path=DEFAULT_DB_PATH) -> dict:
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "mw-sense" or parts[2] != "status":
        raise ValueError("MQTT heartbeat topic must be mw-sense/{node_id}/status.")
    _validate_topic_segment(parts[1], "node_id")
    payload = _decode_json_object(body, "heartbeat")
    if payload.get("node_id") != parts[1] or payload.get("event") != "heartbeat":
        raise ValueError("MQTT heartbeat identity or event does not match its topic.")
    credential = payload.pop("device_token", None)
    if not verify_device_credential(parts[1], credential, database_path):
        raise ValueError("MQTT heartbeat authentication failed.")
    heartbeat_fields = {
        key: value for key, value in payload.items()
        if key not in {"node_id", "event"}
    }
    try:
        heartbeat = DeviceHeartbeat.model_validate(heartbeat_fields)
    except ValidationError as exc:
        raise ValueError("MQTT heartbeat failed runtime metric validation.") from exc
    runtime = heartbeat.model_dump(exclude={"firmware_version"}, exclude_none=True)
    device = update_device_heartbeat(
        parts[1], heartbeat.firmware_version, database_path, runtime
    )
    if not device:
        raise ValueError("MQTT heartbeat came from an unregistered node.")
    return device


def build_mqtt_callbacks(database_path=DEFAULT_DB_PATH):
    """Create broker callbacks separately so message handling can be tested."""
    def on_connect(connection, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            logger.error("mqtt_connection_rejected reason=%s", reason_code)
            return
        result, message_id = connection.subscribe([
            ("mw-sense/+/+/telemetry", 1),
            ("mw-sense/+/status", 1),
        ])
        if result != 0:
            logger.error("mqtt_subscription_failed result=%s", result)
            return
        logger.info(
            "mqtt_bridge_connected topics=mw-sense/+/+/telemetry,mw-sense/+/status"
        )

    def on_disconnect(connection, userdata, disconnect_flags, reason_code, properties):
        if reason_code.is_failure:
            logger.warning("mqtt_connection_lost reason=%s; client will retry", reason_code)
        else:
            logger.info("mqtt_connection_closed reason=%s", reason_code)

    def on_message(connection, userdata, message):
        try:
            if message.topic.count("/") == 2 and message.topic.endswith("/status"):
                device = ingest_mqtt_heartbeat(message.topic, message.payload, database_path)
                logger.info("mqtt_heartbeat_received node_id=%s", device["node_id"])
                return
            record = ingest_mqtt_message(message.topic, message.payload, database_path)
            acknowledgement_topic = (
                f"mw-sense/{record['node_id']}/{record['sensor_id']}/ack/{record['request_id']}"
            )
            acknowledgement = json.dumps({
                "request_id": record["request_id"],
                "accepted": True,
            })
            published = connection.publish(
                acknowledgement_topic, acknowledgement, qos=1, retain=False
            )
            if published.rc != 0:
                logger.error(
                    "mqtt_acknowledgement_publish_failed node_id=%s sensor_id=%s result=%s",
                    record["node_id"], record["sensor_id"], published.rc,
                )
                return
            logger.info(
                "mqtt_reading_stored_and_acknowledged node_id=%s sensor_id=%s record_id=%s",
                record["node_id"], record["sensor_id"], record["id"],
            )
        except (ValueError, KeyError) as exc:
            logger.warning("mqtt_message_rejected topic=%s reason=%s", message.topic, exc)
        except Exception:
            # Do not log payloads: they may contain device credentials.
            logger.exception("mqtt_message_processing_failed topic=%s", message.topic)

    return on_connect, on_disconnect, on_message


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

    client.on_connect, client.on_disconnect, client.on_message = build_mqtt_callbacks(database_path)
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    initialize_database(database_path)
    # Async connection lets loop_forever manage initial failures and reconnects.
    client.connect_async(host, port, keepalive=60)
    logger.info("starting_mw_sense_mqtt_bridge host=%s port=%s", host, port)
    client.loop_forever()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("MW_SENSE_LOG_LEVEL", "INFO"))
    main()
