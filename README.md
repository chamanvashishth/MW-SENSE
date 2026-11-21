# MW-SENSE Virtual Laboratory

**Modular Wireless Sensor Network for Real Time Infrastructure and Environmental Monitoring**

An interactive virtual lab styled after the eight-slide MW-SENSE presentation. The browser model lets students change environmental conditions and observe how a DHT22, an SGP40 and a capacitive soil probe become validated ESP32 telemetry, MQTT frames and dashboard records.

> **Simulation notice:** The site does not read a physical ESP32. All values and packet delivery events are generated locally. Nothing is transmitted to a broker or cloud service. The original physical firmware remains available in `source/tinkered`.


## Open the rebuilt lab

The interactive website is the repository's new [main page](index.html). For a browser demo without installing software download [MW_SENSE_Lab_Demo.html](MW_SENSE_Lab_Demo.html) and open it locally. GitHub Pages can host the same static site from the main branch root if Pages is enabled in repository settings.

The previous virtual lab interface is preserved at [legacy/index.html](legacy/index.html) and the prior detailed README at [docs/README_PREVIOUS.md](docs/README_PREVIOUS.md). The earlier FastAPI backend and original PlatformIO firmware under `backend/` and `firmware/esp32/` remain in the repository. They are independent from the new browser simulation. The uploaded Tinkered firmware and its actual pin map are preserved in [source/tinkered](source/tinkered/README.md).

## Start the website

For the simplest experience, open the accompanying **MW_SENSE_Lab_Demo.html** file in any modern browser. That version includes all code and styles and works without an internet connection.

For the modular website version run:

```sh
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Use the five tabs: **Virtual environment**, **Hardware and wiring**, **Data journey**, **Reliability tests**, and **Project guide**.

## What students can do

1. Load **Normal room**, **Greenhouse**, **Heatwave**, **Poor ventilation**, or **After rainfall**, or use the four sliders to adjust conditions directly.
2. Watch temperature, humidity, VOC index and soil moisture readings change. Each sensor responds at the rate defined in the provided source rather than instantly or simultaneously.
3. Inspect the animated wiring diagram to identify exactly which signal enters each ESP32 pin. Select a component to see its measured output and validation logic.
4. Watch the full data path: **Sense → Validate → Encode → Transmit → Store → Visualize**.
5. Inspect the actual simulated JSON packet and the reception table. Add a second **emulated** node to see why IDs and a consistent data schema matter.
6. Inject DHT22, SGP40, soil ADC, WiFi and MQTT failures. The model labels invalid current readings and keeps the last known good value separate.
7. Change the simulation clock between 1×, 2× and 4× to get through the VOC warm up period faster, or pause and reset.

## Source based hardware mapping

The Tinkered ZIP is the definitive source of the pin map used by this virtual lab. The earlier presentation's generic circuit slide used different example pins. Those are not the pin assignments implemented by the supplied Tinkered firmware.

| Physical part | ESP32 connection | Lab behaviour |
| --- | --- | --- |
| DHT22 | Data on **GPIO 13** | Digital temperature and relative humidity every 2500 ms |
| SGP40 VOC sensor | I²C SDA **GPIO 21**, SCL **GPIO 22**, address **0x59** | Relative VOC index every 1000 ms after about 45 seconds warm up |
| Capacitive soil moisture v1.2 | Analog output **GPIO 34**, ADC1 | 16-sample 12-bit ADC average every 1000 ms |
| 10 kΩ resistor | Between DHT data and 3.3 V rail | Data line pullup |
| ESP32 DevKit V1 (30 pin) | USB power | 3.3 V supply to sensors, common GND |
| Breadboard and jumper wires | 3.3 V rail and GND rail | Physical connections, 14 jumper wires in uploaded BOM |

The SGP40 reports a **relative VOC index**. It is **not CO₂**, **not gas PPM**, and **not a certified AQI**. The displayed virtual VOC index moves toward the scenario value as a teaching approximation after warm up.

### Soil calibration

The supplied `config.h` defines dry ADC count **3723** and wet ADC count **1489**. The model estimates:

```text
moisture (%) = 100 × (3723 − ADC) / (3723 − 1489)
```

Values outside those calibration endpoints are flagged and not silently shown as healthy moisture percentages. ADC rail values near 0 or 4095 are treated as errors. A realistic looking ADC value does **not** guarantee a probe is connected. For physical deployment you must calibrate the real probe against dry and wet soil.

### Other validation rules

- The DHT22 firmware checks temperature between **−40 and 80 °C** and humidity between **0 and 100 %RH**.
- The VOC sensor reads once per second and can take about **45 seconds** to return a useful nonzero index. If recent DHT data is unavailable it falls back to **25 °C and 50 %RH** for algorithm compensation.
- Healthy readings older than **10 seconds** (DHT) or **3.5 seconds** (VOC or soil) are marked stale in the Tinkered firmware.
- Every **5 seconds** the firmware creates a telemetry message containing node identity, sequence number, uptime, compensation method and individual sensor statuses.
- Invalid current readings use `null`, while `last_good_value` remains a separate field. The virtual lab follows the same principle.

## How the ESP32 responds

```text
Environment condition
       ↓
