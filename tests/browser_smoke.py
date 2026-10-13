"""Browser smoke tests for the MW-SENSE virtual lab.

These checks exercise the page in Chromium. They verify the user-visible
simulation flow, browser persistence, offline-link handling and mobile nav.
They do not represent hardware or radio testing.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from functools import partial
import os
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_api(base_url, process):
    import urllib.request

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("API server exited before becoming ready")
        try:
            with urllib.request.urlopen(base_url + "/health", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise TimeoutError("API server did not become ready")


def main():
    with tempfile.TemporaryDirectory() as storage_dir:
        database_path = Path(storage_dir) / "mw_sense_browser_test.db"
        handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"
        api_port = _free_port()
        api_url = f"http://127.0.0.1:{api_port}"
        api_env = os.environ.copy()
        api_env["MW_SENSE_DB_PATH"] = str(database_path)
        api_env["MW_SENSE_ALLOWED_ORIGINS"] = base_url
        api_env["MW_SENSE_API_TOKEN"] = "browser-test-admin-token"
        api_process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=ROOT,
            env=api_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _wait_for_api(api_url, api_process)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                context = browser.new_context(
                    viewport={"width": 1440, "height": 1000},
                    accept_downloads=True,
                )
                page = context.new_page()
                page.goto(base_url, wait_until="networkidle")
                assert page.title() == "MW-SENSE | Virtual Lab"
                assert page.locator("#storage-status").inner_text() == "Saved in this browser"
                assert page.locator("#reading-count").inner_text().strip() == "000"

                page.locator("#transmit-button").click()
                page.locator("#pipeline-state").filter(has_text="SAMPLE DELIVERED").wait_for(timeout=10000)
                assert page.locator("#reading-count").inner_text().strip() == "001"
                assert page.locator("#records-body tr").count() == 1
                saved = page.evaluate("JSON.parse(localStorage.getItem('mw-sense.telemetry.v1'))")
                assert len(saved) == 1 and saved[0]["simulation"] is True

                page.locator("label.toggle-label").click()
                assert page.locator("#network-toggle").is_checked() is False
                page.locator("#transmit-button").click()
                page.locator("#pipeline-state").filter(has_text="TRANSMISSION FAILED").wait_for(timeout=10000)
                assert page.locator("#reading-count").inner_text().strip() == "001"
                assert page.locator("#records-body tr").count() == 1
                page.locator("label.toggle-label").click()
                assert page.locator("#network-toggle").is_checked() is True

                page.locator("#storage-mode").select_option("server")
                page.locator("#api-base-url").fill(api_url)
                page.locator("#api-token").fill("browser-test-admin-token")
                page.locator("#connect-server").click()
                page.locator("#storage-status").filter(has_text="Connected to API server").wait_for(timeout=10000)
                registration = page.evaluate(
                    """async ({url, token}) => {
                      const response = await fetch(url + "/devices", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                        body: JSON.stringify({ node_id: "NODE-01", label: "Browser test node" })
                      });
                      return { status: response.status, body: await response.json() };
                    }""",
                    {"url": api_url, "token": "browser-test-admin-token"},
                )
                assert registration["status"] == 201
                page.locator("#refresh-devices").click()
                device_row = page.locator("#device-rows tr").filter(has_text="NODE-01")
                device_row.wait_for(timeout=10000)
                device_row.filter(has_text="Not issued").wait_for(timeout=10000)
                device_row.locator('button[data-device-action="issue"]').click()
                page.locator("#credential-reveal").wait_for(state="visible", timeout=10000)
                issued_token = page.locator("#issued-device-token").input_value()
                assert len(issued_token) >= 32
                assert page.locator("#issued-device-token").get_attribute("type") == "password"
                page.locator("#toggle-device-token").click()
                assert page.locator("#issued-device-token").get_attribute("type") == "text"
                page.locator("#dismiss-device-token").click()
                assert page.locator("#credential-reveal").is_hidden()
                device_row = page.locator("#device-rows tr").filter(has_text="NODE-01")
                device_row.filter(has_text="Active").wait_for(timeout=10000)
                device_row.locator('button[data-device-action="history"]').click()
                page.locator("#device-events").filter(has_text="ISSUED").wait_for(timeout=10000)
                page.on("dialog", lambda dialog: dialog.accept())
                device_row.locator('button[data-device-action="revoke"]').click()
                device_row = page.locator("#device-rows tr").filter(has_text="NODE-01")
                assert "Not issued" in device_row.inner_text()
                device_row.locator('button[data-device-action="history"]').click()
                page.locator("#device-events").filter(has_text="REVOKED").wait_for(timeout=10000)
                credential_check = page.evaluate(
                    """async ({url, token}) => {
                      const response = await fetch(url + "/devices/NODE-01/credential-events", {
                        headers: { Authorization: "Bearer " + token }
                      });
                      return response.json();
                    }""",
                    {"url": api_url, "token": "browser-test-admin-token"},
                )
                assert [event["event"] for event in credential_check] == ["revoked", "issued"]
                page.locator("#transmit-button").click()
                page.locator("#pipeline-state").filter(has_text="SAMPLE DELIVERED").wait_for(timeout=10000)
                assert page.locator("#records-body tr").count() == 1
                server_records = page.evaluate(
                    "({url, token}) => fetch(url + '/telemetry', {headers: {Authorization: 'Bearer ' + token}}).then(response => response.json())",
                    {"url": api_url, "token": "browser-test-admin-token"},
                )
                assert server_records["count"] == 1
                assert server_records["items"][0]["simulation"] is True

                with page.expect_download() as download_info:
                    page.locator("#export-csv").click()
                download = download_info.value
                assert download.suggested_filename == "mw-sense-session-readings.csv"
                csv_path = Path(storage_dir) / download.suggested_filename
                download.save_as(csv_path)
                csv_text = csv_path.read_text(encoding="utf-8")
                assert "timestamp,node_id,sensor_id,parameter,value,unit,status,simulation" in csv_text
                assert "temperature" in csv_text

                page.locator("#clear-records").click()
                page.locator("#record-summary").filter(has_text="0 saved records").wait_for(timeout=10000)
                assert page.evaluate("({url, token}) => fetch(url + '/telemetry', {headers: {Authorization: 'Bearer ' + token}}).then(r => r.json())",
                    {"url": api_url, "token": "browser-test-admin-token"})["count"] == 0

                mobile = context.new_page()
                mobile.set_viewport_size({"width": 390, "height": 844})
                mobile.goto(base_url, wait_until="networkidle")
                nav = mobile.locator(".nav-list")
                assert nav.is_visible()
                box = nav.bounding_box()
                assert box and box["width"] <= 390
                assert mobile.locator(".nav-link").count() >= 9
                assert mobile.locator("#transmit-button").is_visible()

                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            api_process.terminate()
            api_process.wait(timeout=10)


if __name__ == "__main__":
    main()
