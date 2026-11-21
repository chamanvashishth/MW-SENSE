import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SensorLab, soilReading } from '../lab/engine.mjs';
import { DATASETS, parseCsvReplay, validateReplayRows } from '../lab/datasets.mjs';

test('All three cited replay excerpts contain forty original observations', () => {
  for (const d of Object.values(DATASETS)) {
    assert.equal(d.rows.length, 40);
    assert(d.sourceUrl.startsWith('https://'));
  }
});
test('Greenhouse first row is reproduced and zero soil remains zero', () => {
  const lab = new SensorLab(); lab.loadDataset('greenhouse1'); lab.advance(5);
  assert.equal(lab.getReading('temperature').value, 25.3);
  assert.equal(lab.getReading('humidity').value, 86);
  assert.equal(lab.getReading('soil_percent').value, 0);
  assert(lab.verifyCurrentRow().every(v => v.status === 'match'));
});
test('Recorded source creates no fabricated SGP40 or analog ADC values', () => {
  const lab = new SensorLab(); lab.loadDataset('greenhouse1'); lab.advance(5);
  assert.equal(lab.getReading('voc_index').status, 'not_available');
  assert.equal(lab.getReading('soil_adc').status, 'not_available');
  assert.equal(lab.lastPacket.simulation, true);
  assert.equal(lab.lastPacket.source.sample, 1);
});
test('UCI environmental observations do not fabricate soil data', () => {
  const lab = new SensorLab(); lab.loadDataset('uci'); lab.advance(5);
  assert.equal(lab.getReading('temperature').value, 13.6);
  assert.equal(lab.getReading('humidity').value, 48.9);
  assert.equal(lab.getReading('soil_percent').status, 'not_available');
});
test('Dataset transitions restart sampling instead of leaking old values', () => {
  const lab = new SensorLab(); lab.loadDataset('greenhouse1'); lab.advance(10);
  lab.loadDataset('uci'); assert.equal(lab.time, 0);
  assert.equal(lab.getReading('temperature').value, null);
  lab.advance(5); assert.equal(lab.getReading('temperature').value, 13.6);
});
test('Pause freezes the clock, manual step works, and Reset replays from row one', () => {
  const lab = new SensorLab(); lab.loadDataset('greenhouse4'); lab.advance(12.5);
  lab.isRunning = false; const time = lab.time;
  lab.step(7); assert.equal(lab.time, time);
  lab.advance(6); assert.equal(lab.datasetIndex, 3);
  assert.equal(lab.isRunning, false);
  lab.restart(); assert.equal(lab.datasetIndex, 0);
  assert.equal(lab.sourceMode, 'recorded_replay');
});
test('Injected sensor fault never matches the recorded temperature', () => {
  const lab = new SensorLab(); lab.loadDataset('greenhouse1');
  lab.advance(5); lab.setFault('dht', true); lab.advance(2.6);
  assert.equal(lab.verifyCurrentRow()[0].status, 'error');
});
test('WiFi restoration while paused does not deliver frames early', () => {
  const lab = new SensorLab(); lab.setFault('wifi', true); lab.advance(5);
  lab.isRunning = false; lab.setFault('wifi', false);
  assert.equal(lab.records.length, 0);
  lab.advance(5); assert(lab.records.length > 0);
});
test('Exact moisture endpoints stay valid even with analog jitter', () => {
  for (const p of [0, 100]) for (const phase of [-5, 0, 3, 100])
    assert.equal(soilReading(p, false, phase).status, 'ok');
});
test('Untrusted CSV input validation catches malformed values', () => {
  assert.equal(parseCsvReplay('temperature,humidity,soil_moisture\n20,40,0')[0].soil, 0);
  assert.throws(() => parseCsvReplay('temperature,humidity\n200,40'), /invalid temperature/);
  assert.throws(() => validateReplayRows([{ temperature:null, humidity:null, soil:null }]), /no sensor observations/);
});