DHT22 digital value   SGP40 I²C index   Soil ADC counts
       ↓                  ↓                 ↓
              ESP32 sensor routines
       ↓
    Validate signal and value
       ↓
  Identify node and sensor fields
       ↓
       Encode JSON frame
       ↓
          WiFi + MQTT
       ↓
       Monitoring record
       ↓
    Dashboard and history
```

### Fault injection is an educational extension

The supplied Tinkered firmware **does not implement an offline persistent telemetry queue**. This virtual lab has a bounded **in memory demonstration queue** to explain a possible store and forward design. It flushes held packets when the simulated link returns, while preserving their original virtual uptime. This behaviour **must not** be attributed to the physical ESP32 until it has been implemented and verified there.

Likewise, the second node is emulated with shifted readings and unique IDs. It is not a second hardware device. Real RF attenuation, interference, sensor drift, electrical noise, power budgets, physical failures and broker authentication are not modelled.

## Files

```text
site/
├── index.html              App UI, accessible controls and the wiring illustration
├── lab/
│   ├── style.css           Responsive PowerPoint inspired theme
│   ├── app.mjs             View logic, controls, graphs and event inspector
│   └── engine.mjs          Testable model for sensors, validation and transport
├── tests/
│   └── lab.test.mjs        Six runnable tests for sampling, warm up and fault recovery
├── docs/
│   └── PROJECT_NOTES.md    Scope, source distinction and future validation plan
└── source/tinkered/       The supplied Tinkered project for comparison
```

## Run tests

From the website root:

```sh
node --test tests/lab.test.mjs
```

A browser smoke check was also performed on Chromium by injecting the application into a permitted about:blank page. The virtual lab rendered without JavaScript errors, the five navigation sections opened, network recovery controls worked, and a mobile viewport had no horizontal overflow. This smoke check is not a physical hardware validation.

## Tinkered firmware

The physical C++ implementation and wiring exports live in `source/tinkered` in this downloadable package:

```sh
cd source/tinkered
pio run -e esp32dev
pio run -e esp32dev -t upload
pio device monitor -b 115200
```

Before flashing, edit `src/config.h` for your WiFi access and trusted MQTT broker. The supplied firmware defaults to a publicly reachable broker on **plaintext port 1883** with no authentication and a local HTTP dashboard. Do not expose this configuration to an untrusted or public deployment. See the firmware README for network limitations and sensor calibration details.

## Research gap and next experimental work

The academic proposal calls out reliability, communication recovery and scaling across low cost nodes. A real evaluation should record MQTT delivery rate, network outages, recovery time, power consumption, measurement accuracy against reference instruments, calibration stability and behaviour with several physical ESP32 nodes. The virtual lab helps explain these tests but does not replace them.

## References

- [Espressif ESP32 documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/)
- [Sensirion SGP40 documentation](https://sensirion.com/products/catalog/SGP40)
- [Adafruit DHT sensor guide](https://learn.adafruit.com/dht)
- [MQTT information and specification links](https://mqtt.org/)
- [Wokwi ESP32 simulator documentation](https://docs.wokwi.com/)

**Presentation source:** `MW_SENSE_Synopsis_Aligned_Final(1).pptx` (provided by the user). The page styling uses its warm off white `#F7F5F0`, strong charcoal type, subtle borders and modular panels. The website content reflects the actual pin map and component list in the uploaded Tinkered ZIP.