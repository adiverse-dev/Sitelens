const assert = require("assert");
const http = require("http");
const { chromium } = require("playwright");
const urlValidator = require("../src/utils/urlValidator");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Build a page that loads resources from a private URL */
function buildAttackerPage(privateUrl) {
  return `<!DOCTYPE html><html><head><title>Attacker</title></head><body>
<img src="${privateUrl}/img">
<iframe src="${privateUrl}/frame"></iframe>
<script>
  fetch("${privateUrl}/fetch").catch(()=>{});
  const x = new XMLHttpRequest();
  x.open("GET","${privateUrl}/xhr");
  x.send();
</script>
</body></html>`;
}

/** Wrap urlValidator.validateTargetUrl so only the safe-server port passes through */
function installTestBypass(safePort) {
  const original = urlValidator.validateTargetUrl;
  urlValidator.validateTargetUrl = async (url) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return { safe: false, reason: "Bad URL" }; }
    if (parsed.hostname === "127.0.0.1" && parsed.port === String(safePort)) {
      return { safe: true, url, hostname: "127.0.0.1", resolvedAddresses: ["127.0.0.1"], reason: null };
    }
    return original(url);
  };
  return () => { urlValidator.validateTargetUrl = original; };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("\n=== PHASE 1.5 — Playwright SSRF Guard Tests ===\n");

  // Lazily re-require after imports resolve to pick up mutable module export
  const { launchAuditBrowser, collectPageAudit } = require("../src/services/browserAudit.service");

  // ─── 1. Safe public page ─────────────────────────────────────────────────
  {
    const { browser, page } = await launchAuditBrowser();
    try {
      const result = await collectPageAudit(page, "https://example.com");
      assert.ok(result.title, "Expected a page title");
      assert.ok(Array.isArray(result.blockedRequests), "blockedRequests must be an array");
      // example.com has no private-IP resources
      const ssrfBlocks = result.blockedRequests.filter(r => r.reason === "SSRF protection");
      assert.strictEqual(ssrfBlocks.length, 0, "No resources should be SSRF-blocked on example.com");
      console.log("✓ Safe public page — audit succeeded, no false-positive blocks");
    } finally {
      await browser.close();
    }
  }

  // ─── 2. Private-IP subresources (img, iframe, fetch, xhr) ───────────────
  {
    let privateHitCount = 0;

    const privateServer = await startServer((req, res) => {
      privateHitCount++;
      res.writeHead(200);
      res.end("secret");
    });
    const privatePort = privateServer.address().port;
    const privateBase = `http://127.0.0.1:${privatePort}`;

    // Safe content server — allowed through the bypass
    const safeServer = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(buildAttackerPage(privateBase));
    });
    const safePort = safeServer.address().port;
    const restore = installTestBypass(safePort);

    const { browser, page } = await launchAuditBrowser();
    try {
      const result = await collectPageAudit(page, `http://127.0.0.1:${safePort}/`);

      // The private server must NEVER have been reached
      assert.strictEqual(
        privateHitCount,
        0,
        `Private server was reached ${privateHitCount} times — SSRF guard failed!`
      );

      // blockedRequests must contain at least the blocked attempts
      const ssrfBlocks = result.blockedRequests.filter((r) => r.reason === "SSRF protection");
      assert.ok(ssrfBlocks.length > 0, "Expected at least one SSRF-blocked request");

      // Audit itself must not crash
      assert.ok(result.title !== undefined, "Audit should still return a title");
      console.log(`✓ Private subresources (img/iframe/fetch/xhr) — blocked ${ssrfBlocks.length} request(s), private server hit count: ${privateHitCount}`);
    } finally {
      restore();
      await browser.close();
      privateServer.close();
      safeServer.close();
    }
  }

  // ─── 3. Redirect to private IP ───────────────────────────────────────────
  {
    let privateHitCount = 0;

    const privateServer = await startServer((req, res) => {
      privateHitCount++;
      res.writeHead(200);
      res.end("secret");
    });
    const privatePort = privateServer.address().port;

    // Redirect server — returns 302 → private IP
    const redirectServer = await startServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${privatePort}/target` });
      res.end();
    });
    const redirectPort = redirectServer.address().port;
    const restore = installTestBypass(redirectPort); // allow the redirect server itself

    const { browser, page } = await launchAuditBrowser();
    try {
      // page.goto will fail (redirect aborted), which is expected
      try {
        await collectPageAudit(page, `http://127.0.0.1:${redirectPort}/`);
      } catch (_) {
        // Expected — navigation aborted
      }

      assert.strictEqual(
        privateHitCount,
        0,
        `Private endpoint was reached via redirect — SSRF guard failed! (hit count: ${privateHitCount})`
      );
      console.log(`✓ Redirect to private IP — blocked before reaching private server (hit count: ${privateHitCount})`);
    } finally {
      restore();
      await browser.close();
      privateServer.close();
      redirectServer.close();
    }
  }

  // ─── 4. Safe redirect ────────────────────────────────────────────────────
  {
    const targetServer = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Safe Target</title></head><body>OK</body></html>");
    });
    const targetPort = targetServer.address().port;

    const redirectServer = await startServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/` });
      res.end();
    });
    const redirectPort = redirectServer.address().port;

    // Allow both ports through
    const original = urlValidator.validateTargetUrl;
    urlValidator.validateTargetUrl = async (url) => {
      let parsed;
      try { parsed = new URL(url); } catch (_) { return { safe: false, reason: "Bad URL" }; }
      if (parsed.hostname === "127.0.0.1" && (parsed.port === String(redirectPort) || parsed.port === String(targetPort))) {
        return { safe: true, url, hostname: "127.0.0.1", resolvedAddresses: ["127.0.0.1"], reason: null };
      }
      return original(url);
    };

    const { browser, page } = await launchAuditBrowser();
    try {
      const result = await collectPageAudit(page, `http://127.0.0.1:${redirectPort}/`);
      assert.ok(result.title !== undefined, "Should have a title after safe redirect");
      const ssrfBlocks = result.blockedRequests.filter((r) => r.reason === "SSRF protection");
      assert.strictEqual(ssrfBlocks.length, 0, "No blocks expected for safe redirect");
      console.log("✓ Safe redirect — followed normally, audit succeeded");
    } finally {
      urlValidator.validateTargetUrl = original;
      await browser.close();
      targetServer.close();
      redirectServer.close();
    }
  }

  // ─── 5. Direct private IPv4 / Cloud Metadata ─────────────────────────────
  // Phase 1.3 already blocks these at the controller. This test confirms the
  // SSRF guard inside Playwright also independently blocks them if somehow reached.
  {
    const { browser, page } = await launchAuditBrowser();
    try {
      const { installSsrfGuard } = require("../src/services/browserAudit.service");
      // We test the guard directly by calling validateTargetUrl
      const check10 = await urlValidator.validateTargetUrl("http://10.0.0.1");
      assert.strictEqual(check10.safe, false, "10.0.0.1 should be SSRF-blocked");
      const check169 = await urlValidator.validateTargetUrl("http://169.254.169.254");
      assert.strictEqual(check169.safe, false, "169.254.169.254 should be SSRF-blocked");
      const checkIPv6 = await urlValidator.validateTargetUrl("http://[::1]");
      assert.strictEqual(checkIPv6.safe, false, "::1 should be SSRF-blocked");
      console.log("✓ Validator confirms: 10.0.0.1, 169.254.169.254, and [::1] are all blocked");
      await browser.close();
    } catch (e) {
      await browser.close();
      throw e;
    }
  }

  console.log("\n=== All Phase 1.5 tests passed ===\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
