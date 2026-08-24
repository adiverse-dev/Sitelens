/**
 * tests/urlDiscovery.test.js
 *
 * Phase 5.2 — URL Discovery Tests
 *
 * Strategy:
 *   Spins up a local deterministic HTTP server serving hand-crafted HTML pages.
 *   Navigates a real Playwright page to each test URL.
 *   Calls discoverLinks() and asserts the resulting classification.
 *
 *   No third-party websites are used.  No network requests leave localhost.
 *
 * Tests:
 *   1.  Absolute same-domain URL              → sameDomain
 *   2.  Root-relative URL                     → sameDomain (resolved correctly)
 *   3.  Relative URL (../)                    → sameDomain (correct absolute URL)
 *   4.  External HTTP URL                     → external
 *   5.  External HTTPS URL                    → external
 *   6.  Fragment-only (#section)              → discarded
 *   7.  mailto:                               → discarded
 *   8.  tel:                                  → discarded
 *   9.  javascript:void(0)                    → discarded
 *   10. Empty href                            → discarded
 *   11. Malformed URL                         → discarded without throwing
 *   12. Multiple links mixed categories       → all categorized correctly
 *   13. Duplicate links (NOT deduplicated)    → duplicates preserved
 *   14. data: href                            → discarded
 *   15. blob: href                            → discarded
 *   16. HTTPS same-domain link               → sameDomain (protocol-agnostic hostname match)
 */

"use strict";

const http      = require("http");
const { chromium } = require("playwright");
const { discoverLinks: discoverStructuredLinks } = require("../src/services/crawler.service");

