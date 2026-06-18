const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const screenshotPath = path.join("docs", "assets", "sitelens-demo.png");

app.use(cors());
app.use(express.json());

function isValidHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
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
    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage();
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
      timeout: 15000,
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

    const images = await page.locator("img").evaluateAll((elements) => {
      const missingAltImages = elements
        .filter((image) => !image.getAttribute("alt")?.trim())
        .slice(0, 10)
        .map((image) => image.currentSrc || image.src || "Unknown image source");

      const withAlt = elements.filter((image) =>
        image.getAttribute("alt")?.trim()
      ).length;

      return {
        total: elements.length,
        withAlt,
        missingAlt: elements.length - withAlt,
        missingAltSamples: missingAltImages,
      };
    });

    fs.mkdirSync(path.dirname(screenshotPath), {
      recursive: true,
    });

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    res.json({
      success: true,
      url,
      title,
      screenshot: "docs/assets/sitelens-demo.png",
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
      images,
      consoleErrors,
      failedRequests,
      summary: {
        consoleErrorCount: consoleErrors.length,
        failedRequestCount: failedRequests.length,
        imageMissingAltCount: images.missingAlt,
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
