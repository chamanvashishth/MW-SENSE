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
- Queues readings in LittleFS when publishing is unavailable, then drains the queue after reconnecting.
- Gives each sample a request ID so the backend can safely handle duplicate delivery.

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

Edit `include/config.h` and set the Wi-Fi credentials, broker hostname, broker port, broker username/password, node ID, and sensor pin. The real `config.h` is ignored by Git; do not commit it.

Register the node with the API before sending physical telemetry. The node ID must be one of the currently supported catalogue IDs.

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

The request ID remains stable when the same queued message is retried. The backend uses it to avoid inserting the same sample more than once.

Heartbeat messages use `mw-sense/{node_id}/status` and include the node ID, firmware version, and `event: "heartbeat"`.

## Reliability notes

- The offline queue is bounded. When it is full, the firmware does not overwrite older unsent readings.
- LittleFS is mounted without automatic formatting. If the filesystem cannot be mounted, queued persistence is unavailable; the firmware reports the problem rather than erasing stored data.
- The example uses PubSubClient, which publishes at QoS 0. The bridge's QoS 1 subscription does not upgrade the publisher's delivery guarantee.
- The request ID protects against duplicate application ingestion, but it is not a substitute for broker-level delivery guarantees.
- The firmware waits for NTP synchronization. A sample without a trustworthy timestamp is skipped rather than assigned a fabricated time.
- Sensor range limits and calibration must be checked against the actual selected sensor before using the readings operationally.

## Current limitations

The repository does not yet confirm the physical controller revision, DHT22 wiring, power design, enclosure, broker deployment, sensor calibration, or radio coverage. No live broker, hardware, or field test is claimed by the automated build.
