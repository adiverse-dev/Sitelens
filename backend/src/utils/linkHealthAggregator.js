"use strict";

const HEALTH_VALUES = Object.freeze([
  "healthy",
  "redirected",
  "restricted",
  "broken",
  "unreachable",
  "blocked",
  "unchecked",
]);
const HEALTH_SET = new Set(HEALTH_VALUES);
const REPORT_HEALTH_VALUES = Object.freeze([...HEALTH_VALUES, "unknown"]);
const CLASSIFICATIONS = Object.freeze(["internal", "external"]);
const SEVERITY_PRIORITY = Object.freeze({
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  none: 5,
});
const HIGH_REDIRECT_PROBLEMS = new Set([
  "redirect_loop",
  "too_many_redirects",
  "missing_location",
  "invalid_location",
]);

function normalizeWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function expectedBrokenValue(health) {
  if (health === "broken") return true;
  if (health === "healthy" || health === "redirected" || health === "restricted") {
    return false;
  }
  return null;
}

function inspectCheck(check) {
  if (check === undefined || check === null) {
    return { valid: false, problem: "missing_check" };
  }
  if (typeof check !== "object" || Array.isArray(check)) {
    return { valid: false, problem: "invalid_check" };
  }
  if (!HEALTH_SET.has(check.health) || check.isBroken !== expectedBrokenValue(check.health)) {
    return { valid: false, problem: "invalid_check" };
  }
  return { valid: true, problem: null };
}

function nullableInteger(value) {
  return Number.isInteger(value) ? value : null;
}

function cloneRedirectChain(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      url: normalizedString(entry.url),
      statusCode: nullableInteger(entry.statusCode),
      location: normalizedString(entry.location),
      responseTimeMs: Number.isFinite(entry.responseTimeMs)
        ? Math.max(0, Math.round(entry.responseTimeMs))
        : null,
    }));
}

function normalizeCheck(check) {
  const redirectChain = cloneRedirectChain(check.redirectChain);
  return {
    health: check.health,
    isBroken: check.isBroken,
    statusCode: nullableInteger(check.statusCode),
    finalUrl: normalizedString(check.finalUrl),
    finalStatusCode: nullableInteger(check.finalStatusCode),
    redirectCount: Number.isInteger(check.redirectCount) && check.redirectCount >= 0
      ? check.redirectCount
      : redirectChain.length,
    redirectProblem: normalizedString(check.redirectProblem),
    redirectChain,
  };
}

function selectCanonicalCheck(checksBySignature) {
  const signatures = [...checksBySignature.keys()].sort(compareStrings);
  return signatures.length > 0 ? checksBySignature.get(signatures[0]) : null;
}

/**
 * Severity is independent of Phase 6C health. Priority is the stable numeric
 * rank used for sorting; affected-page count is the next ordering key.
 */
function classifySeverity({ health, classifications, redirectProblem, classificationConflict }) {
  const isInternal = classifications.includes("internal");
  let severity;

  if (health === "broken") {
    severity = HIGH_REDIRECT_PROBLEMS.has(redirectProblem) || isInternal
      ? "high"
      : "medium";
  } else if (health === "redirected") {
    severity = isInternal ? "medium" : "low";
  } else if (health === "unreachable") {
    severity = isInternal ? "medium" : "low";
  } else if (
    health === "blocked" &&
    redirectProblem === "blocked_destination" &&
    isInternal
  ) {
    severity = "high";
  } else if (health === "blocked") {
    severity = "low";
  } else if (health === "restricted" || health === "unchecked" || health === "unknown") {
    severity = "info";
  } else {
    severity = "none";
  }

  if (classificationConflict && SEVERITY_PRIORITY[severity] > SEVERITY_PRIORITY.medium) {
    return "medium";
  }
  return severity;
}

function createEmptySummary() {
  return {
    uniqueTargets: 0,
    totalOccurrences: 0,
    internal: { uniqueTargets: 0, occurrences: 0 },
    external: { uniqueTargets: 0, occurrences: 0 },
    byHealth: Object.fromEntries(REPORT_HEALTH_VALUES.map((health) => [health, 0])),
    brokenInternalTargets: 0,
    brokenExternalTargets: 0,
    affectedPages: 0,
    classificationConflicts: 0,
    invalidOccurrences: 0,
    discardedOccurrences: 0,
  };
}

function createEmptyIssues() {
  return {
    broken: [],
    redirected: [],
    restricted: [],
    unreachable: [],
    blocked: [],
    unchecked: [],
    unknown: [],
    conflicts: [],
  };
}

function createGroup(normalizedUrl) {
  return {
    normalizedUrl,
    classifications: new Set(),
    occurrenceCount: 0,
    affectedPages: new Set(),
    anchors: new Set(),
    checksBySignature: new Map(),
    checkProblems: new Set(),
  };
}

