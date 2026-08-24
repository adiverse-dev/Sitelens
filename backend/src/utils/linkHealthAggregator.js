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
const REMEDIATION_OWNERS = Object.freeze([
  "developer",
  "seo",
  "content",
  "site_owner",
  "review",
]);
const ACTION_SEVERITIES = Object.freeze(["high", "medium", "low", "info"]);
const HIGH_REDIRECT_PROBLEMS = new Set([
  "redirect_loop",
  "too_many_redirects",
  "missing_location",
  "invalid_location",
]);

function remediationDefinition(title, summary, recommendedAction, verification, owner) {
  return Object.freeze({ title, summary, recommendedAction, verification, owner });
}

const REMEDIATION_DEFINITIONS = Object.freeze({
  resolve_link_classification_conflict: remediationDefinition(
    "Resolve link classification conflict",
    "This normalized target appears as both internal and external.",
    "Review the source records and correct the target classification before acting on other link guidance.",
    "Re-run the crawl and confirm the target has one classification.",
    "review"
  ),
  repair_link_check_contract: remediationDefinition(
    "Restore link check evidence",
    "This target does not contain a valid Phase 6 check contract.",
    "Review the link-check pipeline and restore a valid health and isBroken result for this target.",
    "Re-run the crawl and confirm the target has a recognized health classification.",
    "developer"
  ),
  fix_redirect_loop: remediationDefinition(
    "Fix redirect loop",
    "Phase 6 detected a redirect loop for this target.",
    "Update the redirect rules so the chain reaches one stable destination without revisiting a URL.",
    "Re-run the crawl and confirm the redirect chain terminates successfully.",
    "developer"
  ),
  shorten_redirect_chain: remediationDefinition(
    "Shorten redirect chain",
    "This target exceeded the configured redirect-hop limit.",
    "Replace the source link with the intended final destination or shorten the server-side redirect chain.",
    "Re-run the crawl and confirm the target resolves within the redirect limit.",
    "developer"
  ),
  add_missing_redirect_location: remediationDefinition(
    "Add redirect destination",
    "A redirect response did not provide a Location destination.",
    "Configure the redirect response with a valid HTTP or HTTPS Location value.",
    "Re-run the crawl and confirm the redirect resolves to the intended destination.",
    "developer"
  ),
  fix_invalid_redirect_location: remediationDefinition(
    "Fix invalid redirect destination",
    "A redirect response provided a malformed Location destination.",
    "Replace the malformed Location value with a valid HTTP or HTTPS destination.",
    "Re-run the crawl and confirm the redirect destination is valid and reachable.",
    "developer"
  ),
  replace_unsupported_redirect_status: remediationDefinition(
    "Use a supported redirect status",
    "This target returned a redirect status that SiteLens does not follow.",
    "Use a standard 301, 302, 303, 307, or 308 redirect, or link directly to the intended destination.",
    "Re-run the crawl and confirm the redirect uses a supported status and resolves successfully.",
    "developer"
  ),
  review_blocked_redirect_destination: remediationDefinition(
    "Review blocked redirect destination",
    "Security validation blocked the redirect destination; it is not confirmed broken.",
    "Review the redirect destination and replace it only after confirming that it is an allowed public target.",
    "Re-run the crawl and confirm the destination passes security validation or the source link is updated.",
    "review"
  ),
  replace_unsupported_redirect_scheme: remediationDefinition(
    "Replace unsupported redirect scheme",
    "The redirect destination does not use HTTP or HTTPS.",
    "Replace the redirect destination with an appropriate HTTP or HTTPS target.",
    "Re-run the crawl and confirm the redirect uses an allowed scheme.",
    "developer"
  ),
  remove_redirect_credentials: remediationDefinition(
    "Remove redirect credentials",
    "The redirect destination contains embedded credentials and was blocked.",
    "Remove credentials from the redirect URL and use an approved authentication flow if access is required.",
    "Re-run the crawl and confirm the redirect URL contains no embedded credentials.",
    "developer"
  ),
  replace_or_remove_broken_internal_link: remediationDefinition(
    "Replace or remove broken internal link",
    "Phase 6 classified this internal target as broken.",
    "Update every affected source page to a valid internal destination or remove the link.",
    "Re-run the crawl and confirm the target resolves successfully.",
    "developer"
  ),
  review_or_replace_broken_external_link: remediationDefinition(
    "Review or replace broken external link",
    "Phase 6 classified this external target as broken.",
    "Verify the intended third-party destination, then update or remove the link on every affected source page.",
    "Re-run the crawl and confirm the replacement target resolves successfully.",
    "content"
  ),
  update_internal_redirect: remediationDefinition(
    "Update internal redirect",
    "This internal target redirects to another destination.",
    "Update affected source pages to link directly to the verified final internal destination.",
    "Re-run the crawl and confirm the source pages no longer depend on this redirect.",
    "developer"
  ),
  review_external_redirect: remediationDefinition(
    "Review external redirect",
    "This external target redirects to another destination.",
    "Verify that the final destination is intended, then update the source link if appropriate.",
    "Re-run the crawl and confirm the external redirect still resolves to the approved destination.",
    "content"
  ),
  retry_unreachable_internal_target: remediationDefinition(
    "Retry unreachable internal target",
    "Phase 6 could not reach this internal target; it is not confirmed broken.",
    "Check the internal service and network path, then retry before replacing the link.",
    "Re-run the crawl and confirm the target becomes reachable or receives a deterministic status.",
    "developer"
  ),
  retry_unreachable_external_target: remediationDefinition(
    "Retry unreachable external target",
    "Phase 6 could not reach this external target; it is not confirmed broken.",
    "Retry the target and verify it independently before deciding whether to update or remove the link.",
    "Re-run the crawl and confirm the target becomes reachable or receives a deterministic status.",
    "review"
  ),
  verify_restricted_internal_target: remediationDefinition(
    "Verify restricted internal target",
    "This internal target returned a restricted result and is not classified as broken.",
    "Confirm that the access restriction is intentional and that linked users have the required access path.",
    "Re-run the crawl or an authorized check and confirm the restriction is expected.",
    "site_owner"
  ),
  verify_restricted_external_target: remediationDefinition(
    "Verify restricted external target",
    "This external target returned a restricted result and is not classified as broken.",
    "Confirm that the external destination and its access requirements are appropriate for users.",
    "Re-run the crawl or verify the destination manually and confirm the restriction is expected.",
    "review"
  ),
  review_target_limit_configuration: remediationDefinition(
    "Review link check target limit",
    "This target was not checked because the unique-target limit was reached.",
    "Prioritize the target within the existing crawl scope or review the server-side link-check target limit.",
    "Re-run the crawl and confirm this target receives a completed check result.",
    "site_owner"
  ),
  review_unchecked_target: remediationDefinition(
    "Review unchecked target",
    "This target did not receive a completed link check and is not confirmed broken.",
    "Review the check evidence and retry the target before taking corrective link action.",
    "Re-run the crawl and confirm the target receives a completed check result.",
    "review"
  ),
  review_blocked_internal_target: remediationDefinition(
    "Review blocked internal target",
    "Security validation blocked this internal target; it is not confirmed broken.",
    "Review the target against the server security policy and correct the link only if the destination is unintended.",
    "Re-run the crawl and confirm the target is either intentionally blocked or safely checkable.",
    "review"
  ),
  review_blocked_external_target: remediationDefinition(
    "Review blocked external target",
    "Security validation blocked this external target; it is not confirmed broken.",
    "Review the target against the server security policy before deciding whether to update the link.",
    "Re-run the crawl and confirm the target is either intentionally blocked or safely checkable.",
    "review"
  ),
});

