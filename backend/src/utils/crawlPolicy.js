/**
 * backend/src/utils/crawlPolicy.js
 *
 * Phase 5.4 — Same-Domain + Crawl Policy
 *
 * Centralized utility to determine whether a normalized URL is allowed to
 * enter the crawl pipeline based on the configured policy.
 *
 * Rules:
 * - Deterministic, pure function. No network calls, fetch, or DNS.
 * - Assumes the URL has already been normalized (Phase 5.3), but still validates.
 * - Enforces www-equivalence (example.com == www.example.com).
 * - Enforces exact hostname matching by default.
 * - Optionally allows subdomains if crawlSubdomains is true.
 * - HTTP/HTTPS are accepted (port safety is handled later by validateTargetUrl).
 */

"use strict";

/**
 * Determines if a normalized candidate URL is allowed to be crawled based on the seed.
 *
 * @param {string} normalizedUrl - The candidate URL to check.
 * @param {string} seedUrl - The seed URL of the crawl.
 * @param {Object} [options={}] - Crawl policy options.
 * @param {boolean} [options.crawlSubdomains=false] - Whether to allow subdomains of the seed.
 * @returns {{ allowed: boolean, reason: string }}
 */
function isAllowedByPolicy(normalizedUrl, seedUrl, options = {}) {
  const crawlSubdomains = options.crawlSubdomains === true;

  let candidateObj, seedObj;

  try {
    candidateObj = new URL(normalizedUrl);
    seedObj = new URL(seedUrl);
  } catch (_) {
    return { allowed: false, reason: "invalid-url" };
  }

  // Only HTTP/HTTPS protocols are supported for crawling
  if (candidateObj.protocol !== "http:" && candidateObj.protocol !== "https:") {
    return { allowed: false, reason: "unsupported-protocol" };
  }

  const rawCandidateHost = candidateObj.hostname;
  const rawSeedHost = seedObj.hostname;

  // Normalize www for equivalence comparison
  const normCandidateHost = rawCandidateHost.startsWith("www.")
    ? rawCandidateHost.slice(4)
    : rawCandidateHost;
  
  const normSeedHost = rawSeedHost.startsWith("www.")
    ? rawSeedHost.slice(4)
    : rawSeedHost;

  // 1. Exact match (or www-equivalent match)
  if (normCandidateHost === normSeedHost) {
    const reason = rawCandidateHost !== rawSeedHost ? "www-equivalent" : "same-host";
    return { allowed: true, reason };
  }

  // 2. Subdomain check
  // A candidate is a subdomain if it ends with ".normSeedHost"
  if (normCandidateHost.endsWith("." + normSeedHost)) {
    if (crawlSubdomains) {
      return { allowed: true, reason: "subdomain-allowed" };
    } else {
      return { allowed: false, reason: "subdomain-not-allowed" };
    }
  }

  // 3. External domains (including reverse-subdomains or completely different sites)
  return { allowed: false, reason: "external-domain" };
}

module.exports = {
  isAllowedByPolicy
};
