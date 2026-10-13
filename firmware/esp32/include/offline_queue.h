#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include "config.h"

class OfflineQueue {
 public:
  bool begin() {
    if (!LittleFS.begin(true)) return false;
    if (!LittleFS.exists(OFFLINE_QUEUE_FILE)) {
      File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_WRITE);
      return static_cast<bool>(file);
    }
    return true;
  }

  bool enqueue(const String& payload) {
    if (count() >= OFFLINE_QUEUE_LIMIT) return false;
    File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_APPEND);
    if (!file) return false;
    const size_t written = file.println(payload);
    file.close();
    return written > 0;
  }

  bool publishOldest(bool (*publisher)(const String&)) {
    File input = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
    if (!input) return false;
    String first = input.readStringUntil('\n');
    String remainder = input.readString();
    input.close();
    if (first.isEmpty() || !publisher(first)) return false;
    File output = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_WRITE);
    if (!output) return false;
    const size_t written = output.print(remainder);
    output.close();
    return written == remainder.length();
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
};
