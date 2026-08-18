function parseRobotsDirectives(content) {
  if (!content) {
    return [];
  }

  return content
    .toLowerCase()
    .split(/[,\s]+/)
    .map((directive) => directive.trim())
    .filter(Boolean);
}

function createIndexabilityAudit({ robotsMeta, googlebotMeta }) {
  const robotsDirectives = parseRobotsDirectives(robotsMeta);
  const googlebotDirectives = parseRobotsDirectives(googlebotMeta);
  const directives = [...robotsDirectives, ...googlebotDirectives];
  const issues = [];
  const hasNoindex = directives.includes("noindex");
  const hasNofollow = directives.includes("nofollow");

  if (hasNoindex) {
    issues.push("Page contains noindex directive");
  }

  if (hasNofollow) {
    issues.push("Page contains nofollow directive");
  }

  return {
    indexable: !hasNoindex,
    followable: !hasNofollow,
    robotsMeta,
    googlebotMeta,
    issues,
  };
}

async function collectIndexabilityAudit(page) {
  const metaDirectives = await page.evaluate(() => {
    const getMetaContent = (name) => {
      const element = Array.from(document.querySelectorAll("meta[name]")).find(
        (meta) => meta.getAttribute("name")?.toLowerCase() === name
      );
      const content = element?.getAttribute("content")?.trim();
      return content || null;
    };

    return {
      robotsMeta: getMetaContent("robots"),
      googlebotMeta: getMetaContent("googlebot"),
    };
  });

  return createIndexabilityAudit(metaDirectives);
}

module.exports = {
  collectIndexabilityAudit,
  createIndexabilityAudit,
  parseRobotsDirectives,
};
