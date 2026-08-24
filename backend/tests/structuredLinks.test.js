"use strict";

const assert = require("assert");
const http = require("http");
const { chromium } = require("playwright");
const { discoverLinks } = require("../src/services/crawler.service");

async function runTests() {
  const server = http.createServer((req, res) => {
    const port = server.address().port;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body>
      <a href="http://127.0.0.1:${port}/absolute#team">  Absolute\n link  </a>
      <a href="/root-relative/">Root relative</a>
      <a href="../relative">Relative</a>
      <a href="https://outside.invalid/path/#fragment" rel="NoFoLLoW sponsored NOFOLLOW">External</a>
      <a href="#section">Fragment</a>
      <a href="   ">Empty</a>
      <a href="mailto:test@example.com">Email</a>
      <a href="tel:+15551234567">Call</a>
      <a href="javascript:void(0)">JavaScript</a>
      <a href="data:text/plain,hello">Data</a>
      <a href="blob:https://example.com/id">Blob</a>
      <a href="http://%">Malformed</a>
      <a href="/duplicate#first">First duplicate</a>
      <a href="/duplicate/">Second duplicate</a>
    </body></html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const sourceUrl = `http://127.0.0.1:${port}/products/catalog/`;
  const seedUrl = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(sourceUrl);
    const links = await discoverLinks(page, sourceUrl, seedUrl);

    assert.deepStrictEqual(links.summary, {
      internal: 5,
      external: 1,
      discarded: 8,
    });

    const absolute = links.internal.find((link) => link.rawHref.includes("/absolute"));
    assert.ok(absolute, "absolute internal link should be retained");
    assert.strictEqual(absolute.sourceUrl, sourceUrl);
    assert.strictEqual(absolute.targetUrl, `${seedUrl}absolute#team`);
    assert.strictEqual(absolute.normalizedUrl, `${seedUrl}absolute`);
    assert.strictEqual(absolute.anchorText, "Absolute link");
    assert.strictEqual(absolute.classification, "internal");
    assert.deepStrictEqual(absolute.rel, []);
    assert.strictEqual(absolute.nofollow, false);

    const rootRelative = links.internal.find((link) => link.rawHref === "/root-relative/");
    assert.strictEqual(rootRelative.targetUrl, `${seedUrl}root-relative/`);
    assert.strictEqual(rootRelative.normalizedUrl, `${seedUrl}root-relative`);

    const relative = links.internal.find((link) => link.rawHref === "../relative");
    assert.strictEqual(relative.targetUrl, `${seedUrl}products/relative`);
    assert.strictEqual(relative.normalizedUrl, `${seedUrl}products/relative`);

    const external = links.external[0];
    assert.strictEqual(external.classification, "external");
    assert.strictEqual(external.normalizedUrl, "https://outside.invalid/path");
    assert.deepStrictEqual(external.rel, ["nofollow", "sponsored"]);
    assert.strictEqual(external.nofollow, true);

    const duplicateRecords = links.internal.filter(
      (link) => link.normalizedUrl === `${seedUrl}duplicate`
    );
    assert.strictEqual(duplicateRecords.length, 2);
    assert.deepStrictEqual(
      duplicateRecords.map((link) => link.anchorText),
      ["First duplicate", "Second duplicate"]
    );

    const discardedByHref = new Map(
      links.discarded.map((link) => [link.rawHref, link])
    );
    assert.strictEqual(discardedByHref.get("#section").reason, "fragment-only");
    assert.strictEqual(discardedByHref.get("   ").reason, "empty-href");
    assert.strictEqual(discardedByHref.get("http://%").reason, "malformed-url");

    for (const rawHref of [
      "mailto:test@example.com",
      "tel:+15551234567",
      "javascript:void(0)",
      "data:text/plain,hello",
      "blob:https://example.com/id",
    ]) {
      const discarded = discardedByHref.get(rawHref);
      assert.strictEqual(discarded.reason, "unsupported-scheme");
      assert.strictEqual(discarded.targetUrl, null);
      assert.strictEqual(discarded.normalizedUrl, null);
    }

    assert.ok(
      [...links.internal, ...links.external, ...links.discarded].every(
        (link) => link.sourceUrl === sourceUrl
      ),
      "every link record should preserve its source URL"
    );

    console.log("Structured link contract tests passed");
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

runTests().catch((error) => {
  console.error("Structured link contract tests failed:", error);
  process.exit(1);
});
