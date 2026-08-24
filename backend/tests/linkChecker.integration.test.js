"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const urlValidator = require("../src/utils/urlValidator");
const { checkLinkTarget } = require("../src/services/linkChecker.service");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function runHttpChecks() {
  const methodsByPath = new Map();
  let redirectTargetHits = 0;

  const server = http.createServer((req, res) => {
    const methods = methodsByPath.get(req.url) || [];
    methods.push({ method: req.method, range: req.headers.range || null });
    methodsByPath.set(req.url, methods);

    if (req.url === "/ok") {
      res.writeHead(204);
      res.end();
    } else if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/redirect-target?token=secret#private" });
      res.end();
    } else if (req.url.startsWith("/redirect-target")) {
      redirectTargetHits += 1;
      res.writeHead(200);
      res.end("followed");
    } else if (req.url === "/unauthorized") {
      res.writeHead(401);
      res.end();
    } else if (req.url === "/forbidden") {
      res.writeHead(403);
      res.end();
    } else if (req.url === "/missing") {
      res.writeHead(404);
      res.end();
    } else if (req.url === "/server-error") {
      res.writeHead(503);
      res.end();
    } else if (req.url === "/head-fallback" && req.method === "HEAD") {
      res.writeHead(405);
      res.end();
    } else if (req.url === "/head-fallback") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("fallback body");
    } else if (req.url === "/slow") {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200);
          res.end();
        }
      }, 150);
    } else if (req.url === "/abort") {
      req.socket.destroy();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await listen(server);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const allowInjectedLocalhost = async (targetUrl) => ({
    safe: true,
    url: targetUrl,
    hostname: "127.0.0.1",
    resolvedAddresses: ["127.0.0.1"],
    reason: null,
  });
  const options = { timeoutMs: 500, validateTargetUrl: allowInjectedLocalhost };

  try {
    const ok = await checkLinkTarget(`${baseUrl}/ok`, options);
    assert.strictEqual(ok.state, "ok");
    assert.strictEqual(ok.statusCode, 204);

    const pinnedAddress = await checkLinkTarget(
      `http://public.example:${port}/ok`,
      options
    );
    assert.strictEqual(pinnedAddress.state, "ok");
    assert.strictEqual(pinnedAddress.statusCode, 204);

    const redirect = await checkLinkTarget(`${baseUrl}/redirect`, options);
    assert.strictEqual(redirect.state, "redirect");
    assert.strictEqual(redirect.statusCode, 302);
    assert.strictEqual(redirect.location, `${baseUrl}/redirect-target`);
    assert.strictEqual(redirect.finalState, "ok");
    assert.strictEqual(redirect.finalStatusCode, 200);
    assert.strictEqual(redirect.health, "redirected");
    assert.strictEqual(redirect.isBroken, false);
    assert.strictEqual(redirect.redirectCount, 1);
    assert.strictEqual(redirectTargetHits, 1);

    const unauthorized = await checkLinkTarget(`${baseUrl}/unauthorized`, options);
    assert.strictEqual(unauthorized.state, "restricted");
    assert.strictEqual(unauthorized.statusCode, 401);

    const forbidden = await checkLinkTarget(`${baseUrl}/forbidden`, options);
    assert.strictEqual(forbidden.state, "restricted");
    assert.strictEqual(forbidden.statusCode, 403);

    const missing = await checkLinkTarget(`${baseUrl}/missing`, options);
    assert.strictEqual(missing.state, "client_error");
    assert.strictEqual(missing.statusCode, 404);

    const serverError = await checkLinkTarget(`${baseUrl}/server-error`, options);
    assert.strictEqual(serverError.state, "server_error");
    assert.strictEqual(serverError.statusCode, 503);

    const fallback = await checkLinkTarget(`${baseUrl}/head-fallback`, options);
    assert.strictEqual(fallback.state, "ok");
    assert.strictEqual(fallback.statusCode, 200);
    assert.deepStrictEqual(methodsByPath.get("/head-fallback"), [
      { method: "HEAD", range: null },
      { method: "GET", range: "bytes=0-0" },
    ]);

    const timeout = await checkLinkTarget(`${baseUrl}/slow`, {
      timeoutMs: 40,
      validateTargetUrl: allowInjectedLocalhost,
    });
    assert.strictEqual(timeout.state, "timeout");
    assert.strictEqual(timeout.errorCode, "REQUEST_TIMEOUT");

    const networkError = await checkLinkTarget(`${baseUrl}/abort`, options);
    assert.strictEqual(networkError.state, "network_error");
    assert.strictEqual(networkError.errorMessage, "Link check request failed");

    const blocked = await checkLinkTarget("http://127.0.0.1/");
    assert.strictEqual(blocked.state, "blocked");
    assert.strictEqual(blocked.errorCode, "SSRF_BLOCKED");

    const metadata = await checkLinkTarget("http://169.254.169.254/");
    assert.strictEqual(metadata.state, "blocked");
    assert.strictEqual(metadata.errorCode, "SSRF_BLOCKED");

    const reserved = await checkLinkTarget("http://192.0.2.1/");
    assert.strictEqual(reserved.state, "blocked");
    assert.strictEqual(reserved.errorCode, "SSRF_BLOCKED");

    let credentialValidatorCalled = false;
    const credentials = await checkLinkTarget("http://user:pass@example.invalid/", {
      validateTargetUrl: async () => {
        credentialValidatorCalled = true;
        return { safe: true, resolvedAddresses: ["127.0.0.1"] };
      },
    });
    assert.strictEqual(credentials.state, "blocked");
    assert.strictEqual(credentials.errorCode, "CREDENTIALS_NOT_ALLOWED");
    assert.strictEqual(credentialValidatorCalled, false);
  } finally {
    await close(server);
  }
}

