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
const { collectSeoAudit } = require("./seoAudit.service");
const { collectSocialAudit } = require("./socialAudit.service");

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

async function collectPageAudit(page, url) {
  const consoleErrors = [];
  const failedRequests = [];

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
    headingHierarchy,
    images,
    consoleErrors,
    failedRequests,
  };
}

module.exports = {
  launchAuditBrowser,
  collectPageAudit,
};
