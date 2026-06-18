const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;
const screenshotPath = path.join("docs", "assets", "sitelens-demo.png");

app.use(cors());
app.use(express.json());

app.post("/audit", async (req, res) => {
  const { url } = req.body;

  try {
    const browser = await chromium.launch();
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

    // Page Load Time
    const startTime = Date.now();

    await page.goto(url);

    const loadTime = Date.now() - startTime;

    const title = await page.title();

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    await browser.close();

    res.json({
      success: true,
      title,
      screenshot: screenshotPath,
      loadTime,
      consoleErrors,
      failedRequests,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
