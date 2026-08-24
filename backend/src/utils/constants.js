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
// Phase 6B link checks are deliberately independent from Playwright crawl limits.
const LINK_CHECK_MAX_TARGETS_HARD_LIMIT = 1000;
const LINK_CHECK_CONCURRENCY_HARD_LIMIT = 10;
const LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT = 10;
const CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS = 15000;

function readBoundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum) return fallback;
  return Math.min(value, maximum);
}

// Maximum unique retained link targets checked during one crawl.
const LINK_CHECK_MAX_TARGETS = readBoundedInteger(
  "LINK_CHECK_MAX_TARGETS",
  200,
  1,
  LINK_CHECK_MAX_TARGETS_HARD_LIMIT
);
// Number of lightweight HTTP checks processed simultaneously.
const LINK_CHECK_CONCURRENCY = readBoundedInteger(
  "LINK_CHECK_CONCURRENCY",
  4,
  1,
  LINK_CHECK_CONCURRENCY_HARD_LIMIT
);
// Maximum number of redirect transitions followed for one unique target.
const LINK_CHECK_MAX_REDIRECTS = readBoundedInteger(
  "LINK_CHECK_MAX_REDIRECTS",
  5,
  0,
  LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT
);
// Total target-check deadline, including the optional HEAD-to-GET fallback.
const CRAWLER_REQUEST_TIMEOUT_MS = readBoundedInteger(
  "CRAWLER_REQUEST_TIMEOUT_MS",
  5000,
  100,
  CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS
);
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
  LINK_CHECK_MAX_TARGETS,
  LINK_CHECK_MAX_TARGETS_HARD_LIMIT,
  LINK_CHECK_CONCURRENCY,
  LINK_CHECK_CONCURRENCY_HARD_LIMIT,
  LINK_CHECK_MAX_REDIRECTS,
  LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT,
  CRAWLER_REQUEST_TIMEOUT_MS,
  CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS,
  CRAWL_RATE_LIMIT_WINDOW_MS,
  CRAWL_RATE_LIMIT_MAX_REQUESTS,
};
