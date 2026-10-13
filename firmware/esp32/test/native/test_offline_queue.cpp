#include <cassert>
#include <iostream>
#include "offline_queue.h"
#include "acknowledgement.h"

static String record(const char* requestId) {
  return String("{\"request_id\":\"") + requestId + "\",\"value\":27.8}";
}

static void resetQueue(OfflineQueue& queue) {
  LittleFS.reset();
  assert(queue.begin());
}

static void testAcknowledgementTopicBinding() {
  const String queued =
      "{\"request_id\":\"NODE-01-boot-7\",\"sensor_id\":\"TEMP-01\",\"value\":27.8}";
  const String validTopic = "mw-sense/NODE-01/TEMP-01/ack/NODE-01-boot-7";
  assert(matchesQueuedAcknowledgement(
      "NODE-01", validTopic, "NODE-01-boot-7", queued));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", "mw-sense/NODE-01/HUM-01/ack/NODE-01-boot-7",
      "NODE-01-boot-7", queued));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", "mw-sense/NODE-02/TEMP-01/ack/NODE-01-boot-7",
      "NODE-01-boot-7", queued));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", validTopic, "another-request", queued));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", validTopic, "", queued));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", validTopic, "NODE-01-boot-7", "{malformed"));
  assert(!matchesQueuedAcknowledgement(
      "NODE-01", validTopic, String(97, 'x'), queued));
  assert(!matchesQueuedAcknowledgement(
      "", validTopic, "NODE-01-boot-7", queued));
}

int main() {
  testAcknowledgementTopicBinding();
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

  // If installing the replacement fails, the original queue is restored.
  LittleFS.rename_failure_count = 0;
  assert(queue.enqueue(record("rename-fail-2")));
  LittleFS.rename_calls = 0;
  LittleFS.fail_rename_on_call = 2;
  assert(!queue.acknowledgeOldest("rename-fail"));
  assert(queue.count() == 2);
  assert(queue.peekOldest(oldest));
  assert(oldest == record("rename-fail"));
  assert(!LittleFS.exists("/telemetry.bak"));
  assert(!LittleFS.exists("/telemetry.tmp"));
  LittleFS.fail_rename_on_call = 0;

  std::cout << "OfflineQueue native tests passed\\n";
  return 0;
}
