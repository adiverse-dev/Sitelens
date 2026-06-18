const {
  SITEMAP_CHILD_FETCH_LIMIT,
  SITEMAP_TIMEOUT_MS,
  SITELENS_USER_AGENT,
} = require("../utils/constants");
const { isValidHttpUrl } = require("../utils/urlValidator");

function createDefaultSitemapUrl(url) {
  const parsedUrl = new URL(url);
  return `${parsedUrl.origin}/sitemap.xml`;
}

function createEmptySitemapAudit(url, overrides = {}) {
  return {
    exists: false,
    url,
    statusCode: null,
    validXml: false,
    urlCount: 0,
    hasLastmod: false,
    issues: [],
    error: null,
    ...overrides,
  };
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": SITELENS_USER_AGENT,
      },
    });
    const text = await response.text().catch(() => "");

    return {
      response,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function hasBalancedTags(xml, tagName) {
  const openTags = xml.match(new RegExp(`<${tagName}(\\s|>)`, "gi")) || [];
  const closeTags = xml.match(new RegExp(`</${tagName}>`, "gi")) || [];
  return openTags.length === closeTags.length;
}

function isProbablyValidSitemapXml(xml) {
  const cleanXml = stripXmlComments(xml).trim();

  if (!cleanXml) {
    return false;
  }

  const hasSitemapRoot =
    /<urlset(\s|>)/i.test(cleanXml) || /<sitemapindex(\s|>)/i.test(cleanXml);

  return (
    hasSitemapRoot &&
    hasBalancedTags(cleanXml, "url") &&
    hasBalancedTags(cleanXml, "sitemap") &&
    hasBalancedTags(cleanXml, "loc")
  );
}

function extractTagValues(xml, tagName) {
  const values = [];
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "gi");
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const value = match[1].trim();

    if (value) {
      values.push(value);
    }
  }

  return values;
}

function parseSitemapXml(xml) {
  const cleanXml = stripXmlComments(xml);
  const type = /<sitemapindex(\s|>)/i.test(cleanXml)
    ? "sitemapindex"
    : "urlset";
  const validXml = isProbablyValidSitemapXml(cleanXml);

  if (!validXml) {
    return {
      type: null,
      validXml: false,
      urlCount: 0,
      hasLastmod: false,
      sitemapUrls: [],
    };
  }

  if (type === "sitemapindex") {
    const sitemapBlocks =
      cleanXml.match(/<sitemap(?:\s[^>]*)?>[\s\S]*?<\/sitemap>/gi) || [];
    const sitemapUrls = sitemapBlocks
      .map((block) => extractTagValues(block, "loc")[0])
      .filter(Boolean);

    return {
      type,
      validXml,
      urlCount: 0,
      hasLastmod: /<lastmod(?:\s[^>]*)?>[\s\S]*?<\/lastmod>/i.test(cleanXml),
      sitemapUrls,
    };
  }

  const urlBlocks = cleanXml.match(/<url(?:\s[^>]*)?>[\s\S]*?<\/url>/gi) || [];

  return {
    type,
    validXml,
    urlCount: urlBlocks.length,
    hasLastmod: urlBlocks.some((block) =>
      /<lastmod(?:\s[^>]*)?>[\s\S]*?<\/lastmod>/i.test(block)
    ),
    sitemapUrls: [],
  };
}

function createSitemapIssues({ exists, statusCode, validXml, urlCount, hasLastmod }) {
  const issues = [];

  if (!exists) {
    issues.push("Sitemap is missing");
    return issues;
  }

  if (statusCode !== 200) {
    issues.push(`Sitemap returns non-200 status code: ${statusCode}`);
    return issues;
  }

  if (!validXml) {
    issues.push("Sitemap XML is invalid");
    return issues;
  }

  if (urlCount === 0) {
    issues.push("Sitemap contains no URLs");
  }

  if (!hasLastmod) {
    issues.push("Sitemap does not contain lastmod tags");
  }

  return issues;
}

function getSitemapCandidates(url, robots) {
  const robotsSitemapUrls = Array.isArray(robots?.sitemapUrls)
    ? robots.sitemapUrls.filter(isValidHttpUrl)
    : [];

  if (robotsSitemapUrls.length > 0) {
    return Array.from(new Set(robotsSitemapUrls));
  }

  return [createDefaultSitemapUrl(url)];
}

async function auditChildSitemaps(sitemapUrls) {
  const childSitemaps = sitemapUrls.slice(0, SITEMAP_CHILD_FETCH_LIMIT);
  const results = await Promise.allSettled(
    childSitemaps.map(async (url) => {
      const { response, text } = await fetchTextWithTimeout(
        url,
        SITEMAP_TIMEOUT_MS
      );

      if (!response.ok) {
        return {
          url,
          statusCode: response.status,
          validXml: false,
          urlCount: 0,
          hasLastmod: false,
        };
      }

      const parsed = parseSitemapXml(text);

      return {
        url,
        statusCode: response.status,
        validXml: parsed.validXml,
        urlCount: parsed.urlCount,
        hasLastmod: parsed.hasLastmod,
      };
    })
  );

  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

async function auditSingleSitemap(url) {
  try {
    const { response, text } = await fetchTextWithTimeout(
      url,
      SITEMAP_TIMEOUT_MS
    );
    const statusCode = response.status;

    if (!response.ok) {
      const exists = statusCode !== 404;

      return createEmptySitemapAudit(url, {
        exists,
        statusCode,
        issues: createSitemapIssues({
          exists,
          statusCode,
          validXml: false,
          urlCount: 0,
          hasLastmod: false,
        }),
      });
    }

    const parsed = parseSitemapXml(text);
    let urlCount = parsed.urlCount;
    let hasLastmod = parsed.hasLastmod;
    let childSitemaps = [];

    if (parsed.type === "sitemapindex" && parsed.sitemapUrls.length > 0) {
      childSitemaps = await auditChildSitemaps(parsed.sitemapUrls);
      urlCount = childSitemaps.reduce(
        (total, child) => total + child.urlCount,
        0
      );
      hasLastmod = childSitemaps.some((child) => child.hasLastmod);
    }

    const audit = {
      exists: true,
      url,
      statusCode,
      validXml: parsed.validXml,
      urlCount,
      hasLastmod,
      issues: [],
      error: null,
    };

    return {
      ...audit,
      issues: createSitemapIssues(audit),
    };
  } catch (error) {
    return createEmptySitemapAudit(url, {
      issues: ["Sitemap is unreachable"],
      error:
        error.name === "AbortError"
          ? "Sitemap request timed out"
          : error.message,
    });
  }
}

async function auditSitemap(url, robots) {
  const candidates = getSitemapCandidates(url, robots);
  const audits = [];

  for (const candidate of candidates) {
    const audit = await auditSingleSitemap(candidate);
    audits.push(audit);

    if (audit.exists && audit.statusCode === 200) {
      return audit;
    }
  }

  return audits[0] || createEmptySitemapAudit(createDefaultSitemapUrl(url), {
    issues: ["Sitemap is missing"],
  });
}

module.exports = {
  auditSitemap,
  parseSitemapXml,
};
