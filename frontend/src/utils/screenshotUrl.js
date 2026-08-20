import { API_BASE_URL } from "../services/api";

/**
 * Resolves a URL-rooted screenshot path returned by the backend into a fully qualified URL.
 * @param {string} screenshotPath - The path returned by the backend (e.g. "/screenshots/example.png")
 * @returns {string} The full URL (e.g. "http://localhost:5000/screenshots/example.png")
 */
export function getScreenshotUrl(screenshotPath) {
  if (!screenshotPath) return "";
  
  // Prevent duplicate slashes just in case
  const cleanPath = screenshotPath.startsWith("/") ? screenshotPath : `/${screenshotPath}`;
  return `${API_BASE_URL}${cleanPath}`;
}
