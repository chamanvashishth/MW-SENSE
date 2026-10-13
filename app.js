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
const storageMode = document.querySelector("#storage-mode");
const apiBaseUrl = document.querySelector("#api-base-url");
const apiToken = document.querySelector("#api-token");
const connectServerButton = document.querySelector("#connect-server");
let localRepository = null;
let activeRepository = null;
let records = [];
try {
  localRepository = window.MWSenseTelemetry.createTelemetryRepository(
    window.MWSenseTelemetry.createLocalAdapter(window.localStorage, "mw-sense.telemetry.v1", 5000)
  );
  activeRepository = localRepository;
  records = localRepository.list();
  if (storageNotice) storageNotice.textContent = "Saved in this browser";
} catch (error) {
  if (storageNotice) storageNotice.textContent = "Browser storage unavailable · session only";
}
function setStorageControls(mode) {
  const serverMode = mode === "server";
  apiBaseUrl.disabled = !serverMode;
  apiToken.disabled = !serverMode;
  connectServerButton.disabled = !serverMode;
}

const devicePanel = document.querySelector("#device-admin-panel");
const deviceRows = document.querySelector("#device-rows");
const refreshDevicesButton = document.querySelector("#refresh-devices");
const credentialReveal = document.querySelector("#credential-reveal");
const issuedDeviceToken = document.querySelector("#issued-device-token");
const deviceEvents = document.querySelector("#device-events");
let connectedApiBase = "";
let connectedApiToken = "";

function deviceRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (connectedApiToken) headers.Authorization = "Bearer " + connectedApiToken;
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(connectedApiBase + path, { ...options, headers });
}

async function loadDeviceRegistry() {
  if (!connectedApiBase) return;
  refreshDevicesButton.disabled = true;
  deviceRows.innerHTML = '<tr><td colspan="14" class="empty-state">Loading registered nodes…</td></tr>';
  try {
    const response = await deviceRequest("/devices");
    if (!response.ok) throw new Error("Device list returned " + response.status);
    const devices = await response.json();
    deviceRows.replaceChildren();
    if (!devices.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 14;
      cell.className = "empty-state";
      cell.textContent = "No nodes have been registered yet.";
      row.append(cell);
      deviceRows.append(row);
      return;
    }
    devices.forEach((device) => {
      const row = document.createElement("tr");
      const formatUptime = (seconds) => {
        if (seconds === null || seconds === undefined) return "Not reported";
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return hours ? hours + "h " + minutes + "m" : minutes + "m " + (seconds % 60) + "s";
      };
      const formatPendingAge = (timestamp) => {
        if (!timestamp) return "No pending sample";
        const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
        if (!Number.isFinite(ageSeconds)) return "Invalid timestamp";
        if (ageSeconds < 60) return ageSeconds + "s";
        if (ageSeconds < 3600) return Math.floor(ageSeconds / 60) + "m";
        if (ageSeconds < 86400) return Math.floor(ageSeconds / 3600) + "h " + Math.floor((ageSeconds % 3600) / 60) + "m";
        return Math.floor(ageSeconds / 86400) + "d " + Math.floor((ageSeconds % 86400) / 3600) + "h";
      };
      const values = [
        device.node_id,
        device.last_status,
        (device.health_state || "unknown").toUpperCase(),
        device.firmware_version || "Not reported",
        device.boot_count ?? "Not reported",
        formatUptime(device.uptime_seconds),
        device.queue_depth ?? "Not reported",
        formatPendingAge(device.oldest_pending_timestamp),
        device.retry_count ?? "Not reported",
        device.wifi_rssi_dbm === null || device.wifi_rssi_dbm === undefined ? "Not reported" : device.wifi_rssi_dbm + " dBm",
        device.mqtt_connected === null || device.mqtt_connected === undefined ? "Not reported" : device.mqtt_connected ? "Connected" : "Disconnected",
        device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "No heartbeat yet",
        device.credential_active ? "Active" : "Not issued"
      ];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        if (index === 1 || index === 2) {
          const status = document.createElement("span");
          status.className = "device-status " + String(value).toLowerCase();
          status.textContent = value;
          if (index === 2 && device.health_warnings?.length) {
            status.title = device.health_warnings.join("\n");
            status.setAttribute("aria-label", value + ": " + device.health_warnings.join(" "));
          }
          cell.append(status);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "device-actions";
      const issue = document.createElement("button");
      issue.type = "button";
      issue.className = "button secondary";
      issue.dataset.deviceAction = "issue";
      issue.dataset.nodeId = device.node_id;
      issue.textContent = device.credential_active ? "Rotate" : "Issue";
      actions.append(issue);
      if (device.credential_active) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "button secondary";
        revoke.dataset.deviceAction = "revoke";
        revoke.dataset.nodeId = device.node_id;
        revoke.textContent = "Revoke";
        actions.append(revoke);
      }
      const history = document.createElement("button");
      history.type = "button";
      history.className = "button secondary";
      history.dataset.deviceAction = "history";
      history.dataset.nodeId = device.node_id;
      history.textContent = "History";
      actions.append(history);
      actionCell.append(actions);
      row.append(actionCell);
      deviceRows.append(row);
    });
  } catch (error) {
    deviceRows.innerHTML = '<tr><td colspan="14" class="empty-state">Could not load devices. Check API access and reconnect.</td></tr>';
  } finally {
    refreshDevicesButton.disabled = false;
  }
}

