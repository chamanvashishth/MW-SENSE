# MW-SENSE
ESP32 environmental sensing with a local live dashboard and MQTT telemetry.

## What it does
Reads temperature and humidity from a DHT22, a relative VOC index from an SGP40, and raw and calibrated soil moisture from a capacitive probe. The ESP32 validates readings, reports sensor errors and stale data, and serves a dashboard while publishing telemetry to MQTT. Its bounded registry supports the local node plus up to eight remote nodes using the same schema.

## Hardware
Breadboard prototype components from `wiring/wiring.json` and the cross-reference BOM:

| ID | Qty | Part | Details |
|---|---:|---|---|
| `bb_1` | 1 | Full-size breadboard | — |
| `esp32_1` | 1 | ESP32 DevKit V1 (30-pin) | USB-powered development board |
| `dht_1` | 1 | DHT22 temperature and humidity sensor | 3.3 V |
| `air_1` | 1 | SGP40 VOC sensor | 3.3 V |
| `soil_1` | 1 | Capacitive soil moisture sensor | 3.3 V |
| `dht_pullup` | 1 | Resistor | 10 kΩ, 1/4 W |
| — | 14 | Jumper wires | Male-to-male per BOM |

## Schematic
The provided `schematic/main.sch` has no `.block` annotations; its components form one sensor-and-controller circuit:

- `U2` is the ESP32. GPIO13 (`N_IO13`) reads `U3` DHT22 data; GPIO34 (`N_IO34`) reads `U1` soil-sensor output; GPIO21 (`N_IO21`) and GPIO22 (`N_IO22`) connect to `U4` SGP40 SDA and SCL.
- `R1` (10 kΩ) pulls `N_IO13` up to `V33`.
- Net `V33` powers the sensors and pull-up; net `0` is ground. USB 5 V enters at the ESP32 development board; its 3.3 V output supplies the breadboard’s positive rail.

## Wiring
Power the ESP32 from USB. The breadboard’s positive rail is connected to ESP32 `3V3`; its negative rail is connected to `GND_L`. The soil probe uses its supplied leads.

| Part pin | Connect to |
|---|---|
| ESP32 `3V3` | Breadboard positive rail |
| ESP32 `GND_L` | Breadboard negative rail |
| DHT22 `VCC` | 3.3 V positive rail |
| DHT22 `DATA` | ESP32 `IO13` |
| DHT22 `GND` | Ground rail |
| 10 kΩ resistor, one end | DHT22 `DATA` / ESP32 `IO13` |
| 10 kΩ resistor, other end | 3.3 V positive rail |
| SGP40 `VIN` | 3.3 V positive rail |
| SGP40 `GND` | Ground rail |
| SGP40 `SDA` | ESP32 `IO21` |
| SGP40 `SCL` | ESP32 `IO22` |
| Soil sensor `VCC` | 3.3 V positive rail |
| Soil sensor `GND` | Ground rail |
| Soil sensor `AOUT` | ESP32 `IO34` |

In the supplied wiring, the SGP40’s `3V3` pin is not connected; its `VIN` pin is connected to the 3.3 V rail. ESP32 `VIN` is not used.

## Firmware
The firmware samples DHT22 every 2,500 ms, soil ADC every 1,000 ms, and VOC every 1,000 ms. It averages 16 soil ADC samples at 12-bit resolution with 11 dB attenuation. MQTT telemetry is published every 5,000 ms. Dashboard data is polled every 2 seconds.

Sensor checks and status behavior:

- DHT22 temperature must be finite and within −40 to 80 °C; humidity must be finite and within 0 to 100 %RH. Failed readings report `error`; previous good values remain labeled as last-good, not current.
- Soil readings near the ADC rails (raw ≤16 or ≥4079) report `rail_error`. A non-rail raw ADC value remains available even when outside calibration; in that case `soil_percent` reports `out_of_calibration`. A plausible ADC value cannot reliably detect a disconnected probe.
- Soil percentage uses the configured dry endpoint `3723` ADC and wet endpoint `1489` ADC. Those endpoints map to 0% and 100%, respectively. Calibrate them for the actual probe and soil; values outside the endpoints are flagged, not clamped.
- The SGP40 is checked at I²C address `0x59`. On initialization, its VOC algorithm warms up for about 45 seconds. A zero index during learning is `warming_up`; valid index values are 1–500. Failed measurements report `error` and trigger retries with backoff. The VOC index is relative to recent air history: it is **not** AQI, CO₂, or a pollutant concentration.
- Initial readings are `loading`. Healthy readings become `stale` when older than 10 seconds for temperature/humidity or 3,500 ms for VOC/soil. Sensor records include age, error count, consecutive error count, and last-good value.

