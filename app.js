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
      actionCell.className = "device-actions";
      const historyButton = document.createElement("button");
      historyButton.type = "button";
      historyButton.className = "button secondary";
      historyButton.textContent = "History";
      historyButton.dataset.deviceAction = "history";
      historyButton.dataset.nodeId = device.node_id;
      actionCell.append(historyButton);

      if (device.credential_active) {
        const revokeButton = document.createElement("button");
        revokeButton.type = "button";
        revokeButton.className = "clear-button";
        revokeButton.textContent = "Revoke";
        revokeButton.dataset.deviceAction = "revoke";
        revokeButton.dataset.nodeId = device.node_id;
        actionCell.append(revokeButton);
      } else {
        const issueButton = document.createElement("button");
        issueButton.type = "button";
        issueButton.className = "button secondary";
        issueButton.textContent = "Issue";
        issueButton.dataset.deviceAction = "issue";
        issueButton.dataset.nodeId = device.node_id;
        actionCell.append(issueButton);
      }
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
    const timeline = [
      ...credentials.map((event) => ({ ...event, category: "credential" })),
      ...lifecycle.map((event) => ({ ...event, category: "device" }))
    ].sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

    deviceEvents.replaceChildren();
    const heading = document.createElement("b");
    heading.textContent = nodeId + " · Recent activity";
    deviceEvents.append(heading);

    if (!timeline.length) {
      const empty = document.createElement("p");
      empty.textContent = "No device or credential events have been recorded yet.";
      deviceEvents.append(empty);
      return;
    }

    const labels = {
      issued: "Credential issued",
      rotated: "Credential rotated",
      revoked: "Credential revoked",
      boot: "Device restarted",
      online: "Device back online",
      offline: "Device went offline"
    };

    timeline.forEach((event) => {
      const line = document.createElement("div");
      line.className = "device-event-row";
      const description = document.createElement("span");
      description.textContent = labels[event.event] || event.event;
      const date = document.createElement("time");
      date.dateTime = event.created_at;
      date.textContent = new Date(event.created_at).toLocaleString();
      line.append(description, date);

      const details = [];
      if (event.event === "boot" && event.boot_count !== null && event.boot_count !== undefined) {
        details.push("Boot count " + event.boot_count);
      }
      if (event.event === "offline" && event.details?.last_seen_at) {
        details.push("Last heartbeat " + new Date(event.details.last_seen_at).toLocaleString());
      }
      if (event.event === "online" && event.details?.reason === "heartbeat_received_after_offline") {
        details.push("A new heartbeat restored contact");
      }
      if (details.length) {
        const note = document.createElement("small");
        note.textContent = details.join(" · ");
        line.append(note);
      }
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
let currentPayload = null;
let currentPacketView = "json";

const sensorMeta = {
  temperature: { id: "TEMP-01", node: "NODE-01", unit: "°C", label: "temperature" },
  humidity: { id: "HUM-01", node: "NODE-01", unit: "%", label: "humidity" },
  air: { id: "AIR-02", node: "NODE-02", unit: "simulated units", label: "air_quality" },
  soil: { id: "SOIL-01", node: "NODE-03", unit: "%", label: "soil_moisture" }
};

function getPayload() {
  const input = document.querySelector("#" + selectedSensor);
  const meta = sensorMeta[selectedSensor];
  const requestId = window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : "mw-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  return {
    node_id: meta.node,
    sensor_id: meta.id,
    parameter: meta.label,
    timestamp: new Date().toISOString(),
    value: Number(input.value),
    unit: meta.unit,
    status: "PENDING",
    simulation: true,
    request_id: requestId
  };
}

// Generate raw hex frame string for educational inspection
function formatHexFrame(payload) {
  if (!payload || !payload.value) return "0xAA 0x55 [WAITING FOR PACKET]";
  const preamble = "0xAA 0x55";
  const nodeHex = payload.node_id === "NODE-01" ? "0x01" : payload.node_id === "NODE-02" ? "0x02" : "0x03";
  const paramHex = payload.parameter === "temperature" ? "0x10" : payload.parameter === "humidity" ? "0x20" : payload.parameter === "air_quality" ? "0x30" : "0x40";
  const valFloat = Number(payload.value);
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, valFloat);
  const floatHex = Array.from(new Uint8Array(buffer)).map((b) => "0x" + b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  const crc = "0x" + Math.floor((Math.sin(valFloat) + 2) * 10000).toString(16).slice(0, 4).toUpperCase();
  return [
    "/* FRAME HEADER: 802.15.4 / ESP-NOW PACKET */",
    `[PREAMBLE]:    ${preamble}`,
    `[NODE_ADDR]:   ${nodeHex} (${payload.node_id})`,
    `[PARAM_CODE]:  ${paramHex} (${payload.parameter})`,
    `[RAW_PAYLOAD]: ${floatHex} (Float32: ${payload.value} ${payload.unit})`,
    `[CHECKSUM]:    CRC-16 / ${crc} [VERIFIED VALID]`
  ].join("\n");
}

function formatJourneyTrace(payload) {
  if (!payload) return "Awaiting telemetry dispatch...";
  return [
    "STAGE 1: TRANSDUCER ACQUISITION",
    `  ↳ Sensor: ${payload.sensor_id} (${payload.parameter})`,
    `  ↳ Transduction: Physical state converted to 12-bit ADC voltage.`,
    "",
    "STAGE 2: EDGE VALIDATION (ESP32)",
    `  ↳ Calibration: Raw ADC counts scaled to ${payload.value} ${payload.unit}`,
    `  ↳ Bounds check: Value is within registered operational limits.`,
    "",
    "STAGE 3: RF WIRELESS LINK (2.4 GHz)",
    `  ↳ Protocol: ESP-NOW broadcast frame (Tx Latency: ${document.querySelector("#latency-output").textContent})`,
    `  ↳ Channel: 2.412 GHz, RSSI: -58 dBm, 0% Drop Rate.`,
    "",
    "STAGE 4: IOT GATEWAY INGESTION",
    `  ↳ Enveloping: Verified CRC-16 checksum, attached received_at timestamp.`,
    "",
    "STAGE 5: PERSISTENCE & MONITORING",
    `  ↳ Storage: Telemetry appended to store with unique Request ID.`,
    `  ↳ State: ${payload.status}`
  ].join("\n");
}

function updatePacketDisplay() {
  if (!currentPayload) {
    packetJson.textContent = '{ "status": "awaiting_sample" }';
    return;
  }
  if (currentPacketView === "json") {
    packetJson.textContent = JSON.stringify(currentPayload, null, 2);
  } else if (currentPacketView === "hex") {
    packetJson.textContent = formatHexFrame(currentPayload);
  } else if (currentPacketView === "journey") {
    packetJson.textContent = formatJourneyTrace(currentPayload);
  }
}

// Packet inspector tabs
document.querySelectorAll(".packet-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".packet-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentPacketView = btn.dataset.view;
    updatePacketDisplay();
  });
});

