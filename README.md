# MW-SENSE Virtual Lab

**Modular Wireless Sensor Network for Real-Time Infrastructure and Environmental Monitoring**

MW-SENSE is an educational project workspace for introducing the architecture and data journey of a modular wireless sensor network. This first repository milestone establishes a browser-based virtual lab shell with an interactive, simulated sensor-to-dashboard flow.

> **Simulation notice:** The current lab uses browser-generated values. It can persist validated readings in the current browser profile, but it is not connected to physical sensors, an ESP32/STM32 board, a radio network, a broker, or a central server database. Simulation results must not be presented as hardware test evidence.

## First milestone

- Project introduction and system overview.
- Conceptual six-layer architecture: sensor, edge node, wireless link, gateway, data store, dashboard.
- Adjustable virtual temperature, humidity, air-quality, and soil-moisture values.
- A six-stage telemetry animation: acquisition, validation, transmission, gateway, storage, visualization.
- A browser-persisted data explorer with CSV export, parameter filtering, and a 5,000-record retention limit.
- A live trend chart, configurable virtual sampling, and per-node activity indicators.
- Adjustable threshold checks with a small in-session alert feed.
- Repeatable network presets and a six-step guided walkthrough.
- Simulated wireless-link on/off behavior.
- Responsive dark interface for desktop and mobile.

## Run locally

No build step or package installation is required.

1. Clone the repository.
2. Open `index.html` in a modern browser, or serve the folder with a local static server.

For example, with Python:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Repository structure

```text
MW-SENSE/
├── index.html       # Application layout and sections
├── styles.css       # Responsive visual system
├── app.js           # Browser-side virtual telemetry simulation
├── telemetry-core.js # Payload validation, repository adapters and gateway contract
├── tests/            # Unit and end-to-end pipeline tests
├── .github/workflows/ci.yml # Automated Node.js checks
├── package.json      # Dependency-free test command
├── README.md        # Project overview and setup
└── LICENSE
```

## Conceptual architecture

```text
Sensors → Edge node → Wireless link → Gateway → Data store → Dashboard
```

The design is modular. Actual controller, sensor models, radio protocol, server, and database are deployment decisions and should be documented when verified in the physical implementation.

## Current milestone boundaries

The monitoring chart and alert feed use records loaded from the selected storage destination. Browser-local records remain on that device and are not shared with other users or devices. Sampling runs in the active page and stops when the user stops it or closes the page. Node activity means a virtual node has delivered a sample during this session; it does not indicate a physical device heartbeat. Thresholds are educational examples, not safety alarms.

## Planned next milestones

1. **Backend hardening:** add authentication, authorization, database migrations, retention policies, and production deployment controls.
2. **Device integration:** connect verified firmware and real telemetry without conflating it with simulation.
3. **Operations:** add observability, backup/restore, and deployment documentation.

## Important engineering boundary

A browser simulation can explain data flow and test application behavior. It cannot establish physical sensor accuracy, radio range, power consumption, electrical reliability, or long-duration field performance. Those require documented tests on the selected hardware.

## Project

Repository: https://github.com/chamanvashishth/MW-SENSE


## Telemetry validation and tests

The virtual node validates each payload before the wireless stage. It checks the registered node/sensor pairing, parameter, unit, numeric reading range, timestamp, and explicit simulation marker. Invalid samples stop at the validation stage and are not added to the session dataset.

The validation rules, versioned gateway envelope, and in-memory gateway storage contract live in a small dependency-free module. A version 1.0 envelope contains `schema_version`, `message_type`, `received_at`, and the validated `payload`. This is an application contract for the virtual lab; it is not an MQTT broker, HTTP gateway, or remote database.

The pipeline tests exercise validation → transmission decision → gateway envelope → storage using an in-memory collection. GitHub Actions runs the Node.js suite for pushes and pull requests to `main`.

Run the checks locally with Node.js:

```bash
npm test
```

The dashboard accesses readings through a small repository interface (`list`, `append`, and `clear`). The browser dashboard now offers a storage selector for browser-local storage or a configured FastAPI server. Server mode must be connected explicitly using the API URL and a successful health check before it accepts transmissions. The repository can create and import version 1.0 JSON snapshots and validates every imported reading before appending it. The local adapter is synchronous; the HTTP adapter is asynchronous, so callers can use either through the same returned interface.

