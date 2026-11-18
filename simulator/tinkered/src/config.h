#pragma once

// Resolved from the supplied wiring/wiring.json pin-map. No runtime remapping.
#define ROOM_SENSOR_PIN 13
#define SOIL_INPUT_PIN 34
#define AIR_SDA_PIN 21
#define AIR_SCL_PIN 22

constexpr unsigned char AIR_SENSOR_ADDR = 0x59;

// Always attempted, including with these simulator-compatible placeholders.
constexpr char WIFI_SSID[] = "YOUR_WIFI_SSID";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";

constexpr char MQTT_HOST[] = "broker.hivemq.com";
constexpr unsigned short MQTT_PORT = 1883;
constexpr char MQTT_USERNAME[] = "";
constexpr char MQTT_PASSWORD[] = "";
constexpr char PROJECT_NAMESPACE[] = "mw-sense";

// Empty => mw- followed by all 12 MAC hex digits. Allowed: A-Z a-z 0-9 _ -.
// Each physical node MUST have a unique ID. Client ID is derived from that ID.
constexpr char NODE_ID_OVERRIDE[] = "";
// Future sensor nodes use the same broker/namespace and set this false.
// Only the designated dashboard host needs the centralized registry/web service.
constexpr bool DASHBOARD_HOST = true;

// Real hardware: HTTP and MQTT/1883 are plaintext and unauthenticated by default.
// Use a trusted LAN/private broker. This firmware does not implement TLS,
// authorization, public configuration, or secure Internet-facing hosting.
constexpr int SOIL_DRY_ADC = 3723;
constexpr int SOIL_WET_ADC = 1489;
constexpr int SOIL_RAIL_MARGIN = 16;
constexpr unsigned SOIL_AVERAGE_SAMPLES = 16;
// Outside calibrated endpoints is flagged, not silently clamped to a healthy %.
// A floating analog probe can look plausible; this is NOT disconnect detection.

constexpr unsigned long DHT_INTERVAL_MS = 2500;
constexpr unsigned long SOIL_INTERVAL_MS = 1000;
constexpr unsigned long VOC_INTERVAL_MS = 1000;
constexpr unsigned long COMPENSATION_MAX_AGE_MS = 10000;
constexpr unsigned long TELEMETRY_INTERVAL_MS = 5000;
constexpr unsigned long NODE_STALE_MS = 20000;

constexpr unsigned NODE_ID_MAX = 32;
constexpr unsigned REGISTRY_SIZE = 9; // Local node plus eight actual remote nodes.
constexpr unsigned TELEMETRY_MAX_BYTES = 2048;
constexpr unsigned MQTT_BUFFER_BYTES = 2304;
constexpr unsigned API_MAX_BYTES = 24576;
