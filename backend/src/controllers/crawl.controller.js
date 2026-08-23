/**
 * crawl.controller.js
 *
 * Request handler for POST /crawl.
 *
 * Responsibilities:
 *  1. Read and validate request body.
 *  2. Validate URL format and security (reusing existing urlValidator — no new SSRF logic).
 *  3. Validate and apply defaults to crawl options.
 *  4. Call runCrawl() from crawler.service.js.
 *  5. Return the CrawlResult as JSON.
 *
 * This controller does NOT contain any crawling logic.
 * All crawl orchestration lives in crawler.service.js.
 */

const { isValidHttpUrl, validateTargetUrl } = require("../utils/urlValidator");
const { runCrawl } = require("../services/crawler.service");
const {
  CRAWLER_MAX_PAGES,
  CRAWLER_MAX_DEPTH,
  CRAWLER_CONCURRENCY,
} = require("../utils/constants");

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Hard ceilings the caller cannot exceed regardless of what they pass.
const MAX_ALLOWED_PAGES = 200;
const MAX_ALLOWED_DEPTH = 10;
const MAX_ALLOWED_CONCURRENCY = 5;

const MIN_ALLOWED_PAGES = 1;
const MIN_ALLOWED_DEPTH = 0;
const MIN_ALLOWED_CONCURRENCY = 1;

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /crawl
 *
 * Expected request body:
 * {
 *   "url": "https://example.com",
 *   "options": {                    // all optional — defaults applied if absent
 *     "maxPages":      50,
 *     "maxDepth":      3,
 *     "concurrency":   2,
 *     "runLighthouse": false
 *   }
 * }
 */
async function crawlWebsite(req, res) {
  const { url, options = {} } = req.body;

  // ── 1. URL presence check ──────────────────────────────────────────────────
  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required",
    });
  }

  // ── 2. URL format check ────────────────────────────────────────────────────
  if (!isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid HTTP or HTTPS URL",
    });
  }

  // ── 3. SSRF security check ─────────────────────────────────────────────────
  // Reuses the existing validateTargetUrl() — no new SSRF logic here.
  const securityCheck = await validateTargetUrl(url);
  if (!securityCheck.safe) {
    return res.status(400).json({
      success: false,
      error: "Target URL is not allowed",
    });
  }

  // ── 4. Crawl option validation ─────────────────────────────────────────────
  const optionValidationError = _validateOptions(options);
  if (optionValidationError) {
    return res.status(400).json({
      success: false,
      error: optionValidationError,
    });
  }

  // ── 5. Apply defaults ──────────────────────────────────────────────────────
  const resolvedOptions = _applyDefaults(options);

  // ── 6. Run crawl ───────────────────────────────────────────────────────────
  try {
    const crawlResult = await runCrawl(url, resolvedOptions);
    return res.json(crawlResult);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the crawl options object.
 * Returns an error string if invalid, or null if all values are acceptable.
 *
 * @param {Object} options
 * @returns {string|null}
 */
function _validateOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    return "options must be a plain object";
  }

  // maxPages
  if (options.maxPages !== undefined) {
    if (
      !Number.isInteger(options.maxPages) ||
      options.maxPages < MIN_ALLOWED_PAGES ||
      options.maxPages > MAX_ALLOWED_PAGES
    ) {
      return `maxPages must be an integer between ${MIN_ALLOWED_PAGES} and ${MAX_ALLOWED_PAGES}`;
    }
  }

  // maxDepth
  if (options.maxDepth !== undefined) {
    if (
      !Number.isInteger(options.maxDepth) ||
      options.maxDepth < MIN_ALLOWED_DEPTH ||
      options.maxDepth > MAX_ALLOWED_DEPTH
    ) {
      return `maxDepth must be an integer between ${MIN_ALLOWED_DEPTH} and ${MAX_ALLOWED_DEPTH}`;
    }
  }

  // concurrency
  if (options.concurrency !== undefined) {
    if (
      !Number.isInteger(options.concurrency) ||
      options.concurrency < MIN_ALLOWED_CONCURRENCY ||
      options.concurrency > MAX_ALLOWED_CONCURRENCY
    ) {
      return `concurrency must be an integer between ${MIN_ALLOWED_CONCURRENCY} and ${MAX_ALLOWED_CONCURRENCY}`;
    }
  }

  // runLighthouse
  if (options.runLighthouse !== undefined) {
    if (typeof options.runLighthouse !== "boolean") {
      return "runLighthouse must be a boolean";
    }
  }

  return null;
}

/**
 * Merges caller-supplied options with system defaults.
 *
 * @param {Object} options - Caller-supplied options (already validated).
 * @returns {{ maxPages: number, maxDepth: number, concurrency: number, runLighthouse: boolean }}
 */
function _applyDefaults(options) {
  return {
    maxPages:      options.maxPages      ?? CRAWLER_MAX_PAGES,
    maxDepth:      options.maxDepth      ?? CRAWLER_MAX_DEPTH,
    concurrency:   options.concurrency   ?? CRAWLER_CONCURRENCY,
    runLighthouse: options.runLighthouse ?? false,
  };
}

module.exports = {
  crawlWebsite,
};
