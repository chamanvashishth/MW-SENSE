#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_SGP40.h>
#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include "config.h"
#include "dashboard.h"

enum ReadingStatus : uint8_t {
  LOADING, READING_OK, ERROR_READING, OUT_OF_CALIBRATION, RAIL_ERROR, WARMING_UP, STALE
};
const char *const STATUS_TEXT[] = {
  "loading", "ok", "error", "out_of_calibration", "rail_error", "warming_up", "stale"
};
const char *const SENSOR_KEYS[] = {
  "temperature", "humidity", "voc_index", "soil_percent", "soil_adc"
};
const char *const SENSOR_UNITS[] = {"C", "%RH", "index", "%", "ADC counts"};
const uint32_t SENSOR_MAX_AGE[] = {10000, 10000, 3500, 3500, 3500};

struct Reading {
  float lastGood = 0;
  uint32_t goodAt = 0;
  uint32_t ageAtReception = 0;
  uint32_t errors = 0;
  uint32_t consecutiveErrors = 0;
  ReadingStatus status = LOADING;
  bool hasGood = false;
};

struct Node {
  char id[NODE_ID_MAX + 1] = {};
  Reading readings[5];
  uint32_t receivedAt = 0;
  uint32_t sequence = 0;
  uint32_t uptime = 0;
  bool used = false;
  bool hasTelemetry = false;
  bool online = false;
  bool compensationFallback = true;
};

DHT roomSensor(ROOM_SENSOR_PIN, DHT22);
Adafruit_SGP40 airSensor;
WebServer server(80);
WiFiClient mqttTransport;
PubSubClient mqtt(mqttTransport);
SemaphoreHandle_t registryMutex;
Node nodes[REGISTRY_SIZE];
char nodeId[NODE_ID_MAX + 1];
char clientId[48];
char telemetryTopic[100], statusTopic[100], telemetryFilter[100], statusFilter[100];
volatile bool wifiHealthy = false;
volatile bool mqttHealthy = false;
uint32_t registryErrors = 0;
uint32_t networkErrors = 0;
bool mqttBufferReady = false;
bool airReady = false;
uint32_t airStarted = 0, airRetryAt = 0, airBackoff = 2000;
uint32_t lastDht = 0, lastSoil = 0, lastVoc = 0;
uint32_t sensorDiagnosticAt = 0;

static bool due(uint32_t now, uint32_t deadline) {
  return int32_t(now - deadline) >= 0;
}

