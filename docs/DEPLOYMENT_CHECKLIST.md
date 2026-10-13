# MW-SENSE deployment readiness checklist

This checklist is a gate for a controlled pilot, not a claim that MW-SENSE is production-ready. Mark an item complete only after the named check has been performed and its evidence has been recorded.

## 1. Environment and access
- [ ] Choose and document the deployment host, operating system, Python version, and supported browser versions.
- [ ] Run the API behind HTTPS. Do not expose the development server directly to the public internet.
- [ ] Store the API bearer token, MQTT credentials, and broker CA certificate in an approved secret store or protected deployment configuration.
- [ ] Restrict API and broker access to the required networks and operators.
- [ ] Set an explicit CORS origin allowlist for the dashboard deployment.
- [ ] Decide who can register devices, issue or revoke credentials, view telemetry, and clear records.
- [ ] Confirm logs never contain bearer tokens, device credentials, or raw telemetry message bodies.

## 2. Database and recovery
- [ ] Choose a persistent database path and confirm the service account can read and write it.
- [ ] Decide the retention period and configure MW_SENSE_RETENTION_DAYS deliberately.
- [ ] Configure scheduled backups and define who owns them.
- [ ] Perform a backup and restore rehearsal using a separate destination database.
- [ ] Verify restored data, schema version, and SQLite integrity before accepting traffic.
- [ ] Document recovery point and recovery time objectives for the pilot.
- [ ] Confirm disk capacity and alerting for low storage.

## 3. MQTT broker
- [ ] Create a dedicated broker identity for the bridge and restrict it to the MW-SENSE telemetry and status topics.
- [ ] Create a unique credential for each physical node; never reuse a shared device token.
- [ ] Verify broker TLS using the correct CA certificate. Do not use the development-only insecure TLS option.
- [ ] Verify the broker ACL prevents a node from publishing under another node's topic.
- [ ] Test bridge startup when the broker is unavailable, then restore the broker and confirm reconnect and resubscription.
- [ ] Test malformed, unauthorized, duplicate, and out-of-order messages.
- [ ] Confirm broker persistence and delivery settings match the pilot's loss tolerance.

## 4. Physical node and firmware
- [ ] Record the exact ESP32 board revision, sensor model, wiring, power source, firmware version, and calibration method.
- [ ] Confirm the sensor adapter matches the connected hardware and pin assignment.
- [ ] Measure sensor readings against a suitable reference instrument and record the method and results.
- [ ] Test Wi-Fi loss, broker loss, reboot, clock synchronization failure, and power interruption.
- [ ] Inspect the LittleFS queue after interrupted writes and interrupted queue rewrites.
- [ ] Confirm duplicate request IDs do not create duplicate database records.
- [ ] Measure queue capacity, sample interval, memory use, power draw, and recovery time on the actual board.
- [ ] Confirm the node reports UTC timestamps and reject or quarantine readings when time is not trustworthy.
- [ ] Verify the physical installation is safe and appropriate for its environment.

## 5. Dashboard and API
- [ ] Configure the production API URL and required bearer token in the intended dashboard environment.
- [ ] Confirm server mode fails closed when the API cannot be reached; do not rely on browser-local storage as a server fallback.
- [ ] Test the dashboard using the intended operator accounts and supported devices.
- [ ] Confirm simulated readings remain visibly identified and are never mixed into physical evidence.
- [ ] Verify CSV exports, pagination, retention, and clear-data permissions.
- [ ] Review threshold values with the domain owner. Educational defaults are not safety alarms.
- [ ] Confirm diagnostics access is restricted and does not disclose credentials or reading contents.

## 6. Pilot acceptance and operations
- [ ] Define measurable acceptance criteria before the pilot (availability, data completeness, latency, and acceptable loss).
- [ ] Run an agreed-duration pilot and preserve the test configuration and raw evidence.
- [ ] Record missing samples, duplicate deliveries, reconnect events, and device downtime.
- [ ] Document alert ownership, incident response, credential rotation, and device replacement procedures.
- [ ] Review privacy, data ownership, and retention requirements for the monitored environment.
- [ ] Obtain approval from the technical and operational owners before expanding the deployment.

## Known implementation boundaries
- The ESP32 reference firmware currently publishes with PubSubClient QoS 0. Request IDs make repeated database ingestion idempotent, but they do not prove broker receipt.
- The offline queue uses a temporary file and backup rename sequence to reduce the risk of losing the queue during rewrite. A power interruption can still cause a previously published item to be retried; the request ID is intended to make that retry safe at the database.
- CI compilation and software tests do not establish sensor accuracy, radio coverage, power performance, electrical safety, or field reliability.
- Treat a deployment as unverified until the corresponding physical tests and evidence above exist.