const path = require("path");
const { SCREENSHOT_DIR } = require("./constants");

function normalizeFilePath(filePath) {
  return filePath.split(path.sep).join("/");
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
