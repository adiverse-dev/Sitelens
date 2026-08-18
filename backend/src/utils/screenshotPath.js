const path = require("path");
const { SCREENSHOT_DIR } = require("./constants");

/**
 * Converts a full screenshot filesystem path into a URL-rooted path
 * that can be served by Express static middleware.
 *
 * Example:
 *   "screenshots/www.example.com-2026-08-18T04-35-03-502Z.png"
 *   → "/screenshots/www.example.com-2026-08-18T04-35-03-502Z.png"
 */
function normalizeFilePath(filePath) {
  const filename = path.basename(filePath);
  return `/screenshots/${filename}`;
}

function createScreenshotPath(url) {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "-");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return path.join(SCREENSHOT_DIR, `${hostname}-${timestamp}.png`);
}

module.exports = {
  normalizeFilePath,
  createScreenshotPath,
};

