import { apiFetch } from "./api";

/**
 * Submits a URL for auditing by the SiteLens backend.
 * @param {string} url - The target URL to audit (e.g. "https://www.wikipedia.org")
 * @returns {Promise<Object>} The complete audit result from the backend.
 */
export async function auditWebsite(url) {
  if (!url) {
    throw new Error("A valid URL is required");
  }

  // The apiFetch wrapper already handles HTTP errors (e.g. 400 SSRF, 429 Rate Limit)
  // and throws them as standard Errors.
  const data = await apiFetch("/audit", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  if (!data.success) {
    throw new Error(data.error || "Audit failed on the backend.");
  }

  return data;
}
