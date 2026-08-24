/**
 * tests/crawler.service.test.js
 *
 * Phase 5.6 — Crawler Service Integration Tests
 */

"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");

// Mock urlValidator BEFORE requiring crawler.service
const urlValidator = require("../src/utils/urlValidator");
const originalValidate = urlValidator.validateTargetUrl;
urlValidator.validateTargetUrl = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === "127.0.0.1") {
    return { safe: true, url, hostname: "127.0.0.1", resolvedAddresses: ["127.0.0.1"], reason: null };
  }
  return originalValidate(url);
};

const { runCrawl } = require("../src/services/crawler.service");

function createTestDependencies(onCheck = () => {}) {
  return {
    checkLinkTarget: async (targetUrl) => {
      onCheck(targetUrl);
      return {
        state: "ok",
        statusCode: 200,
        responseTimeMs: 1,
        errorCode: null,
        errorMessage: null,
        location: null,
      };
    },
  };
}

// ─── Test Server Setup ───────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();

  const pages = {
    "/": `
      <html><body><h1>Home</h1>
      <a href="/about#team" rel="nofollow sponsored">About overview</a>
      <a href="/about/">About duplicate</a>
      <a href="/products">Products</a>
      <a href="https://outside.invalid/resource">External resource</a>
      <a href="#top">Back to top</a>
      </body></html>
    `,
    "/about": `
      <html><body><h1>About</h1>
      <a href="/">Home</a>
      </body></html>
    `,
    "/products": `
      <html><body><h1>Products</h1>
      <a href="/">Home</a>
      </body></html>
    `
  };

  app.use((req, res) => {
    if (pages[req.path]) {
      res.set("Content-Type", "text/html");
      res.send(pages[req.path]);
    } else {
      res.status(404).send("Not found");
    }
  });

  return app;
}

async function startTestServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return server;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function printCrawlResult(label, start, finish, res, maxObserved) {
  console.log(`\n--- ${label} ---`);
  console.log(`Start Time: ${new Date(start).toISOString()}`);
  console.log(`Finish Time: ${new Date(finish).toISOString()}`);
  console.log(`Duration: ${finish - start}ms`);
  console.log(`Pages Discovered: ${res.crawl.pagesDiscovered}`);
  console.log(`Pages Crawled: ${res.crawl.pagesCrawled}`);
  console.log(`Pages Failed: ${res.crawl.pagesFailed}`);
  console.log(`Max Observed Concurrency: ${maxObserved !== undefined ? maxObserved : 'N/A'}`);
  console.log(`-------------------------\n`);
}

