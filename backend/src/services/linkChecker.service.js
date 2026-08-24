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
}) {
  return {
    state,
    statusCode,
    responseTimeMs,
    errorCode,
    errorMessage,
    location,
  };
}

function createUncheckedResult(errorCode = "TARGET_LIMIT_EXCEEDED") {
  const errorMessage = errorCode === "TARGET_LIMIT_EXCEEDED"
    ? "Link check target limit reached"
    : "Link target was not checked";

  return createCheckResult({
    state: "unchecked",
    errorCode,
    errorMessage,
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

function createBlockedResult(errorCode, responseTimeMs) {
  return createCheckResult({
    state: "blocked",
    responseTimeMs,
    errorCode,
    errorMessage: "Target URL is not allowed",
  });
}

function createNetworkErrorResult(errorCode, responseTimeMs) {
  return createCheckResult({
    state: "network_error",
    responseTimeMs,
    errorCode,
    errorMessage: "Link check request failed",
  });
}

function createTimeoutResult(responseTimeMs) {
  return createCheckResult({
    state: "timeout",
    responseTimeMs,
    errorCode: "REQUEST_TIMEOUT",
    errorMessage: "Link check timed out",
  });
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
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

async function checkLinkTarget(targetUrl, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS)
    : CRAWLER_REQUEST_TIMEOUT_MS;
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

  let securityCheck;
  try {
    securityCheck = await validateTarget(target.href);
  } catch (_) {
    return createBlockedResult("SECURITY_VALIDATION_FAILED", elapsedSince(startedAt));
  }

  if (!securityCheck || securityCheck.safe !== true) {
    const reason = securityCheck && securityCheck.reason;
    if (reason === "DNS resolution failed" || reason === "DNS returning no address") {
      return createNetworkErrorResult("DNS_ERROR", elapsedSince(startedAt));
    }
    return createBlockedResult("SSRF_BLOCKED", elapsedSince(startedAt));
  }

  const resolvedAddresses = Array.isArray(securityCheck.resolvedAddresses)
    ? securityCheck.resolvedAddresses.filter((address) => net.isIP(address) !== 0)
    : [];

  // Never fall back to a second, unvalidated DNS lookup at connection time.
  if (resolvedAddresses.length === 0) {
    return createBlockedResult("SECURITY_VALIDATION_FAILED", elapsedSince(startedAt));
  }

  try {
    let remainingMs = timeoutMs - elapsedSince(startedAt);
    if (remainingMs <= 0) return createTimeoutResult(elapsedSince(startedAt));

    let response = await requestHeaders(target, resolvedAddresses[0], "HEAD", remainingMs);

    if (response.statusCode === 405 || response.statusCode === 501) {
      remainingMs = timeoutMs - elapsedSince(startedAt);
      if (remainingMs <= 0) return createTimeoutResult(elapsedSince(startedAt));
      response = await requestHeaders(target, resolvedAddresses[0], "GET", remainingMs);
    }

    const state = classifyStatus(response.statusCode);
    if (state === "network_error") {
      return createNetworkErrorResult("UNEXPECTED_STATUS", elapsedSince(startedAt));
    }

    return createCheckResult({
      state,
      statusCode: response.statusCode,
      responseTimeMs: elapsedSince(startedAt),
      location: state === "redirect"
        ? sanitizeLocation(response.location, target.href)
        : null,
    });
  } catch (error) {
    const responseTimeMs = elapsedSince(startedAt);
    if (error && error.code === "LINK_CHECK_TIMEOUT") {
      return createTimeoutResult(responseTimeMs);
    }

    const errorCode = error && EXPOSED_NETWORK_CODES.has(error.code)
      ? error.code
      : "NETWORK_ERROR";
    return createNetworkErrorResult(errorCode, responseTimeMs);
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
    timeoutMs: boundedInteger(
      options.timeoutMs,
      CRAWLER_REQUEST_TIMEOUT_MS,
      1,
      CRAWLER_REQUEST_TIMEOUT_HARD_LIMIT_MS
    ),
  };
}

function normalizeCheckResult(result, responseTimeMs) {
  if (!result || !CHECK_STATES.has(result.state)) {
    return createNetworkErrorResult("INVALID_CHECK_RESULT", responseTimeMs);
  }

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
  });
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
        result = await checkTarget(targetUrl, { timeoutMs: limits.timeoutMs });
      } catch (_) {
        result = createNetworkErrorResult(
          "NETWORK_ERROR",
          elapsedSince(startedAt)
        );
      }

      resultsByTarget.set(
        targetUrl,
        normalizeCheckResult(result, elapsedSince(startedAt))
      );
    }
  });

  await Promise.all(workers);

  for (const [targetUrl, records] of occurrencesByTarget) {
    const result = resultsByTarget.get(targetUrl) || createUncheckedResult("NOT_PROCESSED");
    for (const record of records) {
      record.check = { ...result };
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
