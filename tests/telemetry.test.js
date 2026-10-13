const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePayload, isPacketDropped } = require("../telemetry-core.js");
const validSample = { node_id: "NODE-01", sensor_id: "TEMP-01", parameter: "temperature", timestamp: "2026-08-15T10:30:00.000Z", value: 28.4, unit: "°C", status: "PENDING", simulation: true };

test("accepts a correctly identified in-range sample", () => assert.deepEqual(validatePayload(validSample), { valid: true, errors: [] }));
test("rejects a reading outside the sensor range", () => {
  const result = validatePayload({ ...validSample, value: 51 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /outside the configured sensor range/);
});
test("rejects mismatched node and sensor identifiers", () => {
  const result = validatePayload({ ...validSample, node_id: "NODE-03", sensor_id: "SOIL-01" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
test("rejects non-numeric values and invalid timestamps", () => {
  const result = validatePayload({ ...validSample, value: NaN, timestamp: "not-a-date" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /finite number/);
  assert.match(result.errors.join(" "), /valid date-time/);
});
test("requires the simulation marker in the virtual lab", () => assert.equal(validatePayload({ ...validSample, simulation: false }).valid, false));
test("models packet loss at zero and one hundred percent", () => {
  assert.equal(isPacketDropped(0, 0.5), false);
  assert.equal(isPacketDropped(100, 0.5), true);
});
test("rejects invalid packet-loss inputs", () => {
  assert.throws(() => isPacketDropped(-1, 0.5), RangeError);
  assert.throws(() => isPacketDropped(10, 1), RangeError);
});
