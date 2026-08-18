const express = require("express");
const http = require("http");
const { auditRateLimiter } = require("../src/middlewares/rateLimiter.middleware");

// Mock controller to simulate SSRF validation returning 400
const mockAuditWebsite = (req, res) => {
  res.status(400).json({ success: false, error: "Target URL is not allowed" });
};

const runTests = async () => {
  const app = express();
  app.use(express.json());
  app.post("/audit", auditRateLimiter, mockAuditWebsite);
  app.post("/other", auditRateLimiter, (req, res) => res.json({ ok: true })); // Unrelated route check
  
  const server = http.createServer(app);
  
  await new Promise((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address().port;
  console.log(`Test server running on port ${port}...`);

  let passed = true;

  try {
    // 1. Verify requests 1-5 pass rate limit but hit SSRF validation
    console.log("Testing requests 1-5 (Allowed through rate limiter)...");
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://localhost:5000" })
      });
      const data = await res.json();
      
      if (res.status !== 400 || data.error !== "Target URL is not allowed") {
        console.error(`❌ Request ${i} failed expected SSRF block. Got HTTP ${res.status}`);
        passed = false;
      }
      
      // Verify headers
      if (!res.headers.has("ratelimit-limit") || !res.headers.has("ratelimit-remaining")) {
         console.error(`❌ Request ${i} missing standard RateLimit headers`);
         passed = false;
      }
    }

    // 2. Verify request 6 hits 429
    console.log("Testing request 6 (Rate Limited)...");
    const res6 = await fetch(`http://127.0.0.1:${port}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:5000" })
    });
    const data6 = await res6.json();
    
    if (res6.status !== 429) {
      console.error(`❌ Request 6 failed expected 429 Rate Limit block. Got HTTP ${res6.status}`);
      passed = false;
    }
    
    if (data6.error !== "Too many audit requests from this IP, please try again after a minute.") {
      console.error(`❌ Request 6 error message mismatch. Got: ${data6.error}`);
      passed = false;
    }
    
    if (!res6.headers.has("retry-after")) {
      console.error(`❌ Request 6 missing Retry-After header`);
      passed = false;
    }

    // 3. Verify unrelated route does NOT inherit limiter state or block (if applied separately, but wait, the middleware instance is shared)
    // Actually, express-rate-limit tracks by IP by default. If we mount the SAME middleware instance on multiple routes, they share the limit bucket!
    // Since auditRateLimiter is specifically applied to /audit, let's verify an UNPROTECTED route.
    console.log("Testing unprotected route...");
    app.post("/unprotected", (req, res) => res.json({ ok: true }));
    const resUnprotected = await fetch(`http://127.0.0.1:${port}/unprotected`, { method: "POST" });
    if (resUnprotected.status !== 200) {
      console.error(`❌ Unprotected route was blocked with HTTP ${resUnprotected.status}`);
      passed = false;
    }

    if (passed) {
      console.log("✅ All rate limiter tests passed!");
    } else {
      console.error("❌ Rate limiter tests failed!");
      process.exitCode = 1;
    }
    
  } finally {
    server.close();
  }
};

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
