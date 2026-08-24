"use strict";

const http = require("http");
const https = require("https");
const net = require("net");
const urlValidator = require("../utils/urlValidator");
const {
  SITELENS_USER_AGENT,
  LINK_CHECK_MAX_TARGETS,
  LINK_CHECK_MAX_TARGETS_HARD_LIMIT,
  LINK_CHECK_CONCURRENCY,
  LINK_CHECK_CONCURRENCY_HARD_LIMIT,
  LINK_CHECK_MAX_REDIRECTS,
  LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT,
  CRAWLER_REQUEST_TIMEOUT_MS,
  CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS,
} = require("../utils/constants");

const CHECK_STATES = new Set([
  "ok",
  "redirect",
  "restricted",
  "client_error",
  "server_error",
  "timeout",
  "network_error",
  "blocked",
  "unchecked",
]);

const HEALTH_STATES = new Set([
  "healthy",
  "redirected",
  "restricted",
  "broken",
  "unreachable",
  "blocked",
  "unchecked",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REDIRECT_PROBLEMS = new Set([
  "redirect_loop",
  "too_many_redirects",
  "missing_location",
  "invalid_location",
  "unsupported_scheme",
  "credentials_not_allowed",
  "blocked_destination",
  "unsupported_redirect_status",
]);

const SECURITY_REDIRECT_PROBLEMS = new Set([
  "unsupported_scheme",
  "credentials_not_allowed",
  "blocked_destination",
]);

const VALIDATION_TIMEOUT = Symbol("validation-timeout");

const EXPOSED_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function createCheckResult({
  state,
  statusCode = null,
  responseTimeMs = null,
  errorCode = null,
  errorMessage = null,
  location = null,
  redirected,
  redirectCount,
  redirectChain = [],
  finalUrl = null,
  finalStatusCode,
  finalState,
  health,
  isBroken,
  redirectProblem = null,
}) {
  const resolvedRedirectCount = Number.isInteger(redirectCount)
    ? Math.max(0, redirectCount)
    : redirectChain.length;
  const resolvedRedirected = typeof redirected === "boolean"
    ? redirected
    : resolvedRedirectCount > 0;
  const resolvedFinalState = finalState === undefined ? state : finalState;
  const resolvedFinalStatusCode = finalStatusCode === undefined
    ? statusCode
    : finalStatusCode;
  const resolvedHealth = HEALTH_STATES.has(health)
    ? health
    : classifyHealth(resolvedFinalState, resolvedRedirected, redirectProblem);
  const resolvedIsBroken = isBroken === true || isBroken === false || isBroken === null
    ? isBroken
    : classifyBroken(resolvedHealth);

  return {
    state,
    statusCode,
    responseTimeMs,
    errorCode,
    errorMessage,
    location,
    redirected: resolvedRedirected,
    redirectCount: resolvedRedirectCount,
    redirectChain,
    finalUrl,
    finalStatusCode: resolvedFinalStatusCode,
    finalState: resolvedFinalState,
    health: resolvedHealth,
    isBroken: resolvedIsBroken,
    redirectProblem,
  };
}

function classifyHealth(finalState, redirected, redirectProblem) {
  if (redirectProblem) {
    return SECURITY_REDIRECT_PROBLEMS.has(redirectProblem)
      ? "blocked"
      : "broken";
  }

  if (finalState === "ok") return redirected ? "redirected" : "healthy";
  if (finalState === "restricted") return "restricted";
  if (finalState === "client_error" || finalState === "server_error" || finalState === "redirect") {
    return "broken";
  }
  if (finalState === "timeout" || finalState === "network_error") return "unreachable";
  if (finalState === "blocked") return "blocked";
  if (finalState === "unchecked") return "unchecked";
  return "unreachable";
}

function classifyBroken(health) {
  if (health === "broken") return true;
  if (health === "healthy" || health === "redirected" || health === "restricted") {
    return false;
  }
  return null;
}

function createUncheckedResult(errorCode = "TARGET_LIMIT_EXCEEDED") {
  const errorMessage = errorCode === "TARGET_LIMIT_EXCEEDED"
    ? "Link check target limit reached"
    : "Link target was not checked";

  return createCheckResult({
    state: "unchecked",
    errorCode,
    errorMessage,
    finalState: "unchecked",
    finalStatusCode: null,
    health: "unchecked",
    isBroken: null,
  });
}

function classifyStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return "ok";
  if (statusCode >= 300 && statusCode < 400) return "redirect";
  if (statusCode === 401 || statusCode === 403) return "restricted";
  if (statusCode >= 400 && statusCode < 500) return "client_error";
  if (statusCode >= 500 && statusCode < 600) return "server_error";
  return "network_error";
}

function sanitizeLocation(location, targetUrl) {
  if (typeof location !== "string" || !location.trim()) return null;

  try {
    const parsed = new URL(location.trim(), targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";

    return parsed.href.length <= 2048 ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

function sanitizeUrl(value) {
  return sanitizeLocation(value, value);
}

function normalizeRedirectUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    }
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function createBlockedResult(errorCode, responseTimeMs) {
  return createCheckResult({
    state: "blocked",
    responseTimeMs,
    errorCode,
    errorMessage: "Target URL is not allowed",
    finalState: "blocked",
    finalStatusCode: null,
    health: "blocked",
    isBroken: null,
  });
}

function createNetworkErrorResult(errorCode, responseTimeMs) {
  return createCheckResult({
    state: "network_error",
    responseTimeMs,
    errorCode,
    errorMessage: "Link check request failed",
    finalState: "network_error",
    finalStatusCode: null,
    health: "unreachable",
    isBroken: null,
  });
}

function createTimeoutResult(responseTimeMs) {
  return createCheckResult({
    state: "timeout",
    responseTimeMs,
    errorCode: "REQUEST_TIMEOUT",
    errorMessage: "Link check timed out",
    finalState: "timeout",
    finalStatusCode: null,
    health: "unreachable",
    isBroken: null,
  });
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function remainingTime(context) {
  return context.timeoutMs - elapsedSince(context.startedAt);
}

function finalizeCheck(context, outcome) {
  const firstResponse = context.firstResponse;
  const finalState = outcome.finalState;

  return createCheckResult({
    state: firstResponse ? firstResponse.state : finalState,
    statusCode: firstResponse ? firstResponse.statusCode : (outcome.finalStatusCode ?? null),
    responseTimeMs: elapsedSince(context.startedAt),
    errorCode: outcome.errorCode || null,
    errorMessage: outcome.errorMessage || null,
    location: firstResponse ? firstResponse.location : null,
    redirected: context.redirectChain.length > 0,
    redirectCount: context.redirectChain.length,
    redirectChain: context.redirectChain,
    finalUrl: outcome.finalUrl === undefined
      ? sanitizeUrl(context.currentUrl.href)
      : outcome.finalUrl,
    finalStatusCode: outcome.finalStatusCode ?? null,
    finalState,
    redirectProblem: outcome.redirectProblem || null,
  });
}

function finalizeRedirectProblem(context, redirectProblem, statusCode) {
  const details = {
    redirect_loop: ["REDIRECT_LOOP", "Redirect loop detected", "redirect"],
    too_many_redirects: ["TOO_MANY_REDIRECTS", "Redirect hop limit exceeded", "redirect"],
    missing_location: ["MISSING_LOCATION", "Redirect response is missing Location", "redirect"],
    invalid_location: ["INVALID_LOCATION", "Redirect Location is invalid", "redirect"],
    unsupported_scheme: ["UNSUPPORTED_SCHEME", "Redirect protocol is not allowed", "blocked"],
    credentials_not_allowed: ["CREDENTIALS_NOT_ALLOWED", "Redirect credentials are not allowed", "blocked"],
    blocked_destination: ["SSRF_BLOCKED", "Redirect destination is not allowed", "blocked"],
    unsupported_redirect_status: ["UNSUPPORTED_REDIRECT_STATUS", "Redirect status is not followed", "redirect"],
  }[redirectProblem];

  return finalizeCheck(context, {
    finalState: details[2],
    finalStatusCode: details[2] === "redirect" ? statusCode : null,
    errorCode: details[0],
    errorMessage: details[1],
    redirectProblem,
  });
}

function requestHeaders(target, address, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const originHostname = target.hostname.replace(/^\[|\]$/g, "");
    const headers = {
      Accept: "*/*",
      Connection: "close",
      Host: target.host,
      "User-Agent": SITELENS_USER_AGENT,
    };

    if (method === "GET") {
      headers.Range = "bytes=0-0";
    }

    const requestOptions = {
      protocol: target.protocol,
      hostname: address,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method,
      path: `${target.pathname}${target.search}`,
      headers,
      agent: false,
    };

    if (target.protocol === "https:" && net.isIP(originHostname) === 0) {
      requestOptions.servername = originHostname;
    }

    let settled = false;
    const request = transport.request(requestOptions, (response) => {
      if (settled) {
        response.destroy();
        return;
      }

      settled = true;
      request.setTimeout(0);
      const result = {
        statusCode: response.statusCode || 0,
        location: response.headers.location || null,
      };

      // Phase 6B only needs response headers. Destroying the stream prevents an
      // unbounded body download, including when a server ignores the Range header.
      response.on("error", () => {});
      response.destroy();
      resolve(result);
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error("Link check timed out");
      error.code = "LINK_CHECK_TIMEOUT";
      request.destroy(error);
    });

    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    request.end();
  });
}

async function requestHop(context, address) {
  let remainingMs = remainingTime(context);
  if (remainingMs <= 0) {
    const error = new Error("Link check timed out");
    error.code = "LINK_CHECK_TIMEOUT";
    throw error;
  }

  let response = await requestHeaders(
    context.currentUrl,
    address,
    "HEAD",
    remainingMs
  );

  if (response.statusCode === 405 || response.statusCode === 501) {
    remainingMs = remainingTime(context);
    if (remainingMs <= 0) {
      const error = new Error("Link check timed out");
      error.code = "LINK_CHECK_TIMEOUT";
      throw error;
    }
    response = await requestHeaders(
      context.currentUrl,
      address,
      "GET",
      remainingMs
    );
  }

  return response;
}

function networkErrorCode(error) {
  return error && EXPOSED_NETWORK_CODES.has(error.code)
    ? error.code
    : "NETWORK_ERROR";
}

async function validateHop(context, validateTarget) {
  const validationTimeMs = remainingTime(context);
  if (validationTimeMs <= 0) return { timeout: true };

  let timeoutId;
  let securityCheck;
  try {
    securityCheck = await Promise.race([
      Promise.resolve(validateTarget(context.currentUrl.href)),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(VALIDATION_TIMEOUT), validationTimeMs);
      }),
    ]);
  } catch (_) {
    return { blocked: true, errorCode: "SECURITY_VALIDATION_FAILED" };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (securityCheck === VALIDATION_TIMEOUT) return { timeout: true };
  if (remainingTime(context) <= 0) return { timeout: true };

  if (!securityCheck || securityCheck.safe !== true) {
    const reason = securityCheck && securityCheck.reason;
    if (reason === "DNS resolution failed" || reason === "DNS returning no address") {
      return { networkError: true, errorCode: "DNS_ERROR" };
    }
    return { blocked: true, errorCode: "SSRF_BLOCKED" };
  }

  const resolvedAddresses = Array.isArray(securityCheck.resolvedAddresses)
    ? securityCheck.resolvedAddresses.filter((address) => net.isIP(address) !== 0)
    : [];

  if (resolvedAddresses.length === 0) {
    return { blocked: true, errorCode: "SECURITY_VALIDATION_FAILED" };
  }

  return { address: resolvedAddresses[0] };
}

