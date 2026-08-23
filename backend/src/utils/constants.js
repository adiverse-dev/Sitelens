const PORT = process.env.PORT || 5000;
const NAVIGATION_TIMEOUT_MS = Number(process.env.NAVIGATION_TIMEOUT_MS) || 15000;
const ROBOTS_TIMEOUT_MS = Number(process.env.ROBOTS_TIMEOUT_MS) || 10000;
const SITEMAP_TIMEOUT_MS = Number(process.env.SITEMAP_TIMEOUT_MS) || 10000;
const SITEMAP_CHILD_FETCH_LIMIT =
  Number(process.env.SITEMAP_CHILD_FETCH_LIMIT) || 10;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "screenshots";
// How long a screenshot file is kept on disk before cleanup deletes it (default 60 min)
const SCREENSHOT_TTL_MS = Number(process.env.SCREENSHOT_TTL_MS) || 60 * 60 * 1000;
// How often the cleanup job scans the screenshot directory (default 10 min)
const SCREENSHOT_CLEANUP_INTERVAL_MS =
  Number(process.env.SCREENSHOT_CLEANUP_INTERVAL_MS) || 10 * 60 * 1000;
const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];
const SITELENS_USER_AGENT =
  "SiteLensBot/0.4 (+https://github.com/adiverse-dev/Sitelens)";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 5;

// ── Phase 5 — Multi-Page Crawler ──────────────────────────────────────────────
// Maximum number of pages the crawler will audit in a single crawl run.
const CRAWLER_MAX_PAGES = Number(process.env.CRAWLER_MAX_PAGES) || 50;
// Maximum link depth to follow from the seed URL (seed = depth 0).
const CRAWLER_MAX_DEPTH = Number(process.env.CRAWLER_MAX_DEPTH) || 3;
// Number of pages audited concurrently. Kept low to avoid Chromium RAM exhaustion.
const CRAWLER_CONCURRENCY = Number(process.env.CRAWLER_CONCURRENCY) || 2;
// Per-page navigation + audit timeout in milliseconds.
const CRAWLER_PAGE_TIMEOUT_MS = Number(process.env.CRAWLER_PAGE_TIMEOUT_MS) || 20000;
// Timeout for lightweight HTTP requests made by the crawler (e.g. HEAD checks).
const CRAWLER_REQUEST_TIMEOUT_MS = Number(process.env.CRAWLER_REQUEST_TIMEOUT_MS) || 10000;
// Crawl rate limiter: 1 crawl request per IP per window (crawls are far heavier than audits).
const CRAWL_RATE_LIMIT_WINDOW_MS = Number(process.env.CRAWL_RATE_LIMIT_WINDOW_MS) || 60000;
const CRAWL_RATE_LIMIT_MAX_REQUESTS = Number(process.env.CRAWL_RATE_LIMIT_MAX_REQUESTS) || 1;

module.exports = {
  PORT,
  NAVIGATION_TIMEOUT_MS,
  ROBOTS_TIMEOUT_MS,
  SITEMAP_TIMEOUT_MS,
  SITEMAP_CHILD_FETCH_LIMIT,
  SCREENSHOT_DIR,
  SCREENSHOT_TTL_MS,
  SCREENSHOT_CLEANUP_INTERVAL_MS,
  LIGHTHOUSE_CATEGORIES,
  SITELENS_USER_AGENT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  CRAWLER_MAX_PAGES,
  CRAWLER_MAX_DEPTH,
  CRAWLER_CONCURRENCY,
  CRAWLER_PAGE_TIMEOUT_MS,
  CRAWLER_REQUEST_TIMEOUT_MS,
  CRAWL_RATE_LIMIT_WINDOW_MS,
  CRAWL_RATE_LIMIT_MAX_REQUESTS,
};
