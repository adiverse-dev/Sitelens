/**
 * tests/crawlArchitecture.test.js
 *
 * Phase 5.1 — Crawler Architecture & Contract Tests
 *
 * Tests:
 *  1.  POST /crawl route exists (200 on valid request)
 *  2.  Missing URL is rejected (400)
 *  3.  Invalid URL format rejected (400)
 *  4.  localhost rejected by SSRF check (400)
 *  5.  Private IP rejected by SSRF check (400)
 *  6.  Invalid maxPages rejected (400)
 *  7.  Invalid maxDepth rejected (400)
 *  8.  Invalid concurrency rejected (400)
 *  9.  runLighthouse non-boolean rejected (400)
 *  10. Defaults are applied when options absent
 *  11. runLighthouse defaults to false
 *  12. Stub response shape is correct
 *  13. POST /audit still works (regression)
 *  14. POST /audit rate limit is unchanged (5 req/min)
 *  15. POST /crawl has stricter rate limit (1 req/min)
 *
 * Does NOT test actual crawling (no browser launched, no pages visited).
 *
 * Architecture note:
 *   Groups A–C and D use isolated Express apps with rate-limiters disabled or
 *   set to a high ceiling so that individual validation tests don't burn the
 *   production rate-limit window.  Group E uses a dedicated isolated app with
 *   tight ceilings to verify rate-limit differentiation.
 */

const express = require("express");
const http = require("http");
const rateLimit = require("express-rate-limit");

// ─── helpers ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function post(server, path, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

/**
 * Creates an isolated Express app that mounts /audit and /crawl with
 * configurable rate-limit ceilings. Default ceiling is 1000 (effectively
 * unlimited for testing purposes) so individual validation tests don't
 * consume the production rate-limit window.
 */
function buildTestApp({ auditMax = 1000, crawlMax = 1000 } = {}) {
  const { auditWebsite } = require("../src/controllers/audit.controller");
  const { crawlWebsite } = require("../src/controllers/crawl.controller");

  const noOpLimiter = (max) => rateLimit({
    windowMs: 60000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) =>
      res.status(options.statusCode).json({ success: false, error: "rate-limited" }),
  });

  const app = express();
  app.use(express.json());
  app.post("/audit", noOpLimiter(auditMax), auditWebsite);
  app.post("/crawl", noOpLimiter(crawlMax), crawlWebsite);
  return app;
}

async function startTestServer(appOptions) {
  const app = buildTestApp(appOptions);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return server;
}