async function checkLinkTarget(targetUrl, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS)
    : CRAWLER_REQUEST_TIMEOUT_MS;
  const maxRedirects = Number.isInteger(options.maxRedirects) && options.maxRedirects >= 0
    ? Math.min(options.maxRedirects, LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT)
    : LINK_CHECK_MAX_REDIRECTS;
  const validateTarget = options.validateTargetUrl || urlValidator.validateTargetUrl;

  let target;
  try {
    target = new URL(targetUrl);
  } catch (_) {
    return createBlockedResult("INVALID_TARGET", elapsedSince(startedAt));
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return createBlockedResult("UNSUPPORTED_PROTOCOL", elapsedSince(startedAt));
  }

  if (target.username || target.password) {
    return createBlockedResult("CREDENTIALS_NOT_ALLOWED", elapsedSince(startedAt));
  }

  const context = {
    startedAt,
    timeoutMs,
    maxRedirects,
    currentUrl: target,
    firstResponse: null,
    redirectChain: [],
    redirectsFollowed: 0,
    seenUrls: new Set([normalizeRedirectUrl(target.href)]),
  };

  while (true) {
    if (remainingTime(context) <= 0) {
      return finalizeCheck(context, {
        finalState: "timeout",
        errorCode: "REQUEST_TIMEOUT",
        errorMessage: "Link check timed out",
      });
    }

    const hopStartedAt = Date.now();
    const validation = await validateHop(context, validateTarget);

    if (validation.timeout) {
      return finalizeCheck(context, {
        finalState: "timeout",
        errorCode: "REQUEST_TIMEOUT",
        errorMessage: "Link check timed out",
      });
    }

    if (validation.networkError) {
      return finalizeCheck(context, {
        finalState: "network_error",
        errorCode: validation.errorCode,
        errorMessage: "Link check request failed",
      });
    }

    if (validation.blocked) {
      if (context.redirectChain.length > 0) {
        return finalizeRedirectProblem(context, "blocked_destination", null);
      }
      return finalizeCheck(context, {
        finalState: "blocked",
        errorCode: validation.errorCode,
        errorMessage: "Target URL is not allowed",
      });
    }

    let response;
    try {
      response = await requestHop(context, validation.address);
    } catch (error) {
      if (error && error.code === "LINK_CHECK_TIMEOUT") {
        return finalizeCheck(context, {
          finalState: "timeout",
          errorCode: "REQUEST_TIMEOUT",
          errorMessage: "Link check timed out",
        });
      }
      return finalizeCheck(context, {
        finalState: "network_error",
        errorCode: networkErrorCode(error),
        errorMessage: "Link check request failed",
      });
    }

    const state = classifyStatus(response.statusCode);
    const location = state === "redirect"
      ? sanitizeLocation(response.location, context.currentUrl.href)
      : null;

    if (!context.firstResponse) {
      context.firstResponse = {
        state,
        statusCode: response.statusCode,
        location,
      };
    }

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      const chainEntry = {
        url: sanitizeUrl(context.currentUrl.href),
        statusCode: response.statusCode,
        location: null,
        responseTimeMs: elapsedSince(hopStartedAt),
      };
      const rawLocation = typeof response.location === "string"
        ? response.location.trim()
        : "";

      if (!rawLocation) {
        context.redirectChain.push(chainEntry);
        return finalizeRedirectProblem(context, "missing_location", response.statusCode);
      }

      let redirectUrl;
      try {
        redirectUrl = new URL(rawLocation, context.currentUrl.href);
      } catch (_) {
        context.redirectChain.push(chainEntry);
        return finalizeRedirectProblem(context, "invalid_location", response.statusCode);
      }

      chainEntry.location = sanitizeUrl(redirectUrl.href);
      context.redirectChain.push(chainEntry);

      if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
        return finalizeRedirectProblem(context, "unsupported_scheme", response.statusCode);
      }

      if (redirectUrl.username || redirectUrl.password) {
        return finalizeRedirectProblem(context, "credentials_not_allowed", response.statusCode);
      }

      const loopKey = normalizeRedirectUrl(redirectUrl.href);
      if (!loopKey) {
        return finalizeRedirectProblem(context, "invalid_location", response.statusCode);
      }

      if (context.seenUrls.has(loopKey)) {
        return finalizeRedirectProblem(context, "redirect_loop", response.statusCode);
      }

      if (context.redirectsFollowed >= context.maxRedirects) {
        return finalizeRedirectProblem(context, "too_many_redirects", response.statusCode);
      }

      context.seenUrls.add(loopKey);
      context.redirectsFollowed += 1;
      context.currentUrl = redirectUrl;
      continue;
    }

    if (state === "redirect") {
      context.redirectChain.push({
        url: sanitizeUrl(context.currentUrl.href),
        statusCode: response.statusCode,
        location,
        responseTimeMs: elapsedSince(hopStartedAt),
      });
      return finalizeRedirectProblem(
        context,
        "unsupported_redirect_status",
        response.statusCode
      );
    }

    if (state === "network_error") {
      return finalizeCheck(context, {
        finalState: "network_error",
        errorCode: "UNEXPECTED_STATUS",
        errorMessage: "Link check request failed",
      });
    }

    return finalizeCheck(context, {
      finalState: state,
      finalStatusCode: response.statusCode,
    });
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum) return fallback;
  return Math.min(value, maximum);
}

