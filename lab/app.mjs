import { SensorLab, SCENARIOS, SENSOR_KEYS, SENSOR_META } from './engine.mjs';
import { DATASETS, parseCsvReplay } from './datasets.mjs';
let lab = new SensorLab();
let selectedSensor = 'temperature';
let selectedComponent = 'dht';
let selectedStage = 0;
let visibleTab = 'lab';
let clearedUntil = 0;
let lastRendered = '';
let importedSource = null;
const $ = id => document.getElementById(id);
const nf = (value, decimals = 0) => Number(value).toFixed(decimals);
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const statusPretty = status => ({not_available:'NOT RECORDED', ok: 'OK', loading: 'LOADING', warming_up: 'WARMING', error: 'ERROR', out_of_calibration: 'UNCALIBRATED', rail_error: 'RAIL ERROR', stale: 'STALE' })[status] || status.toUpperCase();
const statusBrief = status => ({not_available:'Source does not contain this sensor',loading:'Waiting for sample',warming_up:'Learning sensor baseline',error:'Read failure',rail_error:'ADC rail detected',out_of_calibration:'Probe needs calibration',stale:'Reading is old',ok:'Valid and up to date'})[status];
const labels = { lab:'VIRTUAL ENVIRONMENT', circuit:'HARDWARE AND WIRING', journey:'DATA JOURNEY', testing:'RELIABILITY TESTS', guide:'PROJECT GUIDE' };
const stages = [
  ['Sensor acquisition', 'DHT22 supplies digital temperature and humidity. SGP40 returns a relative VOC index via I²C. The soil sensor provides a voltage that the ESP32 converts into ADC counts.'],
  ['Local data validation', 'The ESP32 checks the DHT range, detects missing I²C responses and rejects ADC rail readings. Invalid current values are marked null and last good values remain separate.'],
  ['Structured telemetry packet', 'Every published MQTT frame carries a schema version, node identifier, sequence number, uptime, compensation method and one reading object for each measured parameter.'],
  ['WiFi and MQTT transport', 'Every five virtual seconds the node attempts to publish the frame. Network failures prevent simulated delivery. The browser queue is an educational extension, not a feature of the original Tinkered firmware.'],
  ['Centralized monitoring record', 'Successfully delivered frames are added to this browser session’s in memory reception list. This is a simulated database view, not proof of an external broker or backend.'],
  ['Dashboard visualization', 'The dashboard displays the most recent valid sensor values, current status and trends while preserving an audit trail of the data journey.'],
];
const components = {
  dht: { title:'DHT22', description:'One digital sensor measures ambient temperature and relative humidity.', pin:'GPIO 13 · digital data', interface:'Single digital data line with a 10 kΩ pullup', frequency:'Every 2.5 seconds', processing:'Checks −40 to 80 °C and 0 to 100 %RH. Invalid readings are marked as errors.', tip:'Data is pulled to 3.3 V through the 10 kΩ resistor. Both outputs come from one digital sensor.', reading:() => { const t=lab.getReading('temperature'),h=lab.getReading('humidity');return `${show(t,1,'°C')} · ${show(h,0,'%RH')}`; } },
  sgp: { title:'SGP40', description:'A digital VOC sensor that reports a relative VOC index, not certified AQI or CO₂.', pin:'GPIO 21 SDA · GPIO 22 SCL', interface:'I²C at address 0x59', frequency:'Once per second · 45 s initial warm up', processing:'Uses current DHT values for compensation when fresh. I²C errors invalidate the measurement.', tip:'The index is relative to changing air conditions. Its value is not a gas concentration in ppm.', reading:() => show(lab.getReading('voc_index'),0,' index') },
  soil: { title:'Capacitive soil moisture v1.2', description:'A capacitive probe produces an analog voltage related to soil water content.', pin:'GPIO 34 · ADC1', interface:'12 bit analog to digital conversion', frequency:'Every second · mean of 16 ADC samples', processing:'Uses dry endpoint 3723 and wet endpoint 1489 to estimate moisture. Rail counts and out of calibration values are flagged.', tip:'The ADC endpoints are examples from the Tinkered configuration. Calibrate with the real probe before field use.', reading:() => `${show(lab.getReading('soil_percent'),0,'%')} · ${show(lab.getReading('soil_adc'),0,' counts')}` },
  esp32: { title:'ESP32 DevKit V1', description:'The controller reads the sensors, checks quality, prepares telemetry and handles wireless communication.', pin:'GPIO 13 · 21 · 22 · 34', interface:'Digital · I²C · ADC1 · built in WiFi', frequency:'DHT 2.5 s · VOC/soil 1 s · MQTT 5 s', processing:'Tracks validity, age, error counters, node identity and MQTT transmission status.', tip:'Sensors operate at 3.3 V with common ground. The ESP32 board is powered over USB.', reading:() => `${lab.records.length} delivered · ${lab.queue.length} queued` },
};

