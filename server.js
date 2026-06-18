const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

const screenshotPath = path.join(
  "docs",
  "assets",
  "sitelens-demo.png"
);

app.use(cors());
app.use(express.json());

app.post("/audit", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required",
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage();

    // Console Errors
    const consoleErrors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Failed Requests
    const failedRequests = [];

    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        method: request.method(),
      });
    });

    // Navigation + Load Time
    const startTime = Date.now();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const loadTime = Date.now() - startTime;

    // Title
    const title = await page.title();

    // H1 Count
    const h1Count = await page.locator("h1").count();

    // Image Count
    const imageCount = await page.locator("img").count();

    // Meta Description
    let metaDescription = null;

    try {
      metaDescription = await page
        .locator('meta[name="description"]')
        .getAttribute("content");
    } catch (err) {
      metaDescription = null;
    }

    // Screenshot
    fs.mkdirSync(path.dirname(screenshotPath), {
      recursive: true,
    });

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    res.json({
      success: true,
      title,
      screenshot: "docs/assets/sitelens-demo.png",
      loadTime,
      h1Count,
      imageCount,
      metaDescription,
      consoleErrors,
      failedRequests,
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
  console.log(`🚀 SiteLens running on port ${PORT}`);
});