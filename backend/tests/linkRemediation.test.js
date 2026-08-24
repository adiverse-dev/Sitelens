"use strict";

const assert = require("assert");
const { aggregateLinkHealth } = require("../src/utils/linkHealthAggregator");

const BROKEN_VALUE = Object.freeze({
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
    state: health,
    statusCode: 200,
    errorCode: null,
    redirected: health === "redirected",
    redirectCount: 0,
    redirectChain: [],
    finalUrl: url,
    finalStatusCode: 200,
    finalState: health,
    health,
    isBroken: BROKEN_VALUE[health],
    redirectProblem: null,
    ...overrides,
  };
}

function makeLink(definition, sourceUrl) {
  return {
    normalizedUrl: definition.url,
    classification: definition.classification,
    sourceUrl,
    anchorText: definition.code,
    check: definition.missingCheck
      ? undefined
      : makeCheck(definition.health, definition.url, definition.check),
  };
}

function reversePage(page) {
  if (!page || page.status !== "success") return page;
  return {
    ...page,
    links: {
      ...page.links,
      internal: [...page.links.internal].reverse(),
      external: [...page.links.external].reverse(),
      discarded: [...page.links.discarded].reverse(),
    },
  };
}

function assertOrdering(report) {
  for (let index = 1; index < report.targets.length; index += 1) {
    const previous = report.targets[index - 1];
    const current = report.targets[index];
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

  for (let index = 1; index < report.actions.length; index += 1) {
    const previous = report.actions[index - 1];
    const current = report.actions[index];
    assert.ok(previous.priority <= current.priority);
    if (previous.priority === current.priority) {
      assert.ok(previous.code < current.code);
    }
  }
}

function assertContract(report) {
  const targetsByUrl = new Map(report.targets.map((target) => [target.normalizedUrl, target]));
  assert.strictEqual(targetsByUrl.size, report.targets.length);
  assert.strictEqual(
    Object.values(report.summary.byHealth).reduce((total, count) => total + count, 0),
    report.summary.uniqueTargets
  );
  assert.strictEqual(
    report.targets.reduce((total, target) => total + target.occurrenceCount, 0),
    report.summary.totalOccurrences
  );

  for (const urls of Object.values(report.issues)) {
    assert.strictEqual(new Set(urls).size, urls.length);
    for (const url of urls) assert.ok(targetsByUrl.has(url));
  }

  const actionableTargets = report.targets.filter((target) => target.remediation);
  assert.strictEqual(
    report.actionSummary.totalActionableTargets,
    actionableTargets.length
  );
  for (const target of report.targets) {
    if (target.health === "healthy" && !target.classificationConflict) {
      assert.strictEqual(target.remediation, null);
    } else {
      assert.strictEqual(typeof target.remediation.code, "string");
    }
  }

  const expectedByCode = {};
  const expectedByOwner = {
    developer: 0,
    seo: 0,
    content: 0,
    site_owner: 0,
    review: 0,
  };
  const expectedBySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  for (const target of actionableTargets) {
    const { code, owner } = target.remediation;
    expectedByCode[code] = (expectedByCode[code] || 0) + 1;
    expectedByOwner[owner] += 1;
    expectedBySeverity[target.severity] += 1;
  }
  const sortedByCode = Object.fromEntries(
    Object.entries(expectedByCode).sort(([left], [right]) => left < right ? -1 : 1)
  );
  assert.deepStrictEqual(report.actionSummary.byCode, sortedByCode);
  assert.deepStrictEqual(report.actionSummary.byOwner, expectedByOwner);
  assert.deepStrictEqual(report.actionSummary.bySeverity, expectedBySeverity);

  const actionTargets = new Set();
  let actionTargetReferences = 0;
  for (const action of report.actions) {
    assert.strictEqual(action.targetCount, action.targets.length);
    assert.strictEqual(new Set(action.targets).size, action.targets.length);
    const affectedPages = new Set();
    for (const url of action.targets) {
      actionTargetReferences += 1;
      const target = targetsByUrl.get(url);
      assert.ok(target);
      assert.strictEqual(target.remediation.code, action.code);
      actionTargets.add(url);
      for (const pageUrl of target.affectedPages) affectedPages.add(pageUrl);
    }
    assert.strictEqual(action.affectedPageCount, affectedPages.size);
  }
  assert.strictEqual(actionTargets.size, actionableTargets.length);
  assert.strictEqual(actionTargetReferences, actionableTargets.length);
  assertOrdering(report);
}

function runTests() {
  const sourceA = "https://site.test/source-a";
  const sourceB = "https://site.test/source-b";
  const definitions = [
    { code: "replace_or_remove_broken_internal_link", classification: "internal", health: "broken", url: "https://site.test/broken-a", check: { statusCode: 404, finalStatusCode: 404 } },
    { code: "review_or_replace_broken_external_link", classification: "external", health: "broken", url: "https://outside.test/broken", check: { statusCode: 503, finalStatusCode: 503 } },
    { code: "update_internal_redirect", classification: "internal", health: "redirected", url: "https://site.test/old" },
    { code: "review_external_redirect", classification: "external", health: "redirected", url: "https://outside.test/old" },
    { code: "fix_redirect_loop", classification: "external", health: "broken", url: "https://outside.test/loop", check: { redirectProblem: "redirect_loop" } },
    { code: "shorten_redirect_chain", classification: "external", health: "broken", url: "https://outside.test/long", check: { redirectProblem: "too_many_redirects" } },
    { code: "add_missing_redirect_location", classification: "external", health: "broken", url: "https://outside.test/missing-location", check: { redirectProblem: "missing_location" } },
    { code: "fix_invalid_redirect_location", classification: "external", health: "broken", url: "https://outside.test/invalid-location", check: { redirectProblem: "invalid_location" } },
    { code: "replace_unsupported_redirect_status", classification: "external", health: "broken", url: "https://outside.test/status-300", check: { redirectProblem: "unsupported_redirect_status" } },
    { code: "review_blocked_redirect_destination", classification: "internal", health: "blocked", url: "https://site.test/blocked-destination", check: { redirectProblem: "blocked_destination" } },
    { code: "replace_unsupported_redirect_scheme", classification: "internal", health: "blocked", url: "https://site.test/unsupported-scheme", check: { redirectProblem: "unsupported_scheme" } },
    { code: "remove_redirect_credentials", classification: "internal", health: "blocked", url: "https://site.test/credentials", check: { redirectProblem: "credentials_not_allowed" } },
    { code: "retry_unreachable_internal_target", classification: "internal", health: "unreachable", url: "https://site.test/unreachable" },
    { code: "retry_unreachable_external_target", classification: "external", health: "unreachable", url: "https://outside.test/unreachable" },
    { code: "verify_restricted_internal_target", classification: "internal", health: "restricted", url: "https://site.test/restricted", check: { statusCode: 403, finalStatusCode: 403 } },
    { code: "verify_restricted_external_target", classification: "external", health: "restricted", url: "https://outside.test/restricted", check: { statusCode: 401, finalStatusCode: 401 } },
    { code: "review_target_limit_configuration", classification: "internal", health: "unchecked", url: "https://site.test/target-limit", check: { errorCode: "TARGET_LIMIT_EXCEEDED", statusCode: null, finalStatusCode: null } },
    { code: "review_unchecked_target", classification: "external", health: "unchecked", url: "https://outside.test/unchecked", check: { errorCode: "NOT_PROCESSED", statusCode: null, finalStatusCode: null } },
    { code: "repair_link_check_contract", classification: "internal", health: "unknown", url: "https://site.test/missing-check", missingCheck: true },
    { code: "review_blocked_internal_target", classification: "internal", health: "blocked", url: "https://site.test/blocked", check: { statusCode: null, finalStatusCode: null } },
    { code: "review_blocked_external_target", classification: "external", health: "blocked", url: "https://outside.test/blocked", check: { statusCode: null, finalStatusCode: null } },
  ];
  const healthy = {
    code: null,
    classification: "internal",
    health: "healthy",
    url: "https://site.test/healthy",
  };
  const conflict = {
    code: "resolve_link_classification_conflict",
    classification: "internal",
    health: "broken",
    url: "https://shared.test/conflict",
    check: { redirectProblem: "redirect_loop" },
  };

  const internal = definitions
    .filter((definition) => definition.classification === "internal")
    .map((definition) => makeLink(definition, sourceA));
  const external = definitions
    .filter((definition) => definition.classification === "external")
    .map((definition) => makeLink(definition, sourceA));
  internal.push(makeLink(healthy, sourceA));
  internal.push(makeLink(conflict, sourceA));
  external.push(makeLink({ ...conflict, classification: "external" }, sourceA));
  internal.push(null);

  const brokenInternalB = {
    code: "replace_or_remove_broken_internal_link",
    classification: "internal",
    health: "broken",
    url: "https://site.test/broken-b",
    check: { statusCode: 404, finalStatusCode: 404 },
  };
  const pages = [
    {
      url: sourceA,
      status: "success",
      links: { internal, external, discarded: [{ rawHref: "mailto:test@example.com" }] },
    },
    {
      url: sourceB,
      status: "success",
      links: {
        internal: [
          makeLink(definitions[0], sourceB),
          makeLink(brokenInternalB, sourceB),
        ],
        external: [],
        discarded: [],
      },
    },
    {
      url: "https://site.test/failed",
      status: "failed",
      links: { internal: [makeLink(brokenInternalB, "https://site.test/failed")], external: [], discarded: [] },
    },
    null,
  ];

  const inputSnapshot = JSON.stringify(pages);
  const report = aggregateLinkHealth(pages);
  assert.strictEqual(JSON.stringify(pages), inputSnapshot);
  assertContract(report);

  const expectedCodes = new Set([
    ...definitions.map((definition) => definition.code),
    conflict.code,
  ]);
  assert.deepStrictEqual(
    new Set(report.targets.filter((target) => target.remediation).map((target) => target.remediation.code)),
    expectedCodes
  );

  const healthyTarget = report.targets.find((target) => target.normalizedUrl === healthy.url);
  assert.strictEqual(healthyTarget.remediation, null);
  const conflictTarget = report.targets.find((target) => target.normalizedUrl === conflict.url);
  assert.strictEqual(conflictTarget.remediation.code, conflict.code);
  assert.strictEqual(conflictTarget.redirectProblem, "redirect_loop");
  const loopTarget = report.targets.find((target) => target.normalizedUrl === "https://outside.test/loop");
  assert.strictEqual(loopTarget.remediation.code, "fix_redirect_loop");
  const limitedTarget = report.targets.find((target) => target.normalizedUrl === "https://site.test/target-limit");
  assert.strictEqual(limitedTarget.errorCode, "TARGET_LIMIT_EXCEEDED");
  assert.strictEqual(limitedTarget.remediation.code, "review_target_limit_configuration");

  const brokenAction = report.actions.find(
    (action) => action.code === "replace_or_remove_broken_internal_link"
  );
  assert.strictEqual(brokenAction.targetCount, 2);
  assert.strictEqual(brokenAction.affectedPageCount, 2);
  assert.deepStrictEqual(brokenAction.targets, [
    "https://site.test/broken-a",
    "https://site.test/broken-b",
  ]);
  assert.strictEqual(
    report.actionSummary.byCode.replace_or_remove_broken_internal_link,
    2
  );

  const reversedReport = aggregateLinkHealth([...pages].reverse().map(reversePage));
  assert.strictEqual(JSON.stringify(reversedReport), JSON.stringify(report));

  const empty = aggregateLinkHealth([]);
  assert.deepStrictEqual(empty.actionSummary, {
    totalActionableTargets: 0,
    byCode: {},
    byOwner: { developer: 0, seo: 0, content: 0, site_owner: 0, review: 0 },
    bySeverity: { high: 0, medium: 0, low: 0, info: 0 },
  });
  assert.deepStrictEqual(empty.actions, []);
  assertContract(empty);

  console.log("Link remediation and Phase 6 contract tests passed");
}

try {
  runTests();
} catch (error) {
  console.error("Link remediation and Phase 6 contract tests failed:", error);
  process.exit(1);
}
