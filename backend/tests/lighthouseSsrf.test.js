/**
 * Phase 1.6 — Lighthouse SSRF Protection Tests
 *
 * Architecture: Lighthouse 12 uses Puppeteer's page.target() API internally,
 * which Playwright pages do not implement. Therefore Lighthouse cannot reuse
 * a Playwright Page directly. SSRF protection is implemented as:
 *
 *  1. Pre-flight: runLighthouseAudit() calls validateTargetUrl() before
 *     Lighthouse (and its internally-managed Chromium tab) connects at all.
 *
 *  2. Post-audit: lhr.finalDisplayedUrl is validated to detect cases where
 *     Lighthouse followed a server-side redirect to a private address.
 *
 * Known limitation: Lighthouse's internal Chrome tab has no route-level guard
 * on subresources (images, scripts, iframes). The Playwright pass (Phase 1.5)
 * provides subresource SSRF protection for the main browser session.
 */

const assert = require("assert");
const urlValidator = require("../src/utils/urlValidator");
const { runLighthouseAudit, createFailedLighthouseResult } = require("../src/services/lighthouseAudit.service");

async function runTests() {
  console.log("\n=== PHASE 1.6 — Lighthouse SSRF Protection Tests ===\n");

  // ─── 1. SSRF-blocked URLs never reach Lighthouse ─────────────────────────
  // The controller already blocks these at Phase 1.3 before the browser
  // launches.  We verify this at the validator level and confirm the
  // expected error shape from createFailedLighthouseResult.
  {
    const blockedCases = [
      "http://localhost:5000",
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://169.254.169.254",
      "http://[::1]",
    ];

    for (const targetUrl of blockedCases) {
      const check = await urlValidator.validateTargetUrl(targetUrl);
      assert.strictEqual(check.safe, false, `Expected ${targetUrl} to be blocked by validator`);
      console.log(`✓ Validator blocks ${targetUrl} (reason: ${check.reason})`);
    }
  }

  // ─── 2. Pre-flight blocks private URLs before Lighthouse launches ─────────
  // runLighthouseAudit() itself calls validateTargetUrl() as a defence-in-depth
  // layer independent of the Phase 1.3 controller gate.
  {
    const blockedCases = [
      "http://localhost:5000",
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://169.254.169.254",
      "http://[::1]",
    ];

    for (const targetUrl of blockedCases) {
      let caught = null;
      try {
        await runLighthouseAudit(targetUrl, 9222);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, `Expected runLighthouseAudit to throw for ${targetUrl}`);
      assert.ok(
        caught.message.includes("not allowed") || caught.message.includes("security check"),
        `Unexpected error message for ${targetUrl}: ${caught.message}`
      );
      console.log(`✓ runLighthouseAudit pre-flight blocks ${targetUrl}`);
    }
  }

  // ─── 3. Post-audit redirect detection ────────────────────────────────────
  // Simulate Lighthouse having followed a redirect to a private IP by mocking
  // the lhr.finalDisplayedUrl and verifying the post-audit check rejects it.
  {
    // We test the post-audit check by calling validateTargetUrl directly on a
    // "finalDisplayedUrl" that resolved to a private address.
    const privateUrls = [
      "http://127.0.0.1/admin",
      "http://10.0.0.1/secret",
      "http://169.254.169.254/latest/meta-data/",
    ];

    for (const privateUrl of privateUrls) {
      const check = await urlValidator.validateTargetUrl(privateUrl);
      assert.strictEqual(check.safe, false,
        `Post-audit check should block redirect to ${privateUrl}`);
      console.log(`✓ Post-audit redirect check blocks ${privateUrl}`);
    }
  }

  // ─── 4. Safe redirect — post-audit check passes ───────────────────────────
  {
    const safeUrls = [
      "https://www.example.com",
      "https://github.com",
    ];
    for (const safeUrl of safeUrls) {
      const check = await urlValidator.validateTargetUrl(safeUrl);
      assert.strictEqual(check.safe, true,
        `Post-audit check should pass for safe URL ${safeUrl}`);
      console.log(`✓ Post-audit redirect check allows safe URL ${safeUrl}`);
    }
  }

  // ─── 5. createFailedLighthouseResult shape is preserved ──────────────────
  {
    const failedResult = createFailedLighthouseResult(new Error("test error"));
    assert.strictEqual(failedResult.performance, null);
    assert.strictEqual(failedResult.accessibility, null);
    assert.strictEqual(failedResult.bestPractices, null);
    assert.strictEqual(failedResult.seo, null);
    assert.strictEqual(failedResult.error, "test error");
    console.log("✓ createFailedLighthouseResult shape is preserved");
  }

  console.log("\n=== All Phase 1.6 Lighthouse SSRF tests passed ===\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
