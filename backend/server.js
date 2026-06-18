const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");

const app = express();

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

    await page.screenshot({
      path: "google.png",
      fullPage: true,
    });

    await browser.close();

    res.json({
      success: true,
      title,
      screenshot: "google.png",
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

app.listen(5000, () => {
  console.log("Server running on port 5000");
});