"use strict";

const assert = require("assert");
const { aggregateLinkHealth } = require("../src/utils/linkHealthAggregator");

const BROKEN_VALUES = Object.freeze({
  healthy: false,
  redirected: false,
  restricted: false,
  broken: true,
  unreachable: null,
  blocked: null,
  unchecked: null,
});

function makeCheck(health, url, overrides = {}) {
  return {
    state: health === "redirected" ? "redirect" : "ok",
    statusCode: 200,
    responseTimeMs: 1,
    errorCode: null,
    errorMessage: null,
    location: null,
    redirected: health === "redirected",
    redirectCount: 0,
    redirectChain: [],
    finalUrl: url,
    finalStatusCode: 200,
    finalState: "ok",
    health,
    isBroken: BROKEN_VALUES[health],
    redirectProblem: null,
    ...overrides,
  };
}

function makeLink(normalizedUrl, classification, sourceUrl, anchorText, check) {
  return {
    normalizedUrl,
    classification,
    sourceUrl,
    anchorText,
    check,
  };
}

function makePage(url, { internal = [], external = [], discarded = [] } = {}) {
  return {
    url,
    status: "success",
    links: { internal, external, discarded },
  };
}

function findTarget(report, normalizedUrl) {
  return report.targets.find((target) => target.normalizedUrl === normalizedUrl);
}

function assertReconciled(report) {
  const healthTotal = Object.values(report.summary.byHealth)
    .reduce((total, count) => total + count, 0);
  assert.strictEqual(healthTotal, report.summary.uniqueTargets);
  assert.strictEqual(report.targets.length, report.summary.uniqueTargets);
  assert.strictEqual(
    report.targets.reduce((total, target) => total + target.occurrenceCount, 0),
    report.summary.totalOccurrences
  );
}