function updateJourneyBanner() {
  const sourceText = document.querySelector("#journey-source-text");
  const sourceDetail = document.querySelector("#journey-source-detail");
  if (!sourceText || !sourceDetail) return;

  const input = document.querySelector("#" + selectedSensor);
  if (!input) return;
  const val = Number(input.value);
  const details = {
    temperature: {
      src: "Node-01 · DHT22 Weather Station (Rooftop)",
      det: `NTC thermistor converts ambient temperature (${val.toFixed(1)} °C) to analog voltage on GPIO 4`
    },
    humidity: {
      src: "Node-01 · DHT22 Weather Station (Rooftop)",
      det: `Capacitive polymer film absorbs moisture vapor (${val.toFixed(0)} %) on GPIO 4`
    },
    air: {
      src: "Node-02 · MQ-135 Gas Sentinel (Lab Vent)",
      det: `Heated tin-dioxide (SnO2) reacts with gas molecules (${val.toFixed(0)} ppm) on ADC Pin 36`
    },
    soil: {
      src: "Node-03 · Capacitive Soil Probe (Greenhouse)",
      det: `1.5 MHz oscillation measures soil dielectric capacitance (${val.toFixed(0)} %) on ADC Pin 39`
    }
  };
  const active = details[selectedSensor];
  if (active) {
    sourceText.textContent = active.src;
    sourceDetail.textContent = active.det;
  }
}