const REDIRECT_REMEDIATION_CODES = Object.freeze({
  redirect_loop: "fix_redirect_loop",
  too_many_redirects: "shorten_redirect_chain",
  missing_location: "add_missing_redirect_location",
  invalid_location: "fix_invalid_redirect_location",
  unsupported_redirect_status: "replace_unsupported_redirect_status",
  blocked_destination: "review_blocked_redirect_destination",
  unsupported_scheme: "replace_unsupported_redirect_scheme",
  credentials_not_allowed: "remove_redirect_credentials",
});

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
    errorCode: normalizedString(check.errorCode),
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

function selectRemediationCode(target) {
  if (target.classificationConflict) return "resolve_link_classification_conflict";
  if (target.health === "unknown") return "repair_link_check_contract";
  if (REDIRECT_REMEDIATION_CODES[target.redirectProblem]) {
    return REDIRECT_REMEDIATION_CODES[target.redirectProblem];
  }

  const isInternal = target.classifications.includes("internal");
  if (target.health === "healthy") return null;
  if (target.health === "broken") {
    return isInternal
      ? "replace_or_remove_broken_internal_link"
      : "review_or_replace_broken_external_link";
  }
  if (target.health === "redirected") {
    return isInternal ? "update_internal_redirect" : "review_external_redirect";
  }
  if (target.health === "unreachable") {
    return isInternal
      ? "retry_unreachable_internal_target"
      : "retry_unreachable_external_target";
  }
  if (target.health === "restricted") {
    return isInternal
      ? "verify_restricted_internal_target"
      : "verify_restricted_external_target";
  }
  if (target.health === "unchecked") {
    return target.errorCode === "TARGET_LIMIT_EXCEEDED"
      ? "review_target_limit_configuration"
      : "review_unchecked_target";
  }
  if (target.health === "blocked") {
    return isInternal
      ? "review_blocked_internal_target"
      : "review_blocked_external_target";
  }
  return "repair_link_check_contract";
}

