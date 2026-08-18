const { isValidHttpUrl } = require("../utils/urlValidator");

function createCanonicalAudit(canonicalTags) {
  const firstCanonical = canonicalTags[0] || null;
  const canonicalUrl = firstCanonical?.rawHref || null;

  return {
    exists: canonicalTags.length > 0,
    url: canonicalUrl,
    multipleCanonicals: canonicalTags.length > 1,
    isValidUrl: canonicalUrl ? isValidHttpUrl(canonicalUrl) : false,
  };
}

async function collectSeoAudit(page, headings) {
  const h1Texts = headings
    .filter((heading) => heading.level === "H1" && heading.text)
    .map((heading) => heading.text);

  const metaDescription = await page
    .locator('meta[name="description"]')
    .first()
    .getAttribute("content")
    .catch(() => null);

  const canonicalTags = await page.evaluate(() =>
    Array.from(document.querySelectorAll("link[rel]"))
      .filter((link) => {
        const relValue = link.getAttribute("rel") || "";
        return relValue.toLowerCase().split(/\s+/).includes("canonical");
      })
      .map((link) => {
        const rawHref = (link.getAttribute("href") || "").trim();

        return {
          rawHref,
          resolvedHref: rawHref ? link.href : null,
        };
      })
  );

  return {
    seo: {
      h1: {
        count: h1Texts.length,
        texts: h1Texts,
        hasSingleH1: h1Texts.length === 1,
      },
      metaDescription: {
        exists: Boolean(metaDescription),
        content: metaDescription,
        length: metaDescription ? metaDescription.length : 0,
      },
    },
    canonical: createCanonicalAudit(canonicalTags),
  };
}

module.exports = {
  collectSeoAudit,
  createCanonicalAudit,
};