sensorInputs.forEach((id) => {
  const input = document.querySelector("#" + id);
  const output = document.querySelector("#" + id + "-value");
  input.addEventListener("input", () => {
    output.textContent = Number(input.value).toFixed(id === "temperature" ? 1 : 0);
    document.querySelectorAll(".sensor-row").forEach((row) => row.classList.remove("selected"));
    input.closest(".sensor-row").classList.add("selected");
    selectedSensor = id;
    updateJourneyBanner();
  });
});
document.querySelector("#temperature").closest(".sensor-row").classList.add("selected");
updateJourneyBanner();

// Environment Simulation Presets
const envPresets = {
  baseline: { temperature: 24.0, humidity: 50, air: 85, soil: 45, desc: "Standard room conditions restored." },
  smoke: { temperature: 31.0, humidity: 40, air: 380, soil: 35, desc: "Toxic industrial gas leak simulated. AQI spiked to 380 ppm!" },
  heatwave: { temperature: 42.0, humidity: 22, air: 140, soil: 14, desc: "Agricultural heatwave. High temperature and severe soil drought!" },
  monsoon: { temperature: 21.5, humidity: 94, air: 50, soil: 90, desc: "Monsoon cloudburst simulated. High humidity and saturated soil!" },
  freeze: { temperature: 2.5, humidity: 75, air: 65, soil: 30, desc: "Cold storage facility test. Near-freezing temperatures!" }
};

document.querySelectorAll(".env-preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const presetKey = btn.dataset.preset;
    const preset = envPresets[presetKey];
    if (!preset) return;

    document.querySelectorAll(".env-preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Apply values to inputs
    ["temperature", "humidity", "air", "soil"].forEach((param) => {
      const input = document.querySelector("#" + param);
      const output = document.querySelector("#" + param + "-value");
      input.value = preset[param];
      output.textContent = Number(preset[param]).toFixed(param === "temperature" ? 1 : 0);
    });

    updateJourneyBanner();
    showToast("Environment preset loaded: " + preset.desc);
  });
});

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
  stage.querySelector(".stage-state").textContent =
    state === "done" ? "DONE" : state === "active" ? "RUNNING" : state === "error" ? "FAILED" : "IDLE";
}

function resetPipeline() {
  pipelineStages.forEach((_, index) => setStage(index, ""));
}

function updateNetworkLabels() {
  const latency = Number(document.querySelector("#latency-control").value);
  const loss = Number(document.querySelector("#loss-control").value);
  document.querySelector("#latency-output").textContent = latency + " ms";
  document.querySelector("#loss-output").textContent = loss + "%";
  document.querySelector("#network-condition-label").textContent = !networkToggle.checked
    ? "LINK DISABLED"
    : loss >= 30 || latency >= 1500
    ? "DEGRADED LINK"
    : loss > 0 || latency > 500
    ? "IMPAIRED LINK"
    : "NOMINAL LINK";
}

["latency-control", "loss-control"].forEach((id) =>
  document.querySelector("#" + id).addEventListener("input", updateNetworkLabels)
);

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
  recordsBody.innerHTML = visible.length
    ? visible
        .map(
          (r) =>
            "<tr><td>" +
            new Date(r.timestamp).toLocaleTimeString() +
            "</td><td>" +
            r.node_id +
            "</td><td>" +
            r.sensor_id +
            "</td><td>" +
            r.parameter.replace("_", " ") +
            "</td><td>" +
            r.value +
            " " +
            r.unit +
            '</td><td><span class="record-valid">' +
            r.status +
            "</span></td></tr>"
        )
        .join("")
    : '<tr><td colspan="6" class="empty-state">No matching records. Transmit a sample or change the filter.</td></tr>';
  document.querySelector("#record-summary").textContent =
    records.length + " saved record" + (records.length === 1 ? "" : "s");
}

