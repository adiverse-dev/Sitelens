const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");
const net = require("net");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 5000;
const NAVIGATION_TIMEOUT_MS = Number(process.env.NAVIGATION_TIMEOUT_MS) || 15000;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "screenshots";
const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];

let lighthouseLoader;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function isValidHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function createCanonicalAudit(canonicalTags) {
  const firstCanonical = canonicalTags[0] || null;
  const canonicalUrl = firstCanonical?.resolvedHref || firstCanonical?.rawHref || null;

  return {
    exists: canonicalTags.length > 0,
    url: canonicalUrl,
    multipleCanonicals: canonicalTags.length > 1,
    isValidUrl: canonicalUrl ? isValidHttpUrl(canonicalUrl) : false,
  };
}

function normalizeFilePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function createScreenshotPath(url) {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "-");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return path.join(SCREENSHOT_DIR, `${hostname}-${timestamp}.png`);
}

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

async function runLighthouseAudit(url, port) {
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

  return formatLighthouseResult(runnerResult.lhr);
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

  const h1Texts = await page.locator("h1").evaluateAll((elements) =>
    elements
      .map((element) => element.textContent.trim())
      .filter(Boolean)
  );

  const metaDescription = await page
    .locator('meta[name="description"]')
    .first()
    .getAttribute("content")
    .catch(() => null);

  const canonicalTags = await page.evaluate(() =>
    Array.from(document.querySelectorAll("link[rel]"))
      .filter((link) => {
        const relValue = link.getAttribute("rel") || "";
        return relValue.toLowerCase().split(/\s+/).includes("canonical");
      })
      .map((link) => {
        const rawHref = (link.getAttribute("href") || "").trim();

        return {
          rawHref,
          resolvedHref: rawHref ? link.href : null,
        };
      })
  );

  const canonical = createCanonicalAudit(canonicalTags);

  const images = await page.locator("img").evaluateAll((elements) => {
    const imagesWithAlt = elements.filter((image) =>
      image.getAttribute("alt")?.trim()
    );

    const missingAltSamples = elements
      .filter((image) => !image.getAttribute("alt")?.trim())
      .slice(0, 10)
      .map((image) => image.currentSrc || image.src || "Unknown image source");

    return {
      total: elements.length,
      withAlt: imagesWithAlt.length,
      missingAlt: elements.length - imagesWithAlt.length,
      missingAltSamples,
    };
  });

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
    seo: {
      h1: {
        count: h1Texts.length,
        texts: h1Texts,
        hasSingleH1: h1Texts.length === 1,
      },
      metaDescription: {
        exists: Boolean(metaDescription),
        content: metaDescription,
        length: metaDescription ? metaDescription.length : 0,
      },
    },
    canonical,
    images,
    consoleErrors,
    failedRequests,
  };
}

app.post("/audit", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required",
    });
  }

  if (!isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid HTTP or HTTPS URL",
    });
  }

  let browser;

  try {
    const remoteDebuggingPort = await getAvailablePort();

    browser = await chromium.launch({
      headless: true,
      args: [
        `--remote-debugging-port=${remoteDebuggingPort}`,
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();
    const pageAudit = await collectPageAudit(page, url);
    const lighthouse = await runLighthouseAudit(url, remoteDebuggingPort).catch(
      createFailedLighthouseResult
    );

    res.json({
      success: true,
      url,
      ...pageAudit,
      lighthouse,
      summary: {
        consoleErrorCount: pageAudit.consoleErrors.length,
        failedRequestCount: pageAudit.failedRequests.length,
        imageMissingAltCount: pageAudit.images.missingAlt,
        lighthouse,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`SiteLens running on port ${PORT}`);
});