function addOccurrence(group, record, classification, pageUrl) {
  group.classifications.add(classification);
  if (
    CLASSIFICATIONS.includes(record.classification) &&
    record.classification !== classification
  ) {
    group.classifications.add(record.classification);
  }
  group.occurrenceCount += 1;

  const sourceUrl = normalizedString(record.sourceUrl) || normalizedString(pageUrl);
  if (sourceUrl) group.affectedPages.add(sourceUrl);

  const anchor = normalizeWhitespace(record.anchorText);
  if (anchor) group.anchors.add(anchor);

  const inspection = inspectCheck(record.check);
  if (inspection.valid) {
    const normalizedCheck = normalizeCheck(record.check);
    group.checksBySignature.set(JSON.stringify(normalizedCheck), normalizedCheck);
  } else {
    group.checkProblems.add(inspection.problem);
  }
}

function buildTarget(group) {
  const classifications = CLASSIFICATIONS.filter((value) => group.classifications.has(value));
  const classificationConflict = classifications.length > 1;
  const classification = classificationConflict
    ? "conflict"
    : (classifications[0] || "unknown");
  const canonicalCheck = selectCanonicalCheck(group.checksBySignature);
  const health = canonicalCheck ? canonicalCheck.health : "unknown";
  const checkProblem = canonicalCheck
    ? null
    : (group.checkProblems.has("invalid_check") ? "invalid_check" : "missing_check");
  const severity = classifySeverity({
    health,
    classifications,
    redirectProblem: canonicalCheck ? canonicalCheck.redirectProblem : null,
    classificationConflict,
  });
  const affectedPages = [...group.affectedPages].sort(compareStrings);

  return {
    normalizedUrl: group.normalizedUrl,
    classification,
    classifications,
    classificationConflict,
    health,
    isBroken: canonicalCheck ? canonicalCheck.isBroken : null,
    statusCode: canonicalCheck ? canonicalCheck.statusCode : null,
    finalUrl: canonicalCheck ? canonicalCheck.finalUrl : null,
    finalStatusCode: canonicalCheck ? canonicalCheck.finalStatusCode : null,
    redirectCount: canonicalCheck ? canonicalCheck.redirectCount : 0,
    redirectProblem: canonicalCheck ? canonicalCheck.redirectProblem : null,
    redirectChain: canonicalCheck ? canonicalCheck.redirectChain : [],
    checkProblem,
    occurrenceCount: group.occurrenceCount,
    affectedPageCount: affectedPages.length,
    affectedPages,
    anchors: [...group.anchors].sort(compareStrings),
    severity,
    priority: SEVERITY_PRIORITY[severity],
  };
}

function compareTargets(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.affectedPageCount !== right.affectedPageCount) {
    return right.affectedPageCount - left.affectedPageCount;
  }
  return compareStrings(left.normalizedUrl, right.normalizedUrl);
}

function aggregateLinkHealth(pages) {
  const summary = createEmptySummary();
  const groups = new Map();

  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (!page || page.status !== "success" || !page.links) continue;

      summary.discardedOccurrences += Array.isArray(page.links.discarded)
        ? page.links.discarded.length
        : 0;

      for (const classification of CLASSIFICATIONS) {
        const records = Array.isArray(page.links[classification])
          ? page.links[classification]
          : [];

        for (const record of records) {
          if (!record || typeof record !== "object" || Array.isArray(record)) {
            summary.invalidOccurrences += 1;
            continue;
          }

          const normalizedUrl = normalizedString(record.normalizedUrl);
          if (!normalizedUrl) {
            summary.invalidOccurrences += 1;
            continue;
          }

          summary.totalOccurrences += 1;
          summary[classification].occurrences += 1;

          if (!groups.has(normalizedUrl)) {
            groups.set(normalizedUrl, createGroup(normalizedUrl));
          }
          addOccurrence(groups.get(normalizedUrl), record, classification, page.url);
        }
      }
    }
  }

  const targets = [...groups.values()].map(buildTarget).sort(compareTargets);
  const affectedPages = new Set();

  summary.uniqueTargets = targets.length;
  for (const target of targets) {
    summary.byHealth[target.health] += 1;

    if (target.classifications.includes("internal")) {
      summary.internal.uniqueTargets += 1;
      if (target.health === "broken") summary.brokenInternalTargets += 1;
    }
    if (target.classifications.includes("external")) {
      summary.external.uniqueTargets += 1;
      if (target.health === "broken") summary.brokenExternalTargets += 1;
    }
    if (target.classificationConflict) summary.classificationConflicts += 1;

    if (target.health !== "healthy" || target.classificationConflict) {
      for (const pageUrl of target.affectedPages) affectedPages.add(pageUrl);
    }
  }
  summary.affectedPages = affectedPages.size;

  const issues = createEmptyIssues();
  for (const target of targets) {
    if (target.health !== "healthy") {
      issues[target.health].push(target.normalizedUrl);
    }
    if (target.classificationConflict) {
      issues.conflicts.push(target.normalizedUrl);
    }
  }

  return { summary, targets, issues };
}

module.exports = {
  aggregateLinkHealth,
  classifySeverity,
};
