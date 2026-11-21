# MW-SENSE Virtual Laboratory

**Modular Wireless Sensor Network for Real Time Infrastructure and Environmental Monitoring**

A classroom focused virtual lab using the warm off white and charcoal theme of the MW-SENSE PowerPoint. Explore how environmental data reaches the sensor processing model, is validated by the virtual ESP32, becomes a telemetry frame, and arrives at a simulated monitoring dashboard.

**[Open the standalone dataset replay lab](MW_SENSE_Research_Replay_2026.html)**

You can also download the HTML file and open it in your browser without installing dependencies. GitHub does not execute an HTML file as a live app in its code viewer. For an online website, serve the repository root locally or enable GitHub Pages from the main branch.

## What is simulated and what is measured?

Two input modes are offered.

**Synthetic environment** uses adjustable temperature, humidity, VOC target and soil conditions. The browser models DHT22 readings every 2.5 seconds, SGP40 relative VOC behaviour every 1 second, soil ADC acquisition every 1 second, and MQTT publishing every 5 seconds. The VOC approximation is for teaching. It is **not** Sensirion's official Gas Index Algorithm.

**Recorded dataset replay** uses historical published measurements. Source records are preserved with their original observation number or timestamp. They are reprocessed through the educational pipeline on a compressed replay clock, not transmitted by any real connected ESP32. The dataset verifier compares each recorded value with the resulting reading and marks it MATCH, SAMPLING, ERROR or NOT RECORDED.

## Research datasets

| Dataset | Replay excerpt | Observed fields | Original source |
|---|---:|---|---|
| University of Ngaoundéré Greenhouse Scenario 1 | 40 consecutive Sensor 1 records | Temperature, humidity, soil humidity and RSSI | [Original CSV](https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments/blob/master/Dataset_scenario_1.csv) |
| University of Ngaoundéré Greenhouse Scenario 4 | 40 consecutive Sensor 1 records | Temperature, humidity, soil humidity and RSSI | [Original CSV](https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments/blob/master/Dataset_scenario_4.csv) |
| UCI Air Quality | 40 consecutive hourly observations, March 2004 | Temperature, relative humidity and original metal oxide sensor response | [UCI source](https://archive.ics.uci.edu/dataset/360/air+quality) |

UCI Air Quality is documented under **CC BY 4.0**. The greenhouse repository describes measurements taken every 30 minutes and provides CSV files, but does not visibly state a dataset license. The excerpts are attributed for educational inspection. The greenhouse CSV gives sample numbers but no absolute timestamps. The lab never invents source collection timestamps.

**Important sensor distinctions:** Neither dataset contains a native Sensirion SGP40 VOC Index or ESP32 analog to digital conversion counts. Replay marks these as **NOT RECORDED**. The metal oxide response in the UCI dataset is from a different sensor and is not a VOC Index, CO concentration or AQI. A source reported zero soil moisture remains zero rather than silently becoming a missing value. RSSI comes from the dataset source equipment, not from this simulated ESP32 network.

## Operating the lab

1. Select **Virtual environment** and choose **Greenhouse Scenario 1**, **Greenhouse Scenario 4**, or **UCI Air Quality** from Input Data Source.
2. Read the source record on the right. Observe the comparison table showing the original values alongside the simulated ESP32 output.
3. Use **Pause simulation** to freeze the clock and sensor pipeline, **Step 1 s** to inspect the next event, **Next source record** to jump to another historical observation, and **Reset lab** to restart the current dataset.
4. Open **Data journey** to inspect the structured MQTT frame, node ID, source dataset, reading statuses and in memory reception table.
5. Open **Reliability tests** and inject sensor faults or a WiFi outage. Observe null readings, errors, queued frames and simulated recovery.
6. Download the original observation with **Save record** or the full processed history using **Export output trace**.
7. Import your own simple CSV. The accepted columns are `temperature`, `humidity`, `soil_moisture`, with optional `timestamp` and `rssi`. Imported rows are labelled user supplied, not verified. Maximum 1 MB and 10,000 rows.

The original greenhouse sampling interval is about 30 minutes according to its source README. **Every recorded sample plays back over 6 virtual seconds** in this teaching model. UCI source observations are hourly, and their original time strings are retained.

## Actual hardware described in the supplied Tinkered ZIP

| Part | ESP32 connection | Interface |
|---|---|---|
| DHT22 | GPIO 13 with 10 kΩ pullup | Digital temperature and humidity |
| Sensirion SGP40 | GPIO 21 SDA and GPIO 22 SCL | I²C, address 0x59 |
| Capacitive soil probe v1.2 | GPIO 34 | ADC1 analog input |
| ESP32 DevKit V1 | USB power, shared regulated sensor power and ground | Processor and wireless node |

The uploaded original source is preserved in [source/tinkered](source/tinkered/README.md). The original separate firmware and FastAPI backend directories are still available in this repository.

## Issues investigated and corrected

- **Moisture endpoint bug:** Clamped synthetic ADC jitter so valid 0% and 100% endpoints do not falsely become calibration errors.
- **Scheduler order:** Sensor, dataset and MQTT jobs now execute in timestamp order, preventing time reversal on fast playback.
- **Reset leakage:** Changing or resetting a source clears history and old sensor state.
- **Error visibility:** An injected failed sensor displays ERROR rather than an incorrect waiting or matching state.
- **False measurements:** UCI metal oxide output is never represented as SGP40 VOC Index; missing soil and analog ADC readings remain null.
- **Pause and recovery:** Recovering WiFi while paused no longer flushes the queue until the simulation advances.
- **Provenance:** Each replay packet includes a dataset identifier, source sample and `simulation: true`.

Run the test suite with `node --test`. This version adds ten replay regression tests to the original six simulator tests. Browser checks also covered dataset selection, pause, step, reset, CSV import, WiFi queue recovery and mobile layout.

## Repository structure

```text
index.html              Responsive site using the presentation theme
lab/app.mjs             UI controls and source verification table
lab/engine.mjs          Simulation scheduler and ESP32 teaching model
lab/datasets.mjs        Attributed recorded source excerpts and CSV parser
lab/style.css           Responsive site styling
tests/                  Node regression tests
source/tinkered/         Original supplied firmware, circuit and wiring
MW_SENSE_Lab_Demo.html  Single file offline demo
```

To run locally: `python -m http.server 8000` from the repository root, then open `http://localhost:8000`.

## References and research gap

- [UCI Air Quality dataset](https://archive.ics.uci.edu/dataset/360/air+quality)
- [Greenhouse wireless sensor network repository](https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments)
- [Soil moisture and temperature dataset from Universidad Loyola](https://data.mendeley.com/datasets/fpbfmc9vnm/1) as a future source for soil validation. Not bundled.
- [Sensirion Gas Index Algorithm](https://github.com/Sensirion/gas-index-algorithm), for generating VOC Index from actual SGP40 sensor ticks.
- [Espressif ESP32 technical documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/).

This lab checks **software replay, data correctness and simulated failure handling**, not actual field performance. Real-world validation is still required for sensor accuracy, analog calibration, gas response, WiFi packet loss, reconnection, battery power and multi-node reliability.

Academic project by Chaman Vashishth and Vineet Sharma. Dayalbagh Educational Institution Agra.
