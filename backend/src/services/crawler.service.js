/**
 * crawler.service.js
 *
 * Phase 5 — Multi-Page Crawler Orchestrator
 *
 * This service owns the complete crawl lifecycle:
 *
 *   seed URL
 *     ↓
 *   URL discovery       (Phase 5.2)
 *     ↓
 *   URL normalization   (Phase 5.3)
 *     ↓
 *   same-domain policy  (Phase 5.4)
 *     ↓
 *   in-memory queue     (Phase 5.5)
 *     ↓
 *   concurrency pool    (Phase 5.6)
 *     ↓
 *   per-page audit      (Phase 5.6 — reuses browserAudit.service.js)
 *     ↓
 *   result collection   (Phase 5.6)
 *     ↓
 *   site-wide aggregate (Phase 5.7)
 *     ↓
 *   CrawlResult
 *
 * IMPORTANT ARCHITECTURAL RULE:
 *   This service is the ORCHESTRATOR.
 *   It decides which pages to audit and when.
 *   It does NOT implement page-level HTML parsing, Playwright sessions,
 *   Lighthouse runs, or SSRF guards — those remain in their own services.
 *
 * Phase 5.1 scope:
 *   - Document function contracts with JSDoc.
 *   - Return a stub CrawlResult so the endpoint is reachable and testable.
 *   - Do NOT perform real crawling yet.
 */

const {
  CRAWLER_MAX_PAGES,
  CRAWLER_MAX_DEPTH,
  CRAWLER_CONCURRENCY,
} = require("../utils/constants");
const { normalizeUrl, dedupeUrls } = require("../utils/urlNormalizer");
const { isAllowedByPolicy } = require("../utils/crawlPolicy");
const { validateTargetUrl } = require("../utils/urlValidator");
const { launchAuditBrowser, collectPageAudit } = require("./browserAudit.service");
const { runLighthouseAudit, createFailedLighthouseResult } = require("./lighthouseAudit.service");
const { auditRobotsTxt } = require("./robotsAudit.service");
const { auditSitemap } = require("./sitemapAudit.service");
const { aggregateSiteResults } = require("../utils/siteAggregator");
const { Semaphore } = require("../utils/semaphore");

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CrawlOptions
 * @property {number}  maxPages      - Maximum number of pages to audit.
 * @property {number}  maxDepth      - Maximum link depth from seed (seed = 0).
 * @property {number}  concurrency   - Max concurrent page audits.
 * @property {boolean} runLighthouse - Whether to run Lighthouse on crawled pages.
 *                                     Defaults to false in crawl mode to avoid
 *                                     resource exhaustion.  Individual page audits
 *                                     via POST /audit always run Lighthouse.
 */

/**
 * @typedef {Object} QueueEntry
 * @property {string} url   - Normalized absolute URL.
 * @property {number} depth - Depth from seed URL (seed = 0).
 */

/**
 * @typedef {Object} FailEntry
 * @property {string} url     - The URL that failed.
 * @property {string} reason  - Human-readable failure reason.
 * @property {number} depth   - Depth at which the failure occurred.
 */

/**
 * @typedef {Object} CrawlState
 *
 * The in-memory state maintained throughout a single crawl run.
 * All fields are managed exclusively by the crawler — callers must not mutate.
 *
 * @property {QueueEntry[]}       queue        - Pending URLs awaiting audit (FIFO).
 * @property {number}             queueIndex   - Index for O(1) dequeue operations.
 * @property {Set<string>}        visited      - Normalized URLs already enqueued or
 *                                               completed.  Used for deduplication.
 * @property {Map<string, Object>} results     - Per-page audit results keyed by
 *                                               normalized URL.
 * @property {FailEntry[]}        failed       - URLs that could not be audited.
 * @property {number}             pagesCrawled - Number of pages fully processed.
 */

/**
 * @typedef {Object} CrawlSummary
 * @property {string}  status          - "planned" | "running" | "complete" | "failed"
 * @property {number}  pagesDiscovered - Total unique same-domain URLs found.
 * @property {number}  pagesCrawled    - Pages successfully audited.
 * @property {number}  pagesFailed     - Pages that threw an error during audit.
 * @property {number}  pagesSkipped    - Pages excluded by policy or limits.
 * @property {number|null} maxDepthReached - Deepest depth actually visited.
 * @property {string|null} limitHit    - "pages" | "depth" | null
 */

