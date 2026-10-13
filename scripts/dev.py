"""Start the MW-SENSE dashboard and local API for development."""
from __future__ import annotations
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    env = os.environ.copy()
    env.setdefault("MW_SENSE_ALLOWED_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000")
    commands = [
        ("api", [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8001", "--reload"]),
        ("dashboard", [sys.executable, "-m", "http.server", "8000", "--bind", "127.0.0.1"]),
    ]
    processes = []
    try:
        for name, command in commands:
            process = subprocess.Popen(command, cwd=ROOT, env=env)
            processes.append((name, process))
            print(f"Started {name} (pid {process.pid})", flush=True)
        print("\nDashboard: http://127.0.0.1:8000", flush=True)
        print("API docs:  http://127.0.0.1:8001/docs", flush=True)
        print("Press Ctrl+C to stop both services.\n", flush=True)
        while True:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"{name} exited with status {code}.", file=sys.stderr)
                    return code or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping MW-SENSE services…", flush=True)
        return 0
    finally:
        for _, process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for _, process in reversed(processes):
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
