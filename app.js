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
let transmitted = 0;
let runId = 0;

const sensorMeta = {
  temperature: { id: "TEMP-01", node: "NODE-01", unit: "°C", label: "temperature" },
  humidity: { id: "HUM-01", node: "NODE-01", unit: "%", label: "humidity" },
  air: { id: "AIR-02", node: "NODE-02", unit: "simulated units", label: "air_quality" },
  soil: { id: "SOIL-01", node: "NODE-03", unit: "%", label: "soil_moisture" }
};

function getPayload() {
  const key = sensorInputs.find((id) => document.querySelector("#" + id).dataset.selected === "true") || "temperature";
  const input = document.querySelector("#" + key);
  const meta = sensorMeta[key];
  return {
    node_id: meta.node,
    sensor_id: meta.id,
    parameter: meta.label,
    timestamp: new Date().toISOString(),
    value: Number(input.value),
    unit: meta.unit,
    status: "VALID",
    simulation: true
  };
}

sensorInputs.forEach((id) => {
  const input = document.querySelector("#" + id);
  const output = document.querySelector("#" + id + "-value");
  input.addEventListener("input", () => {
    output.textContent = Number(input.value).toFixed(id === "temperature" ? 1 : 0);
    document.querySelectorAll(".sensor-row").forEach((row) => { row.style.borderLeftColor = "transparent"; });
    input.closest(".sensor-row").style.borderLeft = "2px solid var(--cyan)";
    input.dataset.selected = "true";
  });
});
document.querySelector("#temperature").dataset.selected = "true";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}
function setStage(index, state) {
  const stage = pipelineStages[index];
  stage.classList.remove("active", "done");
  if (state) stage.classList.add(state);
  stage.querySelector(".stage-state").textContent = state === "done" ? "DONE" : state === "active" ? "RUNNING" : state === "error" ? "FAILED" : "IDLE";
  if (state === "error") stage.querySelector(".stage-state").textContent = "FAILED";
}
function resetPipeline() { pipelineStages.forEach((_, index) => setStage(index, "")); }

async function transmit() {
  const currentRun = ++runId;
  transmitButton.disabled = true;
  transmitButton.style.opacity = ".65";
  resetPipeline();
  const payload = getPayload();
  packetJson.textContent = JSON.stringify(payload, null, 2);
  packetStatus.textContent = "PREPARING";
  pipelineState.textContent = "PROCESSING SAMPLE";

  const stages = [
    ["Acquisition", "Sensor value sampled at the virtual node."],
    ["Validation", "Payload structure and illustrative value range checked."],
    ["Transmission", "Packet sent over the simulated wireless link."],
    ["Gateway", "Gateway receives and routes the packet."],
    ["Storage", "Timestamped record appended to the in-session data log."],
    ["Visualization", "Monitoring summary refreshed."]
  ];
  for (let index = 0; index < stages.length; index++) {
    if (currentRun !== runId) return;
    setStage(index, "active");
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    if (currentRun !== runId) return;
    if (index === 2 && !networkToggle.checked) {
      setStage(index, "error");
      pipelineState.textContent = "TRANSMISSION FAILED";
      packetStatus.textContent = "LINK OFFLINE";
      networkStatus.textContent = "OFFLINE";
      showToast("Wireless link is disabled. Packet was not delivered.");
      for (let rest = index + 1; rest < stages.length; rest++) setStage(rest, "");
      transmitButton.disabled = false;
      transmitButton.style.opacity = "1";
      return;
    }
    setStage(index, "done");
  }
  transmitted++;
  readingCount.textContent = String(transmitted).padStart(3, "0");
  networkStatus.textContent = "ONLINE";
  pipelineState.textContent = "SAMPLE DELIVERED";
  packetStatus.textContent = "STORED · SIMULATED";
  showToast("Sample completed all six simulated pipeline stages.");
  transmitButton.disabled = false;
  transmitButton.style.opacity = "1";
}

transmitButton.addEventListener("click", transmit);
networkToggle.addEventListener("change", () => {
  networkStatus.textContent = networkToggle.checked ? "READY" : "OFFLINE";
  showToast(networkToggle.checked ? "Simulated wireless link enabled." : "Simulated wireless link disabled.");
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", () => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
