const assert = require("assert");
const {
  checkBlocksAllCrawlers,
  checkHomepageAllowed,
  getGenericRobotsRules,
  parseRobotsTxt,
} = require("../src/services/robotsAudit.service");

function evaluateRobots(content) {
  const parsedRobots = parseRobotsTxt(content);
  const genericRules = getGenericRobotsRules(parsedRobots);

  return {
    allowsHomepage: checkHomepageAllowed(genericRules, "https://example.com/"),
    blocksAll: checkBlocksAllCrawlers(genericRules),
  };
}

const wikipediaLikeRobots = `
User-agent: *
Disallow: /w/
Disallow: /api/rest_v1/
Sitemap: https://www.wikipedia.org/sitemap.xml
`;

const githubLikeRobots = `
User-agent: *
Disallow: /account-login
Disallow: /sessions
Disallow: /settings/
`;

const vercelLikeRobots = `
User-agent: *
Allow: /
Disallow: /api/
Sitemap: https://vercel.com/sitemap.xml
`;

const shopifyLikeRobots = `
User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /orders
Disallow: /checkouts/
Disallow: /collections/*sort_by*
Disallow: /products/*?variant=
Sitemap: https://store.example.com/sitemap.xml

User-agent: BadBot
Disallow: /
`;

const fullyBlockedRobots = `
User-agent: *
Disallow: /
`;

const allowOverridesDisallowRobots = `
User-agent: *
Disallow: /
Allow: /
`;

assert.deepStrictEqual(evaluateRobots(wikipediaLikeRobots), {
  allowsHomepage: true,
  blocksAll: false,
});

assert.deepStrictEqual(evaluateRobots(githubLikeRobots), {
  allowsHomepage: true,
  blocksAll: false,
});

assert.deepStrictEqual(evaluateRobots(vercelLikeRobots), {
  allowsHomepage: true,
  blocksAll: false,
});

assert.deepStrictEqual(evaluateRobots(shopifyLikeRobots), {
  allowsHomepage: true,
  blocksAll: false,
});

assert.deepStrictEqual(evaluateRobots(fullyBlockedRobots), {
  allowsHomepage: false,
  blocksAll: true,
});

assert.deepStrictEqual(evaluateRobots(allowOverridesDisallowRobots), {
  allowsHomepage: true,
  blocksAll: false,
});

console.log("robotsAudit examples passed");