function resolveLimits(options = {}) {
  return {
    maxTargets: boundedInteger(
      options.maxTargets,
      LINK_CHECK_MAX_TARGETS,
      1,
      LINK_CHECK_MAX_TARGETS_HARD_LIMIT
    ),
    concurrency: boundedInteger(
      options.concurrency,
      LINK_CHECK_CONCURRENCY,
      1,
      LINK_CHECK_CONCURRENCY_HARD_LIMIT
    ),
    maxRedirects: boundedInteger(
      options.maxRedirects,
      LINK_CHECK_MAX_REDIRECTS,
      0,
      LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT
    ),
    timeoutMs: boundedInteger(
      options.timeoutMs,
      CRAWLER_REQUEST_TIMEOUT_MS,
      1,
      CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS
    ),
  };
}

function normalizeCheckResult(result, responseTimeMs, targetUrl = null) {
  if (!result || !CHECK_STATES.has(result.state)) {
    return createNetworkErrorResult("INVALID_CHECK_RESULT", responseTimeMs);
  }

  const redirectProblem = REDIRECT_PROBLEMS.has(result.redirectProblem)
    ? result.redirectProblem
    : null;
  const redirectChain = Array.isArray(result.redirectChain)
    ? result.redirectChain
      .slice(0, LINK_CHECK_MAX_REDIRECTS_HARD_LIMIT + 1)
      .map((entry) => ({
        url: entry && typeof entry.url === "string"
          ? entry.url.slice(0, 2048)
          : null,
        statusCode: entry && Number.isInteger(entry.statusCode)
          ? entry.statusCode
          : null,
        location: entry && typeof entry.location === "string"
          ? entry.location.slice(0, 2048)
          : null,
        responseTimeMs: entry && Number.isFinite(entry.responseTimeMs)
          ? Math.max(0, Math.round(entry.responseTimeMs))
          : null,
      }))
    : [];
  const finalState = CHECK_STATES.has(result.finalState)
    ? result.finalState
    : result.state;

  return createCheckResult({
    state: result.state,
    statusCode: Number.isInteger(result.statusCode) ? result.statusCode : null,
    responseTimeMs: Number.isFinite(result.responseTimeMs)
      ? Math.max(0, Math.round(result.responseTimeMs))
      : responseTimeMs,
    errorCode: typeof result.errorCode === "string"
      ? result.errorCode.slice(0, 64)
      : null,
    errorMessage: typeof result.errorMessage === "string"
      ? result.errorMessage.slice(0, 256)
      : null,
    location: typeof result.location === "string"
      ? result.location.slice(0, 2048)
      : null,
    redirected: typeof result.redirected === "boolean"
      ? result.redirected
      : redirectChain.length > 0,
    redirectCount: redirectChain.length,
    redirectChain,
    finalUrl: typeof result.finalUrl === "string"
      ? result.finalUrl.slice(0, 2048)
      : (redirectChain.length === 0 ? sanitizeUrl(targetUrl) : null),
    finalStatusCode: Number.isInteger(result.finalStatusCode)
      ? result.finalStatusCode
      : (redirectChain.length === 0 && Number.isInteger(result.statusCode)
        ? result.statusCode
        : null),
    finalState,
    health: HEALTH_STATES.has(result.health) ? result.health : undefined,
    isBroken: result.isBroken === true || result.isBroken === false || result.isBroken === null
      ? result.isBroken
      : undefined,
    redirectProblem,
  });
}