async function showCredentialHistory(nodeId) {
  deviceEvents.textContent = "Loading device history…";
  try {
    const [credentialResponse, lifecycleResponse] = await Promise.all([
      deviceRequest("/devices/" + encodeURIComponent(nodeId) + "/credential-events"),
      deviceRequest("/devices/" + encodeURIComponent(nodeId) + "/lifecycle-events")
    ]);
    if (!credentialResponse.ok || !lifecycleResponse.ok) {
      throw new Error("Device history request failed.");
    }
    const [credentials, lifecycle] = await Promise.all([
      credentialResponse.json(),
      lifecycleResponse.json()
    ]);
    deviceEvents.replaceChildren();

    const credentialHeading = document.createElement("b");
    credentialHeading.textContent = nodeId + " · Credential history";
    deviceEvents.append(credentialHeading);
    if (!credentials.length) {
      const empty = document.createElement("p");
      empty.textContent = "No credential events recorded.";
      deviceEvents.append(empty);
    }
    credentials.forEach((event) => {
      const line = document.createElement("div");
      line.className = "device-event-row";
      const action = document.createElement("span");
      action.textContent = event.event.toUpperCase();
      const date = document.createElement("time");
      date.textContent = new Date(event.created_at).toLocaleString();
      line.append(action, date);
      deviceEvents.append(line);
    });

    const lifecycleHeading = document.createElement("b");
    lifecycleHeading.textContent = "Boot history";
    deviceEvents.append(lifecycleHeading);
    if (!lifecycle.length) {
      const empty = document.createElement("p");
      empty.textContent = "No boot events reported by this device yet.";
      deviceEvents.append(empty);
    }
    lifecycle.forEach((event) => {
      const line = document.createElement("div");
      line.className = "device-event-row";
      const action = document.createElement("span");
      action.textContent = event.event.toUpperCase() +
        (event.boot_count ? " · boot " + event.boot_count : "");
      const date = document.createElement("time");
      date.textContent = new Date(event.created_at).toLocaleString();
      line.append(action, date);
      deviceEvents.append(line);
    });
  } catch (error) {
    deviceEvents.textContent = "Could not load device history. Check API access and reconnect.";
  }
}

refreshDevicesButton.addEventListener("click", loadDeviceRegistry);
deviceRows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-device-action]");
  if (!button || !connectedApiBase) return;
  const nodeId = button.dataset.nodeId;
  const action = button.dataset.deviceAction;
  if (action === "history") {
    await showCredentialHistory(nodeId);
    return;
  }
  if (action === "revoke" && !window.confirm("Revoke the MQTT credential for " + nodeId + "? The node will stop authenticating until a new credential is issued.")) return;
  button.disabled = true;
  try {
    const response = action === "issue"
      ? await deviceRequest("/devices/" + encodeURIComponent(nodeId) + "/credentials", { method: "POST" })
      : await deviceRequest("/devices/" + encodeURIComponent(nodeId) + "/credentials", { method: "DELETE" });
    if (!response.ok) throw new Error("Credential action returned " + response.status);
    if (action === "issue") {
      const result = await response.json();
      issuedDeviceToken.value = result.credential;
      issuedDeviceToken.type = "password";
      credentialReveal.hidden = false;
      showToast("Credential issued for " + nodeId + ". Copy it now; it will not be shown again.");
    } else {
      credentialReveal.hidden = true;
      issuedDeviceToken.value = "";
      showToast("Credential revoked for " + nodeId + ".");
    }
    await loadDeviceRegistry();
    await showCredentialHistory(nodeId);
  } catch (error) {
    showToast("Could not update the device credential. Check admin access and try again.");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#toggle-device-token").addEventListener("click", () => {
  issuedDeviceToken.type = issuedDeviceToken.type === "password" ? "text" : "password";
  document.querySelector("#toggle-device-token").textContent = issuedDeviceToken.type === "password" ? "Show" : "Hide";
});
document.querySelector("#copy-device-token").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(issuedDeviceToken.value);
    showToast("Device credential copied.");
  } catch (error) {
    issuedDeviceToken.focus();
    issuedDeviceToken.select();
    showToast("Select and copy the credential manually.");
  }
});
document.querySelector("#dismiss-device-token").addEventListener("click", () => {
  issuedDeviceToken.value = "";
  issuedDeviceToken.type = "password";
  credentialReveal.hidden = true;
});

