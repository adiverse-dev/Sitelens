"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SUITES = Object.freeze({
  unit: Object.freeze([
    "robotsAudit.examples.js",
    "crawlPolicy.test.js",
    "crawlerQueue.test.js",
    "urlNormalizer.test.js",
    "linkCheckMapping.test.js",
    "siteAggregation.test.js",
  ]),
  integration: Object.freeze([
    "rateLimiter.test.js",
    "linkChecker.integration.test.js",
    "urlDiscovery.test.js",
    "structuredLinks.test.js",
    "crawler.service.test.js",
  ]),
});

function selectTests(suiteName) {
  if (suiteName === "all") {
    return [...SUITES.unit, ...SUITES.integration];
  }

  return SUITES[suiteName] || null;
}

function removeTemporaryDirectory(tempRoot) {
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  const resolvedTempRoot = path.resolve(tempRoot);
  const relativePath = path.relative(resolvedSystemTemp, resolvedTempRoot);

  if (
    !relativePath ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to remove non-temporary path: ${resolvedTempRoot}`);
  }

  fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
}

function run() {
  const suiteName = process.argv[2] || "all";
  const selectedTests = selectTests(suiteName);

  if (!selectedTests) {
    console.error(
      `Unknown test suite "${suiteName}". Expected one of: unit, integration, all.`
    );
    process.exitCode = 1;
    return;
  }

  const backendRoot = path.resolve(__dirname, "..");
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "sitelens-backend-tests-")
  );
  const screenshotDir = path.join(tempRoot, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const childEnvironment = {
    ...process.env,
    CHROME_LOG_FILE: path.join(tempRoot, "chromium-debug.log"),
    SCREENSHOT_DIR: screenshotDir,
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
  };

  let failures = 0;

  console.log(`Running SiteLens backend ${suiteName} test suite`);
  console.log(`Temporary output: ${tempRoot}`);

  try {
    for (const testFile of selectedTests) {
      console.log(`\n--- ${testFile} ---`);

      const result = spawnSync(process.execPath, [path.join(__dirname, testFile)], {
        cwd: backendRoot,
        env: childEnvironment,
        stdio: "inherit",
      });

      if (result.error) {
        failures++;
        console.error(`${testFile} could not start: ${result.error.message}`);
      } else if (result.status !== 0) {
        failures++;
        const outcome = result.signal
          ? `terminated by signal ${result.signal}`
          : `exited with code ${result.status}`;
        console.error(`${testFile} failed (${outcome}).`);
      }
    }
  } finally {
    try {
      removeTemporaryDirectory(tempRoot);
    } catch (error) {
      failures++;
      console.error(`Failed to clean temporary output: ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\nBackend ${suiteName} suite failed: ${failures} test file(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nBackend ${suiteName} suite passed: ${selectedTests.length} test file(s).`);
}

run();
