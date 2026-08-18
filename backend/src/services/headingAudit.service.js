async function collectHeadings(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(
      (element) => ({
        level: element.tagName.toUpperCase(),
        text: element.textContent.trim(),
      })
    )
  );
}

function createHeadingHierarchyAudit(headings) {
  const issues = [];
  const h1Count = headings.filter((heading) => heading.level === "H1").length;
  const emptyHeadings = headings.filter((heading) => !heading.text);

  if (h1Count === 0) {
    issues.push("Missing H1 heading");
  }

  if (h1Count > 1) {
    issues.push("Multiple H1 headings found");
  }

  if (emptyHeadings.length > 0) {
    issues.push(`${emptyHeadings.length} empty heading(s) found`);
  }

  let previousLevel = null;

  headings
    .filter((heading) => heading.text)
    .forEach((heading) => {
      const currentLevel = Number(heading.level.replace("H", ""));

      if (previousLevel && currentLevel > previousLevel + 1) {
        issues.push(`Skipped heading level: H${previousLevel} to H${currentLevel}`);
      }

      previousLevel = currentLevel;
    });

  return {
    valid: issues.length === 0,
    headings,
    issues,
  };
}

module.exports = {
  collectHeadings,
  createHeadingHierarchyAudit,
};