Browser records remain on the current device. If storage is blocked or unavailable, the app continues with session-only data and reports the limitation. This is not a central database, server backup, or cross-device sync. The FastAPI service is implemented for local development and is not a production deployment. The browser-to-server path is exercised by the API and adapter tests, but a manual browser session should still be performed in the target environment. These tests do not demonstrate physical sensor accuracy, wireless range, electrical reliability, or hardware deployment.


## Python telemetry API

The repository includes a FastAPI service backed by SQLite. The dashboard can use either browser-local storage or this API through the storage selector in the data explorer.

### Start the API

From the repository root:

```bash
python -m venv .venv
# Windows PowerShell:
.venv\\Scripts\\Activate.ps1
# macOS / Linux:
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
uvicorn backend.main:app --reload --port 8001
```

The API starts at `http://127.0.0.1:8001`. Interactive endpoint documentation is available at `/docs`.

### Optional API authentication

For local development, data routes allow access without a token when `MW_SENSE_API_TOKEN` is not set. To require a bearer token, set the environment variable before starting the server. Keep the token private and do not commit it to the repository.

Windows PowerShell:

```powershell
$env:MW_SENSE_API_TOKEN = (python -c "import secrets; print(secrets.token_urlsafe(32))")
uvicorn backend.main:app --reload --port 8001
```

macOS / Linux:

```bash
export MW_SENSE_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
uvicorn backend.main:app --reload --port 8001
```

When authentication is enabled, enter the same token in the dashboard **API token** field. The browser sends it as a bearer token for sensor and telemetry requests. The `/health` endpoint remains public for connection checks. CORS permits the `Authorization` header. Use HTTPS and a proper secrets manager before deploying beyond localhost; a token entered in a browser is available to that browser session and is not a substitute for user-specific authorization.

### Telemetry reliability

- SQLite schema version 4 is recorded in `schema_migrations`. Startup upgrades earlier databases, adds the idempotency column and device registry when needed, and creates a credential-event audit table.
- Each browser-generated sample carries a request ID. Repeating the same POST with that ID returns the existing record rather than inserting a duplicate.
- `GET /telemetry` accepts `limit` (1–5000) and `offset` (0 or greater). The response includes the total matching `count`, current `offset`, and `next_offset` when another page exists.
- The dashboard HTTP adapter retrieves up to the latest 5,000 server records for its in-memory views. The API can also be queried directly one page at a time.

### Retention, diagnostics, and request logs

Retention is off unless explicitly configured. Set `MW_SENSE_RETENTION_DAYS` to a positive whole number to delete readings older than that many days, based on the server's `received_at` timestamp. Cleanup runs during API startup and after successful ingestion. Set it to `0` (the default) to keep all readings. Choose a period that matches your data policy and keep independent backups before enabling deletion.

Windows PowerShell:

```powershell
$env:MW_SENSE_RETENTION_DAYS = "90"
uvicorn backend.main:app --reload --port 8001
```

macOS / Linux:

```bash
export MW_SENSE_RETENTION_DAYS=90
uvicorn backend.main:app --reload --port 8001
```

The public `/health` endpoint remains a lightweight connection check. The token-protected `/health/diagnostics` endpoint reports SQLite integrity, schema version, database file size, total/simulated/device record counts, latest receipt time, and the configured retention period. It does not return telemetry values or credentials.

API request logs include the HTTP method, route path, response status, and elapsed time. Request bodies, bearer tokens, and query strings are deliberately excluded. Telemetry POST requests may be retried once after a network failure or server-side 5xx response; request IDs make that retry safe against duplicate inserts. Client-side 4xx validation/authentication errors are not retried. If a server write fails, the dashboard marks the API connection as lost and requires an explicit reconnect before further server-backed samples.

### Device registration and heartbeat

The API now keeps a small registry for the three node IDs in the current sensor catalogue (`NODE-01`, `NODE-02`, and `NODE-03`). Registration and heartbeat routes require the configured API bearer token when authentication is enabled.

Register a node:

```bash
curl -X POST http://127.0.0.1:8001/devices \
  -H "Authorization: Bearer $MW_SENSE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"node_id":"NODE-01","label":"North wing sensor node"}'
```

List registered nodes with `GET /devices`. A node without a heartbeat remains `registered`; a node whose last heartbeat is older than `MW_SENSE_DEVICE_OFFLINE_SECONDS` (default 120 seconds) is reported as `offline`. Set a different positive whole number to adjust the window.

#### Per-device MQTT credentials

After registering a node, issue its own MQTT credential using the admin-protected endpoint:

```bash
curl -X POST http://127.0.0.1:8001/devices/NODE-01/credentials \
  -H "Authorization: Bearer $MW_SENSE_API_TOKEN"
```

