const { LIGHTHOUSE_CATEGORIES } = require("../utils/constants");

let lighthouseLoader;

async function getLighthouse() {
  if (!lighthouseLoader) {
    lighthouseLoader = import("lighthouse").then(
      (lighthouseModule) => lighthouseModule.default || lighthouseModule
    );
  }

  return lighthouseLoader;
}

function toPercentageScore(category) {
  if (!category || typeof category.score !== "number") {
    return null;
  }

  return Math.round(category.score * 100);
}

function formatLighthouseResult(lhr) {
  return {
    performance: toPercentageScore(lhr.categories.performance),
    accessibility: toPercentageScore(lhr.categories.accessibility),
    bestPractices: toPercentageScore(lhr.categories["best-practices"]),
    seo: toPercentageScore(lhr.categories.seo),
    error: null,
  };
}

function createFailedLighthouseResult(error) {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    error: error.message,
  };
}

async function runLighthouseAudit(url, port) {
  const lighthouse = await getLighthouse();
  const runnerResult = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: LIGHTHOUSE_CATEGORIES,
  });

  if (!runnerResult?.lhr) {
    throw new Error("Lighthouse did not return a valid report");
  }

  return formatLighthouseResult(runnerResult.lhr);
}

module.exports = {
  runLighthouseAudit,
  createFailedLighthouseResult,
};
