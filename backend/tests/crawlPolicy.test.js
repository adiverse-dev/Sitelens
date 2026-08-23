/**
 * tests/crawlPolicy.test.js
 *
 * Phase 5.4 — Crawl Policy Tests
 */

"use strict";

const { isAllowedByPolicy } = require("../src/utils/crawlPolicy");
const assert = require("assert");

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

console.log("\n=== PHASE 5.4 — Crawl Policy Tests ===\n");

const SEED = "https://example.com";

// 1. Exact same host
runTest("Test 1 — Exact same host", () => {
  const result = isAllowedByPolicy("https://example.com/about", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 2. Root
runTest("Test 2 — Root", () => {
  const result = isAllowedByPolicy("https://example.com/", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 3. www equivalent
runTest("Test 3 — www equivalent", () => {
  const result = isAllowedByPolicy("https://www.example.com/about", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "www-equivalent");
});

// 4. Seed is www, candidate is bare
runTest("Test 4 — Seed is www, candidate is bare", () => {
  const result = isAllowedByPolicy("https://example.com/about", "https://www.example.com");
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "www-equivalent");
});

// 5. Subdomain blocked by default
runTest("Test 5 — Subdomain blocked by default", () => {
  const result = isAllowedByPolicy("https://blog.example.com/", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "subdomain-not-allowed");
});

// 6. Another subdomain blocked
runTest("Test 6 — Another subdomain blocked", () => {
  const result = isAllowedByPolicy("https://shop.example.com/", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "subdomain-not-allowed");
});

// 7. Subdomain allowed when opt-in
runTest("Test 7 — Subdomain allowed when opt-in", () => {
  const result = isAllowedByPolicy("https://blog.example.com/", SEED, { crawlSubdomains: true });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "subdomain-allowed");
});

// 8. External domain
runTest("Test 8 — External domain", () => {
  const result = isAllowedByPolicy("https://google.com/", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "external-domain");
});

// 9. Another external domain
runTest("Test 9 — Another external domain", () => {
  const result = isAllowedByPolicy("https://facebook.com/", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "external-domain");
});

// 10. Same host HTTP candidate
runTest("Test 10 — Same host HTTP candidate", () => {
  const result = isAllowedByPolicy("http://example.com/about", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 11. Invalid URL
runTest("Test 11 — Invalid URL", () => {
  const result = isAllowedByPolicy("not_a_valid_url", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "invalid-url");
});

// 12. Non-http/https
runTest("Test 12 — Non-http/https", () => {
  const result = isAllowedByPolicy("ftp://example.com/file", SEED);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "unsupported-protocol");
});

// 13. Port candidate (Policy does not bypass network security checks)
runTest("Test 13 — Port candidate (Allowed by scope, security checked later)", () => {
  const result = isAllowedByPolicy("https://example.com:8443/about", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 14. Case-insensitive hostname
runTest("Test 14 — Case-insensitive hostname", () => {
  const result = isAllowedByPolicy("https://example.COM/about", "https://EXAMPLE.com");
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 15. Path case must not affect hostname policy
runTest("Test 15 — Path case must not affect hostname policy", () => {
  const result = isAllowedByPolicy("https://example.com/ABOUT", SEED);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

// 16. Smoke Test (Leslecart) - Deterministic evaluation
runTest("Test 16 — Leslecart Smoke Test (No crawling)", () => {
  const liveSeed = "https://www.leslecart.com/";
  const result = isAllowedByPolicy(liveSeed, liveSeed, {});
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "same-host");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exitCode = 1;
