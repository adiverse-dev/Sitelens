/**
 * backend/src/utils/urlNormalizer.js
 *
 * Phase 5.3 — URL Normalization and Deduplication
 *
 * A centralized, pure-function utility for normalizing and deduplicating URLs.
 *
 * Rules implemented:
 * - WHATWG standard URL resolution (handles relative URLs)
 * - Restricts to http: and https: schemes
 * - Rejects mailto, tel, javascript, data, blob, sms, ftp, file, etc.
 * - Removes hash fragments (#)
 * - Normalizes hostname casing (automatic via URL API)
 * - Strips default ports (80 for http, 443 for https) (automatic via URL API)
 * - Preserves non-default ports
 * - Normalizes trailing slashes (preserves '/' at root, removes otherwise)
 * - Preserves query parameters exactly as they are
 * - Deterministic, side-effect free, NO network calls
 *
 * Deduplication (dedupeUrls):
 * - Takes an array of raw URLs (and a baseUrl)
 * - Normalizes each URL
 * - Removes nulls and duplicates (using a Set)
 * - Returns array of unique normalized URLs
 */

"use strict";

const DISALLOWED_SCHEMES = new Set([
  "mailto:", "tel:", "javascript:", "data:", "blob:", "sms:", "ftp:", "file:", "chrome:", "chrome-extension:"
]);

/**
 * Normalizes a URL string according to Phase 5.3 rules.
 *
 * @param {string} rawHref - The raw URL string to normalize.
 * @param {string} [baseUrl] - Optional base URL for resolving relative paths.
 * @returns {string|null} - The normalized absolute URL, or null if invalid/discarded.
 */
function normalizeUrl(rawHref, baseUrl) {
  if (typeof rawHref !== "string") return null;

  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  // Pre-filter known bad schemes to prevent issues before resolution
  const lowerTrimmed = trimmed.toLowerCase();
  for (const scheme of DISALLOWED_SCHEMES) {
    if (lowerTrimmed.startsWith(scheme)) return null;
  }

  let urlObj;
  try {
    urlObj = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
  } catch (error) {
    // Malformed URL, unresolvable
    return null;
  }

  // Scheme restriction: only HTTP / HTTPS
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return null;
  }

  // Remove fragments
  urlObj.hash = "";

  // Handle trailing slashes
  // Node's URL API automatically handles double slashes in paths like //about -> /about
  // But we need to enforce trailing slash removal for non-root paths.
  if (urlObj.pathname !== "/") {
    urlObj.pathname = urlObj.pathname.replace(/\/+$/, "");
  }

  // In case the pathname became empty (e.g. from "//" -> ""), ensure it is "/"
  if (urlObj.pathname === "") {
    urlObj.pathname = "/";
  }

  return urlObj.href;
}

/**
 * Deduplicates an array of raw URLs.
 * 
 * @param {string[]} urls - Array of raw URLs to deduplicate.
 * @param {string} [baseUrl] - Optional base URL for resolving relative paths.
 * @returns {string[]} - Array of unique, normalized URLs.
 */
function dedupeUrls(urls, baseUrl) {
  if (!Array.isArray(urls)) return [];

  const unique = new Set();
  for (const rawUrl of urls) {
    const normalized = normalizeUrl(rawUrl, baseUrl);
    if (normalized !== null) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

module.exports = {
  normalizeUrl,
  dedupeUrls
};
