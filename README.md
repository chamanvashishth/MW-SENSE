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

### API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Service health |
| GET | `/sensors` | Registered sensor definitions |
| GET | `/telemetry` | Read newest records; optional `parameter` and `limit` |
| POST | `/telemetry` | Validate and store a reading |
| DELETE | `/telemetry` | Clear the local development dataset |

The service validates the node/sensor pairing, parameter, unit, ISO 8601 timestamp, numeric range, and payload shape before SQLite accepts a reading. The API assigns the `VALID` status; clients cannot supply it. The `simulation` field is retained so simulated and future device-originated readings remain distinguishable.

### Database location

By default, SQLite creates `backend/mw_sense.db`. Set `MW_SENSE_DB_PATH` to use another path. The database is local development storage, not a hosted production database. The local CORS allowlist can be changed with `MW_SENSE_ALLOWED_ORIGINS` (comma-separated origins).

### Run backend tests

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
```

GitHub Actions now runs the existing Node.js suite and the Python API tests independently. The HTTP adapter in `telemetry-core.js` speaks the API's `{ items, count, limit }` list response format. In the dashboard, select **API server**, confirm the server URL, and choose **Connect**. The dashboard checks `/health` and loads server readings before enabling server-backed transmissions. If the connection fails, readings are not silently written to browser storage. Without `MW_SENSE_API_TOKEN`, data routes are unauthenticated and intended only for local development. A shared bearer token is a basic development safeguard, not full user identity or role-based authorization. Do not expose this service directly to the public internet.