function runTests() {
  const empty = aggregateLinkHealth([]);
  assert.strictEqual(empty.summary.uniqueTargets, 0);
  assert.strictEqual(empty.summary.totalOccurrences, 0);
  assert.deepStrictEqual(empty.targets, []);
  assert.deepStrictEqual(empty.issues.broken, []);
  assertReconciled(empty);

  const noLinks = aggregateLinkHealth([makePage("https://site.test/")]);
  assert.deepStrictEqual(noLinks, empty);

  const internalUrl = "https://site.test/about";
  const externalUrl = "https://docs.test/guide";
  const basic = aggregateLinkHealth([makePage("https://site.test/", {
    internal: [makeLink(
      internalUrl,
      "internal",
      "https://site.test/",
      "About",
      makeCheck("healthy", internalUrl)
    )],
    external: [makeLink(
      externalUrl,
      "external",
      "https://site.test/",
      "Guide",
      makeCheck("healthy", externalUrl)
    )],
  })]);
  assert.strictEqual(basic.summary.uniqueTargets, 2);
  assert.strictEqual(basic.summary.totalOccurrences, 2);
  assert.deepStrictEqual(basic.summary.internal, { uniqueTargets: 1, occurrences: 1 });
  assert.deepStrictEqual(basic.summary.external, { uniqueTargets: 1, occurrences: 1 });
  assert.strictEqual(basic.summary.byHealth.healthy, 2);
  assert.strictEqual(findTarget(basic, internalUrl).classification, "internal");
  assert.strictEqual(findTarget(basic, externalUrl).classification, "external");
  assertReconciled(basic);

  const repeatedUrl = "https://site.test/missing";
  const repeatedPages = [
    makePage("https://site.test/", {
      internal: [
        makeLink(repeatedUrl, "internal", "https://site.test/", "  Missing\n product ", makeCheck("broken", repeatedUrl, {
          state: "client_error",
          statusCode: 404,
          finalStatusCode: 404,
          finalState: "client_error",
        })),
        makeLink(repeatedUrl, "internal", "https://site.test/", "Missing product", makeCheck("broken", repeatedUrl, {
          state: "client_error",
          statusCode: 404,
          finalStatusCode: 404,
          finalState: "client_error",
        })),
      ],
    }),
    makePage("https://site.test/products", {
      internal: [
        makeLink(repeatedUrl, "internal", "https://site.test/products", "View product", makeCheck("broken", repeatedUrl, {
          state: "client_error",
          statusCode: 404,
          finalStatusCode: 404,
          finalState: "client_error",
        })),
        makeLink(repeatedUrl, "internal", "https://site.test/products", "View product", makeCheck("broken", repeatedUrl, {
          state: "client_error",
          statusCode: 404,
          finalStatusCode: 404,
          finalState: "client_error",
        })),
      ],
    }),
  ];
  const repeated = aggregateLinkHealth(repeatedPages);
  const repeatedTarget = findTarget(repeated, repeatedUrl);
  assert.strictEqual(repeated.summary.uniqueTargets, 1);
  assert.strictEqual(repeated.summary.totalOccurrences, 4);
  assert.strictEqual(repeatedTarget.occurrenceCount, 4);
  assert.strictEqual(repeatedTarget.affectedPageCount, 2);
  assert.deepStrictEqual(repeatedTarget.affectedPages, [
    "https://site.test/",
    "https://site.test/products",
  ]);
  assert.deepStrictEqual(repeatedTarget.anchors, ["Missing product", "View product"]);
  assert.strictEqual(repeatedTarget.severity, "high");
  assert.strictEqual(repeatedTarget.priority, 1);
  assert.strictEqual(repeated.summary.affectedPages, 2);
  assertReconciled(repeated);

  const urls = {
    brokenInternal: "https://site.test/broken",
    brokenExternal: "https://outside.test/broken",
    redirectedInternal: "https://site.test/old",
    redirectedExternal: "https://outside.test/old",
    restricted: "https://outside.test/private",
    unreachableInternal: "https://site.test/offline",
    unreachableExternal: "https://outside.test/offline",
    blocked: "https://outside.test/blocked",
    blockedInternalRedirect: "https://site.test/blocked-redirect",
    unchecked: "https://site.test/skipped",
    loop: "https://outside.test/loop",
  };
  const healthFixture = makePage("https://site.test/source", {
    internal: [
      makeLink(urls.brokenInternal, "internal", "https://site.test/source", "Broken", makeCheck("broken", urls.brokenInternal, {
        state: "client_error", statusCode: 404, finalState: "client_error", finalStatusCode: 404,
      })),
      makeLink(urls.redirectedInternal, "internal", "https://site.test/source", "Old", makeCheck("redirected", urls.redirectedInternal, {
        state: "redirect", statusCode: 301, finalUrl: "https://site.test/new", redirectCount: 1,
      })),
      makeLink(urls.unreachableInternal, "internal", "https://site.test/source", "Offline", makeCheck("unreachable", urls.unreachableInternal, {
        state: "timeout", statusCode: null, finalUrl: null, finalStatusCode: null, finalState: "timeout",
      })),
      makeLink(urls.blockedInternalRedirect, "internal", "https://site.test/source", "Unsafe", makeCheck("blocked", urls.blockedInternalRedirect, {
        state: "redirect", statusCode: 302, finalUrl: null, finalStatusCode: null, finalState: "blocked",
        redirectProblem: "blocked_destination",
      })),
      makeLink(urls.unchecked, "internal", "https://site.test/source", "Skipped", makeCheck("unchecked", urls.unchecked, {
        state: "unchecked", statusCode: null, finalUrl: null, finalStatusCode: null, finalState: "unchecked",
      })),
    ],
    external: [
      makeLink(urls.brokenExternal, "external", "https://site.test/source", "Broken external", makeCheck("broken", urls.brokenExternal, {
        state: "server_error", statusCode: 503, finalState: "server_error", finalStatusCode: 503,
      })),
      makeLink(urls.redirectedExternal, "external", "https://site.test/source", "Moved", makeCheck("redirected", urls.redirectedExternal, {
        state: "redirect", statusCode: 302, finalUrl: "https://outside.test/new", redirectCount: 1,
      })),
      makeLink(urls.restricted, "external", "https://site.test/source", "Private", makeCheck("restricted", urls.restricted, {
        state: "restricted", statusCode: 403, finalState: "restricted", finalStatusCode: 403,
      })),
      makeLink(urls.unreachableExternal, "external", "https://site.test/source", "Offline external", makeCheck("unreachable", urls.unreachableExternal, {
        state: "network_error", statusCode: null, finalUrl: null, finalStatusCode: null, finalState: "network_error",
      })),
      makeLink(urls.blocked, "external", "https://site.test/source", "Blocked", makeCheck("blocked", urls.blocked, {
        state: "blocked", statusCode: null, finalUrl: null, finalStatusCode: null, finalState: "blocked",
      })),
      makeLink(urls.loop, "external", "https://site.test/source", "Loop", makeCheck("broken", urls.loop, {
        state: "redirect", statusCode: 302, finalState: "redirect", finalStatusCode: 302,
        redirectCount: 2, redirectProblem: "redirect_loop",
      })),
    ],
  });
  const healthReport = aggregateLinkHealth([healthFixture]);
  assert.strictEqual(healthReport.summary.byHealth.broken, 3);
  assert.strictEqual(healthReport.summary.byHealth.redirected, 2);
  assert.strictEqual(healthReport.summary.byHealth.restricted, 1);
  assert.strictEqual(healthReport.summary.byHealth.unreachable, 2);
  assert.strictEqual(healthReport.summary.byHealth.blocked, 2);
  assert.strictEqual(healthReport.summary.byHealth.unchecked, 1);
  assert.strictEqual(healthReport.summary.brokenInternalTargets, 1);
  assert.strictEqual(healthReport.summary.brokenExternalTargets, 2);
  assert.strictEqual(findTarget(healthReport, urls.brokenExternal).severity, "medium");
  assert.strictEqual(findTarget(healthReport, urls.redirectedInternal).severity, "medium");
  assert.strictEqual(findTarget(healthReport, urls.redirectedExternal).severity, "low");
  assert.strictEqual(findTarget(healthReport, urls.unreachableInternal).severity, "medium");
  assert.strictEqual(findTarget(healthReport, urls.unreachableExternal).severity, "low");
  assert.strictEqual(findTarget(healthReport, urls.restricted).severity, "info");
  assert.strictEqual(findTarget(healthReport, urls.blocked).severity, "low");
  assert.strictEqual(findTarget(healthReport, urls.blockedInternalRedirect).severity, "high");
  assert.strictEqual(findTarget(healthReport, urls.loop).severity, "high");
  assert.ok(healthReport.issues.broken.includes(urls.brokenInternal));
  assert.ok(healthReport.issues.redirected.includes(urls.redirectedExternal));
  assert.ok(healthReport.issues.restricted.includes(urls.restricted));
  assert.ok(healthReport.issues.unreachable.includes(urls.unreachableExternal));
  assert.ok(healthReport.issues.blocked.includes(urls.blocked));
  assert.ok(healthReport.issues.unchecked.includes(urls.unchecked));
  assertReconciled(healthReport);

  const unknownMissing = "https://site.test/missing-check";
  const unknownInvalid = "https://site.test/invalid-check";
  const ignoredFailed = "https://site.test/failed-page-link";
  const malformed = aggregateLinkHealth([
    makePage("https://site.test/source", {
      internal: [
        makeLink(unknownMissing, "internal", "https://site.test/source", "Missing check", undefined),
        makeLink(unknownInvalid, "internal", "https://site.test/source", "Invalid check", { health: "other", isBroken: false }),
        { classification: "internal", sourceUrl: "https://site.test/source" },
        null,
      ],
      discarded: [{ rawHref: "mailto:test@example.com" }],
    }),
    {
      url: "https://site.test/failed",
      status: "failed",
      links: {
        internal: [makeLink(ignoredFailed, "internal", "https://site.test/failed", "Ignored", makeCheck("broken", ignoredFailed))],
        external: [],
        discarded: [{ rawHref: "#ignored" }],
      },
    },
  ]);
  assert.strictEqual(malformed.summary.uniqueTargets, 2);
  assert.strictEqual(malformed.summary.byHealth.unknown, 2);
  assert.strictEqual(malformed.summary.invalidOccurrences, 2);
  assert.strictEqual(malformed.summary.discardedOccurrences, 1);
  assert.strictEqual(findTarget(malformed, unknownMissing).checkProblem, "missing_check");
  assert.strictEqual(findTarget(malformed, unknownInvalid).checkProblem, "invalid_check");
  assert.strictEqual(findTarget(malformed, ignoredFailed), undefined);
  assert.deepStrictEqual(malformed.issues.unknown, [unknownInvalid, unknownMissing]);
  assertReconciled(malformed);

  const conflictUrl = "https://shared.test/resource";
  const conflict = aggregateLinkHealth([makePage("https://site.test/source", {
    internal: [makeLink(conflictUrl, "internal", "https://site.test/source", "Internal", makeCheck("healthy", conflictUrl))],
    external: [makeLink(conflictUrl, "external", "https://site.test/source", "External", makeCheck("healthy", conflictUrl))],
  })]);
  const conflictTarget = findTarget(conflict, conflictUrl);
  assert.strictEqual(conflictTarget.classification, "conflict");
  assert.deepStrictEqual(conflictTarget.classifications, ["internal", "external"]);
  assert.strictEqual(conflictTarget.classificationConflict, true);
  assert.strictEqual(conflictTarget.health, "healthy");
  assert.strictEqual(conflictTarget.severity, "medium");
  assert.strictEqual(conflict.summary.classificationConflicts, 1);
  assert.deepStrictEqual(conflict.summary.internal, { uniqueTargets: 1, occurrences: 1 });
  assert.deepStrictEqual(conflict.summary.external, { uniqueTargets: 1, occurrences: 1 });
  assert.deepStrictEqual(conflict.issues.conflicts, [conflictUrl]);
  assert.strictEqual(conflict.summary.affectedPages, 1);
  assertReconciled(conflict);

  const redirectUrl = "https://site.test/redirect";
  const redirectChain = [{
    url: redirectUrl,
    statusCode: 301,
    location: "https://site.test/final",
    responseTimeMs: 2,
  }];
  const redirectCheck = makeCheck("redirected", redirectUrl, {
    state: "redirect",
    statusCode: 301,
    redirectCount: 1,
    redirectChain,
    finalUrl: "https://site.test/final",
  });
  const payloadPages = [makePage("https://site.test/", {
    internal: [makeLink(redirectUrl, "internal", "https://site.test/", "Redirect", redirectCheck)],
  })];
  const originalPayload = JSON.stringify(payloadPages);
  const payloadReport = aggregateLinkHealth(payloadPages);
  assert.strictEqual(JSON.stringify(payloadPages), originalPayload);
  assert.deepStrictEqual(findTarget(payloadReport, redirectUrl).redirectChain, redirectChain);
  assert.notStrictEqual(findTarget(payloadReport, redirectUrl).redirectChain, redirectChain);
  assert.deepStrictEqual(payloadReport.issues.redirected, [redirectUrl]);
  assert.strictEqual(typeof payloadReport.issues.redirected[0], "string");

  const deterministicInput = [healthFixture, ...repeatedPages, ...payloadPages];
  const deterministicSnapshot = JSON.stringify(aggregateLinkHealth(deterministicInput));
  const reversedInput = [...deterministicInput]
    .reverse()
    .map((page) => ({
      ...page,
      links: {
        ...page.links,
        internal: [...page.links.internal].reverse(),
        external: [...page.links.external].reverse(),
      },
    }));
  assert.strictEqual(JSON.stringify(aggregateLinkHealth(reversedInput)), deterministicSnapshot);

  const orderedTargets = aggregateLinkHealth(deterministicInput).targets;
  for (let index = 1; index < orderedTargets.length; index += 1) {
    const previous = orderedTargets[index - 1];
    const current = orderedTargets[index];
    assert.ok(previous.priority <= current.priority);
    if (previous.priority === current.priority) {
      assert.ok(
        previous.affectedPageCount > current.affectedPageCount ||
        (
          previous.affectedPageCount === current.affectedPageCount &&
          previous.normalizedUrl < current.normalizedUrl
        )
      );
    }
  }

  console.log("Link-health aggregation unit tests passed");
}

try {
  runTests();
} catch (error) {
  console.error("Link-health aggregation unit tests failed:", error);
  process.exit(1);
}
