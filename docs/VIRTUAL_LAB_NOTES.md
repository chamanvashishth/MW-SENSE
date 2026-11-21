# MW-SENSE implementation notes

## Crosswalk from presentation to interactive lab

| PowerPoint topic | Virtual lab implementation |
| --- | --- |
| The problem | Opening text explaining isolated monitoring and shared observation |
| Objectives and feasibility | Project guide and incremental sensor workflow |
| How the ESP32 solves it | Controller live decision, validation status, source schema |
| Hardware and software | Interactive components, bill of materials, sample periods |
| Circuit diagram | SVG wiring illustration with selected signal paths |
| References and research | Official resources and technical notes |
| Research gap | Fault injection and testing plan |

## Primary source conflicts

The PowerPoint slide 6 shows DHT22 GPIO 4, soil GPIO 34, and a generic analog air sensor GPIO 35. The Tinkered firmware instead connects DHT22 **GPIO 13**, soil **GPIO 34**, and an **SGP40 digital I²C sensor on GPIO 21 and 22**. The user requested to use the hardware in the source ZIP, so the website uses the **Tinkered wiring**. The earlier slide is treated as an illustrative example, not a competing hardware specification.

## Simulation vs real electronics

The inputs control a deterministic teaching model with small oscillations to make graph activity visible. The sensor calculations and cadence are derived from `src/config.h` and relevant routines in `src/main.cpp`. No actual hardware signal is measured and no MQTT packet leaves the browser. The simulated queue and second node are explicitly labelled extensions. The original source is included for students to compare behavior.

## Next milestones

1. Wire the circuit and verify sensor power and I²C discovery.
2. Check ADC calibration and DHT readings against a reference device.
3. Run a private MQTT broker with authentication and secure connectivity.
4. Connect actual hardware packets to a monitoring server with matching message schema.
5. Measure latency, loss and reconnection at varying distances and node counts.