document.querySelector("#record-filter").addEventListener("change", renderRecords);

document.querySelector("#clear-records").addEventListener("click", async () => {
  if (!activeRepository) {
    showToast("Connect to a storage destination before clearing records.");
    return;
  }
  try {
    await activeRepository.clear();
    records = [];
    transmitted = 0;
    readingCount.textContent = "000";
    currentPayload = null;
    updatePacketDisplay();
    renderRecords();
    renderTrend();
    if (storageNotice)
      storageNotice.textContent = storageMode.value === "server" ? "Connected to API server" : "Saved in this browser";
    showToast("Records cleared from the selected storage destination.");
  } catch (error) {
    showToast("Could not clear records. Check the storage connection and try again.");
  }
});

document.querySelector("#export-csv").addEventListener("click", () => {
  if (!records.length) {
    showToast("There are no records to export yet.");
    return;
  }
  const headers = ["timestamp", "node_id", "sensor_id", "parameter", "value", "unit", "status", "simulation"];
  const csv = [
    headers.join(","),
    ...records.map((r) => headers.map((key) => JSON.stringify(r[key] ?? "")).join(","))
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "mw-sense-session-readings.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// Real-Time Canvas RF Signal Oscilloscope
const rfCanvas = document.querySelector("#rf-canvas");
let rfCtx = null;
let rfPhase = 0;
let rfBurst = 0;

if (rfCanvas && rfCanvas.getContext) {
  rfCtx = rfCanvas.getContext("2d");
  function animateRF() {
    if (!rfCtx) return;
    const w = rfCanvas.width;
    const h = rfCanvas.height;
    rfCtx.clearRect(0, 0, w, h);

    // Draw background grid lines
    rfCtx.strokeStyle = "#121218";
    rfCtx.lineWidth = 1;
    rfCtx.beginPath();
    rfCtx.moveTo(0, h / 2);
    rfCtx.lineTo(w, h / 2);
    rfCtx.stroke();

    // Waveform parameters
    rfPhase += transmissionInProgress ? 0.28 : 0.08;
    if (rfBurst > 0) rfBurst -= 0.04;
    const amplitude = transmissionInProgress ? h * 0.35 : h * 0.15;
    const freq = transmissionInProgress ? 0.08 : 0.035;

    // Draw RF carrier wave
    rfCtx.beginPath();
    rfCtx.lineWidth = transmissionInProgress ? 2.5 : 1.5;
    rfCtx.strokeStyle = transmissionInProgress ? "#00f2fe" : "#1e293b";

    for (let x = 0; x < w; x++) {
      const y = h / 2 + Math.sin(x * freq + rfPhase) * amplitude * (1 + (transmissionInProgress ? Math.sin(x * 0.02) * 0.3 : 0));
      if (x === 0) rfCtx.moveTo(x, y);
      else rfCtx.lineTo(x, y);
    }
    rfCtx.stroke();

    // Packet burst packet marker if active
    if (transmissionInProgress) {
      const packetX = ((Date.now() / 3) % (w + 40)) - 20;
      rfCtx.fillStyle = "#10b981";
      rfCtx.shadowColor = "#00f2fe";
      rfCtx.shadowBlur = 10;
      rfCtx.beginPath();
      rfCtx.arc(Math.min(Math.max(packetX, 10), w - 10), h / 2, 4, 0, Math.PI * 2);
      rfCtx.fill();
      rfCtx.shadowBlur = 0;
    }

    requestAnimationFrame(animateRF);
  }
  requestAnimationFrame(animateRF);
}

async function transmit() {
  if (transmissionInProgress) return "busy";
  transmissionInProgress = true;
  const currentRun = ++runId;
  transmitButton.disabled = true;
  transmitButton.style.opacity = ".65";
  resetPipeline();
  const payload = getPayload();
  currentPayload = payload;
  updatePacketDisplay();

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
          currentPayload = { ...payload, validation_errors: validation.errors };
          updatePacketDisplay();
          showToast("Sample rejected: " + validation.errors.join(" "));
          outcome = "invalid";
          break;
        }
        payload.status = "VALID";
        currentPayload = payload;
        updatePacketDisplay();
      }

      if (index === 2 && !networkToggle.checked) {
        setStage(index, "error");
        pipelineState.textContent = "TRANSMISSION FAILED";
        packetStatus.textContent = "LINK OFFLINE";
        networkStatus.textContent = "OFFLINE";
        showToast("Wireless RF link is disabled. Packet was not delivered.");
        outcome = "failed";
        break;
      }

      if (index === 2 && window.MWSenseTelemetry.isPacketDropped(Number(document.querySelector("#loss-control").value), Math.random())) {
        setStage(index, "error");
        pipelineState.textContent = "PACKET DROPPED";
        packetStatus.textContent = "SIMULATED LOSS";
        networkStatus.textContent = "DEGRADED";
        showToast("Packet was dropped by radio interference. Try transmitting again.");
        outcome = "failed";
        break;
      }

      setStage(index, "done");

      if (index === stages.length - 1) {
        try {
          if (!activeRepository) throw new Error("No storage destination is connected.");
          await activeRepository.append(payload);
          records.push(payload);
          if (storageNotice)
            storageNotice.textContent = storageMode.value === "server" ? "Connected to API server" : "Saved in this browser";
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

document.querySelectorAll(".nav-link").forEach((link) =>
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  })
);

document.querySelectorAll('a[href^="#"]').forEach((link) =>
  link.addEventListener("click", () => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  })
);

updateNetworkLabels();

// Monitoring, trends, thresholds, and repeatable learning scenarios
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
    trendChart.innerHTML =
      '<line x1="36" y1="20" x2="36" y2="158" class="chart-axis"/><line x1="36" y1="158" x2="620" y2="158" class="chart-axis"/><text x="36" y="180" class="chart-label">Waiting for samples</text>';
    return;
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const low = min - spread * 0.15;
  const high = max + spread * 0.15;
  const coords = values.map((value, index) => ({
    x: 36 + (points.length === 1 ? 292 : (index * 584) / (points.length - 1)),
    y: 150 - ((value - low) / (high - low)) * 120
  }));
  const polyline = coords.map((point) => point.x + "," + point.y).join(" ");
  trendChart.innerHTML =
    '<line x1="36" y1="20" x2="36" y2="158" class="chart-axis"/><line x1="36" y1="158" x2="620" y2="158" class="chart-axis"/><line x1="36" y1="90" x2="620" y2="90" class="chart-gridline"/><polyline points="' +
    polyline +
    '" class="chart-line"/>' +
    coords.map((point) => '<circle cx="' + point.x + '" cy="' + point.y + '" r="3.5" class="chart-point"/>').join("") +
    '<text x="36" y="180" class="chart-label">' +
    points.length +
    " recent sample" +
    (points.length === 1 ? "" : "s") +
    "</text>";
  document.querySelector("#chart-latest").textContent = values[values.length - 1].toFixed(
    selected === "temperature" ? 1 : 0
  );
  document.querySelector("#chart-caption").textContent =
    "Latest value · " + new Date(points[points.length - 1].timestamp).toLocaleTimeString();
}