The dashboard shows temperature, humidity, VOC index, soil percentage, raw soil ADC, node state, and Wi-Fi/MQTT health. The host serves it at `/` and its JSON API at `/api/nodes`. The dashboard marks remote telemetry stale after 20 seconds without a message, based on MQTT reception time.

**Build and flash:** Install PlatformIO, then build the `esp32dev` environment and upload over the physical ESP32’s USB serial connection:

```sh
pio run -e esp32dev
pio run -e esp32dev -t upload
pio device monitor -b 115200
```

Set `WIFI_SSID` and `WIFI_PASSWORD` in `src/config.h` before using real hardware. The firmware attempts Wi-Fi even with the supplied placeholder credentials and retries periodically. With the default `DASHBOARD_HOST = true`, it prints the DHCP dashboard URL to the serial monitor after connecting.

**MQTT configuration and nodes:** The firmware defaults to `broker.hivemq.com:1883`, namespace `mw-sense`, with no MQTT username or password. These connections are plaintext; use a trusted LAN/private broker. Each node ID is `mw-` plus the lowercase 12-digit MAC address unless `NODE_ID_OVERRIDE` is set. Overrides must be unique per physical node, at most 32 characters, and use only letters, digits, `_`, or `-`. The MQTT client ID is `mws-<node_id>`.

Topics:

- Telemetry: `mw-sense/<node_id>/telemetry` (retained, every 5 seconds).
- Status: `mw-sense/<node_id>/status` (retained; offline last will).
- Discovery subscriptions: `mw-sense/+/telemetry` and `mw-sense/+/status`.

Schema version 1 telemetry contains `schema_version`, `node_id`, `sequence`, `uptime_ms`, `compensation`, and `sensors`. Each sensor entry has `value`, `unit`, `status`, `age_ms`, `error_count`, `consecutive_errors`, and `last_good_value`. When a reading is not healthy, its current `value` is `null`; any prior measurement is explicitly reported as `last_good_value`. Units are `C`, `%RH`, `index`, `%`, and `ADC counts` for `temperature`, `humidity`, `voc_index`, `soil_percent`, and `soil_adc`. The `compensation` field is `recent_dht` when recent DHT values are available, otherwise `fallback_25C_50RH`. Status messages contain `schema_version`, `node_id`, and `status` (`online` or `offline`).

For additional nodes, use the same broker and namespace, give each a unique ID, and set `DASHBOARD_HOST = false` on nodes that should not host the centralized dashboard. The host accepts up to eight remote nodes and does not silently evict entries when its registry is full.

**Simulator and verification:** The 3D simulator session is limited to 5 minutes and provides a built-in MQTT broker. The firmware configuration shown here targets real hardware and HiveMQ; set `MQTT_HOST` and `MQTT_PORT` to the simulator broker’s supplied address when using that broker. Firmware compilation succeeded in two rounds and circuit checks were verified. An end-to-end simulation and Wi-Fi/MQTT runtime were **not** exercised.

## Assembly
1. Place the ESP32, sensors, and 10 kΩ DHT pull-up on the breadboard and make the connections listed above.
2. Check the connections and power rails before powering the circuit.
3. Set Wi-Fi and, if needed, MQTT settings in `src/config.h`; build and flash over USB serial.
4. Fit the prototype in its intended setup and power the ESP32 from USB. Check that the dashboard appears at the printed URL and that readings and status behavior match the expected sensors.

## How to use
Power the ESP32 from USB. After Wi-Fi connects, open the printed `http://<ESP32-IP>/` URL from a device on the same network. The read-only dashboard refreshes automatically and shows sensor status, reading age, errors, and last-good values. If MQTT is unavailable, local sensing and the HTTP dashboard continue; the Wi-Fi and MQTT indicators show connection state.

## Files
- `README.md` — project overview and setup.
- `design/spec.json` — project intent, power, and acceptance criteria.
- `wiring/wiring.json` — breadboard parts and point-to-point wiring.
- `schematic/main.sch` — schematic component and net connections.
- `specs/bom.json` — breadboard component cross-reference.
- `platformio.ini` — PlatformIO environment and library dependencies.
- `src/config.h` — pins, network settings, node identity, calibration, and intervals.
- `src/main.cpp` — sensing, validation, HTTP service, and MQTT behavior.
- `src/dashboard.h` — embedded dashboard page.
- `docs/steps.json` — project steps data.
- `.tinkered/firmware.json` — project firmware metadata.