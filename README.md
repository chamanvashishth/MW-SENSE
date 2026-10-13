# MW-SENSE Virtual Lab

**Modular Wireless Sensor Network for Real-Time Infrastructure and Environmental Monitoring**

MW-SENSE is an educational project workspace for introducing the architecture and data journey of a modular wireless sensor network. This first repository milestone establishes a browser-based virtual lab shell with an interactive, simulated sensor-to-dashboard flow.

> **Simulation notice:** The current lab uses browser-generated values and an in-memory demonstration flow. It is not connected to physical sensors, an ESP32/STM32 board, a radio network, a broker, or a persistent database. Simulation results must not be presented as hardware test evidence.

## First milestone

- Project introduction and system overview.
- Conceptual six-layer architecture: sensor, edge node, wireless link, gateway, data store, dashboard.
- Adjustable virtual temperature, humidity, air-quality, and soil-moisture values.
- A six-stage telemetry animation: acquisition, validation, transmission, gateway, storage, visualization.
- A session data explorer with CSV export and parameter filtering.
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
├── README.md        # Project overview and setup
└── LICENSE
```

## Conceptual architecture

```text
Sensors → Edge node → Wireless link → Gateway → Data store → Dashboard
```

The design is modular. Actual controller, sensor models, radio protocol, server, and database are deployment decisions and should be documented when verified in the physical implementation.

## Current milestone boundaries

The monitoring chart and alert feed use only records created in the current browser session. Sampling runs in the active page and stops when the user stops it or closes the page. Node activity means a virtual node has delivered a sample during this session; it does not indicate a physical device heartbeat. Thresholds are educational examples, not safety alarms.

## Planned next milestones

1. **Architecture explorer:** inspect each layer, interfaces, payloads, and responsibilities.
2. **Node simulator:** add multiple nodes, sensor configuration, sampling intervals, and node health.
3. **Network experiments:** configurable latency, packet loss, disconnection, retry, and recovery.
4. **Data explorer:** inspect records, validation outcomes, and session history.
5. **Dashboard:** time-series trends, parameter cards, node state, and alerts.
6. **Testing centre:** repeatable unit, integration, wireless-link, and recovery scenarios.
7. **Hardware integration:** connect verified firmware and real telemetry without conflating it with simulation.

## Important engineering boundary

A browser simulation can explain data flow and test application behavior. It cannot establish physical sensor accuracy, radio range, power consumption, electrical reliability, or long-duration field performance. Those require documented tests on the selected hardware.

## Project

Repository: https://github.com/chamanvashishth/MW-SENSE
