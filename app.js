const sensorInputs = ["temperature", "humidity", "air", "soil"];
const readingCount = document.querySelector("#reading-count");
const pipelineStages = [...document.querySelectorAll(".pipeline-stage")];
const transmitButton = document.querySelector("#transmit-button");
const networkToggle = document.querySelector("#network-toggle");
const packetJson = document.querySelector("#packet-json");
const pipelineState = document.querySelector("#pipeline-state");
const packetStatus = document.querySelector("#packet-status");
const networkStatus = document.querySelector("#network-status");
const toast = document.querySelector("#toast");
const recordsBody = document.querySelector("#records-body");
const storageNotice = document.querySelector("#storage-status");
let recordStore;
try { recordStore = window.MWSenseTelemetry.createTelemetryRepository(window.MWSenseTelemetry.createLocalAdapter(window.localStorage, "mw-sense.telemetry.v1", 5000)); }
catch (error) { recordStore = null; }
let records = [];
try { records = recordStore.load(); if (storageNotice) storageNotice.textContent = "Saved in this browser"; }
catch (error) { records = []; if (storageNotice) storageNotice.textContent = "Storage unavailable · session only"; }
let transmitted = 0;
let runId = 0;
let selectedSensor = "temperature";
let transmissionInProgress = false;

const sensorMeta = {
  temperature: { id: "TEMP-01", node: "NODE-01", unit: "°C", label: "temperature" },
  humidity: { id: "HUM-01", node: "NODE-01", unit: "%", label: "humidity" },
  air: { id: "AIR-02", node: "NODE-02", unit: "simulated units", label: "air_quality" },
  soil: { id: "SOIL-01", node: "NODE-03", unit: "%", label: "soil_moisture" }
};

function getPayload() {
  const input = document.querySelector("#" + selectedSensor);
  const meta = sensorMeta[selectedSensor];
  return { node_id: meta.node, sensor_id: meta.id, parameter: meta.label, timestamp: new Date().toISOString(), value: Number(input.value), unit: meta.unit, status: "PENDING", simulation: true };
}
sensorInputs.forEach((id) => {
  const input = document.querySelector("#" + id);
  const output = document.querySelector("#" + id + "-value");
  input.addEventListener("input", () => {
    output.textContent = Number(input.value).toFixed(id === "temperature" ? 1 : 0);
    document.querySelectorAll(".sensor-row").forEach((row) => row.classList.remove("selected"));
    input.closest(".sensor-row").classList.add("selected");
    selectedSensor = id;
  });
});
document.querySelector("#temperature").closest(".sensor-row").classList.add("selected");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}
function setStage(index, state) {
  const stage = pipelineStages[index];
  stage.classList.remove("active", "done", "error");
  if (state) stage.classList.add(state);
  stage.querySelector(".stage-state").textContent = state === "done" ? "DONE" : state === "active" ? "RUNNING" : state === "error" ? "FAILED" : "IDLE";
}
function resetPipeline() { pipelineStages.forEach((_, index) => setStage(index, "")); }

function updateNetworkLabels() {
  const latency = Number(document.querySelector("#latency-control").value);
  const loss = Number(document.querySelector("#loss-control").value);
  document.querySelector("#latency-output").textContent = latency + " ms";
  document.querySelector("#loss-output").textContent = loss + "%";
  document.querySelector("#network-condition-label").textContent = !networkToggle.checked ? "LINK DISABLED" : loss >= 30 || latency >= 1500 ? "DEGRADED LINK" : loss > 0 || latency > 500 ? "IMPAIRED LINK" : "NOMINAL LINK";
}
["latency-control", "loss-control"].forEach((id) => document.querySelector("#" + id).addEventListener("input", updateNetworkLabels));
document.querySelector("#reset-network").addEventListener("click", () => {
  document.querySelector("#latency-control").value = 250;
  document.querySelector("#loss-control").value = 0;
  networkToggle.checked = true;
  updateNetworkLabels();
  networkStatus.textContent = "READY";
  showToast("Network conditions restored to nominal.");
});
networkToggle.addEventListener("change", () => {
  updateNetworkLabels();
  networkStatus.textContent = networkToggle.checked ? "READY" : "OFFLINE";
  showToast(networkToggle.checked ? "Simulated wireless link enabled." : "Simulated wireless link disabled.");
});

