"""Static source checks for the Tinkered ESP32 project, not a firmware build."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
W = json.loads((ROOT / "wiring" / "wiring.json").read_text())
B = json.loads((ROOT / "specs" / "bom.json").read_text())
C = (ROOT / "src" / "config.h").read_text()
M = (ROOT / "src" / "main.cpp").read_text()
T = (ROOT / "src" / "trace.h").read_text()
assert len(W["parts"]) > 5 and len(B) >= 4
for name, pin in {"ROOM_SENSOR_PIN":13,"SOIL_INPUT_PIN":34,"AIR_SDA_PIN":21,"AIR_SCL_PIN":22}.items():
    assert re.search(rf"^#define\s+{name}\s+{pin}\b", C, re.M), name
for marker in ("sampleRoom(", "sampleAir(", "sampleSoil(", "mqtt.publish(",
               'server.on("/trace"', 'server.on("/api/nodes"',
               'server.on("/api/last-published"'):
    assert marker in M, marker
for marker in ("DHT22","SGP40","GPIO34","/api/nodes","/api/last-published"):
    assert marker in T, marker
print("PASS: sensor pin map, routing and trace source metadata")
print("This does not verify compilation, network transport or real hardware.")
