#pragma once
#include <Arduino.h>

const char DASHBOARD_PAGE[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MW-SENSE</title>
<style>
:root{--bg:#F7F7F5;--card:#fff;--border:#E5E5E0;--text:#1C1C1C;--muted:#6B6B66;--good:#2E7D32}
@media(prefers-color-scheme:dark){:root{--bg:#141413;--card:#1D1D1B;--border:#2E2E2B;--text:#F0EFEA;--muted:#9A9A93;--good:#83BD87}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:auto;padding:20px 16px}h1{font-size:24px;font-weight:650;margin:0 0 6px}
h2{font-size:18px;margin:0}.muted,small{color:var(--muted)}#live{font-size:14px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:7px}
.live .dot{background:var(--good)}#health{line-height:1.6;margin:18px 0;font-size:14px}
.node{margin:24px 0}.heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;min-height:168px}
.label{font-size:13px;color:var(--muted)}.value{font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;margin:7px 0}
.unit{font-size:16px;font-weight:400}.note{font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.stale .card{border-style:dashed}.stale .value{color:var(--muted)}footer{font-size:12px;color:var(--muted);line-height:1.6}
</style>
</head>
<body><main>
<h1>MW-SENSE</h1>
<p><a href="/trace" style="color:inherit;font-weight:600">Explore sensor data journey →</a></p>
<div id="live"><span class="dot"></span><span id="liveText">Loading sensor registry…</span></div>
<div id="health" class="muted">WiFi — · MQTT —</div>
<div id="nodes">Waiting for the first local update…</div>
<footer>ESP32 DevKit V1 · Read-only dashboard<br>
VOC index is relative to recent air history, not a pollutant concentration.
Soil calibration is hardware-dependent; plausible ADC values do not prove a probe is connected.
MQTT and HTTP are plaintext: use a trusted network.</footer>
</main>
<script>
const names={temperature:'Temperature',humidity:'Humidity',voc_index:'VOC index',soil_percent:'Soil moisture',soil_adc:'Raw soil ADC'};
const sections=new Map();let lastFetch=0,busy=false;
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function seconds(ms){return ms===null?'never':Math.floor(ms/1000)+' s'}
function draw(data){
 document.getElementById('health').textContent=
 'WiFi: '+(data.wifi.connected?'connected · '+data.wifi.ip:'reconnecting')+
 ' · MQTT: '+(data.mqtt.connected?'connected':'reconnecting')+
 ' · host '+data.host_node_id+' · uptime '+seconds(data.uptime_ms)+
 ' · rejected messages '+data.registry_errors;
 const root=document.getElementById('nodes');if(!sections.size)root.textContent='';
 for(const n of data.nodes){
  let s=sections.get(n.node_id);
  if(!s){
   const box=element('section','node'),heading=element('div','heading'),title=element('h2','',n.node_id),
   state=element('small'),grid=element('div','grid');heading.append(title,state);box.append(heading,grid);root.append(box);
   s={box,state,cards:{}};sections.set(n.node_id,s);
   for(const key of Object.keys(names)){
    const card=element('div','card'),label=element('div','label',names[key]),value=element('div','value'),
    number=element('span','','--'),unit=element('span','unit'),note=element('div','note muted');
    value.append(number,unit);card.append(label,value,note);grid.append(card);s.cards[key]={number,unit,note};
   }
  }
  const unhealthy=n.state!=='online';
  s.box.className='node'+(unhealthy?' stale':'');
  s.state.textContent=n.state+(n.local?' · local':' · MQTT')+' · telemetry '+seconds(n.telemetry_age_ms)+' ago';
  for(const key of Object.keys(names)){
   const m=n.sensors[key],c=s.cards[key];
   c.number.textContent=m.value===null?'--':(key==='temperature'?Number(m.value).toFixed(1):String(m.value));
   c.unit.textContent=' '+m.unit;
   let note=m.status+' · age '+seconds(m.age_ms)+' · errors '+m.error_count;
   if(m.value===null&&m.last_good_value!==null)note+=' · last good '+m.last_good_value+' '+m.unit;
   if(key==='voc_index')note+=' · compensation '+n.compensation;
   if(unhealthy)note+=' · node '+n.state;
   c.note.textContent=note;
  }
 }
}
async function poll(){
 if(busy)return;busy=true;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
 try{
  const r=await fetch('/api/nodes',{cache:'no-store',signal:controller.signal});
  if(!r.ok)throw Error('HTTP');
  const d=await r.json();draw(d);lastFetch=Date.now();
 }catch(e){document.getElementById('liveText').textContent='Offline, retrying';document.getElementById('live').className='';
  for(const s of sections.values()){s.box.className='node stale';s.state.textContent='Dashboard unreachable · displayed data stale';}
 }finally{clearTimeout(timer);busy=false;}
}
setInterval(()=>{
 if(lastFetch&&Date.now()-lastFetch<5000){
  document.getElementById('live').className='live';
  document.getElementById('liveText').textContent='Live, updated '+Math.floor((Date.now()-lastFetch)/1000)+' s ago';
 }else if(lastFetch){
  document.getElementById('live').className='';
  document.getElementById('liveText').textContent='Offline, retrying';
 }
},500);
poll();setInterval(poll,2000);
</script></body></html>
)rawliteral";