function updateNodeHealth(record) {
  const row = document.querySelector('.health-row[data-node="' + record.node_id + '"]');
  if (!row) return;
  row.classList.add("has-reading");
  row.querySelector("strong").textContent = "ACTIVE";
  row.querySelector(".health-last").textContent =
    "Last sample " + new Date(record.timestamp).toLocaleTimeString();
  document.querySelector("#health-summary").textContent = "3 VIRTUAL NODES ACTIVE";
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
  const message =
    record.parameter.replace("_", " ") + " is " + rule.direction + " its configured limit (" + limit + " " + record.unit + ").";
  alertEvents.unshift({ message, time: new Date(record.timestamp).toLocaleTimeString() });
  alertEvents = alertEvents.slice(0, 8);
  renderAlerts();
  showToast("Threshold alert: " + message);
}

function renderAlerts() {
  document.querySelector("#alert-count").textContent = String(alertEvents.length);
  document.querySelector("#alert-list").innerHTML = alertEvents.length
    ? alertEvents
        .map(
          (item) =>
            '<div class="alert-item"><span class="alert-mark">!</span><div><b>' +
            item.message +
            "</b><small>" +
            item.time +
            "</small></div></div>"
        )
        .join("")
    : '<p class="empty-alert">No alerts. Threshold checks evaluate automatically per reading.</p>';
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
  showToast("Automated periodic sampling started.");
});