The response contains a random credential **once**. Copy it into that node's private `firmware/esp32/include/config.h` as `MW_SENSE_DEVICE_TOKEN`. Do not commit or share it. If it is lost, call the endpoint again to rotate it; the previous value stops working immediately. To revoke a credential without issuing a replacement, call `DELETE /devices/NODE-01/credentials`. The node will no longer authenticate until a new credential is issued.

The database stores only a SHA-256 digest of each credential. The MQTT bridge checks the token against the node ID in the topic and payload before accepting telemetry or heartbeats. The token is removed before a reading is validated or stored, so it is never included in telemetry records or API responses. The admin bearer token is required to issue, rotate, revoke, and inspect credential history. `GET /devices/NODE-01/credential-events` returns the last 50 issue/rotate/revoke events without secret material. The device list reports whether a credential is active.

This is application-level device authentication over the TLS connection. Keep broker TLS enabled and configure broker-side per-topic ACLs as an additional boundary. It does not replace broker authentication, certificate verification, or network isolation.

Send a heartbeat:

```bash
curl -X POST http://127.0.0.1:8001/devices/NODE-01/heartbeat \
  -H "Authorization: Bearer $MW_SENSE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firmware_version":"1.0.0"}'
```

A physical telemetry POST (`simulation: false`) is accepted only for a registered node. Successful physical readings also update that node's last-seen time and firmware version. Simulated readings remain available without device registration. This registry currently uses the fixed node IDs in the educational sensor catalogue. Per-device credential issue, rotation, revocation, and audit history are available; arbitrary node provisioning is not implemented yet.

### Firmware telemetry contract

Use ISO 8601 UTC timestamps and include a unique `request_id` so a reconnect or QoS 1 redelivery cannot create duplicate readings. The payload shape is:

```json
{
  "node_id": "NODE-01",
  "sensor_id": "TEMP-01",
  "parameter": "temperature",
  "timestamp": "2026-10-13T10:30:00Z",
  "value": 27.8,
  "unit": "°C",
  "simulation": false,
  "request_id": "node-01-boot-42-sequence-108",
  "firmware_version": "1.0.0"
}
```

The `request_id` should be stable across retries of the same sample and unique for each new sample. The sensor/node pairing, unit, range, timestamp, and payload shape are validated by the same Pydantic contract used by HTTP ingestion. The current sensor catalogue still has fixed example ranges; calibrate and update them against the selected physical sensor before relying on the values.

### ESP32 firmware reference

A PlatformIO reference implementation now lives in `firmware/esp32`. It demonstrates an ESP32 Arduino application with a DHT22 temperature adapter, Wi-Fi and MQTT reconnect attempts, MQTT heartbeat messages, NTP-based timestamps, and a bounded LittleFS queue for readings that could not be published.

The DHT22 is an example sensor only. The exact controller, sensor model, wiring, power supply, pinout and calibration have not been confirmed for the project. The reference currently publishes temperature only; it does not pretend that humidity, air-quality or soil-moisture drivers are implemented.

Build instructions, the firmware payload contract, credential setup and limitations are in [firmware/esp32/README.md](firmware/esp32/README.md). Install PlatformIO, copy `firmware/esp32/include/config.h.example` to `config.h`, configure the network and broker, then run `pio run` from the firmware directory. The local config file is ignored by Git.

The firmware sends telemetry on `mw-sense/{node_id}/{sensor_id}/telemetry` and heartbeat messages on `mw-sense/{node_id}/status`. The MQTT bridge consumes both topics: telemetry updates the stored reading, while heartbeat messages update the registered node's last-seen time and firmware version. Register the node through the API before connecting it.

The example uses PubSubClient, which publishes at QoS 0. A QoS 1 subscription on the bridge does not upgrade the publisher's delivery guarantee. The firmware now requires broker CA certificate validation when TLS is enabled. Add the broker CA PEM as `MQTT_ROOT_CA` in your private `config.h`; without it, the firmware stops before connecting. An explicit `MQTT_ALLOW_INSECURE_TLS` opt-in exists for isolated development only and must remain disabled in real deployments. No live broker, physical board, sensor calibration or radio test is claimed.

### Optional MQTT bridge

MQTT is an independent ingestion process, not a broker bundled into this repository. The bridge subscribes to QoS 1 topics `mw-sense/+/+/telemetry` and `mw-sense/+/status`. It writes validated physical readings to the same SQLite database as the HTTP API and applies registered-device heartbeats to the device registry.