async function discoverLinks(page, baseUrl) {
  const links = await discoverStructuredLinks(page, baseUrl);

  return {
    sameDomain: links.internal.map((link) => link.targetUrl),
    external: links.external.map((link) => link.targetUrl),
    discarded: links.discarded.map((link) => link.rawHref),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

/**
 * Starts a local HTTP server that serves different HTML depending on the
 * requested path.  Returns { server, baseUrl, close }.
 *
 * Routes are defined as { [path]: htmlString }.
 */
async function startHtmlServer(routes) {
  const server = http.createServer((req, res) => {
    const html = routes[req.url] || routes["/"] || "<html><body></body></html>";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl  = `http://127.0.0.1:${port}`;

  return {
    server,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n=== PHASE 5.2 — URL Discovery Tests ===\n");

  const browser = await chromium.launch({ headless: true });

  try {
    // ── Test 1: Absolute same-domain URL ─────────────────────────────────────
    console.log("[ Test 1 ] Absolute same-domain URL");
    {
      const { server, baseUrl, close } = await startHtmlServer({
        "/": `<html><body>
          <a href="${"http://REPLACED/about"}">About</a>
        </body></html>`,
      });
      // We need to inject the actual baseUrl into the HTML — build it after server starts.
      server.close();

      // Build a fresh server with the real port embedded in the HTML.
      const { server: srv, baseUrl: base, close: cls } = await startHtmlServer({
        "/": `<html><body><a href="${""}">placeholder</a></body></html>`,
      });
      srv.close();

      // Simpler: use a single server but build HTML after knowing port.
      const innerSrv = http.createServer((req, res) => {
        const port = innerSrv.address().port;
        const html = `<html><body>
          <a href="http://127.0.0.1:${port}/about">About</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port1  = innerSrv.address().port;
      const base1  = `http://127.0.0.1:${port1}`;

      const page = await browser.newPage();
      await page.goto(base1);
      const result = await discoverLinks(page, base1);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.sameDomain.length === 1,                           "Test 1 — 1 sameDomain link");
      assert(result.sameDomain[0] === `${base1}/about`,               "Test 1 — resolved correctly");
      assert(result.external.length   === 0,                           "Test 1 — no external links");
      assert(result.discarded.length  === 0,                           "Test 1 — no discarded");
    }

    // ── Test 2: Root-relative URL (/about) ───────────────────────────────────
    console.log("\n[ Test 2 ] Root-relative URL");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body><a href="/about">About</a></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port2 = innerSrv.address().port;
      const base2 = `http://127.0.0.1:${port2}`;

      const page = await browser.newPage();
      await page.goto(base2);
      const result = await discoverLinks(page, base2);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.sameDomain.length === 1,                        "Test 2 — 1 sameDomain link");
      assert(result.sameDomain[0] === `${base2}/about`,            "Test 2 — /about resolved to absolute URL");
      assert(result.external.length  === 0,                         "Test 2 — no external");
      assert(result.discarded.length === 0,                         "Test 2 — no discarded");
    }

    // ── Test 3: Relative URL (../contact from /products/) ────────────────────
    console.log("\n[ Test 3 ] Relative URL (../)");
    {
      const innerSrv = http.createServer((req, res) => {
        // Serve /products/ with a relative link ../contact
        const html = `<html><body><a href="../contact">Contact</a></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port3 = innerSrv.address().port;
      const base3 = `http://127.0.0.1:${port3}/products/`;

      const page = await browser.newPage();
      // Navigate to the products/ page so the browser sets the correct base.
      const srv3Url = `http://127.0.0.1:${port3}/products/`;
      await page.goto(srv3Url);
      const result = await discoverLinks(page, srv3Url);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      // ../contact from /products/ → /contact
      const expected = `http://127.0.0.1:${port3}/contact`;
      assert(result.sameDomain.length === 1,             "Test 3 — 1 sameDomain link");
      assert(result.sameDomain[0] === expected,          "Test 3 — ../contact resolved to /contact");
      assert(result.external.length  === 0,              "Test 3 — no external");
      assert(result.discarded.length === 0,              "Test 3 — no discarded");
    }

    // ── Test 4 + 5: External HTTP and HTTPS URLs ──────────────────────────────
    console.log("\n[ Test 4+5 ] External URLs");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body>
          <a href="http://google.com">Google HTTP</a>
          <a href="https://facebook.com/page">Facebook HTTPS</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port45 = innerSrv.address().port;
      const base45 = `http://127.0.0.1:${port45}`;

      const page = await browser.newPage();
      await page.goto(base45);
      const result = await discoverLinks(page, base45);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.sameDomain.length === 0,                           "Test 4+5 — no same-domain");
      assert(result.external.length   === 2,                           "Test 4+5 — 2 external links");
      assert(result.external.some(u => u.includes("google.com")),      "Test 4 — google.com is external");
      assert(result.external.some(u => u.includes("facebook.com")),    "Test 5 — facebook.com is external");
      assert(result.discarded.length  === 0,                           "Test 4+5 — no discarded");
    }

    // ── Test 6: Fragment-only (#section) ─────────────────────────────────────
    console.log("\n[ Test 6 ] Fragment-only href");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body><a href="#section">Jump</a></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port6 = innerSrv.address().port;
      const base6 = `http://127.0.0.1:${port6}`;

      const page = await browser.newPage();
      await page.goto(base6);
      const result = await discoverLinks(page, base6);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.discarded.length  === 1,  "Test 6 — 1 discarded (fragment)");
      assert(result.discarded[0]      === "#section", "Test 6 — raw value preserved");
      assert(result.sameDomain.length === 0,  "Test 6 — no same-domain");
      assert(result.external.length   === 0,  "Test 6 — no external");
    }

    // ── Tests 7–9: Discarded schemes (mailto, tel, javascript) ───────────────
    console.log("\n[ Test 7–9 ] Discarded schemes (mailto / tel / javascript)");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body>
          <a href="mailto:test@example.com">Email</a>
          <a href="tel:+911234567890">Call</a>
          <a href="javascript:void(0)">JS</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port79 = innerSrv.address().port;
      const base79 = `http://127.0.0.1:${port79}`;

      const page = await browser.newPage();
      await page.goto(base79);
      const result = await discoverLinks(page, base79);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.discarded.length  === 3,                                  "Test 7–9 — 3 discarded");
      assert(result.discarded.some(d => d.startsWith("mailto:")),             "Test 7 — mailto: discarded");
      assert(result.discarded.some(d => d.startsWith("tel:")),               "Test 8 — tel: discarded");
      assert(result.discarded.some(d => d.startsWith("javascript:")),        "Test 9 — javascript: discarded");
      assert(result.sameDomain.length === 0,                                  "Test 7–9 — no same-domain");
      assert(result.external.length   === 0,                                  "Test 7–9 — no external");
    }

    // ── Test 10: Empty href ───────────────────────────────────────────────────
    console.log("\n[ Test 10 ] Empty href");
    {
      const innerSrv = http.createServer((req, res) => {
        // href="" — getAttribute returns "" 
        const html = `<html><body><a href="">Empty</a></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port10 = innerSrv.address().port;
      const base10 = `http://127.0.0.1:${port10}`;

      const page = await browser.newPage();
      await page.goto(base10);
      const result = await discoverLinks(page, base10);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.discarded.length  === 1,  "Test 10 — empty href discarded");
      assert(result.sameDomain.length === 0,  "Test 10 — no same-domain");
      assert(result.external.length   === 0,  "Test 10 — no external");
    }

    // ── Test 11: Malformed URL ────────────────────────────────────────────────
    // A "malformed" URL in Phase 5.2 context means one that new URL() throws on.
    // Note: "::invalid::url" is NOT malformed — it resolves as a same-domain relative
    // path (http://host/::invalid::url). Truly malformed examples use broken percent-
    // encoding inside authority components, which new URL() rejects.
    console.log("\n[ Test 11 ] Malformed URL (does not throw)");
    {
      const innerSrv = http.createServer((req, res) => {
        // "http://%" — invalid percent-encoding in host → new URL() throws → discarded.
        // "//example.com%/path" — malformed authority → new URL() throws → discarded.
        const html = `<html><body>
          <a href="http://%">Broken1</a>
          <a href="//example.com%/path">Broken2</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port11 = innerSrv.address().port;
      const base11 = `http://127.0.0.1:${port11}`;

      const page = await browser.newPage();
      await page.goto(base11);

      let threw = false;
      let result;
      try {
        result = await discoverLinks(page, base11);
      } catch (_) {
        threw = true;
      }
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(!threw,                          "Test 11 — malformed URL does NOT throw");
      assert(result.sameDomain.length === 0,  "Test 11 — no same-domain");
      assert(result.external.length   === 0,  "Test 11 — no external");
      assert(result.discarded.length  === 2,  "Test 11 — both malformed URLs discarded");
    }

    // ── Test 11b: Colon-prefixed relative paths resolve as same-domain ────────
    // Documents correct URL spec behavior: "::path" is a relative URL that
    // resolves against the base host → sameDomain. NOT discarded.
    console.log("\n[ Test 11b ] Colon-relative path → same-domain (correct URL spec behavior)");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body>
          <a href="::relative-path">Colon relative</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port11b = innerSrv.address().port;
      const base11b = `http://127.0.0.1:${port11b}`;

      const page = await browser.newPage();
      await page.goto(base11b);
      const result = await discoverLinks(page, base11b);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      // "::relative-path" resolves to "http://127.0.0.1:PORT/::relative-path"
      // → same-domain. Implementation is CORRECT — this is URL spec behavior.
      assert(result.sameDomain.length === 1,  "Test 11b — colon-relative resolves as same-domain");
      assert(result.external.length   === 0,  "Test 11b — no external");
      assert(result.discarded.length  === 0,  "Test 11b — not discarded");
    }


    // ── Test 12: Multiple mixed-category links ────────────────────────────────
    console.log("\n[ Test 12 ] Multiple links, all categories");
    {
      const innerSrv = http.createServer((req, res) => {
        const port = innerSrv.address().port;
        const html = `<html><body>
          <a href="http://127.0.0.1:${port}/about">About</a>
          <a href="/contact">Contact</a>
          <a href="https://external.example.com/page">External</a>
          <a href="mailto:hello@example.com">Mail</a>
          <a href="#top">Top</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port12 = innerSrv.address().port;
      const base12 = `http://127.0.0.1:${port12}`;

      const page = await browser.newPage();
      await page.goto(base12);
      const result = await discoverLinks(page, base12);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.sameDomain.length === 2,                                   "Test 12 — 2 same-domain");
      assert(result.sameDomain.some(u => u.endsWith("/about")),               "Test 12 — /about in sameDomain");
      assert(result.sameDomain.some(u => u.endsWith("/contact")),             "Test 12 — /contact in sameDomain");
      assert(result.external.length   === 1,                                   "Test 12 — 1 external");
      assert(result.external[0].includes("external.example.com"),             "Test 12 — external.example.com correct");
      assert(result.discarded.length  === 2,                                   "Test 12 — 2 discarded");
      assert(result.discarded.some(d => d.startsWith("mailto:")),             "Test 12 — mailto discarded");
      assert(result.discarded.some(d => d === "#top"),                        "Test 12 — #top discarded");
    }

    // ── Test 13: Duplicate links — NOT deduplicated (intentional) ─────────────
    console.log("\n[ Test 13 ] Duplicate links are preserved (dedup is Phase 5.5)");
    {
      const innerSrv = http.createServer((req, res) => {
        const port = innerSrv.address().port;
        const html = `<html><body>
          <a href="http://127.0.0.1:${port}/about">About 1</a>
          <a href="http://127.0.0.1:${port}/about">About 2</a>
          <a href="http://127.0.0.1:${port}/about">About 3</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port13 = innerSrv.address().port;
      const base13 = `http://127.0.0.1:${port13}`;

      const page = await browser.newPage();
      await page.goto(base13);
      const result = await discoverLinks(page, base13);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      // All 3 identical URLs must remain — dedup is NOT Phase 5.2's job.
      assert(result.sameDomain.length === 3,   "Test 13 — duplicates preserved (3, not 1)");
      assert(result.external.length   === 0,   "Test 13 — no external");
      assert(result.discarded.length  === 0,   "Test 13 — no discarded");
    }

    // ── Test 14: data: href ───────────────────────────────────────────────────
    console.log("\n[ Test 14 ] data: href → discarded");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body>
          <a href="data:text/html,<h1>Hello</h1>">Data</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port14 = innerSrv.address().port;
      const base14 = `http://127.0.0.1:${port14}`;

      const page = await browser.newPage();
      await page.goto(base14);
      const result = await discoverLinks(page, base14);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.discarded.length  >= 1,   "Test 14 — data: href discarded");
      assert(result.sameDomain.length === 0,   "Test 14 — no same-domain");
      assert(result.external.length   === 0,   "Test 14 — no external");
    }

    // ── Test 15: blob: href ───────────────────────────────────────────────────
    console.log("\n[ Test 15 ] blob: href → discarded");
    {
      const innerSrv = http.createServer((req, res) => {
        const html = `<html><body>
          <a href="blob:https://example.com/uuid-1234">Blob</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port15 = innerSrv.address().port;
      const base15 = `http://127.0.0.1:${port15}`;

      const page = await browser.newPage();
      await page.goto(base15);
      const result = await discoverLinks(page, base15);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      assert(result.discarded.length  === 1,   "Test 15 — blob: href discarded");
      assert(result.sameDomain.length === 0,   "Test 15 — no same-domain");
      assert(result.external.length   === 0,   "Test 15 — no external");
    }

    // ── Test 16: HTTPS same-domain link ──────────────────────────────────────
    // If base is http://127.0.0.1:PORT but the anchor href is the https variant
    // of the SAME hostname, it should still land in sameDomain (same hostname,
    // only protocol differs — hostname match is what matters in Phase 5.2).
    console.log("\n[ Test 16 ] Protocol variant — same hostname → sameDomain");
    {
      const innerSrv = http.createServer((req, res) => {
        const port = innerSrv.address().port;
        // href is https:// but same hostname (127.0.0.1) and same port
        const html = `<html><body>
          <a href="https://127.0.0.1:${port}/secure">Secure</a>
        </body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      await new Promise((r) => innerSrv.listen(0, "127.0.0.1", r));
      const port16 = innerSrv.address().port;
      const base16 = `http://127.0.0.1:${port16}`;

      const page = await browser.newPage();
      await page.goto(base16);
      const result = await discoverLinks(page, base16);
      await page.close();
      await new Promise((r) => innerSrv.close(r));

      // Hostname is identical (127.0.0.1) → sameDomain in Phase 5.2.
      assert(result.sameDomain.length === 1,   "Test 16 — same hostname → sameDomain");
      assert(result.external.length   === 0,   "Test 16 — not classified as external");
      assert(result.discarded.length  === 0,   "Test 16 — not discarded");
    }

  } finally {
    await browser.close();
  }

  // ─── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});
