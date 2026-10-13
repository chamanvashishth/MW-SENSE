# ESP32 firmware reference

This directory contains a PlatformIO reference for connecting an ESP32 sensor node to the MW-SENSE MQTT ingestion bridge.

It is a starting point for a physical prototype, not evidence that a particular board or sensor has been assembled, calibrated, or field-tested.

## What it currently does

- Connects to Wi-Fi and retries after connection loss.
- Connects to an MQTT broker and retries after connection loss.
- Reads temperature through the example DHT22 adapter.
- Waits for an NTP-synchronized UTC clock before creating a timestamped reading.
- Publishes telemetry to `mw-sense/{node_id}/{sensor_id}/telemetry`.
- Publishes a heartbeat to `mw-sense/{node_id}/status`.
- Saves each sample in LittleFS before attempting transmission.
- Retries the oldest queued sample until the backend acknowledges successful database ingestion.
- Removes a queued sample only when an acknowledgement with the matching request ID arrives.
- Gives each sample a stable request ID so retries and repeated broker deliveries remain idempotent.

The current adapter publishes temperature only. Humidity, air quality, and soil moisture drivers are not implemented by this firmware reference.

## Configure the node

From this directory, copy the example configuration:

```bash
cp include/config.h.example include/config.h
```

On Windows PowerShell:

```powershell
Copy-Item include/config.h.example include/config.h
```

Edit `include/config.h` and set the Wi-Fi credentials, broker hostname, broker port, broker username/password, node ID, sensor pin, and the per-device token provisioned by the API. The real `config.h` is ignored by Git; do not commit it.

Register the node with the API before sending physical telemetry. The node ID must be one of the currently supported catalogue IDs.

After registration, issue a node-specific credential from the admin-authenticated API:

```bash
curl -X POST http://127.0.0.1:8001/devices/NODE-01/credentials \
  -H "Authorization: Bearer $MW_SENSE_API_TOKEN"
```

Copy the returned one-time `credential` into `MW_SENSE_DEVICE_TOKEN` in the node's private `config.h`. The API stores only a SHA-256 digest. Rotating the credential invalidates the previous value; update the firmware configuration before reconnecting the node. To revoke without replacement, use `DELETE /devices/NODE-01/credentials`; the node cannot authenticate again until a new credential is issued.

## MQTT security

TLS is enabled in the example configuration. **Broker certificate verification is required by default.** Add the broker's CA certificate to your private `config.h`:

```cpp
#define MQTT_ROOT_CA R"EOF(
-----BEGIN CERTIFICATE-----
PASTE THE BROKER CA CERTIFICATE HERE
-----END CERTIFICATE-----
)EOF"
```

Use the CA certificate that validates the broker's certificate chain. Do not place a private key in this firmware configuration.

If TLS is enabled but `MQTT_ROOT_CA` is missing, the firmware deliberately stops before connecting. This avoids silently accepting an unverified broker.

For an isolated development broker only, `MQTT_ALLOW_INSECURE_TLS` can be explicitly set to `1`. That disables certificate verification and is not suitable for real deployments. Keep it set to `0` for normal use. Setting `MQTT_USE_TLS` to `0` disables transport encryption entirely.

Use a unique broker identity and topic-level publish ACL for each physical node. The firmware's shared username/password example is not per-device authorization.

## Build

Install PlatformIO, create the private `config.h` as described above, then run:

```bash
pio run
```

The repository CI compiles the example configuration. That compile check does not connect to a broker or verify credentials, certificates, sensor wiring, or board behavior.

## Telemetry contract

A temperature reading follows this shape:

```json
{
  "node_id": "NODE-01",
  "sensor_id": "TEMP-01",
  "parameter": "temperature",
  "timestamp": "2026-10-13T10:30:00Z",
  "value": 27.8,
  "unit": "°C",
  "simulation": false,
  "request_id": "NODE-01-boot-sequence",
  "firmware_version": "0.1.0"
}
```

The request ID remains stable when the same queued message is retried. After validation and database insertion (or recognition of an existing idempotent record), the bridge publishes `mw-sense/{node_id}/{sensor_id}/ack/{request_id}` at QoS 1 with `accepted: true`. The ESP32 subscribes to its own acknowledgement topics and removes only the queue head whose request ID matches. If the acknowledgement is lost, the node retries; the backend recognizes the duplicate and sends the acknowledgement again.

Heartbeat messages use `mw-sense/{node_id}/status` and include the node ID, firmware version, `event: "heartbeat"`, and the same per-device token. The bridge validates the credential for both telemetry and heartbeat messages and removes it before storage.

## Reliability notes

- The offline queue is bounded. When it is full, the firmware does not overwrite older unsent readings.
- LittleFS is mounted without automatic formatting. If the filesystem cannot be mounted, queued persistence is unavailable; the firmware reports the problem rather than erasing stored data.
- PubSubClient publishes telemetry at QoS 0. MW-SENSE therefore uses an application-level acknowledgement after database ingestion rather than claiming broker-level QoS 1 delivery for the node's telemetry publish.
- The bridge publishes acknowledgements at QoS 1. The node keeps the sample until it receives the matching acknowledgement; if it does not, it retries with the same request ID.
- This is an at-least-once retry pattern with idempotent database ingestion, not an end-to-end exactly-once guarantee. Test broker restarts, lost acknowledgements, and power interruption on the target hardware.
- The firmware waits for NTP synchronization. A sample without a trustworthy timestamp is skipped rather than assigned a fabricated time.
- Sensor range limits and calibration must be checked against the actual selected sensor before using the readings operationally.

## Current limitations

The repository does not yet confirm the physical controller revision, DHT22 wiring, power design, enclosure, broker deployment, sensor calibration, or radio coverage. No live broker, hardware, or field test is claimed by the automated build.