Install its optional dependency:

```bash
python -m pip install -r backend/requirements-mqtt.txt
```

Configure the broker connection using environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `MW_SENSE_MQTT_HOST` | Broker hostname (required) | — |
| `MW_SENSE_MQTT_PORT` | Broker port | `8883` |
| `MW_SENSE_MQTT_CLIENT_ID` | Bridge client ID | `mw-sense-ingest` |
| `MW_SENSE_MQTT_USERNAME` | Broker username | unset |
| `MW_SENSE_MQTT_PASSWORD` | Broker password | unset |
| `MW_SENSE_MQTT_TLS` | Enable TLS | `true` |
| `MW_SENSE_DB_PATH` | SQLite database path | `backend/mw_sense.db` |

Start it in a separate terminal:

```bash
python -m backend.mqtt_bridge
```

MQTT topic format is `mw-sense/{node_id}/{sensor_id}/telemetry`. The topic identity must match the JSON body. The bridge rejects simulated payloads, unknown sensor definitions, missing request IDs, unregistered nodes, and messages without that node's valid device credential. Use broker-side authentication, TLS, and per-topic publish ACLs so each device can publish only to its own node topic. The bridge process uses its own broker credentials from environment variables; per-device application credentials are checked after messages arrive. This API does not configure broker users or ACLs for you.

The MQTT parser, heartbeat handler and database ingestion path are covered by automated tests. A live broker, physical node, Wi-Fi reconnect, firmware build, and sensor calibration have not been tested by CI and must be verified in the target lab.

### API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Public service connection check |
| GET | `/health/diagnostics` | Protected database and retention diagnostics |
| GET | `/sensors` | Registered sensor definitions |
| POST | `/devices` | Register a known node |
| GET | `/devices` | List node status and credential state |
| POST | `/devices/{node_id}/credentials` | Issue or rotate a device credential |
| DELETE | `/devices/{node_id}/credentials` | Revoke a device credential |
| GET | `/devices/{node_id}/credential-events` | Read credential lifecycle history |
| POST | `/devices/{node_id}/heartbeat` | Record an API heartbeat |
| GET | `/telemetry` | Read newest records; optional `parameter`, `limit`, and `offset` |
| POST | `/telemetry` | Validate and store a reading |
| DELETE | `/telemetry` | Clear the local development dataset |

The service validates the node/sensor pairing, parameter, unit, ISO 8601 timestamp, numeric range, and payload shape before SQLite accepts a reading. The API assigns the `VALID` status; clients cannot supply it. The `simulation` field distinguishes virtual samples from physical device readings. Physical readings require a registered node.

### Backup and recovery

The API includes a small SQLite backup utility. It uses SQLite's online backup API, so committed data is copied consistently even when the database uses WAL mode. Backups are verified for SQLite integrity and the required MW-SENSE tables before they are accepted.

Create a timestamped backup:

```bash
python -m backend.backup create
```

Choose a destination:

```bash
python -m backend.backup create --output ./private-backups/mw-sense.sqlite3
```

Verify a backup before storing or restoring it:

```bash
python -m backend.backup verify ./private-backups/mw-sense.sqlite3
```

Restore into a new database path:

```bash
python -m backend.backup restore ./private-backups/mw-sense.sqlite3 --database ./recovered/mw_sense.db
```

Restore deliberately refuses to replace an existing database. Move the current database aside first, and keep a separate copy before recovery. Backups contain telemetry data and should be stored securely; do not commit them to Git or expose them through the web server. These commands are local operator tools, not public API endpoints.

### Database location

By default, SQLite creates `backend/mw_sense.db`. Set `MW_SENSE_DB_PATH` to use another path. The database is local development storage, not a hosted production database. The local CORS allowlist can be changed with `MW_SENSE_ALLOWED_ORIGINS` (comma-separated origins).

### Run backend tests

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
```

GitHub Actions now runs the existing Node.js suite and the Python API tests independently. The HTTP adapter in `telemetry-core.js` follows the API's paginated response and loads up to the latest 5,000 records. In the dashboard, select **API server**, confirm the server URL, and choose **Connect**. The dashboard checks `/health` and loads server readings before enabling server-backed transmissions. If the connection fails, readings are not silently written to browser storage. Without `MW_SENSE_API_TOKEN`, data routes are unauthenticated and intended only for local development. A shared bearer token is a basic development safeguard, not full user identity or role-based authorization. Do not expose this service directly to the public internet.
