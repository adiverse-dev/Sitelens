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
  LINK_CHECK_MAX_TARGETS,
  LINK_CHECK_CONCURRENCY,
  CRAWLER_REQUEST_TIMEOUT_MS,
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
const { applyLinkChecks } = require("./linkChecker.service");

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
 * @property {Object}       linkChecks - Phase 6B unique-target check summary.
 * @property {Object[]}     pages      - Per-page audit results (Phase 5.6).
 */

/**
 * @typedef {Object} DiscoveredLinks
 * @property {Object[]} internal  - Crawl-policy-approved HTTP/HTTPS records.
 * @property {Object[]} external  - Usable HTTP/HTTPS records outside policy.
 * @property {Object[]} discarded - Unusable records with deterministic reasons.
 * @property {{ internal: number, external: number, discarded: number }} summary
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
 * @param {Object} [dependencies] - Internal dependency injection for offline tests.
 * @returns {Promise<CrawlResult>}
 */
async function runCrawl(seedUrl, options, dependencies = {}) {
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

  const pages = Array.from(state.results.values());
  const linkChecks = await applyLinkChecks(
    pages,
    {},
    { checkTarget: dependencies.checkLinkTarget }
  );
  const completedAt = Date.now();

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
      linkChecks,
      pages,
  };
}

/**
 * Discover and classify all anchor links on the currently loaded Playwright page.
 *
 * Phase 5.2 — URL Discovery.
 *
 * This function extracts link evidence, resolves and normalizes usable targets,
 * and classifies them with the same crawl policy used for queue admission.
 *
 * Security note:
 *   This function performs ONLY string inspection — no fetch(), no page.goto(),
 *   no network activity.  SSRF validation of discovered URLs happens later
 *   (Phase 5.4/5.5) before any URL is actually audited.
 *
 * Deduplication note:
 *   Link records preserve every DOM occurrence. Queue candidates are deduplicated
 *   separately by normalized URL.
 *
 * @param {import('playwright').Page} page    - A Playwright Page that has already
 *                                              navigated to the target URL.
 * @param {string}                    sourceUrl - Absolute URL of the current page.
 * @param {string}                    seedUrl   - Normalized crawl seed URL.
 * @param {CrawlOptions}              options   - Crawl policy options.
 * @returns {Promise<DiscoveredLinks>}
 */
async function discoverLinks(page, sourceUrl, seedUrl = sourceUrl, options = {}) {
  // Extract raw href strings from the DOM — pure string data, no network calls.
  const extractedLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      rawHref: anchor.getAttribute("href") ?? "",
      anchorText: anchor.textContent ?? "",
      rel: anchor.getAttribute("rel") ?? "",
    }))
  );

  let sourceIsValid = true;
  try {
    new URL(sourceUrl);
  } catch (_) {
    // Preserve evidence but mark every record unusable if the source is invalid.
    sourceIsValid = false;
  }

  const internal = [];
  const external = [];
  const discarded = [];

  for (const extractedLink of extractedLinks) {
    const record = sourceIsValid
      ? _createLinkRecord(extractedLink, sourceUrl, seedUrl, options)
      : _createDiscardedLinkRecord(extractedLink, sourceUrl, "invalid-source-url");

    if (record.classification === "internal") internal.push(record);
    else if (record.classification === "external") external.push(record);
    else discarded.push(record);
  }

  return {
    internal,
    external,
    discarded,
    summary: {
      internal: internal.length,
      external: external.length,
      discarded: discarded.length,
    },
  };
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
    const sourceUrl = browserSession.page.url() || entry.url;
    const links = await discoverLinks(
      browserSession.page,
      sourceUrl,
      seedUrl,
      options
    );
    
    // Queue normalized internal targets once while preserving every link record.
    const queueCandidates = new Set(
      links.internal.map((link) => link.normalizedUrl).filter(Boolean)
    );

    for (const normalizedUrl of queueCandidates) {
      const securityCheck = await validateTargetUrl(normalizedUrl);
      if (!securityCheck.safe) continue;

      enqueue(state, normalizedUrl, entry.depth + 1, options);
    }

    state.results.set(entry.url, {
      url: entry.url,
      depth: entry.depth,
      status: "success",
      ...pageAudit,
      lighthouse,
      links,
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
    linkChecks: {
      uniqueTargets: 0,
      processedTargets: 0,
      uncheckedTargets: 0,
      limitHit: false,
      limits: {
        maxTargets: LINK_CHECK_MAX_TARGETS,
        concurrency: LINK_CHECK_CONCURRENCY,
        timeoutMs: CRAWLER_REQUEST_TIMEOUT_MS,
      },
    },
    pages: [],        // Phase 5.6
  };
}

/** Normalize human-readable DOM text to a stable single-line value. */
function _normalizeWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function _normalizeRelTokens(value) {
  if (typeof value !== "string") return [];

  return Array.from(
    new Set(value.toLowerCase().split(/\s+/).filter(Boolean))
  );
}

function _createDiscardedLinkRecord(extractedLink, sourceUrl, reason) {
  const rel = _normalizeRelTokens(extractedLink.rel);

  return {
    sourceUrl,
    rawHref: typeof extractedLink.rawHref === "string" ? extractedLink.rawHref : "",
    targetUrl: null,
    normalizedUrl: null,
    anchorText: _normalizeWhitespace(extractedLink.anchorText),
    rel,
    nofollow: rel.includes("nofollow"),
    reason,
  };
}

function _createLinkRecord(extractedLink, sourceUrl, seedUrl, options) {
  const rawHref = typeof extractedLink.rawHref === "string"
    ? extractedLink.rawHref
    : "";
  const trimmedHref = rawHref.trim();

  if (!trimmedHref) {
    return _createDiscardedLinkRecord(extractedLink, sourceUrl, "empty-href");
  }

  if (trimmedHref.startsWith("#")) {
    return _createDiscardedLinkRecord(extractedLink, sourceUrl, "fragment-only");
  }

  let target;
  try {
    target = new URL(trimmedHref, sourceUrl);
  } catch (_) {
    return _createDiscardedLinkRecord(extractedLink, sourceUrl, "malformed-url");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return _createDiscardedLinkRecord(extractedLink, sourceUrl, "unsupported-scheme");
  }

  const targetUrl = target.href;
  const normalizedUrl = normalizeUrl(targetUrl);
  if (!normalizedUrl) {
    return _createDiscardedLinkRecord(extractedLink, sourceUrl, "malformed-url");
  }

  const policy = isAllowedByPolicy(normalizedUrl, seedUrl, options);
  const classification = policy.allowed ? "internal" : "external";
  const rel = _normalizeRelTokens(extractedLink.rel);

  return {
    sourceUrl,
    rawHref,
    targetUrl,
    normalizedUrl,
    anchorText: _normalizeWhitespace(extractedLink.anchorText),
    classification,
    rel,
    nofollow: rel.includes("nofollow"),
  };
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