document.querySelector("#sampler-stop").addEventListener("click", () => {
  if (samplerTimer) window.clearInterval(samplerTimer);
  samplerTimer = null;
  setSamplerRunning(false);
  showToast("Automated periodic sampling stopped.");
});

chartParameter.addEventListener("change", renderTrend);

const scenarios = {
  normal: { latency: 100, loss: 0, online: true, title: "Normal delivery", detail: "Sample passes through all six stages with low latency." },
  congested: { latency: 800, loss: 12, online: true, title: "Channel congestion", detail: "Higher latency and occasional packet loss. Tests link buffer behavior." },
  unstable: { latency: 1400, loss: 35, online: true, title: "Unstable link", detail: "Frequent packet loss dropped at the RF transmission stage." },
  outage: { latency: 250, loss: 0, online: false, title: "Link blackout", detail: "Disabled RF link prevents transmission from completing." }
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
    result.querySelector("b").textContent =
      scenario.title + " · " + (outcome === "delivered" ? "delivered" : outcome === "invalid" ? "rejected" : outcome === "busy" ? "busy" : "not delivered");
    result.querySelector("p").textContent =
      scenario.detail +
      " " +
      (outcome === "delivered"
        ? "The record is now available in the data explorer."
        : outcome === "invalid"
        ? "The validation stage rejected the payload; no record was stored."
        : outcome === "busy"
        ? "Another transmission is already in progress."
        : "No record was added; review the pipeline status and try again.");
    result.querySelector(".test-result-mark").textContent = outcome === "delivered" ? "✓" : "!";
  });
});

const guide = [
  ["01 / Sensor Transduction", "Physical parameters (temperature, humidity, air gas, soil capacitance) generate continuous analog voltages. The sensor's transducer converts physical environmental state into electrical resistance or capacitance."],
  ["02 / Edge Sampling (ESP32 ADC)", "The microcontroller samples the analog pin via a 12-bit ADC, averages readings to filter electrical noise, and applies calibration curves to compute engineering units (°C, %, PPM)."],
  ["03 / Pre-Transmission Validation", "Before powering on the RF radio, the edge firmware checks bounds. If a reading is impossible (e.g. -100°C), it flags a sensor fault to avoid wasting radio transmission power."],
  ["04 / Wireless RF Packet Broadcast", "The node formats a binary or JSON packet with a preamble, node ID, timestamp, and CRC-16 checksum, broadcasting it over 2.4GHz ESP-NOW or 868MHz LoRa."],
  ["05 / IoT Gateway Ingestion", "The gateway antenna captures the RF packet, validates the CRC checksum, decrypts or unwraps the payload, and attaches an ingestion envelope timestamp."],
  ["06 / Persistence & Real-Time Dashboard", "The gateway commits the verified telemetry reading to the database and streams updates to the live monitoring dashboard, evaluating safety thresholds."]
];

function renderGuide() {
  const panel = document.querySelector("#guide-progress");
  panel.hidden = guideStep < 0;
  if (guideStep < 0) return;
  const step = guide[guideStep];
  document.querySelector("#guide-step-label").textContent = "STAGE " + (guideStep + 1) + " OF " + guide.length;
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

// Keep the monitoring views in sync when a manual transmission succeeds
const originalRenderRecords = renderRecords;
renderRecords = function () {
  originalRenderRecords();
  renderTrend();
};
