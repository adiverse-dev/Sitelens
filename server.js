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

function getMissingFields(source, requiredFields) {
  return requiredFields.filter((field) => !source[field]);
}

function hasAnyField(source, fields) {
  return fields.some((field) => Boolean(source[field]));
}

function isValidOptionalUrl(value) {
  return value ? isValidHttpUrl(value) : false;
}

function createCanonicalAudit(canonicalTags) {
  const firstCanonical = canonicalTags[0] || null;
  const canonicalUrl = firstCanonical?.rawHref || null;

  return {
    exists: canonicalTags.length > 0,
    url: canonicalUrl,
    multipleCanonicals: canonicalTags.length > 1,
    isValidUrl: canonicalUrl ? isValidHttpUrl(canonicalUrl) : false,
  };
}

function createOpenGraphAudit(openGraphTags) {
  const requiredFields = ["title", "description", "image", "url", "type"];

  return {
    exists: hasAnyField(openGraphTags, requiredFields),
    title: openGraphTags.title || null,
    description: openGraphTags.description || null,
    image: openGraphTags.image || null,
    url: openGraphTags.url || null,
    type: openGraphTags.type || null,
    missingFields: getMissingFields(openGraphTags, requiredFields),
    isImageUrlValid: isValidOptionalUrl(openGraphTags.image),
  };
}

function createTwitterCardAudit(twitterTags) {
  const requiredFields = ["card", "title", "description", "image"];

  return {
    exists: hasAnyField(twitterTags, requiredFields),
    card: twitterTags.card || null,
    title: twitterTags.title || null,
    description: twitterTags.description || null,
    image: twitterTags.image || null,
    missingFields: getMissingFields(twitterTags, requiredFields),
    isImageUrlValid: isValidOptionalUrl(twitterTags.image),
  };
}

function createHeadingHierarchyAudit(headings) {
  const issues = [];
  const h1Count = headings.filter((heading) => heading.level === "H1").length;
  const emptyHeadings = headings.filter((heading) => !heading.text);

  if (h1Count === 0) {
    issues.push("Missing H1 heading");
  }

  if (h1Count > 1) {
    issues.push("Multiple H1 headings found");
  }

  if (emptyHeadings.length > 0) {
    issues.push(`${emptyHeadings.length} empty heading(s) found`);
  }

  let previousLevel = null;

  headings
    .filter((heading) => heading.text)
    .forEach((heading) => {
      const currentLevel = Number(heading.level.replace("H", ""));

      if (previousLevel && currentLevel > previousLevel + 1) {
        issues.push(`Skipped heading level: H${previousLevel} to H${currentLevel}`);
      }

      previousLevel = currentLevel;
    });

  return {
    valid: issues.length === 0,
    headings,
    issues,
  };
}

function addRecommendation(recommendations, severity, category, issue, fix) {
  recommendations.push({
    severity,
    category,
    issue,
    fix,
  });
}

