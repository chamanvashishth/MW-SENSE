import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SensorLab, soilReading } from '../lab/engine.mjs';

test('The Tinkered soil calibration produces valid moisture and rejects ADC rails', () => {
  assert.equal(soilReading(0, false, 0).percent, 0);
  assert.equal(soilReading(100, false, 0).percent, 100);
  assert.equal(soilReading(40, true).status, 'rail_error');
});

test('DHT reads GPIO model values after 2.5 seconds and publishes on five second cycle', () => {
  const lab = new SensorLab();
  lab.advance(5);
  assert.equal(lab.getReading('temperature').status, 'ok');
  assert.equal(lab.getReading('humidity').status, 'ok');
  assert.equal(lab.records.length, 1);
  assert.equal(lab.records[0].frame.schema_version, 1);
  assert.equal(lab.records[0].frame.simulation, true);
  assert.equal(lab.records[0].frame.sensors.voc_index.value, null);
});

test('VOC does not pretend the startup algorithm has completed before 45 seconds', () => {
  const lab = new SensorLab();
  lab.advance(44);
  assert.equal(lab.getReading('voc_index').status, 'warming_up');
  lab.advance(3);
  assert.equal(lab.getReading('voc_index').status, 'ok');
  assert(lab.getReading('voc_index').value > 0);
});

test('A failing sensor reports null current value without erasing last good', () => {
  const lab = new SensorLab();
  lab.advance(4);
  const before = lab.getReading('temperature').value;
  lab.setFault('dht', true);
  lab.advance(3);
  assert.equal(lab.getReading('temperature').value, null);
  assert.equal(lab.getReading('temperature').status, 'error');
  assert.equal(lab.getReading('temperature').last_good_value, before);
});

test('Network failure stops delivery and restoring it drains the educational queue', () => {
  const lab = new SensorLab();
  lab.setFault('wifi', true);
  lab.advance(11);
  assert.equal(lab.records.length, 0);
  assert.equal(lab.queue.length, 2);
  lab.setFault('wifi', false);
  assert.equal(lab.records.length, 2);
  assert.equal(lab.queue.length, 0);
  assert(lab.records.every(x => x.queued));
});

test('Second node publishes a different ID using the same record schema', () => {
  const lab = new SensorLab();
  lab.setSecondNode(true);
  lab.advance(5);
  assert.deepEqual(lab.records.map(x => x.frame.node_id).sort(), ['mw-virtual-01','mw-virtual-02']);
  assert.equal(lab.records[0].frame.schema_version, lab.records[1].frame.schema_version);
});