function cloneCheckResult(result) {
  return {
    ...result,
    redirectChain: result.redirectChain.map((entry) => ({ ...entry })),
  };
}

async function applyLinkChecks(pages, options = {}, dependencies = {}) {
  const limits = resolveLimits(options);
  const occurrencesByTarget = new Map();
  const orderedPages = (Array.isArray(pages) ? [...pages] : []).sort((left, right) => {
    const leftDepth = Number.isInteger(left && left.depth)
      ? left.depth
      : Number.MAX_SAFE_INTEGER;
    const rightDepth = Number.isInteger(right && right.depth)
      ? right.depth
      : Number.MAX_SAFE_INTEGER;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;

    const leftUrl = left && typeof left.url === "string" ? left.url : "";
    const rightUrl = right && typeof right.url === "string" ? right.url : "";
    if (leftUrl < rightUrl) return -1;
    if (leftUrl > rightUrl) return 1;
    return 0;
  });

  for (const page of orderedPages) {
    if (!page || page.status !== "success" || !page.links) continue;

    for (const classification of ["internal", "external"]) {
      const records = Array.isArray(page.links[classification])
        ? page.links[classification]
        : [];

      for (const record of records) {
        if (!record || typeof record.normalizedUrl !== "string") {
          if (record && typeof record === "object") {
            record.check = createUncheckedResult("INVALID_TARGET");
          }
          continue;
        }

        let target;
        try {
          target = new URL(record.normalizedUrl);
        } catch (_) {
          record.check = createUncheckedResult("INVALID_TARGET");
          continue;
        }

        if (target.protocol !== "http:" && target.protocol !== "https:") {
          record.check = createUncheckedResult("INVALID_TARGET");
          continue;
        }

        if (!occurrencesByTarget.has(record.normalizedUrl)) {
          occurrencesByTarget.set(record.normalizedUrl, []);
        }
        occurrencesByTarget.get(record.normalizedUrl).push(record);
      }
    }
  }

  const uniqueTargets = Array.from(occurrencesByTarget.keys());
  const selectedTargets = uniqueTargets.slice(0, limits.maxTargets);
  const skippedTargets = uniqueTargets.slice(limits.maxTargets);
  const resultsByTarget = new Map();

  for (const targetUrl of skippedTargets) {
    resultsByTarget.set(targetUrl, createUncheckedResult());
  }

  const checkTarget = dependencies.checkTarget || checkLinkTarget;
  let nextIndex = 0;
  const workerCount = Math.min(limits.concurrency, selectedTargets.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selectedTargets.length) return;

      const targetUrl = selectedTargets[index];
      const startedAt = Date.now();
      let result;
      try {
        result = await checkTarget(targetUrl, {
          timeoutMs: limits.timeoutMs,
          maxRedirects: limits.maxRedirects,
        });
      } catch (_) {
        result = createNetworkErrorResult(
          "NETWORK_ERROR",
          elapsedSince(startedAt)
        );
      }

      resultsByTarget.set(
        targetUrl,
        normalizeCheckResult(result, elapsedSince(startedAt), targetUrl)
      );
    }
  });

  await Promise.all(workers);

  for (const [targetUrl, records] of occurrencesByTarget) {
    const result = resultsByTarget.get(targetUrl) || createUncheckedResult("NOT_PROCESSED");
    for (const record of records) {
      record.check = cloneCheckResult(result);
    }
  }

  return {
    uniqueTargets: uniqueTargets.length,
    processedTargets: selectedTargets.length,
    uncheckedTargets: skippedTargets.length,
    limitHit: skippedTargets.length > 0,
    limits,
  };
}

module.exports = {
  applyLinkChecks,
  checkLinkTarget,
  classifyStatus,
  createCheckResult,
  createUncheckedResult,
  resolveLimits,
  sanitizeLocation,
};