function generateRecommendations(pageAudit, lighthouse) {
  const recommendations = [];
  const { seo, images, canonical, openGraph, twitterCard, headingHierarchy } =
    pageAudit;

  if (seo.h1.count === 0) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing H1 heading",
      "Add one clear H1 that describes the primary topic of the page."
    );
  }

  if (seo.h1.count > 1) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Multiple H1 headings found",
      "Use a single H1 for the main page topic and structure subsections with H2-H6 headings."
    );
  }

  if (!seo.metaDescription.exists) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing meta description",
      "Add a concise meta description that summarizes the page content."
    );
  } else if (
    seo.metaDescription.length < 50 ||
    seo.metaDescription.length > 160
  ) {
    addRecommendation(
      recommendations,
      "low",
      "SEO",
      "Meta description length is outside the recommended range",
      "Keep the meta description roughly between 50 and 160 characters."
    );
  }

  if (!canonical.exists) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing canonical tag",
      "Add a canonical tag that points to the preferred URL for this page."
    );
  } else {
    if (!canonical.isValidUrl) {
      addRecommendation(
        recommendations,
        "high",
        "SEO",
        "Canonical URL is invalid",
        "Use a valid HTTP or HTTPS canonical URL."
      );
    }

    if (canonical.multipleCanonicals) {
      addRecommendation(
        recommendations,
        "high",
        "SEO",
        "Multiple canonical tags detected",
        "Use exactly one canonical tag per page."
      );
    }
  }

  if (openGraph.missingFields.includes("image")) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Missing Open Graph image",
      "Add an og:image tag so shared links have a strong preview image."
    );
  }

  if (openGraph.image && !openGraph.isImageUrlValid) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Open Graph image URL is invalid",
      "Use a valid absolute HTTP or HTTPS URL for og:image."
    );
  }

  if (openGraph.missingFields.length > 0) {
    addRecommendation(
      recommendations,
      "low",
      "Social SEO",
      "Open Graph metadata is incomplete",
      `Add missing Open Graph fields: ${openGraph.missingFields.join(", ")}.`
    );
  }

  if (twitterCard.missingFields.includes("image")) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Missing Twitter Card image",
      "Add twitter:image so posts have a visual preview."
    );
  }

  if (twitterCard.image && !twitterCard.isImageUrlValid) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Twitter Card image URL is invalid",
      "Use a valid absolute HTTP or HTTPS URL for twitter:image."
    );
  }

  if (twitterCard.missingFields.length > 0) {
    addRecommendation(
      recommendations,
      "low",
      "Social SEO",
      "Twitter Card metadata is incomplete",
      `Add missing Twitter Card fields: ${twitterCard.missingFields.join(", ")}.`
    );
  }

  if (images.missingAlt > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Accessibility",
      "Images are missing alt text",
      "Add meaningful alt text to informative images and empty alt text to decorative images."
    );
  }

  headingHierarchy.issues.forEach((issue) => {
    if (issue.includes("Multiple H1") || issue.includes("Missing H1")) {
      return;
    }

    addRecommendation(
      recommendations,
      "medium",
      "Content Structure",
      issue,
      "Use a logical heading outline without empty headings or skipped levels."
    );
  });

  if (lighthouse.performance !== null && lighthouse.performance < 50) {
    addRecommendation(
      recommendations,
      "high",
      "Performance",
      "Lighthouse performance score is below 50",
      "Optimize render-blocking resources, JavaScript execution, images, and server response time."
    );
  }

  if (lighthouse.accessibility !== null && lighthouse.accessibility < 80) {
    addRecommendation(
      recommendations,
      "medium",
      "Accessibility",
      "Lighthouse accessibility score is below 80",
      "Review Lighthouse accessibility findings and fix labels, contrast, semantics, and keyboard issues."
    );
  }

  if (pageAudit.consoleErrors.length > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Reliability",
      "Console errors were detected",
      "Fix JavaScript errors shown in the browser console."
    );
  }

  if (pageAudit.failedRequests.length > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Reliability",
      "Failed network requests were detected",
      "Fix broken assets, API calls, or third-party requests returning failures."
    );
  }

  return recommendations;
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

  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(
      (element) => ({
        level: element.tagName.toUpperCase(),
        text: element.textContent.trim(),
      }))
  );

  const h1Texts = headings
    .filter((heading) => heading.level === "H1" && heading.text)
    .map((heading) => heading.text);
  const headingHierarchy = createHeadingHierarchyAudit(headings);

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

  const openGraphTags = await page.evaluate(() => {
    const getMetaContent = (property) => {
      const element = document.querySelector(`meta[property="${property}"]`);
      const content = element?.getAttribute("content")?.trim();
      return content || null;
    };

    return {
      title: getMetaContent("og:title"),
      description: getMetaContent("og:description"),
      image: getMetaContent("og:image"),
      url: getMetaContent("og:url"),
      type: getMetaContent("og:type"),
    };
  });

  const openGraph = createOpenGraphAudit(openGraphTags);

  const twitterTags = await page.evaluate(() => {
    const getMetaContent = (name) => {
      const element = document.querySelector(`meta[name="${name}"]`);
      const content = element?.getAttribute("content")?.trim();
      return content || null;
    };

    return {
      card: getMetaContent("twitter:card"),
      title: getMetaContent("twitter:title"),
      description: getMetaContent("twitter:description"),
      image: getMetaContent("twitter:image"),
    };
  });

  const twitterCard = createTwitterCardAudit(twitterTags);

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
    openGraph,
    twitterCard,
    headingHierarchy,
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
    const recommendations = generateRecommendations(pageAudit, lighthouse);

    res.json({
      success: true,
      url,
      ...pageAudit,
      lighthouse,
      recommendations,
      summary: {
        consoleErrorCount: pageAudit.consoleErrors.length,
        failedRequestCount: pageAudit.failedRequests.length,
        imageMissingAltCount: pageAudit.images.missingAlt,
        recommendationCount: recommendations.length,
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