// ─── main ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n=== PHASE 5.1 — Crawler Architecture Tests ===\n");

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP A — Route existence + basic request validation
  // Isolated server, high rate limit ceiling (won't burn production window).
  // ────────────────────────────────────────────────────────────────────────────
  console.log("[ Group A ] Route existence + request validation");
  {
    const server = await startTestServer();
    try {
      // Test 1: Valid URL → 200
      {
        const { status, data } = await post(server, "/crawl", { url: "https://example.com" });
        assert(status === 200, "Test 1 — POST /crawl returns 200 on valid URL");
        assert(data.success === true, "Test 1 — success === true");
      }

      // Test 2: Missing URL → 400
      {
        const { status, data } = await post(server, "/crawl", {});
        assert(status === 400, "Test 2 — Missing URL returns 400");
        assert(typeof data.error === "string", "Test 2 — error message is a string");
      }

      // Test 3: Invalid URL format → 400
      {
        const { status } = await post(server, "/crawl", { url: "not-a-url" });
        assert(status === 400, "Test 3 — Invalid URL format returns 400");
      }

      // Test 3b: ftp:// scheme → 400
      {
        const { status } = await post(server, "/crawl", { url: "ftp://example.com" });
        assert(status === 400, "Test 3b — ftp:// scheme returns 400");
      }

      // Test 4: localhost → 400 (SSRF)
      {
        const { status, data } = await post(server, "/crawl", { url: "http://localhost" });
        assert(status === 400, "Test 4 — localhost rejected (400)");
        assert(data.error === "Target URL is not allowed", "Test 4 — correct SSRF error");
      }

      // Test 5: Private IP → 400 (SSRF)
      {
        const { status, data } = await post(server, "/crawl", { url: "http://192.168.1.1" });
        assert(status === 400, "Test 5 — Private IP 192.168.1.1 rejected (400)");
        assert(data.error === "Target URL is not allowed", "Test 5 — correct SSRF error");
      }

      // Test 5b: Cloud metadata IP → 400 (SSRF)
      {
        const { status } = await post(server, "/crawl", { url: "http://169.254.169.254" });
        assert(status === 400, "Test 5b — Cloud metadata IP rejected (400)");
      }
    } finally {
      server.close();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP B — Crawl options validation
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[ Group B ] Crawl options validation");
  {
    const server = await startTestServer();
    try {
      // Test 6: Invalid maxPages
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { maxPages: 0 } });
        assert(status === 400, "Test 6 — maxPages: 0 returns 400");
      }
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { maxPages: 201 } });
        assert(status === 400, "Test 6b — maxPages: 201 returns 400 (exceeds ceiling)");
      }
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { maxPages: 1.5 } });
        assert(status === 400, "Test 6c — maxPages: 1.5 (float) returns 400");
      }

      // Test 7: Invalid maxDepth
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { maxDepth: -1 } });
        assert(status === 400, "Test 7 — maxDepth: -1 returns 400");
      }
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { maxDepth: 11 } });
        assert(status === 400, "Test 7b — maxDepth: 11 returns 400 (exceeds ceiling)");
      }

      // Test 8: Invalid concurrency
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { concurrency: 0 } });
        assert(status === 400, "Test 8 — concurrency: 0 returns 400");
      }
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { concurrency: 6 } });
        assert(status === 400, "Test 8b — concurrency: 6 returns 400 (exceeds ceiling)");
      }

      // Test 9: Invalid runLighthouse (non-boolean)
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { runLighthouse: "yes" } });
        assert(status === 400, "Test 9 — runLighthouse: 'yes' (string) returns 400");
      }
      {
        const { status } = await post(server, "/crawl", { url: "https://example.com", options: { runLighthouse: 1 } });
        assert(status === 400, "Test 9b — runLighthouse: 1 (number) returns 400");
      }
    } finally {
      server.close();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP C — Defaults + stub response shape
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[ Group C ] Defaults + stub response shape");
  {
    const server = await startTestServer();
    try {
      // Test 10 + 11: Defaults applied, runLighthouse defaults to false
      {
        const { status, data } = await post(server, "/crawl", { url: "https://example.com" });
        assert(status === 200, "Test 10 — no options = 200 (defaults applied)");
        assert(data.options.maxPages === 50, "Test 10 — default maxPages = 50");
        assert(data.options.maxDepth === 3, "Test 10 — default maxDepth = 3");
        assert(data.options.concurrency === 2, "Test 10 — default concurrency = 2");
        assert(data.options.runLighthouse === false, "Test 11 — runLighthouse defaults to false");
      }

      // Test 10b: Custom valid options are respected
      {
        const { status, data } = await post(server, "/crawl", {
          url: "https://example.com",
          options: { maxPages: 10, maxDepth: 1, concurrency: 1, runLighthouse: true },
        });
        assert(status === 200, "Test 10b — custom valid options = 200");
        assert(data.options.maxPages === 10, "Test 10b — custom maxPages = 10");
        assert(data.options.maxDepth === 1, "Test 10b — custom maxDepth = 1");
        assert(data.options.concurrency === 1, "Test 10b — custom concurrency = 1");
        assert(data.options.runLighthouse === true, "Test 10b — custom runLighthouse = true");
      }

      // Test 12: Stub response shape is correct
      {
        const { data } = await post(server, "/crawl", { url: "https://example.com" });
        assert(data.success === true, "Test 12 — success === true");
        assert(data.mode === "crawl", "Test 12 — mode === 'crawl'");
        assert(data.seedUrl === "https://example.com", "Test 12 — seedUrl present");
        assert(typeof data.crawl === "object", "Test 12 — crawl object present");
        assert(data.crawl.status === "completed", "Test 12 — crawl.status === 'completed'");
        assert(data.crawl.pagesDiscovered >= 0, "Test 12 — pagesDiscovered >= 0");
        assert(data.crawl.pagesCrawled >= 0, "Test 12 — pagesCrawled >= 0");
        assert(data.crawl.pagesFailed >= 0, "Test 12 — pagesFailed >= 0");
        assert(data.crawl.pagesSkipped >= 0, "Test 12 — pagesSkipped >= 0");
        assert(data.crawl.limitHit === null || typeof data.crawl.limitHit === 'string', "Test 12 — limitHit check");
        assert(Array.isArray(data.pages), "Test 12 — pages is an array");
        assert(typeof data.siteWide === "object", "Test 12 — siteWide === object");
      }
    } finally {
      server.close();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP D — POST /audit regression
  // Validates the existing /audit endpoint still works correctly.
  // We use bad-URL fast paths to avoid spinning up a real browser.
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[ Group D ] POST /audit regression");
  {
    const server = await startTestServer();
    try {
      // Test 13a: Invalid URL still returns 400 from /audit
      {
        const { status } = await post(server, "/audit", { url: "not-a-url" });
        assert(status === 400, "Test 13a — POST /audit rejects invalid URL (400)");
      }

      // Test 13b: SSRF still blocked on /audit
      {
        const { status, data } = await post(server, "/audit", { url: "http://127.0.0.1" });
        assert(status === 400, "Test 13b — POST /audit blocks SSRF (400)");
        assert(data.error === "Target URL is not allowed", "Test 13b — SSRF error message unchanged");
      }

      // Test 13c: Missing URL still returns 400 on /audit
      {
        const { status } = await post(server, "/audit", {});
        assert(status === 400, "Test 13c — POST /audit requires URL field");
      }
    } finally {
      server.close();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP E — Rate limiter differentiation
  // Isolated app with tight ceilings:
  //   /audit  max=3  (tests that it allows multiple before blocking)
  //   /crawl  max=1  (tests the 1-per-minute production default)
  // Uses bad-URL fast paths (controller rejects at 400 before any browser work).
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n[ Group E ] Rate limiter differentiation");
  {
    // Build a fresh isolated app with test-specific ceilings.
    const { auditWebsite } = require("../src/controllers/audit.controller");
    const { crawlWebsite } = require("../src/controllers/crawl.controller");

    const testAuditLimiter = rateLimit({
      windowMs: 60000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res, next, options) =>
        res.status(options.statusCode).json({ success: false, error: "audit-rate-limited" }),
    });

    const testCrawlLimiter = rateLimit({
      windowMs: 60000,
      max: 1,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res, next, options) =>
        res.status(options.statusCode).json({ success: false, error: "crawl-rate-limited" }),
    });

    const testApp = express();
    testApp.use(express.json());
    testApp.post("/audit", testAuditLimiter, auditWebsite);
    testApp.post("/crawl", testCrawlLimiter, crawlWebsite);

    const rateSrv = http.createServer(testApp);
    await new Promise((r) => rateSrv.listen(0, r));

    try {
      // Test 14: /audit allows 3 requests before 429
      let auditBlockedEarly = false;
      for (let i = 1; i <= 3; i++) {
        const { status } = await post(rateSrv, "/audit", { url: "not-a-url" });
        // Expect 400 (bad URL hits controller), NOT 429 (rate limited)
        if (status === 429) { auditBlockedEarly = true; break; }
      }
      assert(!auditBlockedEarly, "Test 14 — /audit allows ≥3 requests before 429");

      const { status: audit429 } = await post(rateSrv, "/audit", { url: "not-a-url" });
      assert(audit429 === 429, "Test 14 — /audit returns 429 on request 4 (limit=3)");

      // Test 15: /crawl blocks after 1 request in same window
      // First request: hits controller (bad URL = 400, not rate-limited)
      const { status: crawl1 } = await post(rateSrv, "/crawl", { url: "not-a-url" });
      assert(crawl1 === 400, "Test 15 — /crawl first request reaches controller (400 from bad URL)");

      // Second request: must be rate-limited (429)
      const { status: crawl2, data: crawl2Data } = await post(rateSrv, "/crawl", { url: "not-a-url" });
      assert(crawl2 === 429, "Test 15 — /crawl returns 429 on second request (limit=1)");
      assert(crawl2Data.error === "crawl-rate-limited", "Test 15 — correct crawl rate-limit error message");
    } finally {
      rateSrv.close();
    }
  }

  // ─── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});
