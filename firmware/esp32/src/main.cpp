#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include <esp_system.h>

#include "config.h"
#include "sensor_source.h"
#include "offline_queue.h"

namespace {
WiFiClientSecure secureClient;
WiFiClient plainClient;
PubSubClient mqtt;
OfflineQueue offlineQueue;
Dht22Source sensor(DHT_DATA_PIN);

String bootId;
uint32_t sequenceNumber = 0;
uint32_t lastSampleAt = 0;
uint32_t lastHeartbeatAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMqttAttemptAt = 0;
uint32_t lastQueueDrainAt = 0;
constexpr uint32_t QUEUE_RETRY_INTERVAL_MS = 5000UL;

String telemetryTopic(const char* sensorId) {
  return String("mw-sense/") + MW_SENSE_NODE_ID + "/" + sensorId + "/telemetry";
}

String makeRequestId() {
  ++sequenceNumber;
  return String(MW_SENSE_NODE_ID) + "-" + bootId + "-" + String(sequenceNumber);
}

bool publishPayload(const String& payload) {
  if (!mqtt.connected()) return false;
  JsonDocument document;
  if (deserializeJson(document, payload)) return false;
  const String sensorId = document["sensor_id"] | "";
  if (sensorId.isEmpty()) return false;
  const String topic = telemetryTopic(sensorId.c_str());
  // The queue entry stays on flash until the backend confirms database storage.
  return mqtt.publish(topic.c_str(), payload.c_str(), false);
}

void onMqttMessage(char* rawTopic, byte* rawPayload, unsigned int length) {
  // Keep callback work bounded; acknowledgement packets are deliberately small.
  if (rawTopic == nullptr || rawPayload == nullptr || length == 0 || length > 256) return;
  const String topic(rawTopic);
  const String prefix = String("mw-sense/") + MW_SENSE_NODE_ID + "/";
  if (!topic.startsWith(prefix)) return;

  String body;
  body.reserve(length);
  for (unsigned int i = 0; i < length; ++i) body += static_cast<char>(rawPayload[i]);

  JsonDocument acknowledgement;
  if (deserializeJson(acknowledgement, body)) return;
  const String requestId = acknowledgement["request_id"] | "";
  const bool accepted = acknowledgement["accepted"] | false;
  if (!accepted || requestId.isEmpty() || requestId.length() > 96) return;

  // Match the complete topic to the queue head. A valid request ID alone is
  // not enough: the acknowledgement must name this node and queued sensor.
  String oldest;
  if (!offlineQueue.peekOldest(oldest)) return;
  JsonDocument queuedReading;
  if (deserializeJson(queuedReading, oldest)) return;
  const String queuedRequestId = queuedReading["request_id"] | "";
  const String sensorId = queuedReading["sensor_id"] | "";
  if (queuedRequestId != requestId || sensorId.isEmpty()) return;

  const String expectedTopic =
      String("mw-sense/") + MW_SENSE_NODE_ID + "/" + sensorId + "/ack/" + requestId;
  if (topic != expectedTopic) return;

  if (offlineQueue.acknowledgeOldest(requestId)) {
    Serial.println("Backend acknowledged and removed a queued reading.");
  }
}

bool currentTimestamp(char* output, size_t outputSize) {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 100)) return false;
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &timeInfo) > 0;
}

void connectWifiIfDue(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED || now - lastWifiAttemptAt < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttemptAt = now;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMqttIfDue(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected() ||
      now - lastMqttAttemptAt < MQTT_RETRY_INTERVAL_MS) return;
  lastMqttAttemptAt = now;
  const String clientId = String("mw-sense-") + MW_SENSE_NODE_ID + "-" + bootId;
  if (mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    const String acknowledgementTopic = String("mw-sense/") + MW_SENSE_NODE_ID + "/+/ack/+";
    if (mqtt.subscribe(acknowledgementTopic.c_str(), 1)) {
      Serial.println("MQTT connected; backend acknowledgements subscribed.");
    } else {
      Serial.println("MQTT connected, but acknowledgement subscription failed.");
    }
  }
}

void sendReading(const SensorReading& reading) {
  char timestamp[25];
  if (!currentTimestamp(timestamp, sizeof(timestamp))) {
    Serial.println("Clock is not synchronized; sample was not queued.");
    return;
  }

  JsonDocument document;
  document["node_id"] = MW_SENSE_NODE_ID;
  document["sensor_id"] = reading.sensorId;
  document["parameter"] = reading.parameter;
  document["timestamp"] = timestamp;
  document["value"] = reading.value;
  document["unit"] = reading.unit;
  document["simulation"] = false;
  document["device_token"] = MW_SENSE_DEVICE_TOKEN;
  document["request_id"] = makeRequestId();
  document["firmware_version"] = MW_SENSE_FIRMWARE_VERSION;

  String payload;
  serializeJson(document, payload);
  if (!offlineQueue.enqueue(payload)) {
    Serial.println("Reading could not be saved; offline queue is full or unavailable.");
  }
}

void sendHeartbeat(uint32_t now) {
  if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatAt = now;
  if (!mqtt.connected()) return;

  JsonDocument document;
  document["node_id"] = MW_SENSE_NODE_ID;
  document["firmware_version"] = MW_SENSE_FIRMWARE_VERSION;
  document["event"] = "heartbeat";
  document["device_token"] = MW_SENSE_DEVICE_TOKEN;
  String payload;
  serializeJson(document, payload);
  const String topic = String("mw-sense/") + MW_SENSE_NODE_ID + "/status";
  mqtt.publish(topic.c_str(), payload.c_str());
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  bootId = String(esp_random(), HEX);
  sensor.begin();
  if (!offlineQueue.begin()) Serial.println("Offline queue could not be initialized.");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
#if MQTT_USE_TLS
  // Verify the broker by default. An insecure connection is available only
  // when the developer explicitly opts in through local configuration.
  #if defined(MQTT_ROOT_CA)
    secureClient.setCACert(MQTT_ROOT_CA);
  #elif MQTT_ALLOW_INSECURE_TLS
    Serial.println("WARNING: MQTT broker certificate verification is disabled.");
    secureClient.setInsecure();
  #else
    Serial.println("MQTT TLS is enabled, but no MQTT_ROOT_CA is configured.");
    Serial.println("Add the broker CA certificate or explicitly enable the development-only insecure option.");
    while (true) delay(1000);
  #endif
  mqtt.setClient(secureClient);
#else
  mqtt.setClient(plainClient);
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqttMessage);
  connectWifiIfDue(millis());
}

void loop() {
  const uint32_t now = millis();
  connectWifiIfDue(now);
  connectMqttIfDue(now);
  mqtt.loop();

  if (mqtt.connected()) {
    sendHeartbeat(now);
    if (now - lastQueueDrainAt >= QUEUE_RETRY_INTERVAL_MS) {
      lastQueueDrainAt = now;
      String oldest;
      if (offlineQueue.peekOldest(oldest)) publishPayload(oldest);
    }
  }

  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    SensorReading reading{};
    if (sensor.read(reading)) sendReading(reading);
    else Serial.println("Sensor returned an invalid reading.");
  }
  delay(10);
}
