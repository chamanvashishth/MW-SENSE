const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecordStore } = require("../telemetry-core.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const validRecord = {
  node_id: "NODE-01",
  sensor_id: "TEMP-01",
  parameter: "temperature",
  timestamp: "2026-08-15T10:30:00.000Z",
  value: 28.4,
  unit: "°C",
  status: "VALID",
  simulation: true
};

test("loads saved records after creating a new store instance", () => {
  const storage = memoryStorage();
  createRecordStore(storage).save(validRecord);
  assert.deepEqual(createRecordStore(storage).load(), [validRecord]);
});

test("rejects readings that are invalid or not yet validated", () => {
  const store = createRecordStore(memoryStorage());
  assert.throws(() => store.save({ ...validRecord, value: 90 }), TypeError);
  assert.throws(() => store.save({ ...validRecord, status: "PENDING" }), TypeError);
});

test("removes malformed JSON and starts with an empty dataset", () => {
  const storage = memoryStorage({ "mw-sense.telemetry.v1": "{broken" });
  assert.deepEqual(createRecordStore(storage).load(), []);
  assert.equal(storage.getItem("mw-sense.telemetry.v1"), null);
});

test("filters invalid records from an otherwise readable dataset", () => {
  const storage = memoryStorage({
    "mw-sense.telemetry.v1": JSON.stringify([validRecord, { ...validRecord, value: 500 }])
  });
  assert.deepEqual(createRecordStore(storage).load(), [validRecord]);
});

test("retains only the configured number of newest records", () => {
  const store = createRecordStore(memoryStorage(), "test.records", 2);
  store.save(validRecord);
  store.save({ ...validRecord, value: 29 });
  store.save({ ...validRecord, value: 30 });
  assert.deepEqual(store.load().map((record) => record.value), [29, 30]);
});

test("clear removes the persisted dataset", () => {
  const storage = memoryStorage();
  const store = createRecordStore(storage);
  store.save(validRecord);
  store.clear();
  assert.deepEqual(store.load(), []);
});

test("requires a browser-compatible storage adapter", () => {
  assert.throws(() => createRecordStore({}), TypeError);
});
