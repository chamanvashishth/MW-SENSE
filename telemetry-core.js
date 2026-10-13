(function (root) {
  "use strict";

  const SENSOR_RULES = {
    temperature: { node: "NODE-01", sensor: "TEMP-01", unit: "°C", min: 0, max: 50 },
    humidity: { node: "NODE-01", sensor: "HUM-01", unit: "%", min: 0, max: 100 },
    air_quality: { node: "NODE-02", sensor: "AIR-02", unit: "simulated units", min: 0, max: 500 },
    soil_moisture: { node: "NODE-03", sensor: "SOIL-01", unit: "%", min: 0, max: 100 }
  };

  function validatePayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { valid: false, errors: ["Payload must be an object."] };
    }

    const rule = SENSOR_RULES[payload.parameter];
    if (!rule) errors.push("Parameter is not registered.");
    else {
      if (payload.node_id !== rule.node) errors.push("Node ID does not match the parameter.");
      if (payload.sensor_id !== rule.sensor) errors.push("Sensor ID does not match the parameter.");
      if (payload.unit !== rule.unit) errors.push("Unit does not match the sensor definition.");
      if (typeof payload.value !== "number" || !Number.isFinite(payload.value)) errors.push("Reading must be a finite number.");
      else if (payload.value < rule.min || payload.value > rule.max) errors.push("Reading is outside the configured sensor range.");
    }

    if (typeof payload.timestamp !== "string" || Number.isNaN(Date.parse(payload.timestamp))) {
      errors.push("Timestamp must be a valid date-time string.");
    }
    if (payload.simulation !== true) errors.push("This virtual lab accepts explicitly simulated samples only.");
    return { valid: errors.length === 0, errors };
  }

  function isPacketDropped(lossPercent, randomValue) {
    if (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) {
      throw new RangeError("Packet loss must be between 0 and 100 percent.");
    }
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError("Random value must be in the range [0, 1).");
    }
    return randomValue * 100 < lossPercent;
  }

  function createGatewayEnvelope(payload) {
    const validation = validatePayload(payload);
    if (!validation.valid) {
      throw new TypeError("Gateway rejected an invalid telemetry payload: " + validation.errors.join(" "));
    }
    return {
      schema_version: "1.0",
      message_type: "telemetry.reading",
      received_at: new Date().toISOString(),
      payload: { ...payload, status: "VALID" }
    };
  }

  function storeGatewayRecord(envelope, records) {
    if (!envelope || envelope.schema_version !== "1.0" || envelope.message_type !== "telemetry.reading" || !validatePayload(envelope.payload).valid) {
      throw new TypeError("Only a valid version 1.0 telemetry envelope can be stored.");
    }
    if (!Array.isArray(records)) throw new TypeError("The record collection must be an array.");
    return records.concat(envelope);
  }


  function createRecordStore(storage, key, limit) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new TypeError("A browser-compatible storage object is required.");
    }
    const storageKey = key || "mw-sense.telemetry.v1";
    const maxRecords = Number.isInteger(limit) && limit > 0 ? limit : 5000;
    function load() {
      const raw = storage.getItem(storageKey);
      if (raw === null) return [];
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (error) { storage.removeItem(storageKey); return []; }
      if (!Array.isArray(parsed)) { storage.removeItem(storageKey); return []; }
      const valid = parsed.filter((record) => validatePayload(record).valid && record.status === "VALID");
      if (valid.length !== parsed.length) storage.setItem(storageKey, JSON.stringify(valid.slice(-maxRecords)));
      return valid.slice(-maxRecords);
    }
    function save(record) {
      if (!validatePayload(record).valid || record.status !== "VALID" {
        throw new TypeError("Only validated telemetry readings can be saved.");
      }
      const next = load().concat(record).slice(-maxRecords);
      storage.setItem(storageKey, JSON.stringify(next));
      return next;
    }
    function clear() { storage.removeItem(storageKey); }
    return { load, save, clear, key: storageKey, limit: maxRecords };
  }

  const api = { validatePayload, isPacketDropped, createGatewayEnvelope, storeGatewayRecord, createRecordStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MWSenseTelemetry = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
