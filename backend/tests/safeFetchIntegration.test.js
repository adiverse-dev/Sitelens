const assert = require('assert');
const http = require('http');
const { safeFetch, SSRFError } = require('../src/utils/safeFetch');
const urlValidator = require('../src/utils/urlValidator');
const { auditRobotsTxt } = require('../src/services/robotsAudit.service');
const { auditSitemap } = require('../src/services/sitemapAudit.service');

async function runTests() {
  console.log("Running safeFetch and integration security tests...");

  // Setup local mock server
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect-to-private') {
      res.writeHead(302, { 'Location': 'http://169.254.169.254' });
      res.end();
    } else if (req.url === '/redirect-safe') {
      res.writeHead(302, { 'Location': '/safe-target' });
      res.end();
    } else if (req.url === '/safe-target') {
      res.writeHead(200);
      res.end('OK');
    } else if (req.url === '/robots.txt') {
      res.writeHead(200);
      res.end('User-agent: *\nAllow: /\nSitemap: http://169.254.169.254/sitemap.xml');
    } else if (req.url === '/sitemap-index.xml') {
      res.writeHead(200);
      res.end('<sitemapindex><sitemap><loc>http://169.254.169.254/admin</loc></sitemap></sitemapindex>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Mock validation to ONLY allow our test server
  const originalValidate = urlValidator.validateTargetUrl;
  urlValidator.validateTargetUrl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === '127.0.0.1' && parsed.port === String(port)) {
      return { safe: true, url, hostname: '127.0.0.1', resolvedAddresses: ['127.0.0.1'], reason: null };
    }
    return originalValidate(url);
  };

  try {
    // 1. Safe Public URL
    const resSafe = await safeFetch('https://example.com');
    assert.strictEqual(resSafe.status, 200);
    console.log("Passed: Safe Public URL");

    // 2. Direct Private IP
    await assert.rejects(
      safeFetch('http://169.254.169.254'),
      { name: 'SSRFError' }
    );
    console.log("Passed: Direct Private IP");

    // 3. Safe Redirect
    const resRedir = await safeFetch(`${baseUrl}/redirect-safe`);
    assert.strictEqual(resRedir.status, 200);
    const body = await resRedir.text();
    assert.strictEqual(body, 'OK');
    console.log("Passed: Safe Redirect");

    // 4. Redirect to Private IP
    await assert.rejects(
      safeFetch(`${baseUrl}/redirect-to-private`),
      { name: 'SSRFError' }
    );
    console.log("Passed: Redirect to Private IP blocked");

    // 5. Robots parsing integration
    const robotsResult = await auditRobotsTxt(baseUrl);
    assert.strictEqual(robotsResult.exists, true);
    assert.strictEqual(robotsResult.sitemapUrls.length, 1);
    assert.strictEqual(robotsResult.sitemapUrls[0], 'http://169.254.169.254/sitemap.xml');
    console.log("Passed: Robots parsing works");

    // 6. Sitemap fetching unsafe URL extracted from Robots
    const sitemapResult = await auditSitemap(baseUrl, robotsResult);
    assert.strictEqual(sitemapResult.exists, false);
    assert.ok(sitemapResult.error.includes("SSRF Blocked"), "Should block SSRF error");
    console.log("Passed: Sitemap SSRF blocked natively");

    // 7. Sitemap containing internal URL in <loc>
    const sitemapIndexResult = await auditSitemap(`${baseUrl}/sitemap-index.xml`, { sitemapUrls: [`${baseUrl}/sitemap-index.xml`] });
    // URL count should be 0 because the child sitemap failed validation
    assert.strictEqual(sitemapIndexResult.urlCount, 0);
    console.log("Passed: Sitemap <loc> child extraction blocked natively");

    console.log("All safeFetch security tests passed!");
  } finally {
    urlValidator.validateTargetUrl = originalValidate;
    server.close();
  }
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