/**
 * @typedef {Object} CrawlResult
 * @property {boolean}      success    - Always true for a complete crawl result.
 * @property {string}       mode       - Always "crawl".
 * @property {string}       seedUrl    - The URL the crawl started from.
 * @property {CrawlSummary} crawl      - High-level crawl statistics.
 * @property {Object|null}  siteWide   - Site-level aggregation (Phase 5.7).
 * @property {Object[]}     pages      - Per-page audit results (Phase 5.6).
 */

/**
 * @typedef {Object} DiscoveredLinks
 *
 * The categorized result of link discovery on a single page.
 *
 * IMPORTANT — Phase 5.2 semantics:
 *   - No normalization is applied (trailing slashes, query params, fragments
 *     are preserved as-is). Normalization is Phase 5.3.
 *   - No deduplication is performed. The same URL may appear more than once
 *     if the page links to it multiple times. Deduplication is Phase 5.5.
 *   - Same-domain classification is based solely on hostname comparison
 *     against the seed's hostname. The final crawl policy (subdomain rules,
 *     www-equivalence) is Phase 5.4.
 *
 * @property {string[]} sameDomain - Resolved absolute URLs whose hostname
 *                                   exactly matches the seed hostname.
 * @property {string[]} external   - Valid HTTP/HTTPS URLs pointing to a
 *                                   different hostname. Recorded but NOT crawled.
 * @property {string[]} discarded  - Raw href values that cannot be crawled:
 *                                   mailto:, tel:, javascript:, data:, blob:,
 *                                   empty, fragment-only, or malformed.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a multi-page crawl starting from `seedUrl`.
 *
 * Phase 5.1 — STUB:
 *   Returns a valid CrawlResult shape with status "planned".
 *   No browser is launched. No URLs are visited. No links are discovered.
 *
 * Future phases will replace the body of this function progressively:
 *   5.2 — Link discovery added inside audit loop.
 *   5.3 — URL normalization applied to every discovered link.
 *   5.4 — Same-domain policy applied before enqueueing.
 *   5.5 — Queue + depth/page limit state machine implemented.
 *   5.6 — Semaphore concurrency + real per-page audits connected.
 *   5.7 — Site-wide aggregation computed from page results.
 *   5.8 — Full security audit + regression tests.
 *
 * @param {string}      seedUrl - The starting URL for the crawl.
 *                                Must already be validated by the controller.
 * @param {CrawlOptions} options - Crawl configuration with defaults applied.
 * @returns {Promise<CrawlResult>}
 */