async function loadRepository(repository, label) {
  const loaded = await repository.list();
  records = (Array.isArray(loaded) ? loaded : []).slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  transmitted = records.length;
  activeRepository = repository;
  renderRecords();
  renderTrend();
  if (storageNotice) storageNotice.textContent = label;
  readingCount.textContent = String(records.length).padStart(3, "0");
  showToast("Loaded " + records.length + " readings from " + label.toLowerCase() + ".");
}
storageMode.addEventListener("change", () => {
  setStorageControls(storageMode.value);
  if (storageMode.value === "local") {
    if (!localRepository) {
      showToast("Browser storage is unavailable in this session.");
      storageMode.value = "server";
      setStorageControls("server");
      return;
    }
    loadRepository(localRepository, "Saved in this browser").catch(() => {
      if (storageNotice) storageNotice.textContent = "Browser storage unavailable";
      showToast("Could not read browser storage.");
    });
  } else {
    activeRepository = null;
    records = [];
    renderRecords();
    renderTrend();
    connectedApiBase = "";
    connectedApiToken = "";
    devicePanel.hidden = true;
    if (storageNotice) storageNotice.textContent = "Server not connected";
  }
});
connectServerButton.addEventListener("click", async () => {
  if (storageMode.value !== "server") return;
  connectServerButton.disabled = true;
  if (storageNotice) storageNotice.textContent = "Connecting to API…";
  try {
    const baseUrl = apiBaseUrl.value.trim().replace(/\/$/, "");
    const token = apiToken.value.trim();
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const health = await fetch(baseUrl + "/health", { headers });
    if (!health.ok) throw new Error("API health check returned " + health.status);
    const serverRepository = window.MWSenseTelemetry.createTelemetryRepository(
      window.MWSenseTelemetry.createHttpAdapter(baseUrl, undefined, { token })
    );
    connectedApiBase = baseUrl;
    connectedApiToken = token;
    await loadRepository(serverRepository, "Connected to API server");
    devicePanel.hidden = false;
    await loadDeviceRegistry();
    showToast("API connection established.");
  } catch (error) {
    activeRepository = null;
    connectedApiBase = "";
    connectedApiToken = "";
    devicePanel.hidden = true;
    if (storageNotice) storageNotice.textContent = "API unavailable · check URL and server";
    showToast("Could not connect to the API. Check the server URL and try again.");
  } finally {
    connectServerButton.disabled = false;
  }
});
setStorageControls(storageMode.value);
devicePanel.hidden = true;
let transmitted = records.length;
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
  const requestId = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : "mw-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  return { node_id: meta.node, sensor_id: meta.id, parameter: meta.label, timestamp: new Date().toISOString(), value: Number(input.value), unit: meta.unit, status: "PENDING", simulation: true, request_id: requestId };
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
document.querySelector("#clear-records").addEventListener("click", async () => {
  if (!activeRepository) { showToast("Connect to a storage destination before clearing records."); return; }
  try {
    await activeRepository.clear();
    records = [];
    transmitted = 0;
    readingCount.textContent = "000";
    renderRecords();
    renderTrend();
    if (storageNotice) storageNotice.textContent = storageMode.value === "server" ? "Connected to API server" : "Saved in this browser";
    showToast("Records cleared from the selected storage destination.");
  } catch (error) {
    showToast("Could not clear records. Check the storage connection and try again.");
  }
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
        try {
          if (!activeRepository) throw new Error("No storage destination is connected.");
          await activeRepository.append(payload);
          records.push(payload);
          if (storageNotice) storageNotice.textContent = storageMode.value === "server" ? "Connected to API server" : "Saved in this browser";
        } catch (error) {
          pipelineState.textContent = "STORAGE FAILED";
          packetStatus.textContent = "NOT STORED";
          setStage(index, "error");
          if (storageMode.value === "server") {
            activeRepository = null;
            networkStatus.textContent = "API OFFLINE";
            if (storageNotice) storageNotice.textContent = "API connection lost · reconnect to continue";
          } else if (storageNotice) {
            storageNotice.textContent = "Storage error · reading not saved";
          }
          showToast("Reading was not stored. " + (error.message || "Check the selected storage destination."));
          outcome = "failed";
          break;
        }
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
  ["Storage", "A delivered sample is saved to the destination selected in the data explorer. Browser mode keeps it on this device; API mode sends it to the configured server."],
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
