"""Request validation for the MW-SENSE telemetry API."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SENSOR_RULES = {
    "temperature": {"node": "NODE-01", "sensor": "TEMP-01", "unit": "°C", "min": 0, "max": 50},
    "humidity": {"node": "NODE-01", "sensor": "HUM-01", "unit": "%", "min": 0, "max": 100},
    "air_quality": {"node": "NODE-02", "sensor": "AIR-02", "unit": "simulated units", "min": 0, "max": 500},
    "soil_moisture": {"node": "NODE-03", "sensor": "SOIL-01", "unit": "%", "min": 0, "max": 100},
}


class TelemetryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1, max_length=64)
    sensor_id: str = Field(min_length=1, max_length=64)
    parameter: Literal["temperature", "humidity", "air_quality", "soil_moisture"]
    timestamp: str = Field(min_length=10, max_length=64)
    value: float = Field(allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=32)
    simulation: bool
    request_id: str | None = Field(default=None, min_length=1, max_length=64)
    firmware_version: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be a valid ISO 8601 date-time") from exc
        return value

    @model_validator(mode="after")
    def validate_sensor_definition(self):
        rule = SENSOR_RULES[self.parameter]
        if self.node_id != rule["node"]:
            raise ValueError("node_id does not match the registered sensor")
        if self.sensor_id != rule["sensor"]:
            raise ValueError("sensor_id does not match the registered parameter")
        if self.unit != rule["unit"]:
            raise ValueError("unit does not match the registered sensor")
        if not rule["min"] <= self.value <= rule["max"]:
            raise ValueError("value is outside the configured sensor range")
        return self


class TelemetryOut(BaseModel):
    id: int
    node_id: str
    sensor_id: str
    parameter: str
    timestamp: str
    value: float
    unit: str
    simulation: bool
    request_id: str | None = None
    firmware_version: str | None = None
    status: str = "VALID"
    received_at: str


class TelemetryList(BaseModel):
    items: list[TelemetryOut]
    count: int
    limit: int
    offset: int = 0
    next_offset: int | None = None



class DeviceRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=100)


class DeviceHeartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    firmware_version: str | None = Field(default=None, min_length=1, max_length=64)
    uptime_seconds: int | None = Field(default=None, ge=0, le=2_147_483_647)
    queue_depth: int | None = Field(default=None, ge=0, le=100_000)
    retry_count: int | None = Field(default=None, ge=0, le=2_147_483_647)
    wifi_rssi_dbm: int | None = Field(default=None, ge=-127, le=0)
    mqtt_connected: bool | None = None


class DeviceOut(BaseModel):
    node_id: str
    label: str
    firmware_version: str | None = None
    registered_at: str
    last_seen_at: str | None = None
    last_status: str
    credential_active: bool = False
