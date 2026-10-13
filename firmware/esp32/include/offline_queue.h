#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"

namespace {
constexpr char QUEUE_TEMP_FILE[] = "/telemetry.tmp";
constexpr char QUEUE_BACKUP_FILE[] = "/telemetry.bak";
}

class OfflineQueue {
 public:
  bool begin() {
    if (!LittleFS.begin(false)) return false;
    recoverInterruptedRewrite();

    if (!LittleFS.exists(OFFLINE_QUEUE_FILE)) {
      File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_WRITE);
      if (!file) return false;
      file.close();
    }
    // A stale temporary file is never treated as the authoritative queue.
    if (LittleFS.exists(QUEUE_TEMP_FILE)) LittleFS.remove(QUEUE_TEMP_FILE);
    return true;
  }

  bool enqueue(const String& payload) {
    if (payload.isEmpty() || count() >= OFFLINE_QUEUE_LIMIT) return false;
    File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_APPEND);
    if (!file) return false;
    const size_t expected = payload.length() + 1;  // JSON plus newline.
    const size_t written = file.println(payload);
    file.flush();
    file.close();
    return written == expected;
  }

  bool peekOldest(String& payload) const {
    File input = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
    if (!input) return false;
    payload = input.readStringUntil('\\n');
    input.close();
    return !payload.isEmpty();
  }

  bool acknowledgeOldest(const String& requestId) {
    if (requestId.isEmpty()) return false;
    File input = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
    if (!input) return false;
    String first = input.readStringUntil('\\n');
    String remainder = input.readString();
    input.close();
    if (first.isEmpty()) return false;

    JsonDocument document;
    if (deserializeJson(document, first)) return false;
    const String queuedRequestId = document["request_id"] | "";
    if (queuedRequestId != requestId) return false;

    // Only a matching application acknowledgement may remove the head item.
    return writeReplacement(remainder);
  }

  size_t count() const {
    File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
    if (!file) return 0;
    size_t lines = 0;
    while (file.available()) {
      String line = file.readStringUntil('\n');
      if (!line.isEmpty()) ++lines;
    }
    file.close();
    return lines;
  }

 private:
  bool writeReplacement(const String& remainder) {
    if (LittleFS.exists(QUEUE_TEMP_FILE) && !LittleFS.remove(QUEUE_TEMP_FILE)) {
      return false;
    }
    File output = LittleFS.open(QUEUE_TEMP_FILE, FILE_WRITE);
    if (!output) return false;
    const size_t written = output.print(remainder);
    output.flush();
    output.close();
    if (written != remainder.length()) {
      LittleFS.remove(QUEUE_TEMP_FILE);
      return false;
    }

    // Keep a recoverable copy until the new queue has taken its place.
    if (LittleFS.exists(QUEUE_BACKUP_FILE) && !LittleFS.remove(QUEUE_BACKUP_FILE)) {
      LittleFS.remove(QUEUE_TEMP_FILE);
      return false;
    }
    if (!LittleFS.rename(OFFLINE_QUEUE_FILE, QUEUE_BACKUP_FILE)) {
      LittleFS.remove(QUEUE_TEMP_FILE);
      return false;
    }
    if (!LittleFS.rename(QUEUE_TEMP_FILE, OFFLINE_QUEUE_FILE)) {
      LittleFS.rename(QUEUE_BACKUP_FILE, OFFLINE_QUEUE_FILE);
      return false;
    }
    LittleFS.remove(QUEUE_BACKUP_FILE);
    return true;
  }

  void recoverInterruptedRewrite() {
    const bool hasQueue = LittleFS.exists(OFFLINE_QUEUE_FILE);
    const bool hasBackup = LittleFS.exists(QUEUE_BACKUP_FILE);
    if (!hasQueue && hasBackup) {
      // Restoring the old queue may redeliver one item. Its request_id makes
      // that retry safe at the API/database boundary.
      LittleFS.rename(QUEUE_BACKUP_FILE, OFFLINE_QUEUE_FILE);
    } else if (hasQueue && hasBackup) {
      LittleFS.remove(QUEUE_BACKUP_FILE);
    }
    if (LittleFS.exists(QUEUE_TEMP_FILE)) LittleFS.remove(QUEUE_TEMP_FILE);
  }
};