function renderRecords() {
  const filter = document.querySelector("#record-filter").value;
  const visible = records.filter((record) => filter === "all" || record.parameter === filter).slice().reverse();
  recordsBody.innerHTML = visible.length ? visible.map((r) =>
    "<tr><td>" + new Date(r.timestamp).toLocaleTimeString() + "</td><td>" + r.node_id + "</td><td>" + r.sensor_id + "</td><td>" + r.parameter.replace("_", " ") + "</td><td>" + r.value + " " + r.unit + "</td><td><span class=\"record-valid\">" + r.status + "</span></td></tr>"
  ).join("") : '<tr><td colspan="6" class="empty-state">No matching records. Transmit a sample or change the filter.</td></tr>';
  document.querySelector("#record-summary").textContent = records.length + " saved record" + (records.length === 1 ? "" : "s");
}
document.querySelector("#record-filter").addEventListener("change", renderRecords);
document.querySelector("#clear-records").addEventListener("click", () => {
  records = [];
  try { recordStore.clear(); if (storageNotice) storageNotice.textContent = "Saved in this browser"; }
  catch (error) { if (storageNotice) storageNotice.textContent = "Storage unavailable · session only"; }
  transmitted = 0;
  readingCount.textContent = "000";
  renderRecords();
  showToast("Session data cleared.");
});
document.querySelector("#export-csv").addEventListener("click", () => {
  if (!records.length) { showToast("There are no records to export yet."); return; }
  const headers = ["timestamp", "node_id", "sensor_id", "parameter", "value", "unit", "status", "simulation"];
  const csv = [headers.join(","), ...records.map((r) => headers.map((key) => JSON.stringify(r[key] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "mw-sense-session-readings.csv";
  a.click();
  URL.revokeObjectURL(url);
});

async function transmit() {
  if (transmissionInProgress) return "busy";
  transmissionInProgress = true;
  const currentRun = ++runId;
  transmitButton.disabled = true;
  transmitButton.style.opacity = ".65";
  resetPipeline();
  const payload = getPayload();
  packetJson.textContent = JSON.stringify(payload, null, 2);
  packetStatus.textContent = "PREPARING";
  pipelineState.textContent = "PROCESSING SAMPLE";
  const stages = ["Acquisition", "Validation", "Transmission", "Gateway", "Storage", "Visualization"];
  let outcome = "pending";
  try {
    for (let index = 0; index < stages.length; index++) {
      if (currentRun !== runId) return "cancelled";
      setStage(index, "active");
      const latency = index === 2 ? Number(document.querySelector("#latency-control").value) : 0;
      await new Promise((resolve) => window.setTimeout(resolve, 320 + Math.min(latency, 1000)));
      if (currentRun !== runId) return "cancelled";
      if (index === 1) {
        const validation = window.MWSenseTelemetry.validatePayload(payload);
        if (!validation.valid) {
          setStage(index, "error");
          pipelineState.textContent = "VALIDATION FAILED";
          packetStatus.textContent = "INVALID PAYLOAD";
          payload.status = "INVALID";
          packetJson.textContent = JSON.stringify({ ...payload, validation_errors: validation.errors }, null, 2);
          showToast("Sample rejected: " + validation.errors.join(" "));
          outcome = "invalid";
          break;
        }
        payload.status = "VALID";
        packetJson.textContent = JSON.stringify(payload, null, 2);
      }
      if (index === 2 && !networkToggle.checked) {
        setStage(index, "error");
        pipelineState.textContent = "TRANSMISSION FAILED";
        packetStatus.textContent = "LINK OFFLINE";
        networkStatus.textContent = "OFFLINE";
        showToast("Wireless link is disabled. Packet was not delivered.");
        outcome = "failed";
        break;
      }
      if (index === 2 && window.MWSenseTelemetry.isPacketDropped(Number(document.querySelector("#loss-control").value), Math.random())) {
        setStage(index, "error");
        pipelineState.textContent = "PACKET DROPPED";
        packetStatus.textContent = "SIMULATED LOSS";
        networkStatus.textContent = "DEGRADED";
        showToast("Packet was dropped by the simulated link. Try transmitting again.");
        outcome = "failed";
        break;
      }
      setStage(index, "done");
      if (index === stages.length - 1) {
        records.push(payload);
        try { recordStore.append(payload); if (storageNotice) storageNotice.textContent = "Saved in this browser"; }
        catch (error) { if (storageNotice) storageNotice.textContent = "Storage unavailable · current session only"; showToast("Reading delivered, but browser storage could not save it."); }
        updateNodeHealth(payload);
        checkThresholds(payload);
        transmitted++;
        readingCount.textContent = String(transmitted).padStart(3, "0");
        networkStatus.textContent = "ONLINE";
        pipelineState.textContent = "SAMPLE DELIVERED";
        packetStatus.textContent = "STORED · SIMULATED";
        renderRecords();
        showToast("Sample delivered and added to the data explorer.");
        outcome = "delivered";
      }
    }
    return outcome;
  } finally {
    transmissionInProgress = false;
    transmitButton.disabled = false;
    transmitButton.style.opacity = "1";
  }
}
transmitButton.addEventListener("click", transmit);
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
}));
document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener("click", () => {
  const target = document.querySelector(link.getAttribute("href"));
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}));
updateNetworkLabels();


