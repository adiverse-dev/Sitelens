"use strict";

const assert = require("assert");
const { aggregateSiteResults } = require("../src/utils/siteAggregator");

async function runTests() {
  console.log("\n=== PHASE 5.7 — Site Aggregation Tests ===\n");
  let passed = 0;
  let failed = 0;

  function runTest(label, testFn) {
    try {
      testFn();
      console.log(`  ✓ ${label}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${label}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  const baseCrawlMeta = {
    pagesDiscovered: 0,
    pagesCrawled: 0,
    pagesSkipped: 0,
    limitHit: null,
    options: { maxPages: 10, maxDepth: 2, concurrency: 2 }
  };

  runTest("Test 1: Empty crawl", () => {
    const res = aggregateSiteResults([], baseCrawlMeta);
    assert.strictEqual(res.pages.discovered, 0);
    assert.strictEqual(res.pages.crawled, 0);
    assert.strictEqual(res.pages.succeeded, 0);
    assert.strictEqual(res.pages.failed, 0);
  });

  runTest("Test 2: One successful page", () => {
    const res = aggregateSiteResults([{ status: "success" }], { ...baseCrawlMeta, pagesDiscovered: 1, pagesCrawled: 1 });
    assert.strictEqual(res.pages.discovered, 1);
    assert.strictEqual(res.pages.crawled, 1);
    assert.strictEqual(res.pages.succeeded, 1);
    assert.strictEqual(res.pages.failed, 0);
  });

  runTest("Test 3: Mixed success/failure", () => {
    const pages = [{ status: "success" }, { status: "success" }, { status: "failed" }];
    const res = aggregateSiteResults(pages, { ...baseCrawlMeta, pagesDiscovered: 3, pagesCrawled: 3 });
    assert.strictEqual(res.pages.discovered, 3);
    assert.strictEqual(res.pages.crawled, 3);
    assert.strictEqual(res.pages.succeeded, 2);
    assert.strictEqual(res.pages.failed, 1);
  });

  runTest("Test 4: Missing meta description aggregation", () => {
    const pages = [
      { status: "success", seo: { metaDescription: { exists: false } } },
      { status: "success", seo: { metaDescription: { exists: false } } },
      { status: "success", seo: { metaDescription: { exists: true } } }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.issues.missingMetaDescriptionPages, 2);
  });

  runTest("Test 5: Missing H1 aggregation", () => {
    const pages = [
      { status: "success", seo: { h1: { count: 0 } } },
      { status: "success", seo: { h1: { count: 2 } } },
      { status: "success", seo: { h1: { count: 1 } } }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.issues.missingH1Pages, 1);
    assert.strictEqual(res.issues.multipleH1Pages, 1);
  });

  runTest("Test 6: Canonical issues", () => {
    const pages = [
      { status: "success", canonical: { exists: false } },
      { status: "success", canonical: { exists: true, isValidUrl: false } },
      { status: "success", canonical: { exists: true, multipleCanonicals: true } },
      { status: "success", canonical: { exists: true, isValidUrl: true, multipleCanonicals: false } }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.issues.canonicalIssues, 3);
  });

  runTest("Test 7: Image aggregation", () => {
    const pages = [
      { status: "success", images: { total: 10, withAlt: 8, missingAlt: 2 } },
      { status: "success", images: { total: 5, withAlt: 4, missingAlt: 1 } }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.images.total, 15);
    assert.strictEqual(res.images.withAlt, 12);
    assert.strictEqual(res.images.missingAlt, 3);
  });

  runTest("Test 8: Recommendations by severity", () => {
    const pages = [
      {
        status: "success", recommendations: [
          { severity: "High" }, { severity: "high" }, { severity: "MEDIUM" }, { severity: "low" }
        ]
      }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.recommendations.bySeverity.high, 2);
    assert.strictEqual(res.recommendations.bySeverity.medium, 1);
    assert.strictEqual(res.recommendations.bySeverity.low, 1);
    assert.strictEqual(res.recommendations.total, 4);
  });

  runTest("Test 9: Recommendations by issue", () => {
    const pages = [
      { status: "success", recommendations: [{ issue: "A" }, { issue: "A" }, { issue: "B" }] }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.recommendations.issueCounts["A"], 2);
    assert.strictEqual(res.recommendations.issueCounts["B"], 1);
  });

  runTest("Test 10: Recommendations by category", () => {
    const pages = [
      { status: "success", recommendations: [{ category: "SEO" }, { category: "SEO" }, { category: "Performance" }] }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.recommendations.byCategory["SEO"], 2);
    assert.strictEqual(res.recommendations.byCategory["Performance"], 1);
  });

  runTest("Test 11: Lighthouse averages", () => {
    const pages = [
      { status: "success", lighthouse: { performance: 90, accessibility: 100 } },
      { status: "success", lighthouse: { performance: 80 } }, // mixed availability
      { status: "success", lighthouse: null } // null ignored
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.lighthouse.performance.average, 85);
    assert.strictEqual(res.lighthouse.accessibility.average, 100);
    assert.strictEqual(res.lighthouse.performance.availablePages, 2);
    assert.strictEqual(res.lighthouse.accessibility.availablePages, 1);
    assert.strictEqual(res.lighthouse.seo.average, null);
  });

  runTest("Test 12: Load time statistics", () => {
    const pages = [
      { status: "success", loadTime: 400 },
      { status: "success", loadTime: 600 },
      { status: "failed" }, // Should be ignored
      { status: "success" } // No load time, ignored
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.performance.loadTime.averageMs, 500);
    assert.strictEqual(res.performance.loadTime.minMs, 400);
    assert.strictEqual(res.performance.loadTime.maxMs, 600);
    assert.strictEqual(res.performance.loadTime.pagesWithLoadTime, 2);
  });

  runTest("Test 13: Console/failed request totals", () => {
    const pages = [
      { status: "success", consoleErrors: ["E1", "E2"], failedRequests: ["R1"] },
      { status: "success", consoleErrors: ["E3"] },
      { status: "success", consoleErrors: [] }
    ];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.reliability.totalConsoleErrors, 3);
    assert.strictEqual(res.reliability.pagesWithConsoleErrors, 2);
    assert.strictEqual(res.reliability.totalFailedRequests, 1);
    assert.strictEqual(res.reliability.pagesWithFailedRequests, 1);
  });

  runTest("Test 14: Blocked request totals", () => {
    const pages = [{ status: "success", blockedRequests: ["B1", "B2"] }];
    const res = aggregateSiteResults(pages, baseCrawlMeta);
    assert.strictEqual(res.reliability.totalBlockedRequests, 2);
    assert.strictEqual(res.reliability.pagesWithBlockedRequests, 1);
  });

  runTest("Test 15: No mutation", () => {
    const page = { status: "success", loadTime: 100 };
    const pageStr = JSON.stringify(page);
    aggregateSiteResults([page], baseCrawlMeta);
    assert.strictEqual(JSON.stringify(page), pageStr);
  });

  runTest("Test 16: Missing/null fields", () => {
    const pages = [{ status: "success" }, { status: "failed" }, null, undefined];
    const res = aggregateSiteResults(pages.filter(Boolean), baseCrawlMeta);
    assert.strictEqual(res.pages.succeeded, 1);
    assert.strictEqual(res.pages.failed, 1);
    assert.strictEqual(res.lighthouse.performance.average, null);
    assert.strictEqual(res.performance.loadTime.averageMs, null);
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