async function runPostCrawlContractCheck() {
  const crawlerPath = require.resolve("../src/services/crawler.service");
  const controllerPath = require.resolve("../src/controllers/crawl.controller");
  const crawlerService = require(crawlerPath);
  const originalRunCrawl = crawlerService.runCrawl;
  const originalValidateTargetUrl = urlValidator.validateTargetUrl;
  let receivedOptions = null;
  const mockedLinkChecks = {
    uniqueTargets: 1,
    processedTargets: 1,
    uncheckedTargets: 0,
    limitHit: false,
    limits: { maxTargets: 200, concurrency: 4, maxRedirects: 5, timeoutMs: 5000 },
  };
  const mockedLinkHealth = {
    summary: {
      uniqueTargets: 1,
      totalOccurrences: 1,
      internal: { uniqueTargets: 1, occurrences: 1 },
      external: { uniqueTargets: 0, occurrences: 0 },
      byHealth: {
        healthy: 0,
        redirected: 1,
        restricted: 0,
        broken: 0,
        unreachable: 0,
        blocked: 0,
        unchecked: 0,
        unknown: 0,
      },
      brokenInternalTargets: 0,
      brokenExternalTargets: 0,
      affectedPages: 1,
      classificationConflicts: 0,
      invalidOccurrences: 0,
      discardedOccurrences: 0,
    },
    targets: [{
      normalizedUrl: "https://public.example/about",
      classification: "internal",
      classifications: ["internal"],
      classificationConflict: false,
      health: "redirected",
      isBroken: false,
      statusCode: 301,
      finalUrl: "https://public.example/new-about",
      finalStatusCode: 200,
      redirectCount: 1,
      redirectProblem: null,
      redirectChain: [{
        url: "https://public.example/about",
        statusCode: 301,
        location: "https://public.example/new-about",
        responseTimeMs: 1,
      }],
      checkProblem: null,
      occurrenceCount: 1,
      affectedPageCount: 1,
      affectedPages: ["https://public.example"],
      anchors: ["About"],
      severity: "medium",
      priority: 2,
    }],
    issues: {
      broken: [],
      redirected: ["https://public.example/about"],
      restricted: [],
      unreachable: [],
      blocked: [],
      unchecked: [],
      unknown: [],
      conflicts: [],
    },
  };

  urlValidator.validateTargetUrl = async (targetUrl) => ({
    safe: true,
    url: targetUrl,
    hostname: "public.example",
    resolvedAddresses: ["203.0.113.10"],
    reason: null,
  });
  crawlerService.runCrawl = async (seedUrl, options) => {
    receivedOptions = options;
    return {
      success: true,
      mode: "crawl",
      seedUrl,
      options,
      crawl: { status: "completed" },
      siteWide: {},
      linkChecks: mockedLinkChecks,
      linkHealth: mockedLinkHealth,
      pages: [{
        status: "success",
        links: {
          internal: [{
            sourceUrl: seedUrl,
            rawHref: "/about",
            targetUrl: "https://public.example/about",
            normalizedUrl: "https://public.example/about",
            anchorText: "About",
            classification: "internal",
            rel: [],
            nofollow: false,
            check: {
              state: "redirect",
              statusCode: 301,
              responseTimeMs: 2,
              errorCode: null,
              errorMessage: null,
              location: "https://public.example/new-about",
              redirected: true,
              redirectCount: 1,
              redirectChain: [{
                url: "https://public.example/about",
                statusCode: 301,
                location: "https://public.example/new-about",
                responseTimeMs: 1,
              }],
              finalUrl: "https://public.example/new-about",
              finalStatusCode: 200,
              finalState: "ok",
              health: "redirected",
              isBroken: false,
              redirectProblem: null,
            },
          }],
          external: [],
          discarded: [],
          summary: { internal: 1, external: 0, discarded: 0 },
        },
      }],
    };
  };

  delete require.cache[controllerPath];
  const { crawlWebsite } = require(controllerPath);
  const app = express();
  app.use(express.json());
  app.post("/crawl", crawlWebsite);
  const server = http.createServer(app);
  await listen(server);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://public.example" }),
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(receivedOptions, {
      maxPages: 50,
      maxDepth: 3,
      concurrency: 2,
      runLighthouse: false,
    });
    assert.deepStrictEqual(body.linkChecks, mockedLinkChecks);
    assert.deepStrictEqual(body.linkHealth, mockedLinkHealth);
    assert.strictEqual(body.pages[0].links.internal[0].check.state, "redirect");
    assert.strictEqual(body.pages[0].links.internal[0].check.statusCode, 301);
    assert.strictEqual(body.pages[0].links.internal[0].check.finalState, "ok");
    assert.strictEqual(body.pages[0].links.internal[0].check.finalStatusCode, 200);
    assert.strictEqual(body.pages[0].links.internal[0].check.health, "redirected");
  } finally {
    await close(server);
    crawlerService.runCrawl = originalRunCrawl;
    urlValidator.validateTargetUrl = originalValidateTargetUrl;
    delete require.cache[controllerPath];
  }
}

async function runTests() {
  await runHttpChecks();
  await runPostCrawlContractCheck();
  console.log("Link-check HTTP and POST /crawl integration tests passed");
}

runTests().catch((error) => {
  console.error("Link-check integration tests failed:", error);
  process.exit(1);
});