async function runCrawl(seedUrl, options) {
  const resolvedOptions = _resolveOptions(options);
  const startTime = Date.now();

  // 1. Normalize seed
  const normalizedSeed = normalizeUrl(seedUrl, seedUrl);
  if (!normalizedSeed) {
    return _buildStubResult(seedUrl, resolvedOptions, "failed");
  }

  // 2. Validate seed
  const securityCheck = await validateTargetUrl(normalizedSeed);
  if (!securityCheck.safe) {
    return _buildStubResult(seedUrl, resolvedOptions, "failed");
  }

  // 3. Apply crawl policy
  const policyCheck = isAllowedByPolicy(normalizedSeed, normalizedSeed, resolvedOptions);
  if (!policyCheck.allowed) {
    return _buildStubResult(seedUrl, resolvedOptions, "failed");
  }

  // 4. Create fresh state
  const state = createCrawlState();
  enqueue(state, normalizedSeed, 0, resolvedOptions);

  const semaphore = new Semaphore(resolvedOptions.concurrency);
  const activeWorkers = new Set();
  
  // 10. Site-level robots + sitemap
  const robots = await auditRobotsTxt(normalizedSeed).catch(() => ({ issues: [] }));
  const sitemap = await auditSitemap(normalizedSeed, robots).catch(() => ({ issues: [] }));

  // Worker Loop
  await new Promise((resolve) => {
    const checkDone = () => {
      const stop = shouldStop(state, resolvedOptions);
      if (stop.stop && activeWorkers.size === 0) {
        resolve();
      } else if (!stop.stop) {
        pump();
      }
    };

    const pump = async () => {
      const stop = shouldStop(state, resolvedOptions);
      if (stop.stop) return; // Halt pulling if capacity reached

      const entry = dequeue(state);
      if (!entry) return; // Queue might temporarily run dry while waiting on workers

      const workerPromise = (async () => {
        await semaphore.acquire();
        try {
          await _processUrl(entry, state, resolvedOptions, normalizedSeed);
        } finally {
          semaphore.release();
          activeWorkers.delete(workerPromise);
          checkDone();
        }
      })();

      activeWorkers.add(workerPromise);
      pump(); // Loop immediately to saturate semaphore
    };

    pump(); // Start the engine
  });

  const completedAt = Date.now();

    const pages = Array.from(state.results.values());
    const siteWide = aggregateSiteResults(pages, {
      pagesDiscovered: state.visited.size,
      pagesCrawled: state.pagesCrawled,
      pagesSkipped: 0,
      limitHit: state.pagesCrawled >= resolvedOptions.maxPages ? "pages" : null,
      options: resolvedOptions,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startTime,
    }, { robots, sitemap });

    return {
      success: true,
      mode: "crawl",
      seedUrl,
      options: resolvedOptions,
      crawl: {
        status: "completed",
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - startTime,
        pagesDiscovered: state.visited.size,
        pagesCrawled: state.pagesCrawled,
        pagesFailed: state.failed.length,
        pagesSkipped: 0,
        limitHit: state.pagesCrawled >= resolvedOptions.maxPages ? "pages" : null,
      },
      siteWide,
      pages,
    };
  }

/**
 * Discover and classify all anchor links on the currently loaded Playwright page.
 *
 * Phase 5.2 — URL Discovery.
 *
 * This function:
 *   1. Uses page.evaluate() to extract raw href strings from every <a> element.
 *   2. Resolves relative hrefs to absolute URLs using the page's baseUrl.
 *   3. Classifies each resolved URL into one of three buckets:
 *        sameDomain — same hostname as baseUrl (candidate for crawling).
 *        external   — valid HTTP/HTTPS but different hostname (recorded, not crawled).
 *        discarded  — uncrawlable (mailto:, tel:, javascript:, empty, fragment-only…).
 *
 * Security note:
 *   This function performs ONLY string inspection — no fetch(), no page.goto(),
 *   no network activity.  SSRF validation of discovered URLs happens later
 *   (Phase 5.4/5.5) before any URL is actually audited.
 *
 * Normalization note:
 *   Raw resolved URLs are returned as-is (fragments, trailing slashes, and
 *   query parameters are preserved).  URL normalization is Phase 5.3.
 *
 * Deduplication note:
 *   If the page links to the same URL multiple times, it will appear multiple
 *   times in the returned arrays.  Deduplication is Phase 5.5.
 *
 * @param {import('playwright').Page} page    - A Playwright Page that has already
 *                                              navigated to the target URL.
 * @param {string}                    baseUrl - The absolute URL of the current page.
 *                                              Used to resolve relative hrefs and to
 *                                              determine the "same domain" hostname.
 * @returns {Promise<DiscoveredLinks>}
 */