static bool validId(const char *id) {
  if (!id) return false;
  size_t n = strnlen(id, NODE_ID_MAX + 1);
  if (!n || n > NODE_ID_MAX) return false;
  for (size_t i = 0; i < n; ++i) {
    char c = id[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

static void good(Reading &r, float value, uint32_t now) {
  r.lastGood = value;
  r.goodAt = now;
  r.hasGood = true;
  r.status = READING_OK;
  r.consecutiveErrors = 0;
}

static void failed(Reading &r, ReadingStatus status = ERROR_READING) {
  r.status = status;
  ++r.errors;
  ++r.consecutiveErrors;
}

static uint32_t readingAge(const Node &n, const Reading &r, uint32_t now, bool local) {
  if (local) return now - r.goodAt;
  uint64_t age = uint64_t(r.ageAtReception) + uint32_t(now - n.receivedAt);
  return age > UINT32_MAX ? UINT32_MAX : uint32_t(age);
}

static void writeNode(JsonObject out, const Node &n, uint32_t now, bool local,
                      bool forDashboard) {
  out["schema_version"] = 1;
  out["node_id"] = n.id;
  out["sequence"] = n.sequence;
  out["uptime_ms"] = local ? now : n.uptime;
  out["compensation"] = n.compensationFallback ? "fallback_25C_50RH" : "recent_dht";
  if (forDashboard) {
    out["local"] = local;
    if (local) {
      out["state"] = "online";
      out["telemetry_age_ms"] = 0;
    } else {
      out["state"] = !n.online ? "offline" :
        (!n.hasTelemetry ? "loading" :
         (now - n.receivedAt > NODE_STALE_MS ? "stale" : "online"));
      if (n.hasTelemetry) out["telemetry_age_ms"] = uint32_t(now - n.receivedAt);
      else out["telemetry_age_ms"] = nullptr;
    }
  }
  JsonObject sensors = out["sensors"].to<JsonObject>();
  for (unsigned i = 0; i < 5; ++i) {
    const Reading &r = n.readings[i];
    JsonObject m = sensors[SENSOR_KEYS[i]].to<JsonObject>();
    uint32_t age = r.hasGood ? readingAge(n, r, now, local) : 0;
    ReadingStatus state = r.status;
    if (state == READING_OK && (!r.hasGood || age > SENSOR_MAX_AGE[i])) state = STALE;
    m["unit"] = SENSOR_UNITS[i];
    m["status"] = STATUS_TEXT[state];
    if (state == READING_OK && r.hasGood) m["value"] = r.lastGood;
    else m["value"] = nullptr;
    if (r.hasGood) {
      m["last_good_value"] = r.lastGood;
      m["age_ms"] = age;
    } else {
      m["last_good_value"] = nullptr;
      m["age_ms"] = nullptr;
    }
    m["error_count"] = r.errors;
    m["consecutive_errors"] = r.consecutiveErrors;
  }
}

static void sampleRoom(uint32_t now) {
  float t = roomSensor.readTemperature();
  float h = roomSensor.readHumidity(); // Same cached DHT transaction.
  // External 10k pull-up is present; leave the idle line as plain INPUT.
  pinMode(ROOM_SENSOR_PIN, INPUT);
  bool tValid = isfinite(t) && t >= -40 && t <= 80;
  bool hValid = isfinite(h) && h >= 0 && h <= 100;
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  if (tValid) good(nodes[0].readings[0], t, now);
  else failed(nodes[0].readings[0]);
  if (hValid) good(nodes[0].readings[1], h, now);
  else failed(nodes[0].readings[1]);
  xSemaphoreGive(registryMutex);
  if (!tValid || !hValid)
    Serial.println("DHT: non-finite/out-of-range reading; retained values are not current.");
}

static void sampleSoil(uint32_t now) {
  uint32_t total = 0;
  for (unsigned i = 0; i < SOIL_AVERAGE_SAMPLES; ++i)
    total += analogRead(SOIL_INPUT_PIN);
  int raw = int((total + SOIL_AVERAGE_SAMPLES / 2) / SOIL_AVERAGE_SAMPLES);
  bool rail = raw <= SOIL_RAIL_MARGIN || raw >= 4095 - SOIL_RAIL_MARGIN;
  bool calibrationValid = SOIL_DRY_ADC > SOIL_WET_ADC &&
                          SOIL_WET_ADC > SOIL_RAIL_MARGIN &&
                          SOIL_DRY_ADC < 4095 - SOIL_RAIL_MARGIN;
  bool calibrated = calibrationValid && raw >= SOIL_WET_ADC && raw <= SOIL_DRY_ADC;
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  Reading &percent = nodes[0].readings[3];
  Reading &adc = nodes[0].readings[4];
  if (rail) {
    failed(adc, RAIL_ERROR);
    failed(percent, RAIL_ERROR);
  } else {
    good(adc, raw, now); // Raw ADC remains a real measurement outside calibration.
    if (calibrated) {
      float moisture = roundf(float(raw - SOIL_DRY_ADC) * 100.0f /
                              float(SOIL_WET_ADC - SOIL_DRY_ADC));
      good(percent, moisture, now);
    } else failed(percent, OUT_OF_CALIBRATION);
  }
  xSemaphoreGive(registryMutex);
  if ((rail || !calibrated) && now - sensorDiagnosticAt >= 10000) {
    sensorDiagnosticAt = now;
    Serial.printf("Soil: raw=%d, %s. Plausibility cannot guarantee disconnect detection.\n",
                  raw, rail ? "ADC rail" : "outside calibration");
  }
}

static bool airAcknowledges() {
  Wire.beginTransmission(AIR_SENSOR_ADDR);
  return Wire.endTransmission() == 0;
}

static void tryAir(uint32_t now) {
  if (airReady || !due(now, airRetryAt)) return;
  // begin() performs the library self-test and resets the VOC algorithm.
  // Only one attempt per independent backoff; no retry loop.
  if (airAcknowledges() && airSensor.begin(&Wire)) {
    airReady = true;
    airStarted = millis();
    airBackoff = 2000;
    xSemaphoreTake(registryMutex, portMAX_DELAY);
    nodes[0].readings[2].status = WARMING_UP;
    nodes[0].readings[2].consecutiveErrors = 0;
    xSemaphoreGive(registryMutex);
    Serial.println("SGP40 ready at 0x59; VOC algorithm warming up (~45 seconds).");
  } else {
    xSemaphoreTake(registryMutex, portMAX_DELAY);
    failed(nodes[0].readings[2]);
    xSemaphoreGive(registryMutex);
    airRetryAt = millis() + airBackoff;
    airBackoff = min(airBackoff * 2, uint32_t(60000));
    Serial.println("SGP40 absent/self-test failed; independent backoff scheduled.");
  }
}

static void sampleAir(uint32_t now) {
  float t = 25, h = 50;
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  Reading &tr = nodes[0].readings[0];
  Reading &hr = nodes[0].readings[1];
  bool fallback = !(tr.hasGood && hr.hasGood &&
                    now - tr.goodAt <= COMPENSATION_MAX_AGE_MS &&
                    now - hr.goodAt <= COMPENSATION_MAX_AGE_MS);
  if (!fallback) { t = tr.lastGood; h = hr.lastGood; }
  nodes[0].compensationFallback = fallback;
  xSemaphoreGive(registryMutex);
  if (!airReady) return;

  // Exactly one VOC algorithm call on each one-second tick, never catch up
  // with rapid calls and never issue a second raw measurement.
  int32_t index = airSensor.measureVocIndex(t, h);
  bool ack = airAcknowledges();
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  Reading &r = nodes[0].readings[2];
  bool error = !ack || index < 0 || index > 500 ||
               (index == 0 && now - airStarted > 60000);
  if (error) failed(r);
  else if (index == 0) {
    r.status = WARMING_UP; // Zero is learning, not a manufactured healthy index.
    r.consecutiveErrors = 0;
  } else good(r, index, now);
  uint32_t consecutive = r.consecutiveErrors;
  xSemaphoreGive(registryMutex);
  if (error) {
    Serial.printf("VOC: measurement/I2C error, result=%ld ACK=%d\n", long(index), ack);
    if (!ack || consecutive >= 3) {
      airReady = false;
      airRetryAt = millis() + airBackoff;
    }
  }
}

static int findRemote(const char *id) {
  for (unsigned i = 1; i < REGISTRY_SIZE; ++i)
    if (nodes[i].used && strcmp(nodes[i].id, id) == 0) return int(i);
  for (unsigned i = 1; i < REGISTRY_SIZE; ++i)
    if (!nodes[i].used) return int(i);
  return -1; // Bounded registry: never invent nodes or silently evict live ones.
}

static void rejectMessage(const char *reason) {
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  ++registryErrors;
  xSemaphoreGive(registryMutex);
  Serial.printf("MQTT message rejected: %s\n", reason);
}

static int decodeStatus(const char *s) {
  if (!s) return -1;
  for (unsigned i = 0; i < sizeof(STATUS_TEXT) / sizeof(STATUS_TEXT[0]); ++i)
    if (!strcmp(s, STATUS_TEXT[i])) return int(i);
  return -1;
}

static bool validSensorValue(unsigned i, float v) {
  if (!isfinite(v)) return false;
  switch (i) {
    case 0: return v >= -40 && v <= 80;
    case 1: return v >= 0 && v <= 100;
    case 2: return v >= 1 && v <= 500 && floorf(v) == v;
    case 3: return v >= 0 && v <= 100 && floorf(v) == v;
    default: return v >= 0 && v <= 4095 && floorf(v) == v;
  }
}

static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  size_t topicLength = strnlen(topic, 100);
  size_t prefixLength = strlen(PROJECT_NAMESPACE);
  if (topicLength >= 100 || length == 0 || length > TELEMETRY_MAX_BYTES ||
      strncmp(topic, PROJECT_NAMESPACE, prefixLength) ||
      topic[prefixLength] != '/') {
    rejectMessage("topic/payload bounds"); return;
  }
  const char *idStart = topic + prefixLength + 1;
  const char *slash = strchr(idStart, '/');
  if (!slash || slash == idStart || size_t(slash - idStart) > NODE_ID_MAX) {
    rejectMessage("node ID length"); return;
  }
  char id[NODE_ID_MAX + 1] = {};
  memcpy(id, idStart, slash - idStart);
  bool telemetry = !strcmp(slash + 1, "telemetry");
  if (!validId(id) || (!telemetry && strcmp(slash + 1, "status"))) {
    rejectMessage("topic format"); return;
  }

  JsonDocument doc;
  DeserializationError parseError = deserializeJson(doc, payload, length,
                                                    DeserializationOption::NestingLimit(5));
  if (parseError) { rejectMessage(parseError.c_str()); return; }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  const char *bodyId = root["node_id"].as<const char *>();
  if (root.isNull() || !root["schema_version"].is<unsigned>() ||
      root["schema_version"].as<unsigned>() != 1 ||
      !validId(bodyId) || strcmp(bodyId, id)) {
    rejectMessage("schema/topic-node_id mismatch"); return;
  }
  if (!strcmp(id, nodeId)) return; // Own retained echo must not replace local data.

  Node incoming;
  strlcpy(incoming.id, id, sizeof(incoming.id));
  incoming.used = true;
  incoming.receivedAt = millis();
  incoming.online = true;

  if (telemetry) {
    if (!root["sequence"].is<uint32_t>() || !root["uptime_ms"].is<uint32_t>()) {
      rejectMessage("sequence/uptime"); return;
    }
    incoming.sequence = root["sequence"].as<uint32_t>();
    incoming.uptime = root["uptime_ms"].as<uint32_t>();
    incoming.hasTelemetry = true;
    const char *compensation = root["compensation"].as<const char *>();
    if (!compensation || (strcmp(compensation, "recent_dht") &&
                          strcmp(compensation, "fallback_25C_50RH"))) {
      rejectMessage("compensation"); return;
    }
    incoming.compensationFallback = strcmp(compensation, "recent_dht") != 0;
    JsonObjectConst sensors = root["sensors"].as<JsonObjectConst>();
    if (sensors.isNull() || sensors.size() != 5) {
      rejectMessage("sensor set"); return;
    }
    for (unsigned i = 0; i < 5; ++i) {
      JsonObjectConst m = sensors[SENSOR_KEYS[i]].as<JsonObjectConst>();
      const char *unit = m["unit"].as<const char *>();
      int status = decodeStatus(m["status"].as<const char *>());
      if (m.isNull() || !unit || strcmp(unit, SENSOR_UNITS[i]) || status < 0 ||
          !m["error_count"].is<uint32_t>() || !m["consecutive_errors"].is<uint32_t>() ||
          !m.containsKey("value") || !m.containsKey("last_good_value") ||
          !m.containsKey("age_ms")) {
        rejectMessage("sensor fields"); return;
      }
      Reading &r = incoming.readings[i];
      r.status = ReadingStatus(status);
      r.errors = m["error_count"].as<uint32_t>();
      r.consecutiveErrors = m["consecutive_errors"].as<uint32_t>();
      if (!m["last_good_value"].isNull()) {
        if (!m["last_good_value"].is<float>() || !m["age_ms"].is<uint32_t>() ||
            !validSensorValue(i, m["last_good_value"].as<float>())) {
          rejectMessage("last-good value/age"); return;
        }
        r.hasGood = true;
        r.lastGood = m["last_good_value"].as<float>();
        r.ageAtReception = m["age_ms"].as<uint32_t>();
      } else if (!m["age_ms"].isNull()) {
        rejectMessage("age without last-good"); return;
      }
      if (status == READING_OK) {
        if (!r.hasGood || !m["value"].is<float>() ||
            !validSensorValue(i, m["value"].as<float>()) ||
            m["value"].as<float>() != r.lastGood ||
            r.ageAtReception > SENSOR_MAX_AGE[i]) {
          rejectMessage("healthy value inconsistent"); return;
        }
      } else if (!m["value"].isNull()) {
        rejectMessage("unhealthy value must be null"); return;
      }
    }
  } else {
    const char *state = root["status"].as<const char *>();
    if (!state || (strcmp(state, "online") && strcmp(state, "offline"))) {
      rejectMessage("online/offline status"); return;
    }
    incoming.online = !strcmp(state, "online");
  }

  xSemaphoreTake(registryMutex, portMAX_DELAY);
  int slot = findRemote(id);
  if (slot >= 0) {
    if (telemetry) {
      // Do not erase an explicit retained offline status if it arrived first.
      bool wasKnown = nodes[slot].used;
      bool previousOnline = nodes[slot].online;
      nodes[slot] = incoming;
      if (wasKnown && !previousOnline) nodes[slot].online = false;
    } else {
      Node &n = nodes[slot];
      if (!n.used) {
        strlcpy(n.id, id, sizeof(n.id));
        n.used = true;
      }
      n.online = incoming.online;
      // Status messages never refresh telemetry age.
    }
  }
  xSemaphoreGive(registryMutex);
  if (slot < 0) rejectMessage("registry full");
}

static bool publishStatus(bool online) {
  JsonDocument doc;
  doc["schema_version"] = 1;
  doc["node_id"] = nodeId;
  doc["status"] = online ? "online" : "offline";
  char text[160];
  size_t expected = measureJson(doc);
  if (expected >= sizeof(text)) return false;
  size_t written = serializeJson(doc, text, sizeof(text));
  return written == expected && mqtt.publish(statusTopic, text, true);
}

static bool publishTelemetry() {
  JsonDocument doc;
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  ++nodes[0].sequence;
  writeNode(doc.to<JsonObject>(), nodes[0], millis(), true, false);
  xSemaphoreGive(registryMutex);
  char payload[TELEMETRY_MAX_BYTES + 1];
  size_t expected = measureJson(doc);
  if (doc.overflowed() || expected > TELEMETRY_MAX_BYTES) {
    Serial.println("Telemetry serialization exceeds configured bound.");
    return false;
  }
  size_t written = serializeJson(doc, payload, sizeof(payload));
  return written == expected &&
    mqtt.publish(telemetryTopic, reinterpret_cast<const uint8_t *>(payload),
                 written, true);
}

static void networkTask(void *) {
  uint32_t wifiRetryAt = millis() + 15000;
  uint32_t mqttRetryAt = 0, mqttBackoff = 2000;
  uint32_t lastPublish = 0;
  bool previouslyWifi = false;
  // PubSubClient connect/DNS can block. Keep all MQTT operations on this task:
  // the Arduino task continues sensing and serving HTTP during network waits.
  mqttTransport.setTimeout(1200);
  mqtt.setSocketTimeout(1);
  mqtt.setKeepAlive(15);
  for (;;) {
    uint32_t now = millis();
    bool connectedWifi = WiFi.status() == WL_CONNECTED;
    wifiHealthy = connectedWifi;
    if (connectedWifi != previouslyWifi) {
      previouslyWifi = connectedWifi;
      if (connectedWifi) {
        Serial.printf("WiFi connected. Dashboard URL: http://%s/\n",
                      WiFi.localIP().toString().c_str());
        mqttRetryAt = now;
      } else {
        mqttHealthy = false;
        mqtt.disconnect();
        Serial.println("WiFi lost; sensing and HTTP task remain running.");
      }
    }
    if (!connectedWifi) {
      if (due(now, wifiRetryAt)) {
        Serial.println("WiFi timed retry.");
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        wifiRetryAt = now + 15000;
      }
    } else if (mqttBufferReady) {
      if (!mqtt.connected() && due(now, mqttRetryAt)) {
        JsonDocument will;
        will["schema_version"] = 1;
        will["node_id"] = nodeId;
        will["status"] = "offline";
        char willText[160];
        size_t expected = measureJson(will);
        size_t written = serializeJson(will, willText, sizeof(willText));
        bool connected = expected < sizeof(willText) && written == expected &&
          mqtt.connect(clientId, MQTT_USERNAME[0] ? MQTT_USERNAME : nullptr,
                       MQTT_USERNAME[0] ? MQTT_PASSWORD : nullptr,
                       statusTopic, 1, true, willText);
        if (connected) {
          // Every reconnect resubscribes both wildcard discovery streams.
          bool telemetrySubscribed = mqtt.subscribe(telemetryFilter, 1);
          bool statusSubscribed = mqtt.subscribe(statusFilter, 1);
          bool announced = publishStatus(true);
          if (!telemetrySubscribed || !statusSubscribed || !announced) {
            Serial.println("MQTT subscribe/online publish failed; reconnect scheduled.");
            mqtt.disconnect();
            connected = false;
          } else {
            mqttBackoff = 2000;
            lastPublish = millis() - TELEMETRY_INTERVAL_MS;
            Serial.println("MQTT connected, wildcard subscriptions and retained online sent.");
          }
        }
        if (!connected) {
          xSemaphoreTake(registryMutex, portMAX_DELAY);
          ++networkErrors;
          xSemaphoreGive(registryMutex);
          Serial.printf("MQTT connect/setup failed, state=%d; retry in %lu ms\n",
                        mqtt.state(), (unsigned long)mqttBackoff);
          mqttRetryAt = millis() + mqttBackoff;
          mqttBackoff = min(mqttBackoff * 2, uint32_t(60000));
        }
      }
      if (mqtt.connected()) {
        if (!mqtt.loop()) {
          Serial.println("MQTT loop disconnected.");
          mqttRetryAt = millis() + mqttBackoff;
        } else if (millis() - lastPublish >= TELEMETRY_INTERVAL_MS) {
          lastPublish = millis();
          if (!publishTelemetry()) {
            xSemaphoreTake(registryMutex, portMAX_DELAY);
            ++networkErrors;
            xSemaphoreGive(registryMutex);
            Serial.println("MQTT telemetry publish failed; local measurements preserved.");
          }
        }
      }
      mqttHealthy = mqtt.connected();
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

static void serveNodes() {
  JsonDocument doc;
  uint32_t now = millis();
  doc["schema_version"] = 1;
  doc["host_node_id"] = nodeId;
  doc["uptime_ms"] = now;
  doc["wifi"]["connected"] = bool(wifiHealthy);
  doc["wifi"]["ip"] = WiFi.localIP().toString();
  doc["mqtt"]["connected"] = bool(mqttHealthy);
  doc["mqtt"]["broker"] = MQTT_HOST;
  // Remote freshness is measured from actual message reception. PubSubClient
  // does not expose retained flags; a retained snapshot has no trustworthy
  // wall-clock timestamp. Offline status and the 20s reception timeout apply.
  doc["freshness_basis"] = "mqtt_reception";
  JsonArray list = doc["nodes"].to<JsonArray>();
  xSemaphoreTake(registryMutex, portMAX_DELAY);
  doc["registry_errors"] = registryErrors;
  doc["mqtt"]["error_count"] = networkErrors;
  for (unsigned i = 0; i < REGISTRY_SIZE; ++i)
    if (nodes[i].used) writeNode(list.add<JsonObject>(), nodes[i], now, i == 0, true);
  xSemaphoreGive(registryMutex);
  if (doc.overflowed() || measureJson(doc) > API_MAX_BYTES) {
    server.send(503, "application/json", "{\"error\":\"registry serialization limit\"}");
    return;
  }
  String response;
  size_t expected = measureJson(doc);
  if (!response.reserve(expected + 1) || serializeJson(doc, response) != expected) {
    server.send(503, "application/json", "{\"error\":\"serialization failed\"}");
    return;
  }
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", response);
}

void setup() {
  Serial.begin(115200);
  registryMutex = xSemaphoreCreateMutex();
  if (!registryMutex) {
    Serial.println("Fatal: registry mutex allocation failed.");
    ESP.restart();
    return;
  }

  WiFi.mode(WIFI_STA);
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toLowerCase();
  String generated = "mw-" + mac;
  const char *chosen = NODE_ID_OVERRIDE[0] ? NODE_ID_OVERRIDE : generated.c_str();
  if (!validId(chosen)) {
    Serial.println("Invalid NODE_ID_OVERRIDE; using unique MAC-derived ID.");
    chosen = generated.c_str();
  }
  strlcpy(nodeId, chosen, sizeof(nodeId));
  snprintf(clientId, sizeof(clientId), "mws-%s", nodeId);
  snprintf(telemetryTopic, sizeof(telemetryTopic), "%s/%s/telemetry", PROJECT_NAMESPACE, nodeId);
  snprintf(statusTopic, sizeof(statusTopic), "%s/%s/status", PROJECT_NAMESPACE, nodeId);
  snprintf(telemetryFilter, sizeof(telemetryFilter), "%s/+/telemetry", PROJECT_NAMESPACE);
  snprintf(statusFilter, sizeof(statusFilter), "%s/+/status", PROJECT_NAMESPACE);
  nodes[0].used = true;
  nodes[0].online = true;
  nodes[0].hasTelemetry = true;
  strlcpy(nodes[0].id, nodeId, sizeof(nodes[0].id));

  roomSensor.begin();
  pinMode(ROOM_SENSOR_PIN, INPUT);
  pinMode(SOIL_INPUT_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_INPUT_PIN, ADC_11db);
  Wire.begin(AIR_SDA_PIN, AIR_SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(50);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqttBufferReady = mqtt.setBufferSize(MQTT_BUFFER_BYTES);
  if (!mqttBufferReady) Serial.println("MQTT buffer allocation failed; MQTT disabled.");

  if (DASHBOARD_HOST) {
    server.on("/", HTTP_GET, []() { server.send_P(200, "text/html", DASHBOARD_PAGE); });
    server.on("/api/nodes", HTTP_GET, serveNodes);
    server.onNotFound([]() { server.send(404, "text/plain", "Not found"); });
    server.begin();
  }

  Serial.printf("\nMW-SENSE node=%s clientId=%s\n", nodeId, clientId);
  Serial.printf("Telemetry: %s (retained, every 5s)\nStatus: %s (retained; offline LWT)\n",
                telemetryTopic, statusTopic);
  Serial.printf("Discovery: %s and %s; registry capacity=%u\n",
                telemetryFilter, statusFilter, REGISTRY_SIZE);
  Serial.println("Schema v1: node_id, sequence, uptime_ms, compensation, sensors.");
  Serial.println("Each sensor: value/unit/status/age_ms/error_count/consecutive_errors/last_good_value.");
  Serial.println("Unhealthy current values are null; last-good values remain explicitly labeled.");
  Serial.println("Plaintext HTTP/MQTT: trusted LAN only. Dashboard URL printed after DHCP.");
  Serial.println("ADC1 GPIO34: 12-bit, 11dB attenuation, 16-sample averaging; calibrate real endpoints.");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // Never skip placeholder credentials.

  uint32_t now = millis();
  lastDht = now;
  lastSoil = now - SOIL_INTERVAL_MS;
  lastVoc = now;
  airRetryAt = now;
  if (xTaskCreatePinnedToCore(networkTask, "mw-network", 12288, nullptr, 1,
                              nullptr, 0) != pdPASS)
    Serial.println("Network task allocation failed; local sensing/dashboard remain available.");
}

void loop() {
  if (DASHBOARD_HOST) server.handleClient();
  uint32_t now = millis();
  if (now - lastDht >= DHT_INTERVAL_MS) {
    lastDht = now;
    sampleRoom(now);
  }
  now = millis();
  if (now - lastSoil >= SOIL_INTERVAL_MS) {
    lastSoil = now;
    sampleSoil(now);
  }
  tryAir(millis());
  now = millis();
  if (now - lastVoc >= VOC_INTERVAL_MS) {
    lastVoc = now;
    sampleAir(now);
  }
  // Yield without blocking retries or multi-second delays.
  yield();
}
