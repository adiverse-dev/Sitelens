const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require("playwright");
const { NAVIGATION_TIMEOUT_MS } = require("../utils/constants");
const {
  createScreenshotPath,
  normalizeFilePath,
} = require("../utils/screenshotPath");
const {
  collectHeadings,
  createHeadingHierarchyAudit,
} = require("./headingAudit.service");
const { collectImageAudit } = require("./imageAudit.service");
const { collectIndexabilityAudit } = require("./indexabilityAudit.service");
const { collectSeoAudit } = require("./seoAudit.service");
const { collectSocialAudit } = require("./socialAudit.service");
const urlValidator = require("../utils/urlValidator");

// Non-network schemes that the browser uses internally and must never be blocked.
const PASSTHROUGH_SCHEMES = new Set(["data:", "blob:", "about:", "javascript:", "chrome:", "chrome-extension:"]);

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function launchAuditBrowser() {
  const remoteDebuggingPort = await getAvailablePort();
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage();

  return {
    browser,
    page,
    remoteDebuggingPort,
  };
}

/**
 * Recursively validates and fetches an HTTP/HTTPS URL without trusting
 * Chromium's built-in redirect following.  Each redirect hop is validated
 * by validateTargetUrl() before the next request is made.
 *
 * Returns one of three sentinels:
 *   "abort"    — caller must call route.abort()
 *   "continue" — caller must call route.continue() (network error, let Chrome handle)
 *   "done"     — route.fulfill() was already called internally
 */
async function handleHttpWithRedirects(route, url, blockedRequests, depth = 0) {
  const MAX_REDIRECTS = 5;

  if (depth > MAX_REDIRECTS) {
    blockedRequests.push({ url, reason: "SSRF protection" });
    return "abort";
  }

  // SSRF validation — covers hostname, IP ranges, ports, credentials
  let check;
  try {
    check = await urlValidator.validateTargetUrl(url);
  } catch (_) {
    blockedRequests.push({ url, reason: "SSRF protection" });
    return "abort";
  }

  if (!check.safe) {
    blockedRequests.push({ url, reason: "SSRF protection" });
    return "abort";
  }

  // Fetch the resource ourselves with maxRedirects:0 so Chrome never
  // sees the Location header and cannot follow it independently.
  let response;
  try {
    response = await route.fetch({ url, maxRedirects: 0 });
  } catch (_) {
    // Connection refused, TLS error, etc. — let Chrome surface the failure.
    return "continue";
  }

  // If the server replied with a redirect, validate and follow it ourselves.
  const status = response.status();
  if (status >= 300 && status < 400) {
    const location = (response.headers()["location"] || "").trim();
    if (location) {
      let redirectUrl;
      try {
        redirectUrl = new URL(location, url).toString();
      } catch (_) {
        blockedRequests.push({ url: location, reason: "SSRF protection" });
        return "abort";
      }
      return handleHttpWithRedirects(route, redirectUrl, blockedRequests, depth + 1);
    }
  }

  // Non-redirect (or redirect with no Location): forward the response to Chrome.
  try {
    await route.fulfill({ response });
  } catch (_) {
    await route.continue().catch(() => {});
  }
  return "done";
}

async function installSsrfGuard(page, blockedRequests) {
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();

    // Determine scheme — handle malformed URLs gracefully
    let scheme;
    try {
      scheme = new URL(requestUrl).protocol;
    } catch (_) {
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }

    // Pass through non-network browser-internal schemes unchanged
    if (PASSTHROUGH_SCHEMES.has(scheme)) {
      await route.continue().catch(() => {});
      return;
    }

    // HTTP/HTTPS — full SSRF validation + redirect control
    if (scheme === "http:" || scheme === "https:") {
      const outcome = await handleHttpWithRedirects(route, requestUrl, blockedRequests);
      if (outcome === "abort") {
        await route.abort("blockedbyclient").catch(() => {});
      } else if (outcome === "continue") {
        await route.continue().catch(() => {});
      }
      // "done" means route.fulfill() was already called — nothing left to do
      return;
    }

    // Any other unknown scheme — block
    await route.abort("blockedbyclient").catch(() => {});
  });
}

async function collectPageAudit(page, url) {
  const consoleErrors = [];
  const failedRequests = [];
  const blockedRequests = [];

  // Install SSRF guard before any navigation
  await installSsrfGuard(page, blockedRequests);

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "Unknown failure",
    });
  });

  const startTime = Date.now();

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  const loadTime = Date.now() - startTime;
  const title = await page.title();
  const headings = await collectHeadings(page);
  const headingHierarchy = createHeadingHierarchyAudit(headings);
  const { seo, canonical } = await collectSeoAudit(page, headings);
  const { openGraph, twitterCard } = await collectSocialAudit(page);
  const indexability = await collectIndexabilityAudit(page);
  const images = await collectImageAudit(page);
  const screenshotPath = createScreenshotPath(url);

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  return {
    title,
    screenshot: normalizeFilePath(screenshotPath),
    loadTime,
    seo,
    canonical,
    openGraph,
    twitterCard,
    indexability,
    headingHierarchy,
    images,
    consoleErrors,
    failedRequests,
    blockedRequests,
  };
}

module.exports = {
  launchAuditBrowser,
  collectPageAudit,
};