async function runTest(label, testFn) {
  try {
    await testFn(label);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log("\n=== PHASE 5.6 — Crawler Service Integration Tests ===\n");

  const app = buildTestApp();
  const server = await startTestServer(app);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runTest("Test A — 1-page local crawl", async (label) => {
      const start = Date.now();
      const result = await runCrawl(baseUrl + "/about", { maxPages: 1, maxDepth: 0, concurrency: 1, runLighthouse: false }, createTestDependencies());
      const finish = Date.now();
      printCrawlResult(label, start, finish, result);
      assert.strictEqual(result.crawl.pagesCrawled, 1, "Should crawl 1 page");
    });

    await runTest("Test B — 2-page local crawl", async (label) => {
      const start = Date.now();
      const result = await runCrawl(baseUrl + "/", { maxPages: 2, maxDepth: 1, concurrency: 1, runLighthouse: false }, createTestDependencies());
      const finish = Date.now();
      printCrawlResult(label, start, finish, result);
      assert.strictEqual(result.crawl.pagesCrawled, 2, "Should crawl 2 pages");
    });

    await runTest("Test C — 3-page local crawl", async (label) => {
      const start = Date.now();
      const checkedTargets = [];
      const result = await runCrawl(baseUrl + "/", { maxPages: 3, maxDepth: 2, concurrency: 1, runLighthouse: false }, createTestDependencies((targetUrl) => checkedTargets.push(targetUrl)));
      const finish = Date.now();
      printCrawlResult(label, start, finish, result);
      assert.strictEqual(result.crawl.pagesCrawled, 3, "Should crawl 3 pages");
      assert.ok(result.siteWide, "siteWide object must exist");
      assert.strictEqual(result.siteWide.pages.crawled, 3, "siteWide.pages.crawled should match");

      const rootPage = result.pages.find((page) => page.url === `${baseUrl}/`);
      assert.ok(rootPage, "Root page result should exist");
      assert.ok(rootPage.links, "Successful page should include structured links");
      assert.deepStrictEqual(rootPage.links.summary, {
        internal: 3,
        external: 1,
        discarded: 1,
      });

      const aboutEvidence = rootPage.links.internal.filter(
        (link) => link.normalizedUrl === `${baseUrl}/about`
      );
      assert.strictEqual(aboutEvidence.length, 2, "Both About anchors should be retained");
      assert.deepStrictEqual(
        aboutEvidence.map((link) => link.anchorText),
        ["About overview", "About duplicate"]
      );
      assert.deepStrictEqual(aboutEvidence[0].rel, ["nofollow", "sponsored"]);
      assert.strictEqual(aboutEvidence[0].nofollow, true);
      assert.strictEqual(aboutEvidence[0].sourceUrl, `${baseUrl}/`);
      assert.strictEqual(aboutEvidence[0].check.state, "ok");
      assert.deepStrictEqual(aboutEvidence[0].check, aboutEvidence[1].check);
      assert.strictEqual(rootPage.links.external[0].check.state, "ok");
      assert.strictEqual(Object.hasOwn(rootPage.links.discarded[0], "check"), false);
      assert.strictEqual(
        checkedTargets.length,
        new Set(checkedTargets).size,
        "Every retained normalized target should be checked once"
      );
      assert.strictEqual(result.linkChecks.uniqueTargets, checkedTargets.length);

      const crawledAboutPages = result.pages.filter(
        (page) => page.url === `${baseUrl}/about`
      );
      assert.strictEqual(crawledAboutPages.length, 1, "Duplicate target should be crawled once");
    });

    await runTest("Test D — concurrency limit", async (label) => {
      const { Semaphore } = require("../src/utils/semaphore");
      const originalAcquire = Semaphore.prototype.acquire;
      
      let maxObserved = 0;
      Semaphore.prototype.acquire = async function() {
        await originalAcquire.call(this);
        if (this.current > maxObserved) maxObserved = this.current;
      };

      const start = Date.now();
      const result = await runCrawl(baseUrl + "/", { maxPages: 3, maxDepth: 2, concurrency: 2, runLighthouse: false }, createTestDependencies());
      const finish = Date.now();
      
      Semaphore.prototype.acquire = originalAcquire; // restore immediately

      printCrawlResult(label, start, finish, result, maxObserved);
      assert.ok(maxObserved <= 2, "Concurrency must not exceed 2");
      assert.strictEqual(result.crawl.pagesCrawled, 3, "Should crawl 3 pages");
    });

    await runTest("Test E — failed-page isolation", async (label) => {
      // Create a fresh app with an abort route
      const errorApp = express();
      errorApp.get("/error-seed", (req, res) => res.send('<a href="/abort">Error</a> <a href="/about">About</a>'));
      errorApp.get("/abort", (req, res) => res.destroy()); // Network error
      errorApp.get("/about", (req, res) => res.send("About"));

      const errServer = await startTestServer(errorApp);
      const p = errServer.address().port;

      const start = Date.now();
      const result = await runCrawl(`http://127.0.0.1:${p}/error-seed`, { maxPages: 3, maxDepth: 1, concurrency: 2, runLighthouse: false }, createTestDependencies());
      const finish = Date.now();
      
      errServer.close();

      printCrawlResult(label, start, finish, result);
      assert.strictEqual(result.crawl.pagesCrawled, 2, "Seed + About should be crawled successfully");
      assert.strictEqual(result.crawl.pagesFailed, 1, "Abort route should fail");
    });

  } finally {
    server.close();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