async function discoverLinks(page, baseUrl) {
  // Extract raw href strings from the DOM — pure string data, no network calls.
  const rawHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
  );

  let seedHostname;
  try {
    seedHostname = new URL(baseUrl).hostname;
  } catch (_) {
    // baseUrl is malformed — return everything as discarded.
    return { sameDomain: [], external: [], discarded: rawHrefs };
  }

  const sameDomain = [];
  const external   = [];
  const discarded  = [];

  for (const rawHref of rawHrefs) {
    const { bucket, resolved } = _classifyHref(rawHref, baseUrl, seedHostname);

    if (bucket === "sameDomain") sameDomain.push(resolved);
    else if (bucket === "external")   external.push(resolved);
    else                              discarded.push(rawHref); // keep raw for diagnostics
  }

  return { sameDomain, external, discarded };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function _processUrl(entry, state, options, seedUrl) {
  let browserSession;
  try {
    browserSession = await launchAuditBrowser();
    
    // Perform audit
    const pageAudit = await collectPageAudit(browserSession.page, entry.url);
    state.pagesCrawled++;
    
    // Lighthouse
    let lighthouse = null;
    if (options.runLighthouse) {
      lighthouse = await runLighthouseAudit(entry.url, browserSession.remoteDebuggingPort)
        .catch(createFailedLighthouseResult);
    }

    // Discover links
    const links = await discoverLinks(browserSession.page, entry.url);
    
    // Filter & Enqueue
    for (const rawLink of links.sameDomain) {
      const norm = normalizeUrl(rawLink, entry.url);
      if (!norm) continue;
      
      const policy = isAllowedByPolicy(norm, seedUrl, options);
      if (policy.allowed) {
        enqueue(state, norm, entry.depth + 1, options);
      }
    }

    state.results.set(entry.url, {
      url: entry.url,
      depth: entry.depth,
      status: "success",
      ...pageAudit,
      lighthouse,
    });

  } catch (err) {
    state.failed.push({ url: entry.url, depth: entry.depth, error: err.message });
    state.results.set(entry.url, {
      url: entry.url,
      depth: entry.depth,
      status: "failed",
      error: err.message,
    });
  } finally {
    if (browserSession && browserSession.browser) {
      await browserSession.browser.close().catch(() => {});
    }
  }
}

// ── Phase 5.5 Queue Helpers ──────────────────────────────────────────────────

/**
 * Creates a fresh in-memory crawl state.
 * @returns {CrawlState}
 */
function createCrawlState() {
  return {
    queue: [],
    queueIndex: 0,
    visited: new Set(),
    results: new Map(),
    failed: [],
    pagesCrawled: 0,
  };
}

/**
 * Validates and enqueues a URL if allowed by depth and capacity limits.
 *
 * @param {CrawlState} state
 * @param {string} url - Normalized URL.
 * @param {number} depth - Depth of the URL from seed.
 * @param {CrawlOptions} [options={}]
 * @returns {{ enqueued: boolean, reason: string }}
 */
function enqueue(state, url, depth, options = {}) {
  const maxDepth = options.maxDepth ?? CRAWLER_MAX_DEPTH;
  const maxPages = options.maxPages ?? CRAWLER_MAX_PAGES;

  if (!url || typeof url !== "string") {
    return { enqueued: false, reason: "invalid-url" };
  }

  if (state.visited.has(url)) {
    return { enqueued: false, reason: "already-visited" };
  }

  if (depth > maxDepth) {
    return { enqueued: false, reason: "max-depth-exceeded" };
  }

  // Ensure capacity exists: visited set tracks all entered URLs
  if (state.visited.size >= maxPages) {
    return { enqueued: false, reason: "max-pages-reached" };
  }

  state.queue.push({ url, depth });
  state.visited.add(url);
  
  return { enqueued: true, reason: "queued" };
}

/**
 * Dequeues the next URL from the queue using an O(1) index strategy.
 *
 * @param {CrawlState} state
 * @returns {QueueEntry|null}
 */
function dequeue(state) {
  if (state.queueIndex < state.queue.length) {
    const entry = state.queue[state.queueIndex];
    state.queueIndex++;
    return entry;
  }
  return null;
}

/**
 * Determines if the crawl should halt based on capacity or queue state.
 *
 * @param {CrawlState} state
 * @param {CrawlOptions} [options={}]
 * @returns {{ stop: boolean, reason?: string }}
 */
function shouldStop(state, options = {}) {
  const maxPages = options.maxPages ?? CRAWLER_MAX_PAGES;

  if (state.pagesCrawled >= maxPages) {
    return { stop: true, reason: "max-pages" };
  }
  
  if (state.queueIndex >= state.queue.length) {
    return { stop: true, reason: "queue-empty" };
  }

  return { stop: false };
}

