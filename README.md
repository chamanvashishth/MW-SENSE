# MW-SENSE Virtual Lab

**Modular Wireless Sensor Network for Real-Time Infrastructure and Environmental Monitoring**

MW-SENSE is an educational workspace for understanding a modular wireless sensor network, from sensor acquisition through edge processing and wireless delivery to a gateway, storage, and dashboard.

> **Simulation boundary:** Browser-generated readings are explicitly marked as simulated. A successful software test does not validate physical sensor accuracy, radio range, power consumption, or field reliability.

## What is included

- Browser-based sensor dashboard with temperature, humidity, air-quality, and soil-moisture channels.
- Configurable virtual sampling, threshold alerts, trend visualization, and CSV/JSON data exchange.
- Six-stage telemetry path: acquisition, validation, transmission, gateway, storage, and visualization.
- Browser-local persistence or an optional FastAPI + SQLite service.
- API device registration, heartbeat/health diagnostics, credential lifecycle, retention controls, and paginated telemetry.
- Optional MQTT bridge and ESP32 reference firmware with a bounded offline queue and application-level acknowledgements.
- Node, Python API, browser, and native firmware-queue tests.

## Run the dashboard and API locally

Requirements: Python 3.10+ (Python 3.12 is used by CI), Node.js 22+, and a modern browser.

### Windows PowerShell

```powershell
git clone https://github.com/chamanvashishth/MW-SENSE.git
cd MW-SENSE
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
python scripts/dev.py
```

### macOS / Linux

```bash
git clone https://github.com/chamanvashishth/MW-SENSE.git
cd MW-SENSE
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
python scripts/dev.py
```

Open **http://127.0.0.1:8000** for the dashboard and **http://127.0.0.1:8001/docs** for the API documentation. The API health check is at `http://127.0.0.1:8001/health`. Press `Ctrl+C` in the terminal to stop both processes.

The helper binds both servers to loopback only. It uses SQLite at the configured local default path. To use a separate database file, set `MW_SENSE_DB_PATH` before starting the helper. The default local setup does not require an API token; see the authentication section below to enable one.

### Start only one service

Dashboard only:

```bash
python -m http.server 8000
```

API only:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

Select **API server** in the dashboard storage selector, enter `http://127.0.0.1:8001`, and connect. The server is not selected or used automatically.

## Run tests

Install Node.js and the Python development dependencies, then run:

```bash
npm run check
npm test
python -m pytest backend/tests -q
```

For real Chromium UI checks, install the isolated browser dependency and browser binary:

```bash
python -m pip install -r requirements-browser.txt
python -m playwright install chromium
python tests/browser_smoke.py
```

The browser smoke suite starts a temporary API database and ephemeral local ports. It exercises browser-local transmission, offline-link rejection, API-backed storage, device registration and credential lifecycle, diagnostics, CSV export, and mobile navigation. It is a software regression test, not a physical hardware test.

The ESP32 reference firmware has a separate PlatformIO build. Install PlatformIO, copy `firmware/esp32/include/config.h.example` to `firmware/esp32/include/config.h`, then run:

```bash
pio run -d firmware/esp32
```

No command above flashes a board. Hardware validation requires the actual selected board, sensors, broker, network, and a recorded test procedure.

## Architecture

```text
Sensors → ESP32/edge node → Wi-Fi/MQTT → Gateway/API → SQLite → Dashboard
```

The browser lab simulates this path. The Python API and optional MQTT bridge implement software services. The ESP32 directory contains reference firmware; it is not proof of a deployed hardware network.

## Optional API authentication

For local development, routes are unauthenticated unless `MW_SENSE_API_TOKEN` is set. To enable bearer-token checks:

Windows PowerShell:

```powershell
$env:MW_SENSE_API_TOKEN = (python -c "import secrets; print(secrets.token_urlsafe(32))")
python scripts/dev.py
```

macOS / Linux:

```bash
export MW_SENSE_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python scripts/dev.py
```

Enter the same token in the dashboard API token field. Keep it private and do not commit it. The health endpoint remains public. This local token mechanism is not a replacement for user-specific authorization, HTTPS, or a production secrets manager.

## Optional MQTT bridge

Install `backend/requirements-mqtt.txt` and configure broker settings using environment variables documented in `backend/mqtt_bridge.py` and the ESP32 README. Do not place real broker credentials in tracked files. Test reconnect, broker restart, lost acknowledgements, queue recovery, and TLS using the target broker and board before deployment.

## Deployment and engineering limits

Read [the deployment checklist](docs/DEPLOYMENT_CHECKLIST.md) before any pilot. Configure authentication, allowed origins, database backups, retention, TLS, monitoring, and access controls for a deployed service. Retention is disabled by default; set `MW_SENSE_RETENTION_DAYS` to a positive integer only after choosing and documenting a data-retention policy.

Repository: https://github.com/chamanvashishth/MW-SENSE
