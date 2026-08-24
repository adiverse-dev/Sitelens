"use strict";

const assert = require("assert");
const {
  applyLinkChecks,
  classifyStatus,
  createCheckResult,
  resolveLimits,
} = require("../src/services/linkChecker.service");

function retainedLink(normalizedUrl, classification = "internal") {
  return {
    sourceUrl: "https://site.invalid/",
    rawHref: normalizedUrl,
    targetUrl: normalizedUrl,
    normalizedUrl,
    anchorText: normalizedUrl,
    classification,
    rel: [],
    nofollow: false,
  };
}

function pageWithLinks(internal = [], external = [], discarded = []) {
  return {
    status: "success",
    links: {
      internal,
      external,
      discarded,
      summary: {
        internal: internal.length,
        external: external.length,
        discarded: discarded.length,
      },
    },
  };
}

async function runTests() {
  assert.strictEqual(classifyStatus(204), "ok");
  assert.strictEqual(classifyStatus(302), "redirect");
  assert.strictEqual(classifyStatus(401), "restricted");
  assert.strictEqual(classifyStatus(403), "restricted");
  assert.strictEqual(classifyStatus(404), "client_error");
  assert.strictEqual(classifyStatus(503), "server_error");

  const duplicateTarget = "https://site.invalid/about";
  const externalTarget = "https://outside.invalid/resource";
  const limitedTarget = "https://site.invalid/limited";
  const duplicateOne = retainedLink(duplicateTarget);
  const duplicateTwo = retainedLink(duplicateTarget);
  const duplicateThree = retainedLink(duplicateTarget);
  const external = retainedLink(externalTarget, "external");
  const limited = retainedLink(limitedTarget);
  const discarded = {
    sourceUrl: "https://site.invalid/",
    rawHref: "mailto:test@example.com",
    targetUrl: null,
    normalizedUrl: null,
    anchorText: "Email",
    rel: [],
    nofollow: false,
    reason: "unsupported-scheme",
  };
  const pages = [
    pageWithLinks([duplicateOne, duplicateTwo], [external], [discarded]),
    pageWithLinks([duplicateThree, limited]),
  ];
  const calls = [];

  const summary = await applyLinkChecks(
    pages,
    { maxTargets: 2, concurrency: 2, timeoutMs: 100 },
    {
      checkTarget: async (targetUrl) => {
        calls.push(targetUrl);
        return createCheckResult({
          state: targetUrl === externalTarget ? "redirect" : "ok",
          statusCode: targetUrl === externalTarget ? 302 : 200,
          responseTimeMs: 1,
          location: targetUrl === externalTarget
            ? "https://outside.invalid/login"
            : null,
        });
      },
    }
  );

  assert.deepStrictEqual(calls, [duplicateTarget, externalTarget]);
  assert.deepStrictEqual(summary, {
    uniqueTargets: 3,
    processedTargets: 2,
    uncheckedTargets: 1,
    limitHit: true,
    limits: { maxTargets: 2, concurrency: 2, timeoutMs: 100 },
  });
  assert.strictEqual(duplicateOne.check.state, "ok");
  assert.deepStrictEqual(duplicateOne.check, duplicateTwo.check);
  assert.deepStrictEqual(duplicateTwo.check, duplicateThree.check);
  assert.notStrictEqual(duplicateOne.check, duplicateTwo.check);
  assert.strictEqual(external.check.state, "redirect");
  assert.strictEqual(limited.check.state, "unchecked");
  assert.strictEqual(limited.check.errorCode, "TARGET_LIMIT_EXCEEDED");
  assert.strictEqual(Object.hasOwn(discarded, "check"), false);

  const failureGood = retainedLink("https://site.invalid/good");
  const failureBad = retainedLink("https://site.invalid/bad", "external");
  await applyLinkChecks(
    [pageWithLinks([failureGood], [failureBad])],
    { maxTargets: 2, concurrency: 2, timeoutMs: 100 },
    {
      checkTarget: async (targetUrl) => {
        if (targetUrl.endsWith("/bad")) throw new Error("sensitive detail");
        return createCheckResult({ state: "ok", statusCode: 200, responseTimeMs: 1 });
      },
    }
  );
  assert.strictEqual(failureGood.check.state, "ok");
  assert.strictEqual(failureBad.check.state, "network_error");
  assert.strictEqual(failureBad.check.errorCode, "NETWORK_ERROR");
  assert.strictEqual(failureBad.check.errorMessage.includes("sensitive"), false);

  let active = 0;
  let maxObserved = 0;
  const concurrencyLinks = Array.from({ length: 7 }, (_, index) =>
    retainedLink(`https://site.invalid/concurrency-${index}`)
  );
  await applyLinkChecks(
    [pageWithLinks(concurrencyLinks)],
    { maxTargets: 7, concurrency: 2, timeoutMs: 100 },
    {
      checkTarget: async () => {
        active += 1;
        maxObserved = Math.max(maxObserved, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return createCheckResult({ state: "ok", statusCode: 200, responseTimeMs: 10 });
      },
    }
  );
  assert.strictEqual(maxObserved, 2);
  assert.ok(concurrencyLinks.every((link) => link.check.state === "ok"));

  assert.deepStrictEqual(
    resolveLimits({ maxTargets: 999999, concurrency: 999999, timeoutMs: 999999 }),
    { maxTargets: 1000, concurrency: 10, timeoutMs: 15000 }
  );

  console.log("Link-check mapping unit tests passed");
}

runTests().catch((error) => {
  console.error("Link-check mapping unit tests failed:", error);
  process.exit(1);
});
