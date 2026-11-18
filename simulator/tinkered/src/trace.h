#pragma once
#include <Arduino.h>

// Served from the ESP32 itself so /api/nodes is same-origin and shows real readings.
const char SENSOR_TRACE_PAGE[] PROGMEM = R"mwtrace(
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MW-SENSE | Sensor Data Journey</title><style>
:root{--bg:#f7f7f4;--ink:#1e252b;--muted:#637078;--line:#dce2df;--card:#fff;--accent:#155d67;--soft:#e8f3f1;--warn:#8d5c09;--bad:#a33e37}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1150px;margin:auto;padding:28px 24px 65px}a{color:var(--accent)}.top{display:flex;gap:20px;justify-content:space-between;align-items:center;flex-wrap:wrap}
h1{font-size:34px;letter-spacing:-.04em;line-height:1.1;margin:20px 0 12px}h2{font-size:25px;letter-spacing:-.03em;margin:0 0 10px}h3{font-size:18px;margin:0 0 10px}p{margin:0 0 14px}.lead{max-width:780px;color:var(--muted)}
.tag{display:inline-flex;border:1px solid var(--line);padding:6px 12px;border-radius:50px;font-size:13px;font-weight:650}.live{color:#197452}.notlive{color:var(--bad)}
.flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:30px 0 20px}.step{position:relative;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;min-height:170px}.step strong{display:block;color:var(--accent);font-size:13px;margin-bottom:9px}.step h3{line-height:1.2}.step p{font-size:14px;color:var(--muted)}
.step:not(:last-child):after{content:'→';position:absolute;right:-14px;top:46%;z-index:2;font-size:21px;background:var(--bg);color:var(--accent);padding:0 2px}
.sensorgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.sensor{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;min-height:380px}.meta{font-size:13px;color:var(--muted);margin-bottom:15px}.r{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:11px 0;align-items:baseline}.r span:first-child{font-size:13px;color:var(--muted)}.r span:last-child{font-size:16px;font-weight:650;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.r .bad{color:var(--bad)}.r .ok{color:#16724e}
.small{font-size:13px;color:var(--muted)}.details{margin:17px 0 0;padding:12px;background:var(--soft);border-radius:10px;font-size:13px}.section{margin-top:38px}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;min-width:0}pre{background:#182229;color:#daeee9;padding:16px;border-radius:10px;overflow:auto;max-height:350px;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
code{font-size:.9em}.note{padding:14px 18px;border-left:3px solid var(--accent);background:var(--soft);margin-top:24px;font-size:14px}
@media(max-width:850px){.flow{grid-template-columns:repeat(2,1fr)}.step:nth-child(2):after{display:none}.sensorgrid{grid-template-columns:1fr}.two{grid-template-columns:1fr}}
@media(max-width:540px){main{padding:20px 14px}.flow{grid-template-columns:1fr}.step:after{display:none}h1{font-size:30px}}
</style></head><body><main>
<div class="top"><b>MW-SENSE <span style="color:var(--muted)">/ Sensor Data Journey</span></b><a href="/">Open monitoring dashboard</a></div>
<h1>Where does each reading come from?</h1>
<p class="lead">A live block by block trace from the wired sensors to the ESP32 and its monitoring data. This page fetches the device's actual readings. It never generates sample measurements.</p>
<div class="top"><span id="conn" class="tag">Connecting to local ESP32 API…</span><span id="health" class="small"></span></div>
<div class="flow" role="list" aria-label="Four data flow blocks">
<div class="step" role="listitem"><strong>BLOCK 01</strong><h3>Physical sensing</h3><p>DHT22 outputs digital readings. SGP40 speaks I²C. Soil probe outputs analog voltage.</p></div>
<div class="step" role="listitem"><strong>BLOCK 02</strong><h3>ESP32 acquisition</h3><p>GPIO13 reads DHT22. GPIO21 and 22 communicate with SGP40. ADC1 GPIO34 measures soil voltage.</p></div>
<div class="step" role="listitem"><strong>BLOCK 03</strong><h3>Validation</h3><p>Check sensor errors and age. Map soil ADC to calibrated percentage. Flag SGP40 warmup.</p></div>
<div class="step" role="listitem"><strong>BLOCK 04</strong><h3>MQTT and dashboard</h3><p>Publish a versioned JSON payload when connected. The dashboard reads /api/nodes every 2 seconds.</p></div>
</div>
<section class="section"><h2>Read the sensors</h2><p class="lead">These values are taken from the ESP32 local registry. A failed or stale measurement is shown as unavailable, not silently replaced with its previous value.</p>
<div class="sensorgrid">
<article class="sensor"><h3>DHT22 <span class="small">Temperature and humidity</span></h3><div class="meta">GPIO13 · digital data · 10 kΩ pullup to 3.3 V · 2.5 s interval</div>
<div class="r"><span>Temperature</span><span id="temperature">Waiting</span></div><div class="r"><span>Humidity</span><span id="humidity">Waiting</span></div><div class="r"><span>Temperature status</span><span id="temperature_status">loading</span></div><div class="r"><span>Humidity status</span><span id="humidity_status">loading</span></div><div class="r"><span>Sensor age</span><span id="temperature_age">n/a</span></div><div class="details">The DHT22 is a digital sensor. The ESP32 checks that temperature is from -40 to 80 °C and relative humidity is from 0 to 100%.</div></article>
<article class="sensor"><h3>SGP40 <span class="small">Relative VOC index</span></h3><div class="meta">GPIO21 SDA · GPIO22 SCL · I²C address 0x59 · 1 s interval</div>
<div class="r"><span>VOC index</span><span id="voc_index">Waiting</span></div><div class="r"><span>Sensor status</span><span id="voc_index_status">loading</span></div><div class="r"><span>Reading age</span><span id="voc_index_age">n/a</span></div><div class="r"><span>Compensation</span><span id="compensation">Waiting</span></div><div class="details">The VOC index is relative to recent air conditions. It is not CO₂ concentration, pollution PPM or a certified AQI. Warmup can take roughly 45 seconds.</div></article>
<article class="sensor"><h3>Capacitive soil probe <span class="small">Moisture</span></h3><div class="meta">GPIO34 · 12-bit ADC1 · 16 readings averaged · 1 s interval</div>
<div class="r"><span>Raw ADC</span><span id="soil_adc">Waiting</span></div><div class="r"><span>Calibrated percent</span><span id="soil_percent">Waiting</span></div><div class="r"><span>Raw data status</span><span id="soil_adc_status">loading</span></div><div class="r"><span>Percent status</span><span id="soil_percent_status">loading</span></div><div class="r"><span>Reading age</span><span id="soil_adc_age">n/a</span></div><div class="details">Calibration used here: dry = 3723 ADC and wet = 1489 ADC. Percent = round(100 × (raw - dry) / (wet - dry)). Recalibrate on real soil.</div></article>
</div></section>
<section class="section"><h2>Inspect the transmitted data</h2><div class="two">
<div class="panel"><h3>Block 3: Current ESP32 API snapshot</h3><p class="small">Actual node state read directly from /api/nodes. Includes reading status and last good value.</p><pre id="snapshot">Waiting for /api/nodes…</pre></div>
<div class="panel"><h3>Block 4: Last successful MQTT publish call</h3><p class="small">The exact JSON handed to MQTT when mqtt.publish() returned success. This does not prove broker delivery. Empty until WiFi and MQTT connect.</p><pre id="published">Waiting for an MQTT publication…</pre></div></div>
<div class="note"><b>How to demonstrate this in class:</b> Open this page from the ESP32 IP address on the same WiFi network. Change the DHT22 temperature or soil value in the supported simulator, or change the sensor's real environment, and watch the sensor card and JSON change. Disconnect WiFi to show that local sensing can continue while MQTT publishing stops. This device page cannot be loaded directly from GitHub Pages because it relies on the ESP32's local API.</div>
</section><footer class="small" style="margin-top:25px">MW-SENSE · Tinkered ESP32 firmware · Read-only device interface · Use only on a trusted network</footer>
</main><script>
'use strict';
let updatedAt=0;
const $=(id)=>document.getElementById(id);
const text=(id,value)=>{const el=$(id);if(el)el.textContent=String(value)};
const age=(a)=>a===null||a===undefined?'no valid sample':(a/1000).toFixed(1)+' s';
function showSensor(key,s){const m=s?.[key];if(!m)return;const val=m.value===null||m.value===undefined?'Unavailable':String(m.value)+' '+m.unit;
 text(key,val);text(key+'_status',m.status+' · '+m.error_count+' errors');text(key+'_age',age(m.age_ms));
 const stat=$(key+'_status');stat.className=m.status==='ok'?'ok':'bad';}
function display(data){
 const local=data.nodes?.find(n=>n.local);
 text('health','Node '+(data.host_node_id||'?')+' · WiFi '+(data.wifi?.connected?'connected':'offline')+' · MQTT '+(data.mqtt?.connected?'connected':'offline'));
 if(!local){text('conn','No local sensor data');return;}
 for(const k of ['temperature','humidity','voc_index','soil_adc','soil_percent'])showSensor(k,local.sensors);
 text('compensation',local.compensation||'Unknown');
 text('snapshot',JSON.stringify(local,null,2));
 text('conn','Live sensor API · updated '+new Date().toLocaleTimeString());
 $('conn').className='tag live';updatedAt=Date.now();
}
async function refresh(){
 try{
  const r=await fetch('/api/nodes',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);display(await r.json());
  const mqtt=await fetch('/api/last-published',{cache:'no-store'});
  if(mqtt.ok){const d=await mqtt.json();text('published',d.status==='no_mqtt_publish_yet'?'No publish succeeded yet. Check MQTT connection and broker settings.':JSON.stringify(d,null,2));}
 }catch(e){text('conn','Local API unavailable · retrying');$('conn').className='tag notlive';}
}
refresh();setInterval(refresh,2000);
setInterval(()=>{if(updatedAt&&Date.now()-updatedAt>5000){text('conn','Sensor API updates are stale');$('conn').className='tag notlive';}},1000);
</script></body></html>
)mwtrace";