// Monitoring, thresholds, and repeatable learning scenarios.
const chartParameter = document.querySelector("#chart-parameter");
const trendChart = document.querySelector("#trend-chart");
const chartValues = {
  temperature: { label: "Temperature history", unit: "°C", sensor: "temperature" },
  humidity: { label: "Humidity history", unit: "%", sensor: "humidity" },
  air_quality: { label: "Air-quality history", unit: "simulated units", sensor: "air" },
  soil_moisture: { label: "Soil-moisture history", unit: "%", sensor: "soil" }
};
let samplerTimer = null;
let samplerBusy = false;
let alertEvents = [];
let guideStep = -1;

function getSensorValue(id) {
  return Number(document.querySelector("#" + id).value);
}

function renderTrend() {
  const selected = chartParameter.value;
  const meta = chartValues[selected];
  const points = records.filter((record) => record.parameter === selected).slice(-24);
  document.querySelector("#chart-title").textContent = meta.label;
  document.querySelector("#chart-unit").textContent = meta.unit;
  if (!points.length) {
    document.querySelector("#chart-latest").textContent = "—";
    document.querySelector("#chart-caption").textContent = "No samples collected yet";
    trendChart.innerHTML = '<line x1="36" y1="20" x2="36" y2="158" class="chart-axis"/><line x1="36" y1="158" x2="620" y2="158" class="chart-axis"/><text x="36" y="180" class="chart-label">Waiting for samples</text>';
    return;
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const low = min - spread * 0.15;
  const high = max + spread * 0.15;
  const coords = values.map((value, index) => ({
    x: 36 + (points.length === 1 ? 292 : index * 584 / (points.length - 1)),
    y: 150 - ((value - low) / (high - low)) * 120
  }));
  const polyline = coords.map((point) => point.x + "," + point.y).join(" ");
  trendChart.innerHTML = '<line x1="36" y1="20" x2="36" y2="158" class="chart-axis"/><line x1="36" y1="158" x2="620" y2="158" class="chart-axis"/><line x1="36" y1="90" x2="620" y2="90" class="chart-gridline"/><polyline points="' + polyline + '" class="chart-line"/>' +
    coords.map((point) => '<circle cx="' + point.x + '" cy="' + point.y + '" r="3.5" class="chart-point"/>' ).join("") +
    '<text x="36" y="180" class="chart-label">' + points.length + ' recent sample' + (points.length === 1 ? "" : "s") + '</text>';
  document.querySelector("#chart-latest").textContent = values[values.length - 1].toFixed(selected === "temperature" ? 1 : 0);
  document.querySelector("#chart-caption").textContent = "Latest value · " + new Date(points[points.length - 1].timestamp).toLocaleTimeString();
}

function updateNodeHealth(record) {
  const row = document.querySelector('.health-row[data-node="' + record.node_id + '"]');
  if (!row) return;
  row.classList.add("has-reading");
  row.querySelector("strong").textContent = "ACTIVE";
  row.querySelector(".health-last").textContent = "Last sample " + new Date(record.timestamp).toLocaleTimeString();
  document.querySelector("#health-summary").textContent = "3 VIRTUAL NODES";
}

function checkThresholds(record) {
  const rules = {
    temperature: { input: "temperature-threshold", test: (value, limit) => value > limit, direction: "above" },
    humidity: { input: "humidity-threshold", test: (value, limit) => value > limit, direction: "above" },
    soil_moisture: { input: "soil-threshold", test: (value, limit) => value < limit, direction: "below" }
  };
  const rule = rules[record.parameter];
  if (!rule) return;
  const limit = Number(document.querySelector("#" + rule.input).value);
  if (!Number.isFinite(limit) || !rule.test(record.value, limit)) return;
  const message = record.parameter.replace("_", " ") + " is " + rule.direction + " its configured limit (" + limit + " " + record.unit + ").";
  alertEvents.unshift({ message, time: new Date(record.timestamp).toLocaleTimeString() });
  alertEvents = alertEvents.slice(0, 8);
  renderAlerts();
  showToast("Threshold alert: " + message);
}

function renderAlerts() {
  document.querySelector("#alert-count").textContent = String(alertEvents.length);
  document.querySelector("#alert-list").innerHTML = alertEvents.length
    ? alertEvents.map((item) => '<div class="alert-item"><span class="alert-mark">!</span><div><b>' + item.message + '</b><small>' + item.time + '</small></div></div>').join("")
    : '<p class="empty-alert">No alerts. Threshold checks run when a sample is delivered.</p>';
}

function takeScheduledSample() {
  if (samplerBusy || transmitButton.disabled) return;
  samplerBusy = true;
  transmit().finally(() => {
    samplerBusy = false;
    renderTrend();
  });
}

function setSamplerRunning(running) {
  document.querySelector("#sampler-start").disabled = running;
  document.querySelector("#sampler-stop").disabled = !running;
  document.querySelector("#sampling-interval").disabled = running;
  document.querySelector("#sampler-start").textContent = running ? "Sampling active" : "Start sampling";
}

document.querySelector("#sampler-start").addEventListener("click", () => {
  if (samplerTimer) return;
  const interval = Number(document.querySelector("#sampling-interval").value) * 1000;
  setSamplerRunning(true);
  takeScheduledSample();
  samplerTimer = window.setInterval(takeScheduledSample, interval);
  showToast("Virtual sampling started. You can stop it at any time.");
});
document.querySelector("#sampler-stop").addEventListener("click", () => {
  if (samplerTimer) window.clearInterval(samplerTimer);
  samplerTimer = null;
  setSamplerRunning(false);
  showToast("Virtual sampling stopped.");
});
chartParameter.addEventListener("change", renderTrend);

const scenarios = {
  normal: { latency: 100, loss: 0, online: true, title: "Normal delivery", detail: "A sample should pass through all six stages with a short simulated delay." },
  congested: { latency: 900, loss: 15, online: true, title: "Slow network", detail: "Extra delay and some packet loss make delivery less predictable. Repeat the test to see the random loss model." },
  unstable: { latency: 1400, loss: 45, online: true, title: "Unstable link", detail: "A high packet-loss probability means many attempts will be dropped at the transmission stage." },
  outage: { latency: 250, loss: 0, online: false, title: "Link unavailable", detail: "The node can prepare a payload, but the disabled wireless link prevents delivery." }
};
document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", async () => {
    const scenario = scenarios[button.dataset.scenario];
    document.querySelector("#latency-control").value = scenario.latency;
    document.querySelector("#loss-control").value = scenario.loss;
    networkToggle.checked = scenario.online;
    updateNetworkLabels();
    networkStatus.textContent = scenario.online ? "READY" : "OFFLINE";
    document.querySelectorAll("[data-scenario]").forEach((item) => item.classList.remove("chosen"));
    button.classList.add("chosen");
    const result = document.querySelector("#test-result");
    result.querySelector("b").textContent = scenario.title + " · running";
    result.querySelector("p").textContent = scenario.detail;
    const outcome = await transmit();
    result.querySelector("b").textContent = scenario.title + " · " + (outcome === "delivered" ? "delivered" : outcome === "invalid" ? "rejected" : outcome === "busy" ? "busy" : "not delivered");
    result.querySelector("p").textContent = scenario.detail + " " + (outcome === "delivered" ? "The record is now available in the data explorer." : outcome === "invalid" ? "The validation stage rejected the payload; no record was stored." : outcome === "busy" ? "Another transmission is already in progress." : "No record was added; review the pipeline status and try again.");
    result.querySelector(".test-result-mark").textContent = outcome === "delivered" ? "✓" : "!";
  });
});