// ── Configuration & Stub Helpers ─────────────────────────────────────────────

/**
 * Merges caller-supplied options with approved defaults.
 *
 * @param {Partial<CrawlOptions>} options
 * @returns {CrawlOptions}
 */
function _resolveOptions(options = {}) {
  return {
    maxPages:      options.maxPages      ?? CRAWLER_MAX_PAGES,
    maxDepth:      options.maxDepth      ?? CRAWLER_MAX_DEPTH,
    concurrency:   options.concurrency   ?? CRAWLER_CONCURRENCY,
    runLighthouse: options.runLighthouse ?? false,
  };
}

/**
 * Builds the Phase 5.1 stub CrawlResult.
 *
 * @param {string}       seedUrl
 * @param {CrawlOptions} options
 * @param {string}       [status="planned"]
 * @returns {CrawlResult}
 */
function _buildStubResult(seedUrl, options, status = "planned") {
  return {
    success: true,
    mode: "crawl",
    seedUrl,
    options: {
      maxPages:      options.maxPages,
      maxDepth:      options.maxDepth,
      concurrency:   options.concurrency,
      runLighthouse: options.runLighthouse,
    },
    crawl: {
      status,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      pagesFailed: 0,
      pagesSkipped: 0,
      maxDepthReached: null,
      limitHit: null,
    },
    siteWide: null,   // Phase 5.7
    pages: [],        // Phase 5.6
  };
}

/**
 * Classify a single raw href value.
 *
 * @param {string} rawHref      - The href string taken directly from the DOM.
 * @param {string} baseUrl      - The absolute URL of the page (for relative resolution).
 * @param {string} seedHostname - Hostname extracted from baseUrl.
 * @returns {{ bucket: 'sameDomain'|'external'|'discard', resolved: string }}
 */
function _classifyHref(rawHref, baseUrl, seedHostname) {
  const trimmed = (rawHref || "").trim();

  // ── Empty href ────────────────────────────────────────────────────────────
  if (!trimmed) {
    return { bucket: "discard", resolved: trimmed };
  }

  // ── Fragment-only (e.g. "#section", "#") ─────────────────────────────────
  if (trimmed.startsWith("#")) {
    return { bucket: "discard", resolved: trimmed };
  }

  // ── Non-HTTP schemes that can never be crawled ────────────────────────────
  // Checked before URL resolution so that "mailto:x" doesn't accidentally
  // resolve against baseUrl (it wouldn't, but explicit is safer).
  const lowerTrimmed = trimmed.toLowerCase();
  const DISCARD_SCHEMES = ["mailto:", "tel:", "javascript:", "data:", "blob:", "sms:", "ftp:"];
  for (const scheme of DISCARD_SCHEMES) {
    if (lowerTrimmed.startsWith(scheme)) {
      return { bucket: "discard", resolved: trimmed };
    }
  }

  // ── Attempt URL resolution ────────────────────────────────────────────────
  let resolved;
  try {
    resolved = new URL(trimmed, baseUrl).href;
  } catch (_) {
    // Malformed — cannot be crawled.
    return { bucket: "discard", resolved: trimmed };
  }

  // ── After resolution, only HTTP/HTTPS are crawlable ──────────────────────
  let parsedResolved;
  try {
    parsedResolved = new URL(resolved);
  } catch (_) {
    return { bucket: "discard", resolved: trimmed };
  }

  if (parsedResolved.protocol !== "http:" && parsedResolved.protocol !== "https:") {
    return { bucket: "discard", resolved: trimmed };
  }

  // ── Classify by hostname ──────────────────────────────────────────────────
  // Phase 5.2: exact hostname match only.
  // Phase 5.4 will refine this with www-equivalence and subdomain policy.
  if (parsedResolved.hostname === seedHostname) {
    return { bucket: "sameDomain", resolved };
  }

  return { bucket: "external", resolved };
}

module.exports = {
  runCrawl,
  discoverLinks,
  normalizeUrl,
  dedupeUrls,
  isAllowedByPolicy,
  createCrawlState,
  enqueue,
  dequeue,
  shouldStop,
};
