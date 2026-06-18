const {
  ROBOTS_TIMEOUT_MS,
  SITELENS_USER_AGENT,
} = require("../utils/constants");

function createRobotsUrl(url) {
  const parsedUrl = new URL(url);
  return `${parsedUrl.origin}/robots.txt`;
}

function createHomepageUrl(url) {
  const parsedUrl = new URL(url);
  return `${parsedUrl.origin}/`;
}

function createEmptyRobotsAudit(url, overrides = {}) {
  return {
    exists: false,
    url: createRobotsUrl(url),
    statusCode: null,
    allowsHomepage: false,
    blocksAll: false,
    sitemapUrls: [],
    ruleCount: 0,
    issues: [],
    error: null,
    ...overrides,
  };
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": SITELENS_USER_AGENT,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRobotsTxt(content) {
  const groups = [];
  const sitemapUrls = [];
  let currentGroup = null;
  let currentGroupHasRules = false;

  content.split(/\r?\n/).forEach((line) => {
    const cleanLine = line.split("#")[0].trim();

    if (!cleanLine) {
      currentGroup = null;
      currentGroupHasRules = false;
      return;
    }

    if (!cleanLine.includes(":")) {
      return;
    }

    const separatorIndex = cleanLine.indexOf(":");
    const field = cleanLine.slice(0, separatorIndex).trim().toLowerCase();
    const value = cleanLine.slice(separatorIndex + 1).trim();

    if (field === "sitemap") {
      if (value) {
        sitemapUrls.push(value);
      }
      return;
    }

    if (field === "user-agent") {
      const userAgent = value.toLowerCase();

      if (currentGroup && !currentGroupHasRules) {
        currentGroup.userAgents.push(userAgent);
      } else {
        currentGroup = {
          userAgents: [userAgent],
          rules: [],
        };
        groups.push(currentGroup);
      }
      currentGroupHasRules = false;
      return;
    }

    if ((field === "allow" || field === "disallow") && currentGroup) {
      currentGroup.rules.push({
        directive: field,
        path: value,
      });
      currentGroupHasRules = true;
    }
  });

  const rules = groups.flatMap((group) =>
    group.rules.map((rule) => ({
      userAgents: group.userAgents,
      ...rule,
    }))
  );

  return {
    groups,
    rules,
    sitemapUrls: Array.from(new Set(sitemapUrls)),
  };
}

function pathMatchesRobotsRule(pathname, rulePath) {
  if (!rulePath) {
    return false;
  }

  const escapedPattern = rulePath
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regexPattern = rulePath.endsWith("$")
    ? `^${escapedPattern.slice(0, -2)}$`
    : `^${escapedPattern}`;

  return new RegExp(regexPattern).test(pathname);
}

function getGenericRobotsRules(parsedRobots) {
  return parsedRobots.groups
    .filter((group) => group.userAgents.includes("*"))
    .flatMap((group) => group.rules);
}

function getStrongestMatchingRule(applicableRules, pathname) {
  const matchingRules = applicableRules.filter((rule) =>
    pathMatchesRobotsRule(pathname, rule.path)
  );

  if (matchingRules.length === 0) {
    return null;
  }

  return matchingRules.reduce((selectedRule, currentRule) => {
    if (!selectedRule || currentRule.path.length > selectedRule.path.length) {
      return currentRule;
    }

    if (
      currentRule.path.length === selectedRule.path.length &&
      currentRule.directive === "allow"
    ) {
      return currentRule;
    }

    return selectedRule;
  }, null);
}

function checkHomepageAllowed(applicableRules, homepageUrl) {
  const homepagePath = new URL(homepageUrl).pathname;
  const strongestRule = getStrongestMatchingRule(applicableRules, homepagePath);

  if (!strongestRule) {
    return true;
  }

  return strongestRule.directive !== "disallow";
}

function checkBlocksAllCrawlers(applicableRules) {
  const strongestRule = getStrongestMatchingRule(applicableRules, "/");

  return (
    Boolean(strongestRule) &&
    strongestRule.directive === "disallow" &&
    strongestRule.path === "/"
  );
}

function createRobotsIssues({
  exists,
  statusCode,
  content,
  parsedRobots,
  blocksAll,
  allowsHomepage,
}) {
  const issues = [];

  if (!exists) {
    issues.push("robots.txt file is missing");
    return issues;
  }

  if (statusCode !== 200) {
    issues.push(`robots.txt returns non-200 status code: ${statusCode}`);
    return issues;
  }

  if (!content.trim()) {
    issues.push("robots.txt is empty");
  }

  if (blocksAll) {
    issues.push("robots.txt blocks all crawlers");
  }

  if (!allowsHomepage) {
    issues.push("robots.txt blocks the homepage");
  }

  if (parsedRobots.sitemapUrls.length === 0) {
    issues.push("robots.txt does not reference a sitemap");
  }

  return issues;
}

async function auditRobotsTxt(url) {
  const robotsUrl = createRobotsUrl(url);
  const homepageUrl = createHomepageUrl(url);

  try {
    const response = await fetchTextWithTimeout(robotsUrl, ROBOTS_TIMEOUT_MS);
    const statusCode = response.status;
    const exists = statusCode !== 404;

    if (!response.ok) {
      const audit = createEmptyRobotsAudit(url, {
        exists,
        statusCode,
        allowsHomepage: exists,
      });

      return {
        ...audit,
        issues: createRobotsIssues({
          exists,
          statusCode,
          content: "",
          parsedRobots: { sitemapUrls: [] },
          blocksAll: false,
          allowsHomepage: audit.allowsHomepage,
        }),
      };
    }

    const content = await response.text();
    const parsedRobots = parseRobotsTxt(content);
    const applicableRules = getGenericRobotsRules(parsedRobots);
    const allowsHomepage = checkHomepageAllowed(applicableRules, homepageUrl);
    const blocksAll = checkBlocksAllCrawlers(applicableRules);

    const audit = {
      exists: true,
      url: robotsUrl,
      statusCode,
      allowsHomepage,
      blocksAll,
      sitemapUrls: parsedRobots.sitemapUrls,
      ruleCount: parsedRobots.rules.length,
      issues: [],
      error: null,
    };

    return {
      ...audit,
      issues: createRobotsIssues({
        exists: audit.exists,
        statusCode: audit.statusCode,
        content,
        parsedRobots,
        blocksAll,
        allowsHomepage,
      }),
    };
  } catch (error) {
    return createEmptyRobotsAudit(url, {
      issues: ["robots.txt is unreachable"],
      error:
        error.name === "AbortError"
          ? "robots.txt request timed out"
          : error.message,
    });
  }
}

module.exports = {
  auditRobotsTxt,
  parseRobotsTxt,
  checkBlocksAllCrawlers,
  checkHomepageAllowed,
  getGenericRobotsRules,
};