const guide = [
  ["Acquisition", "A sensor node reads a physical quantity. In this lab, the slider stands in for a sensor and its current value becomes the sample."],
  ["Validation", "Before sending data, firmware should check that the reading is present, numeric, and within the expected range. The current demo uses bounded inputs."],
  ["Transmission", "The node packages its reading and sends it over a wireless link. Latency, packet loss, and link availability can be changed in the network lab."],
  ["Gateway", "A gateway receives messages from nodes and routes them to the next service. This browser model represents that step locally."],
  ["Storage", "A delivered sample is saved in this browser when local storage is available. It stays on this device and is not sent to a server or shared database."],
  ["Visualization", "The dashboard turns stored readings into a trend and checks the configured alert thresholds. Try changing a sensor value and sampling again."]
];
function renderGuide() {
  const panel = document.querySelector("#guide-progress");
  panel.hidden = guideStep < 0;
  if (guideStep < 0) return;
  const step = guide[guideStep];
  document.querySelector("#guide-step-label").textContent = "STEP " + (guideStep + 1) + " OF " + guide.length;
  document.querySelector("#guide-step-title").textContent = step[0];
  document.querySelector("#guide-step-copy").textContent = step[1];
  document.querySelector("#guide-prev").disabled = guideStep === 0;
  document.querySelector("#guide-advance").textContent = guideStep === guide.length - 1 ? "Finish walkthrough" : "Next step";
  document.querySelector("#guide-next").textContent = "Restart walkthrough";
}
document.querySelector("#guide-next").addEventListener("click", () => {
  guideStep = guideStep < 0 || guideStep === guide.length - 1 ? 0 : guideStep;
  renderGuide();
});
document.querySelector("#guide-prev").addEventListener("click", () => {
  guideStep = Math.max(0, guideStep - 1);
  renderGuide();
});
document.querySelector("#guide-advance").addEventListener("click", () => {
  guideStep = guideStep === guide.length - 1 ? -1 : guideStep + 1;
  renderGuide();
});

// Keep the monitoring views in sync when a manual transmission succeeds.
const originalRenderRecords = renderRecords;
renderRecords = function () {
  originalRenderRecords();
  renderTrend();
};
