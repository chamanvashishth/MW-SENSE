const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelemetryRepository, createHttpAdapter } = require("../telemetry-core.js");

const reading = {
  node_id: "NODE-01", sensor_id: "TEMP-01", parameter: "temperature",
  timestamp: "2026-08-15T10:30:00.000Z", value: 28.4, unit: "°C",
  status: "VALID", simulation: true
};

function memoryAdapter(seed = []) {
  let records = seed.slice();
  return {
    kind: "test-memory",
    list: async () => records.slice(),
    append: async (record) => { records = records.concat(record); return records.slice(); },
    clear: async () => { records = []; }
  };
}

test("repository validates records before delegating to its adapter", async () => {
  const repository = createTelemetryRepository(memoryAdapter());
  await assert.rejects(repository.append({ ...reading, value: 99 }), TypeError);
  assert.deepEqual(await repository.list(), []);
  await repository.append(reading);
  assert.deepEqual(await repository.list(), [reading]);
});

test("repository exports a versioned portable snapshot", async () => {
  const repository = createTelemetryRepository(memoryAdapter([reading]));
  const snapshot = await repository.exportSnapshot();
  assert.equal(snapshot.format, "mw-sense.telemetry-export");
  assert.equal(snapshot.schema_version, "1.0");
  assert.deepEqual(snapshot.records, [reading]);
  assert.ok(Number.isFinite(Date.parse(snapshot.exported_at)));
});

test("snapshot import rejects unknown formats and invalid readings", async () => {
  const repository = createTelemetryRepository(memoryAdapter());
  await assert.rejects(repository.importSnapshot({ format: "other", schema_version: "1.0", records: [] }), TypeError);
  await assert.rejects(repository.importSnapshot({
    format: "mw-sense.telemetry-export", schema_version: "1.0",
    records: [{ ...reading, value: 999 }]
  }), TypeError);
  assert.deepEqual(await repository.list(), []);
});

test("snapshot import appends valid records", async () => {
  const repository = createTelemetryRepository(memoryAdapter());
  const count = await repository.importSnapshot({
    format: "mw-sense.telemetry-export", schema_version: "1.0",
    records: [reading, { ...reading, value: 29 }]
  });
  assert.equal(count, 2);
  assert.deepEqual((await repository.list()).map((item) => item.value), [28.4, 29]);
});

test("repository requires the complete adapter contract", () => {
  assert.throws(() => createTelemetryRepository({ list() {} }), TypeError);
});

test("HTTP adapter sends the documented telemetry resource requests", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ items: [reading], count: 1, limit: 500 }) };
  };
  const adapter = createHttpAdapter("https://example.test/api/", fakeFetch);
  const listed = await adapter.list();
  assert.deepEqual(listed, [reading]);
  await adapter.append(reading);
  await adapter.clear();
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "POST", "DELETE"]);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://example.test/api/telemetry",
    "https://example.test/api/telemetry",
    "https://example.test/api/telemetry"
  ]);
  const posted = JSON.parse(calls[1].options.body);
  assert.equal(posted.sensor_id, "TEMP-01");
  assert.equal("status" in posted, false);
});

test("HTTP adapter reports server errors clearly", async () => {
  const adapter = createHttpAdapter("https://example.test", async () => ({
    ok: false, status: 503
  }));
  await assert.rejects(adapter.list(), /status 503/);
});


test("HTTP adapter sends bearer authentication and omits server-owned fields", async () => {
  let call;
  const adapter = createHttpAdapter("https://example.test", async (url, options) => {
    call = { url, options };
    return { ok: true, status: 201, json: async () => ({ id: 1 }) };
  }, { token: "secret-token" });
  await adapter.append({ ...reading, id: 7, received_at: "2026-08-15T10:31:00Z" });
  assert.equal(call.options.headers.Authorization, "Bearer secret-token");
  const body = JSON.parse(call.options.body);
  assert.equal(body.simulation, true);
  assert.equal("status" in body, false);
  assert.equal("id" in body, false);
  assert.equal("received_at" in body, false);
});


test("HTTP adapter follows telemetry pagination and restores chronological order", async () => {
  const requests = [];
  const newer = { ...reading, value: 31 };
  const older = { ...reading, value: 29 };
  const adapter = createHttpAdapter("https://example.test", async (url) => {
    requests.push(url);
    const offset = Number(new URL(url).searchParams.get("offset"));
    return {
      ok: true,
      status: 200,
      json: async () => offset === 0
        ? { items: [newer], count: 2, limit: 1, offset: 0, next_offset: 1 }
        : { items: [older], count: 2, limit: 1, offset: 1, next_offset: null }
    };
  });
  const result = await adapter.list();
  assert.deepEqual(result.map((item) => item.value), [29, 31]);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /offset=1/);
});
