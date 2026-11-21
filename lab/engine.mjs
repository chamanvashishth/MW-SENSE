import { DATASETS, validateReplayRows } from './datasets.mjs';
// MW-SENSE teaching model. Recorded dataset replay and synthetic data are NEVER live physical ESP32 telemetry.

// Sampling cadence and validation boundaries are adapted from the supplied Tinkered firmware.
export const SENSOR_META = {
  temperature: { title: 'Temperature', unit: '°C', sensor: 'DHT22', pin: 'GPIO 13', period: 2500, min: -40, max: 80 },
  humidity: { title: 'Humidity', unit: '%RH', sensor: 'DHT22', pin: 'GPIO 13', period: 2500, min: 0, max: 100 },
  voc_index: { title: 'VOC Index', unit: 'index', sensor: 'SGP40', pin: 'GPIO 21 + 22', period: 1000, min: 1, max: 500 },
  soil_percent: { title: 'Soil Moisture', unit: '%', sensor: 'Capacitive v1.2', pin: 'GPIO 34', period: 1000, min: 0, max: 100 },
  soil_adc: { title: 'Soil ADC', unit: 'counts', sensor: 'Capacitive v1.2', pin: 'GPIO 34', period: 1000, min: 0, max: 4095 },
};
export const SENSOR_KEYS = Object.keys(SENSOR_META);
export const SCENARIOS = {
  room: { label: 'Normal room', temperature: 24, humidity: 52, voc: 105, soil: 45 },
  greenhouse: { label: 'Greenhouse', temperature: 29, humidity: 72, voc: 125, soil: 67 },
  heatwave: { label: 'Heatwave', temperature: 43, humidity: 30, voc: 155, soil: 13 },
  ventilation: { label: 'Poor ventilation', temperature: 28, humidity: 63, voc: 370, soil: 42 },
  rainfall: { label: 'After rainfall', temperature: 21, humidity: 92, voc: 75, soil: 91 },
};
const DEFAULT_FAULTS = Object.freeze({ dht: false, sgp: false, soil: false, wifi: false, mqtt: false });
const SOIL_DRY = 3723, SOIL_WET = 1489;
const tickMs = 250;

export function soilReading(percent, fail = false, phase = 0) {
  // The circuit's dry and wet ADC endpoints must be calibrated on physical hardware.
  const adc = fail ? 4095 : Math.max(SOIL_WET, Math.min(SOIL_DRY, Math.round(SOIL_DRY - (SOIL_DRY - SOIL_WET) * percent / 100 + (percent > 0 && percent < 100 ? 3 * Math.sin(phase) : 0))));
  if (adc <= 16 || adc >= 4079) return { adc, percent: null, status: 'rail_error' };
  if (adc < SOIL_WET || adc > SOIL_DRY) return { adc, percent: null, status: 'out_of_calibration' };
  return { adc, percent: Math.round((SOIL_DRY - adc) * 100 / (SOIL_DRY - SOIL_WET)), status: 'ok' };
}

function makeReading(unit) {
  return { value: null, last_good_value: null, status: 'loading', unit, age_ms: null, error_count: 0, consecutive_errors: 0, goodAt: null };
}

