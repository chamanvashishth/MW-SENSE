# Sensor data flow explained

This document explains the **Tinkered ESP32 variant** of MW-SENSE. The original repository's `firmware/esp32/` remains a separate implementation with different wiring and message formats.

## Block 1. Physical environment and wiring

| Measurement | Physical source | Sensor signal | ESP32 connection | Sampling |
|---|---|---|---|---|
| Temperature | DHT22 | Digital temperature reading | DATA to GPIO13, 10 kΩ pullup | 2.5 seconds |
| Relative humidity | DHT22 | Digital relative humidity reading | DATA to GPIO13, 10 kΩ pullup | 2.5 seconds |
| VOC index | SGP40 | Relative VOC algorithm output via I²C | SDA GPIO21, SCL GPIO22; address 0x59 | 1 second |
| Soil raw ADC | Capacitive soil probe | Analog voltage proportional to capacitance | AOUT to ADC1 GPIO34 | 1 second |
| Soil percentage | Derived by ESP32 firmware | Calibrated mapping of the raw ADC count | Uses same GPIO34 sample | 1 second |

Each sensor operates at **3.3 V** with common ground. Power to the ESP32 is through USB. The SGP40's VIN is connected to the 3.3 V supply and its 3V3 breakout pin is not connected in the exported circuit. This wiring is specific to the supplied breakout model.

## Block 2. ESP32 collection

The application in `simulator/tinkered/src/main.cpp` uses `sampleRoom()`, `sampleAir()` and `sampleSoil()`:

1. `sampleRoom` reads temperature and humidity from DHT22 through the Adafruit DHT library.
2. `sampleAir` calls the Adafruit SGP40 VOC index routine using recent DHT temperature and humidity for compensation when available. The index initially reports a warmup state. It is not an AQI or CO2 measurement.
3. `sampleSoil` averages 16 readings of the ESP32's 12-bit ADC. A raw count near either rail is marked as a rail error.

No database, MQTT broker or web page reads electrical sensor pins directly. The **ESP32 is the source** of the readings returned by its local API.

## Block 3. Validate and calibrate

The firmware validates temperature between -40 and 80 °C and humidity between 0 and 100% RH. It separates healthy, loading, stale, error, and warmup states. When a sensor fails, `value` becomes `null`; `last_good_value` is retained separately.

The soil percentage calibration is initially configured as:

```text
Dry endpoint: 3723 ADC -> 0%
Wet endpoint: 1489 ADC -> 100%
Soil percent = round(100 * (raw_adc - 3723) / (1489 - 3723))
```

These are sample endpoints from the Tinkered export, not universal soil probe constants. Real sensors require dry and wet calibration. The firmware flags readings beyond those endpoints rather than falsely reporting a precise percentage.

## Block 4. Wireless message formation

The ESP32 publishes to a configurable MQTT broker after WiFi connects. With the default project namespace, topics are:

```text
mw-sense/<node_id>/telemetry
mw-sense/<node_id>/status
```

It uses `schema_version: 1`, one node payload containing the five measurement keys, and includes error counts and the age of readings. The local host can discover up to eight remote nodes that use **the same Tinkered schema**.

See the real payload format in `simulator/tinkered/README.md` and the actual serialization function `writeNode()` in `src/main.cpp`. Do not treat the illustrative flow diagram as a recorded broker packet.

## Block 5. Observe the data in your browser

When the ESP32 is powered and connected to WiFi, its Serial Monitor prints the local IP address. Open:

- `http://<esp32-ip>/` for the sensor dashboard.
- `http://<esp32-ip>/trace` for the **Sensor Data Journey**. Its card values come directly from `GET /api/nodes` every two seconds.
- `http://<esp32-ip>/api/last-published` to inspect the exact most recent JSON for which `mqtt.publish()` returned success. This does not independently guarantee a broker acknowledged or received the packet.

The trace page never creates synthetic sensor values. Until valid readings are available, values are displayed as unavailable, warming up or loading. With no WiFi or MQTT, local sampling can continue, but the browser view may become unreachable if the WiFi link is down.

## Block 6. Compatibility with the existing GitHub application

**There are two firmware profiles in the repository, and they are not interchangeable:**

| Item | Existing firmware `firmware/esp32` | Imported Tinkered firmware `simulator/tinkered` |
|---|---|---|
| Wiring | Existing repo's DHT22 configuration and other existing implementation details | DHT22 GPIO13, SGP40 I2C 21/22, soil GPIO34 |
| Data topics | `mw-sense/{node_id}/{sensor_id}/telemetry` | `mw-sense/{node_id}/telemetry` |
| Data format | One reading per topic with device credentials and backend-specific schema | Aggregated `schema_version:1` payload with nested `sensors` object |
| Backend compatible without conversion? | Designed for current FastAPI/MQTT bridge | **No**. A versioned protocol adapter and device registration are needed. |
| Local read-only device dashboard | Follow original firmware documentation | `/` and `/trace` on ESP32 |

The existing GitHub site's virtual lab inputs are **simulated** user-defined physical conditions. The imported firmware reports readings acquired through actual or simulated ESP32 sensor interfaces. Do not describe virtual sliders as live hardware telemetry.

## Check the data path in five classroom experiments

1. Change DHT22 temperature in a supported Tinkered sensor simulation. Check that `temperature` changes in `/api/nodes` and on `/trace` after the sampling interval.
2. Change soil moisture. Compare `soil_adc` with `soil_percent` and verify the calibration equation.
3. Start the device with SGP40 warming up. The page must indicate `warming_up`, rather than treating zero as a real VOC measurement.
4. Disconnect the MQTT broker while keeping the ESP32 reachable on WiFi. Compare the still updating local API with the unchanged last-published payload.
5. Reconnect and inspect the sequence number in subsequent MQTT payloads. For a second node, use a distinct node ID and the same MQTT namespace, then check registry discovery.

**Current verification:** Tinkered export metadata reports a successful compile and structural wiring check. Those claims come from the export metadata. Physical assembly, broker delivery, long-duration reliability and all five classroom experiments still need real verification.
