const test = require("node:test");
const assert = require("node:assert/strict");
const telemetry = require("../telemetry-core.js");

const sample = {
  node_id: "NODE-02",
  sensor_id: "AIR-02",
  parameter: "air_quality",
  timestamp: "2026-08-15T10:30:00.000Z",
  value: 145,
  unit: "simulated units",
  status: "PENDING",
  simulation: true
};

function runGatewayFlow(payload, options = {}) {
  const validation = telemetry.validatePayload(payload);
  if (!validation.valid) return { delivered: false, stage: "validation", errors: validation.errors };
  if (telemetry.isPacketDropped(options.lossPercent ?? 0, options.randomValue ?? 0.5)) {
    return { delivered: false, stage: "transmission", reason: "packet_dropped" };
  }
  const envelope = telemetry.createGatewayEnvelope(payload);
  const stored = telemetry.storeGatewayRecord(envelope, options.records ?? []);
  return { delivered: true, stage: "stored", envelope, records: stored };
}

test("valid sample crosses validation, gateway and storage", () => {
  const result = runGatewayFlow(sample);
  assert.equal(result.delivered, true);
  assert.equal(result.stage, "stored");
  assert.equal(result.envelope.schema_version, "1.0");
  assert.equal(result.envelope.payload.node_id, "NODE-02");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].payload.simulation, true);
});

test("invalid sample never reaches gateway storage", () => {
  const result = runGatewayFlow({ ...sample, value: 900 });
  assert.equal(result.delivered, false);
  assert.equal(result.stage, "validation");
  assert.equal(result.records, undefined);
});

test("dropped packet is not stored", () => {
  const result = runGatewayFlow(sample, { lossPercent: 100, randomValue: 0.25 });
  assert.equal(result.delivered, false);
  assert.equal(result.stage, "transmission");
  assert.equal(result.reason, "packet_dropped");
});

test("gateway storage returns a new collection without mutating the caller's records", () => {
  const existing = [{ id: "previous" }];
  const result = runGatewayFlow(sample, { records: existing });
  assert.equal(existing.length, 1);
  assert.equal(result.records.length, 2);
});
