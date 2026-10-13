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
├── telemetry-core.js # Payload validation and gateway contract
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

The monitoring chart and alert feed use records available in the current browser profile. Browser-local records remain on that device and are not shared with other users or devices. Sampling runs in the active page and stops when the user stops it or closes the page. Node activity means a virtual node has delivered a sample during this session; it does not indicate a physical device heartbeat. Thresholds are educational examples, not safety alarms.

## Planned next milestones

1. **Backend service:** implement and deploy the documented telemetry API with authentication, validation, and durable database storage.
2. **Device integration:** connect verified firmware and real telemetry without conflating it with simulation.
3. **Operations:** add access control, retention policy, observability, and deployment documentation.

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

The dashboard accesses readings through a small repository interface (`list`, `append`, and `clear`). The current browser adapter uses `localStorage`; a separate HTTP adapter defines a future `/telemetry` API boundary (`GET`, `POST`, and `DELETE`) but does not imply that a server exists. The repository can create and import version 1.0 JSON snapshots and validates every imported reading before appending it. The local adapter is synchronous; the HTTP adapter is asynchronous, so callers can use either through the same returned interface.

Browser records remain on the current device. If storage is blocked or unavailable, the app continues with session-only data and reports the limitation. This is not a central database, server backup, or cross-device sync. The HTTP API adapter is a contract only; no backend service has been deployed. These tests do not demonstrate physical sensor accuracy, wireless range, electrical reliability, or a deployed gateway/database.
