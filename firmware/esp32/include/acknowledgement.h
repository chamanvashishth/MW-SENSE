#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// An acknowledgement is valid only for the current queue head and the
// exact node/sensor/request topic generated for that reading.
inline bool matchesQueuedAcknowledgement(
    const String& nodeId,
    const String& topic,
    const String& requestId,
    const String& queuedPayload) {
  if (nodeId.isEmpty() || requestId.isEmpty() || requestId.length() > 96 ||
      queuedPayload.isEmpty()) {
    return false;
  }

  JsonDocument queuedReading;
  if (deserializeJson(queuedReading, queuedPayload)) return false;

  const String queuedRequestId = queuedReading["request_id"] | "";
  const String sensorId = queuedReading["sensor_id"] | "";
  if (queuedRequestId != requestId || sensorId.isEmpty()) return false;

  const String expectedTopic =
      String("mw-sense/") + nodeId + "/" + sensorId + "/ack/" + requestId;
  return topic == expectedTopic;
}
