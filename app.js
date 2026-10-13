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
const records = [];
let transmitted = 0;
let runId = 0;
let selectedSensor = "temperature";

const sensorMeta = {
  temperature: { id: "TEMP-01", node: "NODE-01", unit: "°C", label: "temperature" },
  humidity: { id: "HUM-01", node: "NODE-01", unit: "%", label: "humidity" },
  air: { id: "AIR-02", node: "NODE-02", unit: "simulated units", label: "air_quality" },
  soil: { id: "SOIL-01", node: "NODE-03", unit: "%", label: "soil_moisture" }
};

function getPayload() {
  const input = document.querySelector("#" + selectedSensor);
  const meta = sensorMeta[selectedSensor];
  return { node_id: meta.node, sensor_id: meta.id, parameter: meta.label, timestamp: new Date().toISOString(), value: Number(input.value), unit: meta.unit, status: "VALID", simulation: true };
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
  document.querySelector("#record-summary").textContent = records.length + " record" + (records.length === 1 ? "" : "s") + " in this session";
}
document.querySelector("#record-filter").addEventListener("change", renderRecords);
document.querySelector("#clear-records").addEventListener("click", () => {
  records.length = 0;
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
  for (let index = 0; index < stages.length; index++) {
    if (currentRun !== runId) return;
    setStage(index, "active");
    const latency = index === 2 ? Number(document.querySelector("#latency-control").value) : 0;
    await new Promise((resolve) => window.setTimeout(resolve, 320 + Math.min(latency, 1000)));
    if (currentRun !== runId) return;
    if (index === 2 && !networkToggle.checked) {
      setStage(index, "error");
      pipelineState.textContent = "TRANSMISSION FAILED";
      packetStatus.textContent = "LINK OFFLINE";
      networkStatus.textContent = "OFFLINE";
      showToast("Wireless link is disabled. Packet was not delivered.");
      outcome = "failed";
      break;
    }
    if (index === 2 && Math.random() * 100 < Number(document.querySelector("#loss-control").value)) {
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
      transmitted++;
      readingCount.textContent = String(transmitted).padStart(3, "0");
      networkStatus.textContent = "ONLINE";
      pipelineState.textContent = "SAMPLE DELIVERED";
      packetStatus.textContent = "STORED · SIMULATED";
      renderRecords();
      showToast("Sample delivered and added to the session data explorer.");
      outcome = "delivered";
    }
  }
  transmitButton.disabled = false;
  transmitButton.style.opacity = "1";
  return outcome;
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
