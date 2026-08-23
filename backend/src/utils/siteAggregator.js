/**
 * src/utils/siteAggregator.js
 *
 * Phase 5.7 - Site-Wide Result Aggregation
 */

function aggregateSiteResults(pages, crawlMetadata, siteWideMetadata = { robots: null, sitemap: null }) {
  const summary = {
    pages: {
      discovered: crawlMetadata.pagesDiscovered || 0,
      crawled: crawlMetadata.pagesCrawled || 0,
      succeeded: 0,
      failed: 0,
      skipped: crawlMetadata.pagesSkipped || 0
    },
    issues: {
      missingH1Pages: 0,
      multipleH1Pages: 0,
      missingMetaDescriptionPages: 0,
      canonicalIssues: 0,
      headingHierarchyIssues: 0,
      indexabilityIssues: 0,
      openGraphIssues: 0,
      twitterCardIssues: 0
    },
    recommendations: {
      total: 0,
      bySeverity: {
        high: 0,
        medium: 0,
        low: 0
      },
      byCategory: {},
      issueCounts: {}
    },
    lighthouse: {
      performance: { availablePages: 0, average: null, _total: 0 },
      accessibility: { availablePages: 0, average: null, _total: 0 },
      bestPractices: { availablePages: 0, average: null, _total: 0 },
      seo: { availablePages: 0, average: null, _total: 0 },
      pwa: { availablePages: 0, average: null, _total: 0 }
    },
    performance: {
      loadTime: {
        averageMs: null,
        minMs: null,
        maxMs: null,
        pagesWithLoadTime: 0,
        _totalMs: 0
      }
    },
    images: {
      total: 0,
      withAlt: 0,
      missingAlt: 0
    },
    reliability: {
      totalConsoleErrors: 0,
      pagesWithConsoleErrors: 0,
      totalFailedRequests: 0,
      pagesWithFailedRequests: 0,
      totalBlockedRequests: 0,
      pagesWithBlockedRequests: 0
    },
    crawlLimits: {
      maxPages: crawlMetadata.options?.maxPages ?? null,
      maxDepth: crawlMetadata.options?.maxDepth ?? null,
      concurrency: crawlMetadata.options?.concurrency ?? null,
      limitHit: crawlMetadata.limitHit ?? null,
      durationMs: crawlMetadata.durationMs ?? null,
      startedAt: crawlMetadata.startedAt ?? null,
      completedAt: crawlMetadata.completedAt ?? null
    },
    robots: siteWideMetadata.robots,
    sitemap: siteWideMetadata.sitemap
  };

  if (!Array.isArray(pages)) return summary;

  for (const page of pages) {
    if (page.status === "success") {
      summary.pages.succeeded++;
    } else {
      summary.pages.failed++;
    }

    if (page.status !== "success") continue;

    if (page.seo?.h1) {
      if (page.seo.h1.count === 0) summary.issues.missingH1Pages++;
      if (page.seo.h1.count > 1) summary.issues.multipleH1Pages++;
    }
    if (page.seo?.metaDescription?.exists === false) {
      summary.issues.missingMetaDescriptionPages++;
    }
    if (page.canonical?.exists === false || page.canonical?.isValidUrl === false || page.canonical?.multipleCanonicals) {
      summary.issues.canonicalIssues++;
    }
    if (page.headingHierarchy?.valid === false) {
      summary.issues.headingHierarchyIssues++;
    }
    if (page.indexability?.indexable === false || (page.indexability?.issues && page.indexability.issues.length > 0)) {
      summary.issues.indexabilityIssues++;
    }
    if (page.openGraph?.exists === false || (page.openGraph?.missingFields && page.openGraph.missingFields.length > 0)) {
      summary.issues.openGraphIssues++;
    }
    if (page.twitterCard?.exists === false || (page.twitterCard?.missingFields && page.twitterCard.missingFields.length > 0)) {
      summary.issues.twitterCardIssues++;
    }

    if (Array.isArray(page.recommendations)) {
      for (const rec of page.recommendations) {
        summary.recommendations.total++;

        if (rec.severity && summary.recommendations.bySeverity[rec.severity.toLowerCase()] !== undefined) {
          summary.recommendations.bySeverity[rec.severity.toLowerCase()]++;
        }

        if (rec.category) {
          summary.recommendations.byCategory[rec.category] = (summary.recommendations.byCategory[rec.category] || 0) + 1;
        }

        if (rec.issue) {
          summary.recommendations.issueCounts[rec.issue] = (summary.recommendations.issueCounts[rec.issue] || 0) + 1;
        }
      }
    }

    if (page.lighthouse && typeof page.lighthouse === "object") {
      const lh = summary.lighthouse;
      const metrics = [
        { key: "performance", score: page.lighthouse.performance },
        { key: "accessibility", score: page.lighthouse.accessibility },
        { key: "bestPractices", score: page.lighthouse.bestPractices },
        { key: "seo", score: page.lighthouse.seo },
        { key: "pwa", score: page.lighthouse.pwa }
      ];

      for (const metric of metrics) {
        if (typeof metric.score === "number") {
          lh[metric.key].availablePages++;
          lh[metric.key]._total += metric.score;
        }
      }
    }

    if (typeof page.loadTime === "number") {
      const lt = summary.performance.loadTime;
      lt.pagesWithLoadTime++;
      lt._totalMs += page.loadTime;
      if (lt.minMs === null || page.loadTime < lt.minMs) lt.minMs = page.loadTime;
      if (lt.maxMs === null || page.loadTime > lt.maxMs) lt.maxMs = page.loadTime;
    }

    if (page.images) {
      summary.images.total += page.images.total || 0;
      summary.images.withAlt += page.images.withAlt || 0;
      summary.images.missingAlt += page.images.missingAlt || 0;
    }

    if (Array.isArray(page.consoleErrors) && page.consoleErrors.length > 0) {
      summary.reliability.totalConsoleErrors += page.consoleErrors.length;
      summary.reliability.pagesWithConsoleErrors++;
    }
    if (Array.isArray(page.failedRequests) && page.failedRequests.length > 0) {
      summary.reliability.totalFailedRequests += page.failedRequests.length;
      summary.reliability.pagesWithFailedRequests++;
    }
    if (Array.isArray(page.blockedRequests) && page.blockedRequests.length > 0) {
      summary.reliability.totalBlockedRequests += page.blockedRequests.length;
      summary.reliability.pagesWithBlockedRequests++;
    }
  }

  for (const key of Object.keys(summary.lighthouse)) {
    const cat = summary.lighthouse[key];
    if (cat.availablePages > 0) {
      cat.average = Math.round(cat._total / cat.availablePages);
    }
    delete cat._total;
  }

  if (summary.performance.loadTime.pagesWithLoadTime > 0) {
    const lt = summary.performance.loadTime;
    lt.averageMs = Math.round(lt._totalMs / lt.pagesWithLoadTime);
  }
  delete summary.performance.loadTime._totalMs;

  return summary;
}

module.exports = { aggregateSiteResults };
