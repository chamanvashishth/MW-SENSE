from pathlib import Path

import pytest

from backend.backup import create_backup, restore_backup, verify_backup
from backend.database import initialize_database, insert_reading, list_readings


def sample():
    return {
        "node_id": "NODE-01",
        "sensor_id": "TEMP-01",
        "parameter": "temperature",
        "timestamp": "2026-08-15T10:30:00Z",
        "value": 28.4,
        "unit": "°C",
        "simulation": True,
        "request_id": "backup-test-reading-1",
    }


def test_backup_is_consistent_and_verifiable(tmp_path):
    live = tmp_path / "live.sqlite3"
    backup = tmp_path / "exports" / "snapshot.sqlite3"
    initialize_database(live)
    insert_reading(sample(), live)

    created = create_backup(live, backup)
    report = verify_backup(created)

    assert created == backup
    assert report["schema_version"] == 4
    assert report["telemetry_records"] == 1
    records, total = list_readings(created)
    assert total == 1
    assert records[0]["value"] == 28.4


def test_backup_refuses_to_overwrite_existing_destination(tmp_path):
    live = tmp_path / "live.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    initialize_database(live)
    create_backup(live, backup)

    with pytest.raises(FileExistsError):
        create_backup(live, backup)


def test_restore_requires_new_destination_and_preserves_data(tmp_path):
    live = tmp_path / "live.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    restored = tmp_path / "restored.sqlite3"
    initialize_database(live)
    insert_reading(sample(), live)
    create_backup(live, backup)

    assert restore_backup(backup, restored) == restored
    records, total = list_readings(restored)
    assert total == 1
    assert records[0]["request_id"] == "backup-test-reading-1"
    assert verify_backup(restored)["integrity"] == "ok"


def test_restore_does_not_replace_an_existing_database(tmp_path):
    live = tmp_path / "live.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    initialize_database(live)
    create_backup(live, backup)

    with pytest.raises(FileExistsError):
        restore_backup(backup, live)


def test_verify_rejects_non_sqlite_file(tmp_path):
    invalid = tmp_path / "not-a-database.sqlite3"
    invalid.write_text("not a sqlite database", encoding="utf-8")

    with pytest.raises(Exception):
        verify_backup(invalid)
