"""SQLite backup and recovery helpers for MW-SENSE.

Run from the repository root:
    python -m backend.backup create
    python -m backend.backup verify path/to/backup.sqlite3
    python -m backend.backup restore path/to/backup.sqlite3
"""
import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .database import DEFAULT_DB_PATH

REQUIRED_TABLES = {"telemetry", "schema_migrations"}


def verify_backup(path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Database file does not exist: {path}")
    with sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True) as db:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite integrity check failed: {integrity}")
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )}
        missing = REQUIRED_TABLES - tables
        if missing:
            raise ValueError("Not an MW-SENSE database; missing: " + ", ".join(sorted(missing)))
        version = db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        count = db.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
    return {"path": str(path.resolve()), "schema_version": version, "telemetry_records": count}


def create_backup(database_path=DEFAULT_DB_PATH, output_path=None):
    source_path = Path(database_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"Database file does not exist: {source_path}")
    if output_path is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_path = source_path.parent / "backups" / f"mw-sense-{stamp}.sqlite3"
    output = Path(output_path)
    if output.resolve() == source_path.resolve():
        raise ValueError("Backup destination must differ from the live database.")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(f"Backup already exists: {output}")
    with sqlite3.connect(source_path, timeout=10) as source:
        with sqlite3.connect(output, timeout=10) as destination:
            source.backup(destination)
    verify_backup(output)
    return output


def restore_backup(backup_path, database_path=DEFAULT_DB_PATH):
    source_path = Path(backup_path)
    target_path = Path(database_path)
    verify_backup(source_path)
    if target_path.exists():
        raise FileExistsError(
            f"Database already exists: {target_path}. Move it aside before restoring."
        )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"{source_path.resolve().as_uri()}?mode=ro", uri=True) as source:
        with sqlite3.connect(target_path) as destination:
            source.backup(destination)
    verify_backup(target_path)
    return target_path


def main():
    parser = argparse.ArgumentParser(description="MW-SENSE SQLite backup and recovery")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="create a consistent SQLite backup")
    create.add_argument("--database", type=Path, default=DEFAULT_DB_PATH)
    create.add_argument("--output", type=Path)
    verify = commands.add_parser("verify", help="verify a backup")
    verify.add_argument("backup", type=Path)
    restore = commands.add_parser("restore", help="restore only into a new database path")
    restore.add_argument("backup", type=Path)
    restore.add_argument("--database", type=Path, default=DEFAULT_DB_PATH)
    args = parser.parse_args()
    if args.command == "create":
        print(f"Backup created: {create_backup(args.database, args.output)}")
    elif args.command == "verify":
        result = verify_backup(args.backup)
        print(f"Verified: {result['path']} | schema v{result['schema_version']} | {result['telemetry_records']} readings")
    else:
        print(f"Database restored: {restore_backup(args.backup, args.database)}")


if __name__ == "__main__":
    main()