function createRemediation(target) {
  const code = selectRemediationCode(target);
  if (!code) return null;

  const definition = REMEDIATION_DEFINITIONS[code];
  let summary = definition.summary;
  if (
    (code === "replace_or_remove_broken_internal_link" ||
      code === "review_or_replace_broken_external_link") &&
    Number.isInteger(target.finalStatusCode)
  ) {
    summary += ` Final HTTP status: ${target.finalStatusCode}.`;
  }

  return {
    code,
    title: definition.title,
    summary,
    recommendedAction: definition.recommendedAction,
    verification: definition.verification,
    owner: definition.owner,
    automatable: false,
  };
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

  const target = {
    normalizedUrl: group.normalizedUrl,
    classification,
    classifications,
    classificationConflict,
    health,
    isBroken: canonicalCheck ? canonicalCheck.isBroken : null,
    errorCode: canonicalCheck ? canonicalCheck.errorCode : null,
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
  target.remediation = createRemediation(target);
  return target;
}

function compareTargets(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.affectedPageCount !== right.affectedPageCount) {
    return right.affectedPageCount - left.affectedPageCount;
  }
  return compareStrings(left.normalizedUrl, right.normalizedUrl);
}

function createActionContract(targets) {
  const ownerCounts = Object.fromEntries(REMEDIATION_OWNERS.map((owner) => [owner, 0]));
  const severityCounts = Object.fromEntries(
    ACTION_SEVERITIES.map((severity) => [severity, 0])
  );
  const codeCounts = new Map();
  const groups = new Map();
  let totalActionableTargets = 0;

  for (const target of targets) {
    if (!target.remediation) continue;

    totalActionableTargets += 1;
    const { code, owner } = target.remediation;
    codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    ownerCounts[owner] += 1;
    severityCounts[target.severity] += 1;

    if (!groups.has(code)) {
      groups.set(code, {
        code,
        severity: target.severity,
        priority: target.priority,
        targetUrls: new Set(),
        affectedPages: new Set(),
      });
    }

    const group = groups.get(code);
    if (target.priority < group.priority) {
      group.priority = target.priority;
      group.severity = target.severity;
    }
    group.targetUrls.add(target.normalizedUrl);
    for (const pageUrl of target.affectedPages) group.affectedPages.add(pageUrl);
  }

  const actions = [...groups.values()]
    .map((group) => ({
      code: group.code,
      severity: group.severity,
      priority: group.priority,
      targetCount: group.targetUrls.size,
      affectedPageCount: group.affectedPages.size,
      targets: [...group.targetUrls].sort(compareStrings),
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      const severityDifference = SEVERITY_PRIORITY[left.severity] -
        SEVERITY_PRIORITY[right.severity];
      if (severityDifference !== 0) return severityDifference;
      return compareStrings(left.code, right.code);
    });

  return {
    actionSummary: {
      totalActionableTargets,
      byCode: Object.fromEntries([...codeCounts.entries()].sort((left, right) => (
        compareStrings(left[0], right[0])
      ))),
      byOwner: ownerCounts,
      bySeverity: severityCounts,
    },
    actions,
  };
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

  const { actionSummary, actions } = createActionContract(targets);
  return { summary, targets, issues, actionSummary, actions };
}

module.exports = {
  aggregateLinkHealth,
  classifySeverity,
};
