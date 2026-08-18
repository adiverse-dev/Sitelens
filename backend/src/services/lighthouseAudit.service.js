const { LIGHTHOUSE_CATEGORIES } = require("../utils/constants");
const urlValidator = require("../utils/urlValidator");

let lighthouseLoader;

async function getLighthouse() {
  if (!lighthouseLoader) {
    lighthouseLoader = import("lighthouse").then(
      (lighthouseModule) => lighthouseModule.default || lighthouseModule
    );
  }

  return lighthouseLoader;
}

function toPercentageScore(category) {
  if (!category || typeof category.score !== "number") {
    return null;
  }

  return Math.round(category.score * 100);
}

function formatLighthouseResult(lhr) {
  return {
    performance: toPercentageScore(lhr.categories.performance),
    accessibility: toPercentageScore(lhr.categories.accessibility),
    bestPractices: toPercentageScore(lhr.categories["best-practices"]),
    seo: toPercentageScore(lhr.categories.seo),
    error: null,
  };
}

function createFailedLighthouseResult(error) {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    error: error.message,
  };
}

/**
 * Runs a Lighthouse audit against the given URL.
 *
 * SSRF Protection strategy:
 *  - Pre-flight: validateTargetUrl() blocks private/internal URLs before
 *    Lighthouse (and its internally-managed Chrome tab) ever opens a connection.
 *  - Post-audit: lhr.finalDisplayedUrl is validated to detect cases where the
 *    server issued an HTTP redirect to a private address that Lighthouse followed.
 *    If a redirect to a private/internal destination is detected, the result is
 *    discarded and a failed result is returned.
 *
 * Note: Lighthouse opens its own CDP session (via puppeteer.connect) and creates
 * a new, independent Chrome tab — it cannot reuse a Playwright Page directly
 * because Lighthouse depends on Puppeteer's page.target() API which Playwright
 * pages do not implement.  The pre-flight + post-audit approach is therefore the
 * correct architecture for this integration.
 *
 * Remaining limitation: Lighthouse's internal Chrome tab has no route-level
 * SSRF guard on subresources (images, scripts, iframes) loaded by the page.
 * The pre-flight check protects the primary navigation URL and redirect targets
 * are detected post-audit via finalDisplayedUrl, but resource-level SSRF
 * (e.g. a page embedding <img src="http://169.254.169.254">) is not blocked at
 * the Chrome level during the Lighthouse pass.  This is documented as a known
 * limitation; the Playwright pass (Phase 1.5) provides subresource protection
 * for the main browser session.
 *
 * @param {string} url  - The target URL.
 * @param {number} port - Remote debugging port of the shared Chromium instance.
 */
async function runLighthouseAudit(url, port) {
  // ── Pre-flight SSRF check ──────────────────────────────────────────────────
  // The controller already validates the initial URL (Phase 1.3), so this check
  // is a defence-in-depth layer for any code paths that call runLighthouseAudit
  // directly, or in case this function is reused outside the controller.
  let preflightCheck;
  try {
    preflightCheck = await urlValidator.validateTargetUrl(url);
  } catch (_) {
    throw new Error("Lighthouse pre-flight security check failed");
  }

  if (!preflightCheck.safe) {
    throw new Error("Lighthouse target URL is not allowed");
  }

  // ── Run Lighthouse ─────────────────────────────────────────────────────────
  const lighthouse = await getLighthouse();
  const runnerResult = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: LIGHTHOUSE_CATEGORIES,
  });

  if (!runnerResult?.lhr) {
    throw new Error("Lighthouse did not return a valid report");
  }

  const lhr = runnerResult.lhr;

  // ── Post-audit redirect check ──────────────────────────────────────────────
  // Lighthouse records the URL the browser actually landed on after following
  // any server-side redirects.  If that final URL differs from the requested
  // URL and resolves to a private/internal address, discard the result.
  const finalUrl = lhr.finalDisplayedUrl || lhr.finalUrl;
  if (finalUrl && finalUrl !== url) {
    let redirectCheck;
    try {
      redirectCheck = await urlValidator.validateTargetUrl(finalUrl);
    } catch (_) {
      throw new Error("Lighthouse post-audit redirect security check failed");
    }

    if (!redirectCheck.safe) {
      throw new Error("Lighthouse target URL is not allowed");
    }
  }

  return formatLighthouseResult(lhr);
}

module.exports = {
  runLighthouseAudit,
  createFailedLighthouseResult,
};

