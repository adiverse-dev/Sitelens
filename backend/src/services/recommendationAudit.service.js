function addRecommendation(recommendations, severity, category, issue, fix) {
  recommendations.push({
    severity,
    category,
    issue,
    fix,
  });
}

function generateRecommendations(pageAudit, lighthouse, robots, sitemap) {
  const recommendations = [];
  const {
    seo,
    images,
    canonical,
    openGraph,
    twitterCard,
    headingHierarchy,
    indexability,
  } = pageAudit;

  if (seo.h1.count === 0) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing H1 heading",
      "Add one clear H1 that describes the primary topic of the page."
    );
  }

  if (seo.h1.count > 1) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Multiple H1 headings found",
      "Use a single H1 for the main page topic and structure subsections with H2-H6 headings."
    );
  }

  if (!seo.metaDescription.exists) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing meta description",
      "Add a concise meta description that summarizes the page content."
    );
  } else if (
    seo.metaDescription.length < 50 ||
    seo.metaDescription.length > 160
  ) {
    addRecommendation(
      recommendations,
      "low",
      "SEO",
      "Meta description length is outside the recommended range",
      "Keep the meta description roughly between 50 and 160 characters."
    );
  }

  if (!canonical.exists) {
    addRecommendation(
      recommendations,
      "high",
      "SEO",
      "Missing canonical tag",
      "Add a canonical tag that points to the preferred URL for this page."
    );
  } else {
    if (!canonical.isValidUrl) {
      addRecommendation(
        recommendations,
        "high",
        "SEO",
        "Canonical URL is invalid",
        "Use a valid HTTP or HTTPS canonical URL."
      );
    }

    if (canonical.multipleCanonicals) {
      addRecommendation(
        recommendations,
        "high",
        "SEO",
        "Multiple canonical tags detected",
        "Use exactly one canonical tag per page."
      );
    }
  }

  if (robots.issues.includes("robots.txt file is missing")) {
    addRecommendation(
      recommendations,
      "medium",
      "Crawlability",
      "robots.txt file is missing",
      "Create a robots.txt file in the website root."
    );
  }

  if (robots.issues.some((issue) => issue.startsWith("robots.txt returns non-200"))) {
    addRecommendation(
      recommendations,
      "medium",
      "Crawlability",
      "robots.txt returns a non-200 status code",
      "Make sure robots.txt is reachable at the website root and returns HTTP 200."
    );
  }

  if (robots.issues.includes("robots.txt is unreachable")) {
    addRecommendation(
      recommendations,
      "medium",
      "Crawlability",
      "robots.txt is unreachable",
      "Check server availability, redirects, DNS, and timeout behavior for robots.txt."
    );
  }

  if (robots.issues.includes("robots.txt is empty")) {
    addRecommendation(
      recommendations,
      "low",
      "Crawlability",
      "robots.txt is empty",
      "Add crawl directives and a Sitemap directive if the site has a sitemap."
    );
  }

  if (robots.blocksAll) {
    addRecommendation(
      recommendations,
      "high",
      "Crawlability",
      "robots.txt blocks all crawlers",
      "Remove Disallow: / from the User-agent * section."
    );
  }

  if (robots.exists && robots.statusCode === 200 && !robots.allowsHomepage) {
    addRecommendation(
      recommendations,
      "high",
      "Crawlability",
      "robots.txt blocks the homepage",
      "Update robots.txt so search engines can crawl the homepage."
    );
  }

  if (robots.issues.includes("robots.txt does not reference a sitemap")) {
    addRecommendation(
      recommendations,
      "medium",
      "Crawlability",
      "robots.txt does not reference a sitemap",
      "Add a Sitemap directive to robots.txt."
    );
  }

  if (sitemap.issues.includes("Sitemap is missing")) {
    addRecommendation(
      recommendations,
      "high",
      "Indexability",
      "Sitemap is missing",
      "Create and submit a sitemap.xml file."
    );
  }

  if (sitemap.issues.includes("Sitemap is unreachable")) {
    addRecommendation(
      recommendations,
      "medium",
      "Indexability",
      "Sitemap is unreachable",
      "Check sitemap URL availability, redirects, DNS, and timeout behavior."
    );
  }

  if (sitemap.issues.some((issue) => issue.startsWith("Sitemap returns non-200"))) {
    addRecommendation(
      recommendations,
      "medium",
      "Indexability",
      "Sitemap returns a non-200 status code",
      "Make sure sitemap.xml is reachable and returns HTTP 200."
    );
  }

  if (sitemap.issues.includes("Sitemap XML is invalid")) {
    addRecommendation(
      recommendations,
      "high",
      "Indexability",
      "Sitemap XML is invalid",
      "Fix sitemap.xml so it uses valid XML with urlset or sitemapindex markup."
    );
  }

  if (sitemap.issues.includes("Sitemap contains no URLs")) {
    addRecommendation(
      recommendations,
      "medium",
      "Indexability",
      "Sitemap contains no URLs",
      "Populate sitemap.xml with indexable URLs."
    );
  }

  if (sitemap.issues.includes("Sitemap does not contain lastmod tags")) {
    addRecommendation(
      recommendations,
      "low",
      "Indexability",
      "Sitemap does not contain lastmod tags",
      "Add lastmod tags to help search engines understand content freshness."
    );
  }

  if (indexability.issues.includes("Page contains noindex directive")) {
    addRecommendation(
      recommendations,
      "high",
      "Indexability",
      "Page contains noindex directive",
      "Remove noindex if the page should appear in search results."
    );
  }

  if (indexability.issues.includes("Page contains nofollow directive")) {
    addRecommendation(
      recommendations,
      "medium",
      "Indexability",
      "Page contains nofollow directive",
      "Remove nofollow if search engines should follow links on this page."
    );
  }

  if (openGraph.missingFields.includes("image")) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Missing Open Graph image",
      "Add an og:image tag so shared links have a strong preview image."
    );
  }

  if (openGraph.image && !openGraph.isImageUrlValid) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Open Graph image URL is invalid",
      "Use a valid absolute HTTP or HTTPS URL for og:image."
    );
  }

  if (openGraph.missingFields.length > 0) {
    addRecommendation(
      recommendations,
      "low",
      "Social SEO",
      "Open Graph metadata is incomplete",
      `Add missing Open Graph fields: ${openGraph.missingFields.join(", ")}.`
    );
  }

  if (twitterCard.missingFields.includes("image")) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Missing Twitter Card image",
      "Add twitter:image so posts have a visual preview."
    );
  }

  if (twitterCard.image && !twitterCard.isImageUrlValid) {
    addRecommendation(
      recommendations,
      "medium",
      "Social SEO",
      "Twitter Card image URL is invalid",
      "Use a valid absolute HTTP or HTTPS URL for twitter:image."
    );
  }

  if (twitterCard.missingFields.length > 0) {
    addRecommendation(
      recommendations,
      "low",
      "Social SEO",
      "Twitter Card metadata is incomplete",
      `Add missing Twitter Card fields: ${twitterCard.missingFields.join(", ")}.`
    );
  }

  if (images.missingAlt > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Accessibility",
      "Images are missing alt text",
      "Add meaningful alt text to informative images and empty alt text to decorative images."
    );
  }

  headingHierarchy.issues.forEach((issue) => {
    if (issue.includes("Multiple H1") || issue.includes("Missing H1")) {
      return;
    }

    addRecommendation(
      recommendations,
      "medium",
      "Content Structure",
      issue,
      "Use a logical heading outline without empty headings or skipped levels."
    );
  });

  if (lighthouse.performance !== null && lighthouse.performance < 50) {
    addRecommendation(
      recommendations,
      "high",
      "Performance",
      "Lighthouse performance score is below 50",
      "Optimize render-blocking resources, JavaScript execution, images, and server response time."
    );
  }

  if (lighthouse.accessibility !== null && lighthouse.accessibility < 80) {
    addRecommendation(
      recommendations,
      "medium",
      "Accessibility",
      "Lighthouse accessibility score is below 80",
      "Review Lighthouse accessibility findings and fix labels, contrast, semantics, and keyboard issues."
    );
  }

  if (pageAudit.consoleErrors.length > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Reliability",
      "Console errors were detected",
      "Fix JavaScript errors shown in the browser console."
    );
  }

  if (pageAudit.failedRequests.length > 0) {
    addRecommendation(
      recommendations,
      "medium",
      "Reliability",
      "Failed network requests were detected",
      "Fix broken assets, API calls, or third-party requests returning failures."
    );
  }

  return recommendations;
}

module.exports = {
  generateRecommendations,
};
