const assert = require("assert");
const { validateTargetUrl } = require("../src/utils/urlValidator");

async function runTests() {
  console.log("Running urlValidator security tests...");

  let res;

  // SAFE
  res = await validateTargetUrl("https://example.com");
  assert.strictEqual(res.safe, true);
  
  res = await validateTargetUrl("https://github.com");
  assert.strictEqual(res.safe, true);
  
  // BLOCK: localhost
  res = await validateTargetUrl("http://localhost");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "DNS resolving to private address");
  
  // BLOCK: 127.0.0.1
  res = await validateTargetUrl("http://127.0.0.1");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Private IP address is not allowed");
  
  // BLOCK: 127.0.0.1:5000 (Custom port)
  res = await validateTargetUrl("http://127.0.0.1:5000");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Unsupported port");
  
  // BLOCK: Cloud Metadata
  res = await validateTargetUrl("http://169.254.169.254");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Private IP address is not allowed");
  
  // BLOCK: Private ranges
  res = await validateTargetUrl("http://10.0.0.1");
  assert.strictEqual(res.safe, false);
  
  res = await validateTargetUrl("http://172.16.0.1");
  assert.strictEqual(res.safe, false);
  
  res = await validateTargetUrl("http://192.168.1.1");
  assert.strictEqual(res.safe, false);
  
  // BLOCK: IPv6 Loopback
  res = await validateTargetUrl("http://[::1]");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Private IP address is not allowed");
  
  // BLOCK: Unusual IP representation 1
  res = await validateTargetUrl("http://0x7f000001");
  assert.strictEqual(res.safe, false);
  // Node's URL normalizes 0x7f000001 to 127.0.0.1
  assert.strictEqual(res.reason, "Private IP address is not allowed");
  
  // BLOCK: Unusual IP representation 2
  res = await validateTargetUrl("http://2130706433");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Private IP address is not allowed");

  // BLOCK: Credentials
  res = await validateTargetUrl("http://user:pass@example.com");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Credentials in URL are not allowed");

  // BLOCK: Unsupported protocol
  res = await validateTargetUrl("ftp://example.com");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Unsupported protocol");
  
  // BLOCK: Unsupported port
  res = await validateTargetUrl("https://example.com:8443");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "Unsupported port");
  
  // BLOCK: DNS failure
  res = await validateTargetUrl("http://this-domain-definitely-does-not-exist-9999.com");
  assert.strictEqual(res.safe, false);
  assert.strictEqual(res.reason, "DNS resolution failed");
  
  console.log("All urlValidator security tests passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
