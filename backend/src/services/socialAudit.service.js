const { isValidOptionalUrl } = require("../utils/urlValidator");

function getMissingFields(source, requiredFields) {
  return requiredFields.filter((field) => !source[field]);
}

function hasAnyField(source, fields) {
  return fields.some((field) => Boolean(source[field]));
}

function createOpenGraphAudit(openGraphTags) {
  const requiredFields = ["title", "description", "image", "url", "type"];

  return {
    exists: hasAnyField(openGraphTags, requiredFields),
    title: openGraphTags.title || null,
    description: openGraphTags.description || null,
    image: openGraphTags.image || null,
    url: openGraphTags.url || null,
    type: openGraphTags.type || null,
    missingFields: getMissingFields(openGraphTags, requiredFields),
    isImageUrlValid: isValidOptionalUrl(openGraphTags.image),
  };
}

function createTwitterCardAudit(twitterTags) {
  const requiredFields = ["card", "title", "description", "image"];

  return {
    exists: hasAnyField(twitterTags, requiredFields),
    card: twitterTags.card || null,
    title: twitterTags.title || null,
    description: twitterTags.description || null,
    image: twitterTags.image || null,
    missingFields: getMissingFields(twitterTags, requiredFields),
    isImageUrlValid: isValidOptionalUrl(twitterTags.image),
  };
}

async function collectSocialAudit(page) {
  const socialTags = await page.evaluate(() => {
    const getPropertyContent = (property) => {
      const element = document.querySelector(`meta[property="${property}"]`);
      const content = element?.getAttribute("content")?.trim();
      return content || null;
    };

    const getNameContent = (name) => {
      const element = document.querySelector(`meta[name="${name}"]`);
      const content = element?.getAttribute("content")?.trim();
      return content || null;
    };

    return {
      openGraph: {
        title: getPropertyContent("og:title"),
        description: getPropertyContent("og:description"),
        image: getPropertyContent("og:image"),
        url: getPropertyContent("og:url"),
        type: getPropertyContent("og:type"),
      },
      twitterCard: {
        card: getNameContent("twitter:card"),
        title: getNameContent("twitter:title"),
        description: getNameContent("twitter:description"),
        image: getNameContent("twitter:image"),
      },
    };
  });

  return {
    openGraph: createOpenGraphAudit(socialTags.openGraph),
    twitterCard: createTwitterCardAudit(socialTags.twitterCard),
  };
}

module.exports = {
  collectSocialAudit,
  createOpenGraphAudit,
  createTwitterCardAudit,
};
