/**
 * tests/screenshotLifecycle.test.js
 *
 * Deterministic tests for the Phase 3 screenshot lifecycle.
 * Uses a temporary isolated directory — never touches the real screenshots/ folder.
 *
 * All TTL/dir values are controlled via environment variables before any
 * module requiring constants.js is loaded, so the cleanup service respects
 * the test-specific configuration.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");

// ---------------------------------------------------------------------------
// Isolated temp directory — avoids touching production screenshots/
// ---------------------------------------------------------------------------
const TEST_DIR = path.join(__dirname, "__test_screenshots_tmp__");
const TTL_MS = 5000; // 5-second TTL for deterministic fast tests

// Set env BEFORE any project module is required so constants.js picks them up
process.env.SCREENSHOT_DIR = TEST_DIR;
process.env.SCREENSHOT_TTL_MS = String(TTL_MS);

// Now require project modules (they will see the overridden env values)
const { cleanupOnce } = require("../src/services/screenshotCleanup.service");
const { normalizeFilePath, createScreenshotPath } = require("../src/utils/screenshotPath");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

function writeFile(filename, ageMs = 0) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, "fake-png-content");
  if (ageMs > 0) {
    const mtime = (Date.now() - ageMs) / 1000;
    fs.utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

function exists(filepath) {
  return fs.existsSync(filepath);
}

function resetDir() {
  if (fs.existsSync(TEST_DIR)) {
    for (const f of fs.readdirSync(TEST_DIR)) {
      fs.unlinkSync(path.join(TEST_DIR, f));
    }
  }
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("\n=== PHASE 3.3 — Screenshot Lifecycle Tests ===\n");

  // -------------------------------------------------------------------------
  // TEST 1 — Fresh screenshot is preserved
  // -------------------------------------------------------------------------
  resetDir();
  const freshFile = writeFile("fresh.png", 0); // just created = age ~0
  await cleanupOnce();
  assert(exists(freshFile), "Test 1 — Fresh PNG (age 0) is preserved");

  // -------------------------------------------------------------------------
  // TEST 2 — Expired screenshot is deleted
  // -------------------------------------------------------------------------
  resetDir();
  const expiredFile = writeFile("expired.png", TTL_MS + 2000); // older than TTL
  await cleanupOnce();
  assert(!exists(expiredFile), "Test 2 — Expired PNG (older than TTL) is deleted");

  // -------------------------------------------------------------------------
  // TEST 3 — Non-PNG files are preserved
  // -------------------------------------------------------------------------
  resetDir();
  const txtFile  = writeFile("test.txt",  TTL_MS + 2000);
  const jsonFile = writeFile("test.json", TTL_MS + 2000);
  const logFile  = writeFile("test.log",  TTL_MS + 2000);
  await cleanupOnce();
  assert(exists(txtFile),  "Test 3 — Expired .txt is NOT deleted");
  assert(exists(jsonFile), "Test 3 — Expired .json is NOT deleted");
  assert(exists(logFile),  "Test 3 — Expired .log is NOT deleted");

  // -------------------------------------------------------------------------
  // TEST 4 — Missing directory is handled gracefully
  // -------------------------------------------------------------------------
  // Remove the test dir entirely
  if (fs.existsSync(TEST_DIR)) {
    for (const f of fs.readdirSync(TEST_DIR)) fs.unlinkSync(path.join(TEST_DIR, f));
    fs.rmdirSync(TEST_DIR);
  }
  let threw = false;
  try {
    await cleanupOnce();
  } catch (_) {
    threw = true;
  }
  assert(!threw, "Test 4 — Missing screenshots directory does not throw");

  // -------------------------------------------------------------------------
  // TEST 5 — Cleanup does not overlap (concurrency guard)
  // -------------------------------------------------------------------------
  // The module-level `cleanupRunning` flag should prevent a second concurrent
  // call from executing. We verify this by checking that calling cleanupOnce()
  // twice simultaneously does not cause an error.
  resetDir();
  writeFile("concurrent.png", TTL_MS + 2000);
  let concurrentError = false;
  try {
    await Promise.all([cleanupOnce(), cleanupOnce()]);
  } catch (_) {
    concurrentError = true;
  }
  assert(!concurrentError, "Test 5 — Concurrent cleanupOnce() calls do not throw");

  // -------------------------------------------------------------------------
  // TEST 6 — Screenshot path normalisation is URL-rooted
  // -------------------------------------------------------------------------
  const inputs = [
    path.join("screenshots", "www.example.com-2026-08-18T04-35-03-502Z.png"),
    path.join("screenshots", "sub", "page-2026-01-01T00-00-00-000Z.png"),
    "C:\\Users\\adity\\Sitelens\\screenshots\\localhost-2026-08-18T04-37-18-590Z.png",
  ];
  for (const input of inputs) {
    const result = normalizeFilePath(input);
    const startsWithSlash = result.startsWith("/screenshots/");
    const endsPng         = result.endsWith(".png");
    const noBackslash     = !result.includes("\\");
    const noAbsolute      = !result.includes("C:") && !result.includes("Users");
    assert(
      startsWithSlash && endsPng && noBackslash && noAbsolute,
      `Test 6 — normalizeFilePath("${path.basename(input)}") → "${result}"`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 7 — Static screenshot serving via express.static
  // -------------------------------------------------------------------------
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const staticFilename = "static-test.png";
  fs.writeFileSync(path.join(TEST_DIR, staticFilename), Buffer.from([137,80,78,71])); // PNG magic bytes

  const staticApp = express();
  staticApp.use("/screenshots", express.static(path.resolve(TEST_DIR)));
  const staticServer = http.createServer(staticApp);

  await new Promise((resolve) => staticServer.listen(0, resolve));
  const staticPort = staticServer.address().port;

  const imgRes = await fetch(`http://127.0.0.1:${staticPort}/screenshots/${staticFilename}`);
  assert(imgRes.status === 200, "Test 7 — Static server returns HTTP 200 for PNG");
  assert(
    (imgRes.headers.get("content-type") || "").includes("png"),
    "Test 7 — Content-Type contains 'png'"
  );
  const body = await imgRes.arrayBuffer();
  assert(body.byteLength > 0, "Test 7 — Response body is non-empty");

  // -------------------------------------------------------------------------
  // TEST 8 — Path traversal is blocked by express.static
  // -------------------------------------------------------------------------
  // express.static normalises paths and will 404 any traversal attempts
  const traversalPaths = [
    "/screenshots/../package.json",
    "/screenshots/../../server.js",
    "/screenshots/%2e%2e/package.json",
  ];
  for (const tp of traversalPaths) {
    const tRes = await fetch(`http://127.0.0.1:${staticPort}${tp}`);
    assert(
      tRes.status === 404,
      `Test 8 — Path traversal "${tp}" returns 404 (not exposed)`
    );
  }

  staticServer.close();
  resetDir();

  // -------------------------------------------------------------------------
  // TEST 9 — Wikipedia E2E (live server required)
  // -------------------------------------------------------------------------
  console.log("\n  [Test 9] Running live Wikipedia E2E against localhost:5000...");
  let e2eOk = false;
  try {
    const auditRes = await fetch("http://localhost:5000/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.wikipedia.org" }),
    });
    const auditData = await auditRes.json();

    const screenshotUrl = auditData.screenshot;
    const screenshotValid =
      screenshotUrl &&
      screenshotUrl.startsWith("/screenshots/") &&
      screenshotUrl.endsWith(".png");

    assert(auditRes.status === 200,   "Test 9 — POST /audit HTTP 200");
    assert(auditData.success === true, "Test 9 — success === true");
    assert(screenshotValid,            "Test 9 — screenshot is URL-rooted /screenshots/*.png");

    if (screenshotValid) {
      const imgRes2 = await fetch(`http://localhost:5000${screenshotUrl}`);
      assert(imgRes2.status === 200, "Test 9 — GET /screenshots/{file} HTTP 200");
      assert(
        (imgRes2.headers.get("content-type") || "").includes("png"),
        "Test 9 — Screenshot Content-Type is image/png"
      );
      e2eOk = true;
    }
  } catch (err) {
    console.error(`  [Test 9] ERROR: ${err.message}`);
    assert(false, "Test 9 — Live server reachable");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});
