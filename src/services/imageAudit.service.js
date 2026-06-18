async function collectImageAudit(page) {
  return page.locator("img").evaluateAll((elements) => {
    const imagesWithAlt = elements.filter((image) =>
      image.getAttribute("alt")?.trim()
    );

    const missingAltSamples = elements
      .filter((image) => !image.getAttribute("alt")?.trim())
      .slice(0, 10)
      .map((image) => image.currentSrc || image.src || "Unknown image source");

    return {
      total: elements.length,
      withAlt: imagesWithAlt.length,
      missingAlt: elements.length - imagesWithAlt.length,
      missingAltSamples,
    };
  });
}

module.exports = {
  collectImageAudit,
};