export class SensorLab {
  constructor() { this.reset(); }
  reset() {
    this.time = 0;
    this.isRunning = true;
    this.rate = 1;
    this.scenario = 'room';
    this.conditions = { ...SCENARIOS.room };
    this.faults = { ...DEFAULT_FAULTS };
    this.hasSecondNode = false;
    this.readings = Object.fromEntries(SENSOR_KEYS.map(k => [k, makeReading(SENSOR_META[k].unit)]));
    this.nextSample = { dht: 2.5, soil: 1, voc: 1, mqtt: 5 };
    this.vocEstimate = 100;
    this.seq = 0;
    this.queue = [];
    this.records = [];
    this.log = [];
    this.history = Object.fromEntries(SENSOR_KEYS.map(k => [k, []]));
    this.lastPacket = null;
    this.lastDelivery = null;
    this.lastDecision = 'Boot complete. Sensor sampling is scheduled.';
    this.lastAction = 'boot';
    this.nodeId = 'mw-virtual-01';
    this.startAt = Date.now();
    this.lastHistoryAt = null;
    this.compensation = null;
    this.sourceMode = 'synthetic';
    this.dataset = null;
    this.datasetIndex = 0;
    this.datasetRow = null;
    this.datasetRowAt = 0;
    this.replayInterval = 6;
    this.sourceError = null;
    this.logEvent('boot', 'ESP32 booted. GPIO and I²C interfaces initialized.', 'neutral');
    this.logEvent('boot', 'SGP40 relative VOC algorithm begins a 45 second warm up.', 'warn');
  }
  loadDataset(id, custom = null) {
    const source = custom || DATASETS[id];
    if (!source) throw Error('Dataset not found.');
    const rows = validateReplayRows(source.rows);
    if (!rows.length) throw Error('Dataset has no observations.');
    this.reset();
    this.sourceMode = 'recorded_replay';
    this.dataset = { id: source.id, name: source.name, origin: source.origin, sourceUrl: source.sourceUrl || null,
      cadence: source.cadence, note: source.note, measured: source.measured, rows };
    this.nextSample.dataset = this.replayInterval;
    this.applyDatasetRow(0);
    this.logEvent('dataset', `Loaded ${rows.length} historical observations from ${source.name}. This is a replay, not live sensing.`, 'good');
  }
  applyDatasetRow(index) {
    if (!this.dataset || index >= this.dataset.rows.length) return;
    this.datasetIndex = index;
    this.datasetRow = this.dataset.rows[index];
    this.datasetRowAt = this.time;
    const row = this.datasetRow;
    this.conditions.temperature = row.temperature ?? 24;
    this.conditions.humidity = row.humidity ?? 50;
    this.conditions.soil = row.soil ?? 45;
    this.conditions.voc = 100; // Only scene fallback. VOC output is always unavailable in replay.
    this.logEvent('dataset', `Original observation ${index + 1}/${this.dataset.rows.length}: ${row.recordedTime}. Source values are kept separate from ESP32 calculations.`, 'neutral');
  }
  advanceDataset() {
    if (!this.dataset) return;
    if (this.datasetIndex + 1 >= this.dataset.rows.length) {
      this.isRunning = false;
      this.lastDecision = 'Reached final recorded observation. Playback paused. Press Reset to replay from the beginning.';
      this.logEvent('dataset', 'End of recorded dataset. Replay stopped automatically.', 'good');
      delete this.nextSample.dataset;
      return;
    }
    this.applyDatasetRow(this.datasetIndex + 1);
  }
  restart() {
    const selected = this.dataset;
    if (selected) this.loadDataset(selected.id, selected);
    else this.reset();
  }
  useSynthetic() { this.reset(); }
  verifyCurrentRow() {
    if (!this.datasetRow) return [];
    return [['temperature', 'temperature'], ['humidity', 'humidity'], ['soil', 'soil_percent']].map(([field,key]) => {
      const expected = this.datasetRow[field], actual = this.getReading(key);
      const measured = expected !== null && expected !== undefined;
      const pending = measured && ['ok', 'loading'].includes(actual.status) && (actual.sampled_at === null || actual.sampled_at < this.datasetRowAt - 1e-8);
      const match = !pending && measured && actual.status === 'ok' && actual.value !== null && Math.abs(actual.value - expected) < (key === 'soil_percent' ? .02 : .11);
      return { field, expected: measured ? expected : null, observed: pending ? null : actual.value, status: !measured ? 'not_recorded' : pending ? 'pending' : match ? 'match' : actual.status === 'ok' ? 'mismatch' : actual.status }; 
    });
  }
  logEvent(stage, message, kind = 'neutral') {
    this.log.unshift({ t: this.time, stage, message, kind });
    if (this.log.length > 110) this.log.length = 110;
    this.lastAction = stage;
  }
  setCondition(name, value) {
    if (this.sourceMode === 'recorded_replay') return;
    if (!['temperature', 'humidity', 'voc', 'soil'].includes(name)) return;
    const ranges = { temperature: [-20, 60], humidity: [0, 100], voc: [1, 500], soil: [0, 100] };
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.conditions[name] = Math.min(ranges[name][1], Math.max(ranges[name][0], n));
    this.scenario = 'custom';
  }
  setScenario(name) {
    if (!SCENARIOS[name] || this.sourceMode === 'recorded_replay') return;
    this.scenario = name;
    this.conditions = { ...SCENARIOS[name] };
    delete this.conditions.label;
    this.logEvent('environment', `Environment changed to ${SCENARIOS[name].label}.`, 'neutral');
  }
  setFault(key, on) {
    if (!(key in this.faults)) return;
    const next = Boolean(on);
    if (this.faults[key] === next) return;
    this.faults[key] = next;
    this.logEvent(key === 'wifi' || key === 'mqtt' ? 'network' : 'sensor',
      `${{dht:'DHT22 data',sgp:'SGP40 I²C',soil:'Soil ADC',wifi:'WiFi link',mqtt:'MQTT broker'}[key]} ${next ? 'fault injected' : 'restored'}.`, next ? 'warn' : 'good');
    if (this.isRunning && !next && (key === 'wifi' || key === 'mqtt') && this.canPublish() && this.queue.length) this.flushQueue(2);
  }
  setSecondNode(on) {
    this.hasSecondNode = this.sourceMode === 'recorded_replay' ? false : Boolean(on);
    this.logEvent('network', this.hasSecondNode ? 'Virtual Node 02 joined for expansion demonstration.' : 'Virtual Node 02 removed.', 'neutral');
  }
  updateReading(key, value, status) {
    const r = this.readings[key];
    if (status === 'ok' && Number.isFinite(value)) {
      r.value = value;
      r.last_good_value = value;
      r.goodAt = this.time;
      r.age_ms = 0;
      r.consecutive_errors = 0;
    } else {
      r.value = null;
      if (status === 'error' || status === 'rail_error' || status === 'out_of_calibration') {
        r.error_count++;
        r.consecutive_errors++;
      }
    }
    r.status = status;
    this.lastAction = 'sensor';
  }
  sampleDht() {
    if (this.faults.dht) {
      for (const key of ['temperature', 'humidity']) this.updateReading(key, null, 'error');
      this.lastDecision = 'DHT22 returned no valid data. ESP32 marks current readings invalid and retains last good values.';
      this.logEvent('validation', 'DHT22 read failed on GPIO 13. Invalid readings will not be shown as current.', 'bad');
      return;
    }
    const row = this.sourceMode === 'recorded_replay' ? this.datasetRow : null;
    const t = row ? row.temperature : +(this.conditions.temperature + 0.15 * Math.sin(this.time * 0.6)).toFixed(1);
    const h = row ? row.humidity : Math.round(this.conditions.humidity + 0.4 * Math.sin(this.time * 0.36));
    this.updateReading('temperature', t, t === null ? 'not_available' : 'ok');
    this.updateReading('humidity', h, h === null ? 'not_available' : 'ok');
    if (row) {
      this.lastDecision = `Educational ESP32 logic accepted recorded temperature ${t ?? 'N/A'} °C and humidity ${h ?? 'N/A'} %RH. The dataset does not establish a DHT22 or ESP32 as its source device.`;
      this.logEvent('sensor', `Dataset row ${this.datasetIndex+1} replayed: T ${t ?? 'N/A'} °C and RH ${h ?? 'N/A'} %.`, 'good');
    } else {
      this.lastDecision = `ESP32 model decoded DHT22 digital data from GPIO 13. Temperature ${t} °C and humidity ${h} %RH passed validation.`;
      this.logEvent('sensor', `Simulated DHT22 GPIO 13: ${t} °C and ${h} %RH.`, 'good');
    }
  }
  sampleSoil() {
    if (this.sourceMode === 'recorded_replay') {
      const percent = this.datasetRow?.soil;
      this.updateReading('soil_adc', null, 'not_available');
      this.updateReading('soil_percent', percent ?? null, percent == null ? 'not_available' : 'ok');
      if (percent != null) {
        this.lastDecision = `Recorded soil moisture ${percent}% was received by the educational processing model. No ADC counts or ESP32 voltage were measured in this dataset.`;
        this.logEvent('sensor', `Source soil reading ${percent}% reprocessed. ADC is unknown.`, 'good');
      }
      return;
    }
    const soil = soilReading(this.conditions.soil, this.faults.soil, this.time * 0.9);
    this.updateReading('soil_adc', soil.status === 'rail_error' ? null : soil.adc, soil.status === 'rail_error' ? 'rail_error' : 'ok');
    this.updateReading('soil_percent', soil.percent, soil.status);
    if (soil.status === 'ok') {
      this.lastDecision = `ESP32 ADC1 read ${soil.adc} counts on GPIO 34. Calibration maps this to ${soil.percent}% soil moisture.`;
      this.logEvent('sensor', `GPIO 34 sampled 16 ADC readings. Mean ${soil.adc} converts to ${soil.percent}% moisture.`, 'good');
    } else {
      this.lastDecision = 'ESP32 detects an invalid soil ADC reading and rejects the current moisture percentage.';
      this.logEvent('validation', `Soil sensor reported ${soil.adc} ADC counts with ${soil.status} status.`, 'bad');
    }
  }
  sampleVoc() {
    if (this.sourceMode === 'recorded_replay') {
      this.updateReading('voc_index', null, 'not_available');
      return;
    }
    const temp = this.readings.temperature;
    const hum = this.readings.humidity;
    const compensation = temp.status === 'ok' && hum.status === 'ok' && this.time - temp.goodAt <= 10 && this.time - hum.goodAt <= 10;
    this.compensation = compensation ? 'recent_dht' : 'fallback_25C_50RH';
    if (this.faults.sgp) {
      this.updateReading('voc_index', null, 'error');
      this.lastDecision = 'SGP40 did not respond at I²C address 0x59. ESP32 flags an I²C error and schedules a retry.';
      this.logEvent('validation', 'SGP40 I²C response missing on GPIO 21 and 22.', 'bad');
      return;
    }
    if (this.time < 45) {
      this.updateReading('voc_index', null, 'warming_up');
      if (Math.abs(this.time % 10) < .13) this.logEvent('sensor', `SGP40 algorithm learning. ${Math.max(0, Math.ceil(45 - this.time))} seconds to first VOC index.`, 'warn');
      return;
    }
    this.vocEstimate += (this.conditions.voc - this.vocEstimate) * 0.20;
    const v = Math.round(Math.min(500, Math.max(1, this.vocEstimate + 2 * Math.sin(this.time / 3))));
    this.updateReading('voc_index', v, 'ok');
    this.lastDecision = `ESP32 requested VOC index via I²C GPIO 21 and 22. Index ${v} is relative air quality information${compensation ? ' with DHT compensation' : ' using fallback compensation'}.`;
    this.logEvent('sensor', `SGP40 at 0x59 returned relative VOC index ${v} (${this.compensation}).`, 'good');
  }
  getReading(key) {
    const r = this.readings[key];
    if (!r) return null;
    const age = r.goodAt === null ? null : Math.round((this.time - r.goodAt) * 1000);
    const maxAge = key === 'temperature' || key === 'humidity' ? 10000 : 3500;
    const status = r.status === 'ok' && age !== null && age > maxAge ? 'stale' : r.status;
    return { value: status === 'ok' ? r.value : null, last_good_value: r.last_good_value, unit: r.unit,
      status, age_ms: age, sampled_at: r.goodAt, error_count: r.error_count, consecutive_errors: r.consecutive_errors };
  }
  getFrame(nodeId = this.nodeId) {
    const secondary = nodeId.endsWith('02');
    const sensorData = Object.fromEntries(SENSOR_KEYS.map(k => [k, this.getReading(k)]));
    if (secondary) {
      const adjustments = { temperature: 1.8, humidity: -3, voc_index: 11, soil_percent: -9, soil_adc: 180 };
      for (const k of SENSOR_KEYS) {
        if (sensorData[k].status === 'ok') sensorData[k].value = +(sensorData[k].value + adjustments[k]).toFixed(1);
        if (sensorData[k].last_good_value !== null) sensorData[k].last_good_value = +(sensorData[k].last_good_value + adjustments[k]).toFixed(1);
      }
    }
    return { schema_version: 1, node_id: nodeId, simulation: true, source_mode: this.sourceMode,
      source: this.sourceMode === 'recorded_replay' ? { dataset_id: this.dataset.id, sample: this.datasetRow.sample, recorded_time: this.datasetRow.recordedTime } : { label: 'browser physics model' },
      sequence: this.seq, uptime_ms: Math.round(this.time * 1000),
      compensation: this.compensation || 'fallback_25C_50RH', sensors: sensorData };
  }
  canPublish() { return !this.faults.wifi && !this.faults.mqtt; }
  deliver(frame, fromQueue = false) {
    const packet = JSON.parse(JSON.stringify(frame));
    const event = { at: this.time, frame: packet, queued: fromQueue };
    this.records.unshift(event);
    if (this.records.length > 120) this.records.length = 120;
    this.lastDelivery = event;
    const qualifier = fromQueue ? 'Recovered queued frame' : 'MQTT delivered telemetry';
    this.logEvent('dashboard', `${qualifier} for ${packet.node_id}. Data stored and dashboard refreshed.`, 'good');
  }
  flushQueue(limit = 1) {
    if (!this.canPublish() || !this.queue.length) return;
    let count = 0;
    while (this.queue.length && count++ < limit) this.deliver(this.queue.shift(), true);
    this.lastDecision = `Connection restored. ${count - 1} queued packet(s) sent to the simulated storage.`;
  }
  publish() {
    this.seq++;
    const frames = [this.getFrame(this.nodeId)];
    if (this.hasSecondNode) frames.push(this.getFrame('mw-virtual-02'));
    this.lastPacket = frames[0];
    for (const frame of frames) {
      if (this.canPublish()) {
        if (this.queue.length) this.flushQueue(2);
        this.deliver(frame);
      } else {
        this.queue.push(JSON.parse(JSON.stringify(frame)));
        if (this.queue.length > 24) {
          this.queue.shift();
          this.logEvent('network', 'Educational offline queue is full. Oldest frame was dropped.', 'warn');
        }
        this.lastDecision = `${this.faults.wifi ? 'WiFi link' : 'MQTT broker'} unavailable. The simulated frame is queued locally.`;
        this.logEvent('network', `Network unavailable. Frame ${this.seq} held in simulation queue.`, 'warn');
      }
    }
  }
  sampleHistory() {
    for (const key of SENSOR_KEYS) {
      const r = this.getReading(key);
      this.history[key].push({ t: this.time, value: r.status === 'ok' ? r.value : null, status: r.status });
      if (this.history[key].length > 90) this.history[key].shift();
    }
  }
  step(seconds = 0.25) {
    if (!this.isRunning) return;
    const dt = Number(seconds);
    if (!Number.isFinite(dt) || dt <= 0) return;
    const end = this.time + Math.min(10, dt * this.rate);
    const jobs = { dht: ['sampleDht', 2.5], soil: ['sampleSoil', 1], voc: ['sampleVoc', 1], mqtt: ['publish', 5], dataset: ['advanceDataset', this.replayInterval] };
    let safety = 0;
    while (safety++ < 200) {
      const due = Object.entries(this.nextSample).filter(([key, time]) => jobs[key] && time <= end + 1e-8).sort((a, b) => a[1] - b[1] || (a[0] === 'dataset' ? -1 : b[0] === 'dataset' ? 1 : 0));
      if (!due.length || !this.isRunning) break;
      const [name, at] = due[0];
      this.time = at;
      this.nextSample[name] += jobs[name][1];
      this[jobs[name][0]]();
      if (this.lastHistoryAt === null || this.time - this.lastHistoryAt >= 1) {
        this.sampleHistory();
        this.lastHistoryAt = this.time;
      }
    }
    if (this.isRunning) this.time = end;
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const saved = this.isRunning, rate = this.rate;
    this.isRunning = true;
    this.rate = 1;
    let remaining = Math.min(seconds, 3600), n=0;
    while (remaining > 1e-8 && n++ < 15000 && this.isRunning) {
      const part=Math.min(0.25,remaining);
      this.step(part);
      remaining-=part;
    }
    this.rate=rate;
    // When a replay naturally finishes, preserve its paused state.
    this.isRunning = this.dataset && !this.nextSample.dataset ? false : saved;
  }
}