function show(reading, decimals, unit) {
  if (!reading) return 'Waiting';
  if (reading.status === 'ok' && reading.value !== null) return `${nf(reading.value,decimals)} ${unit}`.trim();
  return reading.status === 'warming_up' ? 'Warming up' : reading.status === 'loading' ? 'Waiting' : reading.status === 'not_available' ? 'Not recorded' : 'Unavailable';
}
function goTab(id) {
  if (!labels[id]) return;
  visibleTab = id;
  $('intro-hero').hidden = id !== 'lab';
  document.querySelectorAll('.tab-panel').forEach(panel => { const active = panel.id === `tab-${id}`; panel.hidden = !active; panel.classList.toggle('active',active); });
  document.querySelectorAll('.nav-btn').forEach(button => { const active = button.dataset.tab === id; button.classList.toggle('active',active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = labels[id];
  window.scrollTo(0, 0);
  render();
}
function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.tab)));
  $('dismiss-notice').addEventListener('click', () => $('.notice').style.display='none');
  $('pause-btn').addEventListener('click', () => { lab.isRunning = !lab.isRunning; render(); });
  $('reset-btn').addEventListener('click', () => {
    lab.restart(); clearedUntil=0; lastRendered=''; $('second-node').checked=false;
    document.querySelectorAll('[data-fault]').forEach(x=>x.checked=false);
    $('speed').value='1'; updateSliders(); render();
  });
  $('step-btn').addEventListener('click', () => { lab.advance(1); render(); });
  $('source-select').addEventListener('change', e => {
    try {
      if (e.target.value === 'synthetic') lab.useSynthetic();
      else if (e.target.value === 'imported' && importedSource) lab.loadDataset('imported', importedSource);
      else lab.loadDataset(e.target.value);
      resetUiAfterSourceChange();
    } catch(err) { $('source-message').textContent = `Unable to load dataset: ${err.message}`; }
  });
  $('next-record').addEventListener('click', () => {
    if (!lab.dataset || lab.datasetIndex === lab.dataset.rows.length - 1) return;
    const nextTime = lab.nextSample.dataset;
    lab.advance(Math.max(.001, nextTime-lab.time) + 2.6);
    render();
  });
  $('csv-upload').addEventListener('change', async e => {
    const file=e.target.files?.[0]; if (!file) return;
    try {
      if(file.size > 1024*1024) throw Error('Maximum CSV size is 1 MB.');
      const rows=parseCsvReplay(await file.text());
      importedSource={id:'imported',name:file.name,origin:'User supplied CSV. Provenance has not been verified.',sourceUrl:null,
        cadence:'Provided row sequence. No cadence inference.',note:'Imported values are user supplied. Temperature and humidity are reprocessed. Soil percent is used directly and no ESP32 ADC or VOC signal is invented.',
        measured:['temperature','humidity','soil'].filter(k=>rows.some(r=>r[k]!==null)),rows};
      const select=$('source-select');
      let option=select.querySelector('option[value="imported"]');
      if(!option){option=document.createElement('option');option.value='imported';select.appendChild(option);}
      option.textContent=`Imported CSV · ${rows.length} rows`;
      select.value='imported';lab.loadDataset('imported',importedSource);resetUiAfterSourceChange();
    } catch(err) { $('source-message').textContent=`CSV import failed: ${err.message}`; }
    e.target.value='';
  });
  $('export-trace').addEventListener('click', () => {
    const data={kind:'MW-SENSE virtual lab trace',source_mode:lab.sourceMode,source_name:lab.dataset?.name || 'Synthetic model',
      simulation:true,hardware_connected:false,virtual_seconds:lab.time,
      received_frames:lab.records.map(x=>x.frame),pending_frames:lab.queue,log_events:lab.log};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mw-sense-output-trace.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  });
  $('export-record').addEventListener('click', () => {
    if (!lab.datasetRow) return;
    const blob=new Blob([JSON.stringify({source:lab.dataset.name,record:lab.datasetRow,verification:lab.verifyCurrentRow()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mw-sense-source-record.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  });
  $('speed').addEventListener('change', e => { lab.rate = Number(e.target.value); lab.logEvent('system', `Virtual clock set to ${lab.rate}× speed.`, 'neutral'); render(); });
  document.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', () => { lab.setScenario(b.dataset.scenario); updateSliders(); render(); }));
  for (const id of ['temperature','humidity','voc','soil']) $(id).addEventListener('input', e => { lab.setCondition(id, e.target.value); updateSliders(); render(); });
  document.querySelectorAll('[data-sensor]').forEach(b => b.addEventListener('click', () => { selectedSensor=b.dataset.sensor; document.querySelectorAll('.sensor-tile').forEach(x=>x.classList.toggle('selected',x===b)); $('graph-sensor').value=selectedSensor; render(); }));
  $('graph-sensor').addEventListener('change', e => { selectedSensor=e.target.value; document.querySelectorAll('.sensor-tile').forEach(x=>x.classList.toggle('selected',x.dataset.sensor===selectedSensor));render(); });
  $('clear-log').addEventListener('click', () => { lab.log = []; clearedUntil = null; lastRendered = ''; renderLogs(); });
  document.querySelectorAll('[data-component]').forEach(el => { const act=()=>{selectedComponent=el.dataset.component;renderComponent();};el.addEventListener('click',act);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}}); });
  document.querySelectorAll('[data-stage]').forEach(el=>el.addEventListener('click',()=>{selectedStage=Number(el.dataset.stage);renderStage();}));
  $('copy-packet').addEventListener('click', async ()=>{if(!lab.lastPacket)return;const text=JSON.stringify(lab.lastPacket,null,2);try{await navigator.clipboard.writeText(text);$('copy-packet').textContent='Copied';setTimeout(()=>$('copy-packet').textContent='Copy JSON',1200);}catch{const range=document.createRange();range.selectNodeContents($('packet-json'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('copy-packet').textContent='Select and copy';}});
  document.querySelectorAll('[data-fault]').forEach(b=>b.addEventListener('change',()=>{lab.setFault(b.dataset.fault,b.checked);render();}));
  $('second-node').addEventListener('change',e=>{lab.setSecondNode(e.target.checked);render();});
}
function resetUiAfterSourceChange() {
  lastRendered = '';
  $('second-node').checked = false;
  document.querySelectorAll('[data-fault]').forEach(x => { x.checked = false; });
  $('speed').value = '1';
  updateSliders();
  render();
}
function renderEvidence() {
  const isReplay = lab.sourceMode === 'recorded_replay';
  const ds = lab.dataset;
  $('source-mode-label').textContent = isReplay ? 'HISTORICAL REPLAY' : 'BROWSER SIMULATION';
  $('source-badge').textContent = isReplay ? 'RECORDED DATA' : 'SYNTHETIC DATA';
  $('source-badge').classList.toggle('is-recorded', isReplay);
  $('next-record').disabled = !isReplay || lab.datasetIndex >= ds.rows.length - 1;
  $('export-record').disabled = !isReplay;
  document.querySelectorAll('[data-scenario]').forEach(b=>b.disabled=isReplay);
  for(const key of ['temperature','humidity','soil','voc']) $(key).disabled=isReplay;
  $('scenario-buttons').classList.toggle('is-locked',isReplay);
  $('second-node').disabled=isReplay;
  if (!isReplay) {
    $('source-message').textContent='Synthetic values are driven by the sliders. All readings are simulated. No outside dataset or physical sensor is connected.';
    $('record-position').textContent='Synthetic environment · adjustable input';
    $('record-cadence').textContent='DHT 2.5s · Soil and VOC 1s · MQTT 5s';
    $('record-progress').style.width='0%';
    $('verification-rows').replaceChildren();
    const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='Select a recorded dataset to compare source and processed measurements.';tr.appendChild(td);$('verification-rows').appendChild(tr);
    $('source-raw-json').textContent='Synthetic input: '+JSON.stringify(lab.conditions,null,2);
    $('verify-count').textContent='SYNTHETIC';
    $('verification-notes').textContent='Values are generated from the educational model. They are not evidence of physical hardware readings.';
    $('dataset-indicator').textContent='Synthetic model · not hardware telemetry';
    $('dataset-source-link').hidden=true;
    $('dataset-source-note').textContent='No external source selected.';
    return;
  }
  const sourceRow=lab.datasetRow;
  $('source-message').textContent=`${ds.origin}. ${ds.note}`;
  $('record-position').textContent=`SOURCE RECORD ${lab.datasetIndex + 1} OF ${ds.rows.length} · ${sourceRow.recordedTime}`;
  $('record-cadence').textContent=`Source cadence: ${ds.cadence} · Browser replay advances one row every ${lab.replayInterval}s`;
  $('record-progress').style.width=`${(lab.datasetIndex + 1) * 100 / ds.rows.length}%`;
  $('source-raw-json').textContent=JSON.stringify({source:ds.name,record:sourceRow},null,2);
  const packet=lab.lastPacket,deliver=lab.lastDelivery;
  if(packet?.source?.dataset_id===ds.id && packet.source.sample===sourceRow.sample){
    const received=deliver?.frame?.source?.dataset_id===ds.id && deliver.frame.source.sample===sourceRow.sample;
    $('dataset-indicator').textContent=received
      ? `Source row ${sourceRow.sample} → virtual ESP32 → MQTT frame ${packet.sequence} → stored browser record ✓`
      : `Source row ${sourceRow.sample} → MQTT frame ${packet.sequence} prepared. Waiting for simulated delivery.`;
  } else {
    $('dataset-indicator').textContent=`Source row ${sourceRow.sample} loaded. Waiting for the virtual ESP32 to sample and publish it.`;
  }
  $('dataset-source-link').hidden=!ds.sourceUrl;
  if(ds.sourceUrl) $('dataset-source-link').href=ds.sourceUrl;
  $('dataset-source-note').textContent=ds.origin;
  const checks=lab.verifyCurrentRow(),body=$('verification-rows');body.replaceChildren();
  let matched=0,available=0;
  for(const x of checks){
    if(x.expected!==null)available++;
    if(x.status==='match')matched++;
    const tr=document.createElement('tr');
    const strings=[x.field==='soil'?'Soil moisture':x.field==='humidity'?'Humidity':'Temperature',
      x.expected===null?'Not in source':String(x.expected)+(x.field==='temperature'?' °C':' %'),
      x.observed===null?'Waiting or N/A':String(x.observed)+(x.field==='temperature'?' °C':' %'),
      x.status==='match'?'MATCH':x.status==='pending'?'SAMPLING':x.status==='not_recorded'?'N/A':x.status.toUpperCase()];
    for(let i=0;i<strings.length;i++){const td=document.createElement('td');td.textContent=strings[i];if(i===3)td.className='compare-status '+x.status;tr.appendChild(td);}body.appendChild(tr);
  }
  $('verify-count').textContent=`${matched} OF ${available} MATCH`;
  const issues=checks.filter(x=>x.status==='mismatch').length;
  $('verification-notes').textContent=issues?'Mismatch detected. Inspect timing, fault switches or processing logic.':
    'The comparison checks equality to source measurements after the next scheduled sample. Zero soil moisture remains zero. ADC counts and SGP40 VOC index remain unavailable because the dataset did not measure them.';
}
function updateSliders() {
  Object.entries(lab.conditions).forEach(([key,value])=>{const el=$(key);if(el)el.value=value; const output=$(`${key}-val`);if(output)output.textContent= key==='temperature'?`${value} °C`:key==='humidity'?`${value} %RH`:key==='soil'?`${value} %`:value;});
  document.querySelectorAll('[data-scenario]').forEach(b=>b.classList.toggle('active',b.dataset.scenario===lab.scenario));
  $('source-select').value = lab.dataset?.id || 'synthetic';
}
function renderScene() {
  const c=lab.conditions;
  $('scene-temp').textContent=`${nf(c.temperature,1)} °C`;
  $('scene-air').textContent=lab.dataset ? 'Not recorded' : c.voc>300?'Poor ventilation':c.voc>180?'Elevated':'Normal';
  $('scene-soil').textContent=lab.dataset && lab.datasetRow.soil===null?'Not recorded':c.soil<25?'Dry':c.soil>78?'Very wet':'Moderate';
  $('scene-sun').setAttribute('fill',c.temperature>37?'#e3a16d':c.temperature<10?'#b9cadd':'#e4c27c');
  $('scene-sun').setAttribute('r',String(24+Math.max(0,c.temperature-20)*0.48));
  $('scene-clouds').style.opacity=String(.3+c.humidity*.007);
  $('scene-voc-haze').style.opacity=lab.dataset?'0':String(Math.min(.8,c.voc/550));
  $('scene-drops').style.opacity=c.humidity>=80?'1':'0';
  $('soil-bed').style.filter=`brightness(${1-Math.max(0,c.soil-40)/180})`;
}
function renderSensorTile(key,id,valueId,statusId,detailId,decimals) {
  const r=lab.getReading(key);
  $(valueId).textContent=show(r,decimals,SENSOR_META[key].unit);
  $(statusId).textContent=statusPretty(r.status);
  $(statusId).className=`status-label ${r.status}`;
  let desc=statusBrief(r.status);
  if(r.status==='warming_up')desc=`Learning baseline · ${Math.max(0,Math.ceil(45-lab.time))}s`;
  if (r.status !== 'ok' && r.last_good_value !== null) desc+=` · previous ${nf(r.last_good_value,decimals)}`;
  $(detailId).textContent=desc;
}
function renderSummary() {
  $('uptime').textContent=clock(lab.time);
  $('node-state').textContent=lab.isRunning?(lab.dataset?'REPLAY':'SENSING'):'PAUSED';
  $('network-summary').innerHTML=`<i class="tiny-status ${lab.canPublish()?'good':'bad'}"></i>${lab.faults.wifi?'WiFi offline':lab.faults.mqtt?'MQTT offline':'WiFi + MQTT'}`;
  $('packet-count').textContent=String(lab.records.length);
  $('queue-count').textContent=String(lab.queue.length);
  $('sidebar-node').textContent=lab.isRunning?(lab.dataset?'NODE 01 · REPLAY':'NODE 01 · RUNNING'):'NODE 01 · PAUSED';
  $('sidebar-node-sub').textContent=`Virtual time ${clock(lab.time)} · ${lab.rate}× speed`;
  $('pause-icon').textContent=lab.isRunning?'Ⅱ':'▶';
  $('pause-text').textContent=lab.isRunning?'Pause simulation':'Resume simulation';
}
function renderChart() {
  const chart=lab.history[selectedSensor]||[];
  $('chart-caption').textContent=`${SENSOR_META[selectedSensor].title} · ${SENSOR_META[selectedSensor].unit} · sampled on virtual time. Gaps indicate missing or invalid data.`;
  const values=chart.map(p=>p.value).filter(v=>v!==null);
  if(!values.length){$('chart-path').setAttribute('d','');$('chart-markers').innerHTML='';return;}
  const max=Math.max(...values),min=Math.min(...values);
  const spread=Math.max(1,max-min);
  const pad=spread*.42;
  let d='',lastPoint=null;
  for(let i=0;i<chart.length;i++){
    const p=chart[i];if(p.value===null){lastPoint=null;continue;}
    const x=30+(i/Math.max(1,chart.length-1))*625;
    const y=147-(p.value-(min-pad))/(spread+2*pad)*119;
    d+=`${lastPoint?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)} `;lastPoint=[x,y];
  }
  $('chart-path').setAttribute('d',d);
  if(lastPoint)$('chart-markers').innerHTML=`<circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="4.5" fill="#497658" stroke="#fff" stroke-width="2"/>`;
}
function renderLogs() {
  const events=lab.log.filter(e=>e!==clearedUntil).slice(0,12);
  // No executable content from logs. All messages are authored simulator strings.
  const key=events.map(e=>`${e.t}|${e.message}`).join(';');
  if(key===lastRendered)return;
  lastRendered=key;
  const node=$('serial-log');node.replaceChildren();
  for(const e of events){const row=document.createElement('p');row.className=e.kind;
    const stamp=document.createElement('time');stamp.textContent=`[${clock(e.t)}] `;row.append(stamp,document.createTextNode(e.message));node.appendChild(row);}
}
function renderComponent() {
  const c=components[selectedComponent];
  $('component-title').textContent=c.title;$('component-description').textContent=c.description;
  $('component-pin').textContent=c.pin;$('component-interface').textContent=c.interface;
  $('component-frequency').textContent=c.frequency;$('component-reading').textContent=c.reading();
  $('component-processing').textContent=c.processing;$('component-tip').textContent=c.tip;
  document.querySelectorAll('[data-component]').forEach(el=>el.classList.toggle('active',el.dataset.component===selectedComponent));
  document.querySelectorAll('[data-wire]').forEach(el=>el.classList.toggle('active',el.dataset.wire===selectedComponent));
}
function renderStage() {
  const [name,desc]=stages[selectedStage];$('stage-title').textContent=`0${selectedStage+1} · ${name}`;$('stage-description').textContent=desc;
  document.querySelectorAll('[data-stage]').forEach(b=>b.classList.toggle('chosen',Number(b.dataset.stage)===selectedStage));
}
function renderJourney() {
  $('packet-json').textContent=lab.lastPacket?JSON.stringify(lab.lastPacket,null,2):'Waiting for the first 5 second publish event…';
  $('mqtt-topic').textContent=`mw-sense/${lab.nodeId}/telemetry`;
  $('packet-time').textContent=lab.lastPacket?`FRAME ${lab.lastPacket.sequence} · ${clock(lab.lastPacket.uptime_ms/1000)}`:'WAITING FOR FIRST FRAME';
  $('store-count').textContent=`${lab.records.length} STORED`;
  $('last-delivery').textContent=lab.lastDelivery?clock(lab.lastDelivery.at):'Not received';
  $('held-count').textContent=String(lab.queue.length);
  const body=$('storage-rows');body.replaceChildren();
  if(!lab.records.length){const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=4;cell.className='empty-state';cell.textContent='No records yet';row.appendChild(cell);body.appendChild(row);}
  else for(const event of lab.records.slice(0,18)){const tr=document.createElement('tr');for(const str of [clock(event.at),event.frame.node_id,event.frame.sequence,event.queued?'Recovered':'Delivered']){const td=document.createElement('td');td.textContent=String(str);tr.appendChild(td);}body.appendChild(tr);}
  $('node-list').replaceChildren();for(const id of ['mw-virtual-01',...(lab.hasSecondNode?['mw-virtual-02']:[])]){const span=document.createElement('span');span.className='node-tag'+(id.endsWith('01')?' selected-node':'');span.textContent=id.endsWith('01')?'NODE 01 · LOCAL':'NODE 02 · EMULATED';$('node-list').appendChild(span);}
}
function renderTesting() {
  $('queued-number').textContent=String(lab.queue.length);
  $('wifi-led').className=`tiny-status ${lab.faults.wifi?'bad':'good'}`;
  $('mqtt-led').className=`tiny-status ${lab.faults.mqtt||lab.faults.wifi?'bad':'good'}`;
  $('recovery-note').textContent=lab.canPublish()?lab.queue.length?'Link is available. Queue drains on the next publish.':'Link healthy. Frames deliver normally.':`Delivery stopped. Sensors keep sampling. ${lab.queue.length} demo frame(s) held.`;
}
function render() {
  renderSummary();
  if(visibleTab==='lab'){
    renderScene();
    renderSensorTile('temperature','temperature','read-temperature','temp-status','temp-explain',1);
    renderSensorTile('humidity','humidity','read-humidity','hum-status','hum-explain',0);
    renderSensorTile('voc_index','voc','read-voc','voc-status','voc-explain',0);
    renderSensorTile('soil_percent','soil','read-soil','soil-status','soil-explain',0);
    $('esp32-decision').textContent=lab.lastDecision;
    renderEvidence();renderChart();renderLogs();
  } else if(visibleTab==='circuit')renderComponent();
  else if(visibleTab==='journey'){renderStage();renderJourney();}
  else if(visibleTab==='testing')renderTesting();
}

bindEvents();updateSliders();render();
let previous = performance.now();
setInterval(()=>{
  const now=performance.now();
  const realDelta=Math.min((now-previous)/1000,.5);previous=now;
  lab.step(realDelta);
  render();
},250);