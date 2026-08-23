/**
 * tests/crawlerQueue.test.js
 *
 * Phase 5.5 — Crawler Queue Tests
 */

"use strict";

const assert = require("assert");
const {
  createCrawlState,
  enqueue,
  dequeue,
  shouldStop,
} = require("../src/services/crawler.service");

let passed = 0;
let failed = 0;

function runTest(label, testFn) {
  try {
    testFn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

console.log("\n=== PHASE 5.5 — Crawler Queue Tests ===\n");

// Test 1: Create empty CrawlState
runTest("Test 1 — Create empty CrawlState", () => {
  const state = createCrawlState();
  assert.strictEqual(state.queue.length, 0, "queue empty");
  assert.strictEqual(state.visited.size, 0, "visited empty");
  assert.strictEqual(state.results.size, 0, "results empty");
  assert.strictEqual(state.failed.length, 0, "failed empty");
  assert.strictEqual(state.pagesCrawled, 0, "pagesCrawled = 0");
});

// Test 2: Seed enqueue
runTest("Test 2 — Seed enqueue", () => {
  const state = createCrawlState();
  const result = enqueue(state, "https://example.com/", 0);
  
  assert.strictEqual(result.enqueued, true, "enqueued = true");
  assert.strictEqual(state.queue.length, 1, "queue length = 1");
  assert.ok(state.visited.has("https://example.com/"), "visited contains normalized URL");
});

// Test 3: FIFO behavior
runTest("Test 3 — FIFO behavior", () => {
  const state = createCrawlState();
  enqueue(state, "https://example.com/A", 1);
  enqueue(state, "https://example.com/B", 1);
  enqueue(state, "https://example.com/C", 1);

  const out1 = dequeue(state);
  const out2 = dequeue(state);
  const out3 = dequeue(state);

  assert.strictEqual(out1.url, "https://example.com/A", "first out is A");
  assert.strictEqual(out2.url, "https://example.com/B", "second out is B");
  assert.strictEqual(out3.url, "https://example.com/C", "third out is C");
});

// Test 4: Duplicate enqueue
runTest("Test 4 — Duplicate enqueue", () => {
  const state = createCrawlState();
  const url = "https://example.com/about";
  
  const res1 = enqueue(state, url, 1);
  const res2 = enqueue(state, url, 1);

  assert.strictEqual(res1.enqueued, true, "first = enqueued");
  assert.strictEqual(res2.enqueued, false, "second = enqueued is false");
  assert.strictEqual(res2.reason, "already-visited", "reason = already-visited");
  assert.strictEqual(state.queue.length, 1, "queue contains one entry");
});

// Test 5: Visited-before-processing behavior
runTest("Test 5 — Visited-before-processing behavior", () => {
  const state = createCrawlState();
  const url = "https://example.com/contact";
  enqueue(state, url, 1);
  
  // URL should be in visited immediately
  assert.ok(state.visited.has(url), "visited must already contain the URL");
});

// Test 6: Depth 0 allowed
runTest("Test 6 — Depth 0 allowed", () => {
  const state = createCrawlState();
  const result = enqueue(state, "https://example.com/", 0, { maxDepth: 3 });
  assert.strictEqual(result.enqueued, true, "depth 0 allowed");
});

// Test 7: Depth 3 allowed
runTest("Test 7 — Depth 3 allowed", () => {
  const state = createCrawlState();
  const result = enqueue(state, "https://example.com/deep", 3, { maxDepth: 3 });
  assert.strictEqual(result.enqueued, true, "depth 3 allowed");
});

// Test 8: Depth 4 rejected
runTest("Test 8 — Depth 4 rejected", () => {
  const state = createCrawlState();
  const result = enqueue(state, "https://example.com/deeper", 4, { maxDepth: 3 });
  assert.strictEqual(result.enqueued, false, "depth 4 rejected");
  assert.strictEqual(result.reason, "max-depth-exceeded", "reason is max-depth-exceeded");
});

// Test 9: Max pages
runTest("Test 9 — Max pages", () => {
  const state = createCrawlState();
  const options = { maxPages: 3 };

  assert.strictEqual(enqueue(state, "https://example.com/1", 1, options).enqueued, true);
  assert.strictEqual(enqueue(state, "https://example.com/2", 1, options).enqueued, true);
  assert.strictEqual(enqueue(state, "https://example.com/3", 1, options).enqueued, true);
  
  // 4th enqueue should be rejected
  const res4 = enqueue(state, "https://example.com/4", 1, options);
  assert.strictEqual(res4.enqueued, false, "4th enqueue rejected");
  assert.strictEqual(res4.reason, "max-pages-reached", "reason is max-pages-reached");
});

// Test 10: Queue empty stop
runTest("Test 10 — Queue empty stop", () => {
  const state = createCrawlState();
  // Queue is inherently empty upon creation
  const stopRes = shouldStop(state);
  assert.strictEqual(stopRes.stop, true, "shouldStop = true");
  assert.strictEqual(stopRes.reason, "queue-empty", "reason = queue-empty");
});

// Test 11: Max-pages stop
runTest("Test 11 — Max-pages stop", () => {
  const state = createCrawlState();
  state.pagesCrawled = 5;
  const stopRes = shouldStop(state, { maxPages: 5 });
  assert.strictEqual(stopRes.stop, true, "shouldStop = true");
  assert.strictEqual(stopRes.reason, "max-pages", "reason = max-pages");
});

// Test 12: Pending queue + pages below max
runTest("Test 12 — Pending queue + pages below max", () => {
  const state = createCrawlState();
  enqueue(state, "https://example.com/", 0); // queue now has 1 item
  state.pagesCrawled = 0;
  
  const stopRes = shouldStop(state, { maxPages: 5 });
  assert.strictEqual(stopRes.stop, false, "shouldStop = false");
});

// Test 13: Fresh state isolation
runTest("Test 13 — Fresh state isolation", () => {
  const stateA = createCrawlState();
  const stateB = createCrawlState();

  enqueue(stateA, "https://example.com/isolated", 1);
  
  assert.ok(stateA.visited.has("https://example.com/isolated"), "stateA has it");
  assert.strictEqual(stateB.visited.has("https://example.com/isolated"), false, "B.visited does not contain it");
});

// Test 14: Results map
runTest("Test 14 — Results map", () => {
  const state = createCrawlState();
  const url = "https://example.com/";
  const fixture = { title: "Example", status: 200 };
  
  state.results.set(url, fixture);
  
  assert.strictEqual(state.results.get(url), fixture, "results.get(url) returns exact fixture");
});

// Test 15: Failed list
runTest("Test 15 — Failed list", () => {
  const state = createCrawlState();
  const failEntry = { url: "https://example.com/", depth: 0, reason: "timeout" };
  
  state.failed.push(failEntry);
  
  assert.strictEqual(state.failed.length, 1, "failed array contains the entry");
  assert.strictEqual(state.failed[0], failEntry, "exact entry matches");
});

// Test 16: Depth stored with queue entry
runTest("Test 16 — Depth stored with queue entry", () => {
  const state = createCrawlState();
  enqueue(state, "https://example.com/about", 1);
  
  const entry = dequeue(state);
  assert.strictEqual(entry.url, "https://example.com/about", "url matches");
  assert.strictEqual(entry.depth, 1, "depth is 1");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exitCode = 1;
