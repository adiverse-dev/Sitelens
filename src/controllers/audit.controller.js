const {
  collectPageAudit,
  launchAuditBrowser,
} = require("../services/browserAudit.service");
const {
  createFailedLighthouseResult,
  runLighthouseAudit,
} = require("../services/lighthouseAudit.service");
const { auditRobotsTxt } = require("../services/robotsAudit.service");
const {
  generateRecommendations,
} = require("../services/recommendationAudit.service");
const { isValidHttpUrl } = require("../utils/urlValidator");

async function auditWebsite(req, res) {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required",
    });
  }

  if (!isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid HTTP or HTTPS URL",
    });
  }

  let browser;

  try {
    const robotsPromise = auditRobotsTxt(url);
    const browserSession = await launchAuditBrowser();

    browser = browserSession.browser;

    const pageAudit = await collectPageAudit(browserSession.page, url);
    const lighthouse = await runLighthouseAudit(
      url,
      browserSession.remoteDebuggingPort
    ).catch(createFailedLighthouseResult);
    const robots = await robotsPromise;
    const recommendations = generateRecommendations(pageAudit, lighthouse, robots);

    res.json({
      success: true,
      url,
      ...pageAudit,
      robots,
      lighthouse,
      recommendations,
      summary: {
        consoleErrorCount: pageAudit.consoleErrors.length,
        failedRequestCount: pageAudit.failedRequests.length,
        imageMissingAltCount: pageAudit.images.missingAlt,
        robotsIssues: robots.issues.length,
        recommendationCount: recommendations.length,
        lighthouse,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  auditWebsite,
};
