#pragma once
#include <Arduino.h>
#include <DHT.h>

struct SensorReading {
  const char* sensorId;
  const char* parameter;
  float value;
  const char* unit;
};

class SensorSource {
 public:
  virtual ~SensorSource() = default;
  virtual void begin() = 0;
  virtual bool read(SensorReading& reading) = 0;
};

// Example DHT22 adapter for NODE-01. Confirm hardware and calibration first.
class Dht22Source final : public SensorSource {
 public:
  explicit Dht22Source(uint8_t dataPin) : sensor_(dataPin, DHT22) {}
  void begin() override { sensor_.begin(); }
  bool read(SensorReading& reading) override {
    const float temperature = sensor_.readTemperature();
    if (!isfinite(temperature)) return false;
    reading = {"TEMP-01", "temperature", temperature, "°C"};
    return true;
  }
 private:
  DHT sensor_;
};
