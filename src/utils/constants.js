const PORT = process.env.PORT || 5000;
const NAVIGATION_TIMEOUT_MS = Number(process.env.NAVIGATION_TIMEOUT_MS) || 15000;
const ROBOTS_TIMEOUT_MS = Number(process.env.ROBOTS_TIMEOUT_MS) || 10000;
const SITEMAP_TIMEOUT_MS = Number(process.env.SITEMAP_TIMEOUT_MS) || 10000;
const SITEMAP_CHILD_FETCH_LIMIT =
  Number(process.env.SITEMAP_CHILD_FETCH_LIMIT) || 10;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "screenshots";
const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];
const SITELENS_USER_AGENT =
  "SiteLensBot/0.4 (+https://github.com/adiverse-dev/Sitelens)";

module.exports = {
  PORT,
  NAVIGATION_TIMEOUT_MS,
  ROBOTS_TIMEOUT_MS,
  SITEMAP_TIMEOUT_MS,
  SITEMAP_CHILD_FETCH_LIMIT,
  SCREENSHOT_DIR,
  LIGHTHOUSE_CATEGORIES,
  SITELENS_USER_AGENT,
};
