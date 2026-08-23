/**
 * tests/urlNormalizer.test.js
 *
 * Phase 5.3 — URL Normalization and Deduplication Tests
 */

"use strict";

const { normalizeUrl, dedupeUrls } = require("../src/utils/urlNormalizer");
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

console.log("\n=== PHASE 5.3 — URL Normalizer Tests ===\n");

// 1. Absolute URL
runTest("Test 1 — Absolute URL", () => {
  const result = normalizeUrl("https://example.com/about");
  assert.strictEqual(result, "https://example.com/about");
});

// 2. Root-relative URL
runTest("Test 2 — Root-relative URL", () => {
  const result = normalizeUrl("/about", "https://example.com");
  assert.strictEqual(result, "https://example.com/about");
});

// 3. Relative URL
runTest("Test 3 — Relative URL (../)", () => {
  const result = normalizeUrl("../contact", "https://example.com/products/");
  assert.strictEqual(result, "https://example.com/contact");
});

// 4. Fragment removal
runTest("Test 4 — Fragment removal", () => {
  const result = normalizeUrl("https://example.com/about#team");
  assert.strictEqual(result, "https://example.com/about");
});

// 5. Fragment-only
runTest("Test 5 — Fragment-only", () => {
  const result = normalizeUrl("#team", "https://example.com/about");
  assert.strictEqual(result, "https://example.com/about");
});

// 6. Hostname lowercase
runTest("Test 6 — Hostname lowercase", () => {
  const result = normalizeUrl("HTTPS://EXAMPLE.COM/ABOUT");
  assert.strictEqual(result, "https://example.com/ABOUT");
});

// 7. Default HTTPS port removal
runTest("Test 7 — Default HTTPS port removal", () => {
  const result = normalizeUrl("https://example.com:443/about");
  assert.strictEqual(result, "https://example.com/about");
});

// 8. Default HTTP port removal
runTest("Test 8 — Default HTTP port removal", () => {
  const result = normalizeUrl("http://example.com:80/about");
  assert.strictEqual(result, "http://example.com/about");
});

// 9. Non-default port preserved
runTest("Test 9 — Non-default port preserved", () => {
  const result = normalizeUrl("http://example.com:8080/about");
  assert.strictEqual(result, "http://example.com:8080/about");
});

// 10. Root trailing slash preserved
runTest("Test 10 — Root trailing slash preserved", () => {
  const result = normalizeUrl("https://example.com/");
  assert.strictEqual(result, "https://example.com/");
});

// 11. Non-root trailing slash removed
runTest("Test 11 — Non-root trailing slash removed", () => {
  const result = normalizeUrl("https://example.com/about/");
  assert.strictEqual(result, "https://example.com/about");
});

// 12. Multiple trailing slashes normalized consistently
runTest("Test 12 — Multiple trailing slashes removed", () => {
  const result = normalizeUrl("https://example.com/about///");
  assert.strictEqual(result, "https://example.com/about");
});

// 13. Query preserved
runTest("Test 13 — Query preserved", () => {
  const result = normalizeUrl("https://example.com/products?id=1");
  assert.strictEqual(result, "https://example.com/products?id=1");
});

// 14. Different query remains different
runTest("Test 14 — Different query remains different", () => {
  const result1 = normalizeUrl("/products?id=1", "https://example.com");
  const result2 = normalizeUrl("/products?id=2", "https://example.com");
  assert.strictEqual(result1, "https://example.com/products?id=1");
  assert.strictEqual(result2, "https://example.com/products?id=2");
  assert.notStrictEqual(result1, result2);
});

// 15-18. Discarded schemes
const badSchemes = [
  { scheme: "mailto:", url: "mailto:test@example.com", name: "15" },
  { scheme: "tel:", url: "tel:+911234567890", name: "16" },
  { scheme: "javascript:", url: "javascript:void(0)", name: "17" },
  { scheme: "ftp:", url: "ftp://example.com/file", name: "18" }
];

for (const { scheme, url, name } of badSchemes) {
  runTest(`Test ${name} — ${scheme} discarded`, () => {
    const result = normalizeUrl(url);
    assert.strictEqual(result, null);
  });
}

// 19. Empty string
runTest("Test 19 — Empty string discarded", () => {
  assert.strictEqual(normalizeUrl(""), null);
});

// 20. whitespace-only
runTest("Test 20 — Whitespace-only discarded", () => {
  assert.strictEqual(normalizeUrl("   "), null);
});

// 21. null
runTest("Test 21 — Null discarded", () => {
  assert.strictEqual(normalizeUrl(null), null);
});

// 22. malformed URL
runTest("Test 22 — Malformed URL does not throw, returns null", () => {
  // Use a string that causes URL parsing to throw when no baseUrl is provided
  assert.strictEqual(normalizeUrl("http://%"), null);
});

// 23. www remains separate
runTest("Test 23 — www remains separate", () => {
  const result = normalizeUrl("https://www.example.com/about");
  assert.strictEqual(result, "https://www.example.com/about");
});

// 24. external URL normalization
runTest("Test 24 — External URL normalization", () => {
  const result = normalizeUrl("https://facebook.com/page#top");
  assert.strictEqual(result, "https://facebook.com/page");
});

// 25. dedupeUrls() behavior
runTest("Test 25 — dedupeUrls() removes duplicates", () => {
  const urls = [
    "https://example.com/about",
    "https://example.com/about/",
    "https://example.com/about#top"
  ];
  const result = dedupeUrls(urls);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], "https://example.com/about");
});

// 26. dedupe preserves query distinction
runTest("Test 26 — dedupe preserves query distinction", () => {
  const urls = [
    "/products?id=1",
    "/products?id=2"
  ];
  const result = dedupeUrls(urls, "https://example.com");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result.includes("https://example.com/products?id=1"), true);
  assert.strictEqual(result.includes("https://example.com/products?id=2"), true);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exitCode = 1;
