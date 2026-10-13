"""Browser smoke tests for the MW-SENSE virtual lab.

These checks exercise the page in Chromium. They verify the user-visible
simulation flow, browser persistence, offline-link handling and mobile nav.
They do not represent hardware or radio testing.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from functools import partial
from playwright.sync_api import sync_playwright
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory() as storage_dir:
        handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"
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


if __name__ == "__main__":
    main()
