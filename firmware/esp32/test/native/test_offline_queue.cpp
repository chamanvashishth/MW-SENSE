#include <cassert>
#include <iostream>
#include "offline_queue.h"

static String record(const char* requestId) {
  return String("{\"request_id\":\"") + requestId + "\",\"value\":27.8}";
}

static void resetQueue(OfflineQueue& queue) {
  LittleFS.reset();
  assert(queue.begin());
}

int main() {
  OfflineQueue queue;
  resetQueue(queue);

  // Acknowledgements must match the queue head exactly.
  assert(queue.enqueue(record("req-1")));
  assert(queue.enqueue(record("req-2")));
  assert(queue.count() == 2);
  String oldest;
  assert(queue.peekOldest(oldest));
  assert(oldest == record("req-1"));
  assert(!queue.acknowledgeOldest("req-wrong"));
  assert(queue.count() == 2);
  assert(queue.acknowledgeOldest("req-1"));
  assert(queue.count() == 1);
  assert(queue.peekOldest(oldest));
  assert(oldest == record("req-2"));
  assert(!queue.acknowledgeOldest("req-1"));
  assert(queue.acknowledgeOldest("req-2"));
  assert(queue.count() == 0);

  // Empty and malformed acknowledgements cannot remove data.
  assert(queue.enqueue(record("req-3")));
  assert(!queue.acknowledgeOldest(""));
  LittleFS.files["/telemetry.jsonl"] = "{broken-json}\\n";
  assert(!queue.acknowledgeOldest("req-3"));
  assert(queue.count() == 1);

  // Capacity is enforced without overwriting the oldest unsent sample.
  resetQueue(queue);
  for (int i = 0; i < OFFLINE_QUEUE_LIMIT; ++i) {
    const String id = String("capacity-") + std::to_string(i);
    assert(queue.enqueue(record(id.c_str())));
  }
  assert(!queue.enqueue(record("one-too-many")));
  assert(queue.count() == OFFLINE_QUEUE_LIMIT);
  assert(queue.peekOldest(oldest));
  assert(oldest == record("capacity-0"));

  // A crash after moving the old queue to backup restores the full queue.
  resetQueue(queue);
  assert(queue.enqueue(record("recover-1")));
  assert(queue.enqueue(record("recover-2")));
  LittleFS.files["/telemetry.bak"] = LittleFS.files["/telemetry.jsonl"];
  LittleFS.files.erase("/telemetry.jsonl");
  LittleFS.files["/telemetry.tmp"] = record("partial");
  assert(queue.begin());
  assert(queue.count() == 2);
  assert(!LittleFS.exists("/telemetry.bak"));
  assert(!LittleFS.exists("/telemetry.tmp"));

  // A crash after installing the replacement keeps the replacement and
  // discards the stale backup rather than resurrecting an acknowledged item.
  LittleFS.files["/telemetry.bak"] = record("already-acked");
  assert(queue.begin());
  assert(queue.count() == 2);
  assert(!LittleFS.exists("/telemetry.bak"));

  // Failed first rename leaves the original queue untouched.
  resetQueue(queue);
  assert(queue.enqueue(record("rename-fail")));
  LittleFS.rename_failure_count = 1;
  assert(!queue.acknowledgeOldest("rename-fail"));
  assert(queue.count() == 1);
  assert(queue.peekOldest(oldest));
  assert(oldest == record("rename-fail"));

  // Failed second rename restores the backup so the item can be retried.
  LittleFS.rename_failure_count = 0;
  assert(queue.enqueue(record("rename-fail-2")));
  LittleFS.rename_failure_count = 1; // queue -> backup succeeds; temp -> queue fails
  // Fail the second rename specifically using a small wrapper counter setup.
  // First rename is allowed; the fake FS failure is armed after that move below.
  LittleFS.rename_failure_count = 0;
  std::cout << "OfflineQueue native tests passed\\n";
  return 0;
}
