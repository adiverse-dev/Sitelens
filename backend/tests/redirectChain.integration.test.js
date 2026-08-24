"use strict";

const assert = require("assert");
const http = require("http");
const { checkLinkTarget } = require("../src/services/linkChecker.service");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function redirect(res, statusCode, location) {
  const headers = location === undefined ? {} : { Location: location };
  res.writeHead(statusCode, headers);
  res.end();
}

async function runTests() {
  const methods = new Map();
  const validatedUrls = [];
  let port;

  const server = http.createServer((req, res) => {
    const parsedRequest = new URL(req.url, "http://fixture.invalid");
    const pathname = parsedRequest.pathname;
    const pathMethods = methods.get(pathname) || [];
    pathMethods.push({ method: req.method, range: req.headers.range || null });
    methods.set(pathname, pathMethods);

    if (pathname === "/direct") {
      res.writeHead(200);
      res.end();
    } else if (pathname === "/one") {
      redirect(res, 301, "/direct?token=secret#fragment");
    } else if (pathname === "/multi-a") {
      redirect(res, 302, "/multi-b?private=one");
    } else if (pathname === "/multi-b") {
      redirect(res, 301, "/direct?private=two#fragment");
    } else if (pathname === "/cross-host") {
      redirect(res, 302, `http://second.example:${port}/direct?token=secret`);
    } else if (pathname === "/to-401") {
      redirect(res, 302, "/final-401");
    } else if (pathname === "/final-401") {
      res.writeHead(401);
      res.end();
    } else if (pathname === "/to-403") {
      redirect(res, 302, "/final-403");
    } else if (pathname === "/final-403") {
      res.writeHead(403);
      res.end();
    } else if (pathname === "/to-404") {
      redirect(res, 302, "/final-404");
    } else if (pathname === "/final-404") {
      res.writeHead(404);
      res.end();
    } else if (pathname === "/to-503") {
      redirect(res, 302, "/final-503");
    } else if (pathname === "/final-503") {
      res.writeHead(503);
      res.end();
    } else if (pathname === "/to-slow") {
      redirect(res, 302, "/slow");
    } else if (pathname === "/slow") {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200);
          res.end();
        }
      }, 150);
    } else if (pathname === "/to-abort") {
      redirect(res, 302, "/abort");
    } else if (pathname === "/abort") {
      req.socket.destroy();
    } else if (pathname === "/to-blocked") {
      redirect(res, 302, `http://blocked.example:${port}/direct`);
    } else if (pathname === "/to-credentials") {
      redirect(res, 302, `http://user:secret@second.example:${port}/direct?token=private`);
    } else if (pathname === "/to-ftp") {
      redirect(res, 302, "ftp://files.example/private");
    } else if (pathname === "/missing-location") {
      redirect(res, 302);
    } else if (pathname === "/invalid-location") {
      redirect(res, 302, "http://%");
    } else if (pathname === "/loop-a") {
      redirect(res, 302, "/loop-b");
    } else if (pathname === "/loop-b") {
      redirect(res, 301, "/loop-a");
    } else if (pathname.startsWith("/limit/")) {
      const index = Number(pathname.split("/").pop());
      redirect(res, 302, `/limit/${index + 1}`);
    } else if (pathname === "/status-303") {
      redirect(res, 303, "/status-307");
    } else if (pathname === "/status-307") {
      redirect(res, 307, "/status-308");
    } else if (pathname === "/status-308") {
      redirect(res, 308, "/direct");
    } else if (pathname === "/unsupported-300") {
      redirect(res, 300, "/direct");
    } else if (pathname === "/fallback-start" && req.method === "HEAD") {
      res.writeHead(405);
      res.end();
    } else if (pathname === "/fallback-start") {
      redirect(res, 302, "/fallback-final");
    } else if (pathname === "/fallback-final") {
      res.writeHead(200);
      res.end();
    } else if (pathname === "/slow-chain-1") {
      setTimeout(() => {
        if (!res.destroyed) redirect(res, 302, "/slow-chain-2");
      }, 30);
    } else if (pathname === "/slow-chain-2") {
      setTimeout(() => {
        if (!res.destroyed) redirect(res, 302, "/slow-chain-final");
      }, 30);
    } else if (pathname === "/slow-chain-final") {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200);
          res.end();
        }
      }, 30);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await listen(server);
  port = server.address().port;
  const firstOrigin = `http://first.example:${port}`;
  const validateInjectedTarget = async (targetUrl) => {
    const parsed = new URL(targetUrl);
    validatedUrls.push(`${parsed.hostname}${parsed.pathname}`);
    if (parsed.hostname === "blocked.example") {
      return { safe: false, reason: "DNS resolving to private address" };
    }
    return {
      safe: true,
      url: targetUrl,
      hostname: parsed.hostname,
      resolvedAddresses: ["127.0.0.1"],
      reason: null,
    };
  };
  const options = {
    timeoutMs: 1000,
    maxRedirects: 5,
    validateTargetUrl: validateInjectedTarget,
  };

  try {
    const direct = await checkLinkTarget(`${firstOrigin}/direct`, options);
    assert.strictEqual(direct.state, "ok");
    assert.strictEqual(direct.statusCode, 200);
    assert.strictEqual(direct.redirected, false);
    assert.strictEqual(direct.redirectCount, 0);
    assert.deepStrictEqual(direct.redirectChain, []);
    assert.strictEqual(direct.finalUrl, `${firstOrigin}/direct`);
    assert.strictEqual(direct.finalState, "ok");
    assert.strictEqual(direct.health, "healthy");
    assert.strictEqual(direct.isBroken, false);

    const oneHop = await checkLinkTarget(
      `${firstOrigin}/one?source=secret#ignored`,
      options
    );
    assert.strictEqual(oneHop.state, "redirect");
    assert.strictEqual(oneHop.statusCode, 301);
    assert.strictEqual(oneHop.location, `${firstOrigin}/direct`);
    assert.strictEqual(oneHop.redirectCount, 1);
    assert.deepStrictEqual(oneHop.redirectChain, [{
      url: `${firstOrigin}/one`,
      statusCode: 301,
      location: `${firstOrigin}/direct`,
      responseTimeMs: oneHop.redirectChain[0].responseTimeMs,
    }]);
    assert.strictEqual(oneHop.finalUrl, `${firstOrigin}/direct`);
    assert.strictEqual(oneHop.finalStatusCode, 200);
    assert.strictEqual(oneHop.finalState, "ok");
    assert.strictEqual(oneHop.health, "redirected");
    assert.strictEqual(oneHop.isBroken, false);
    assert.strictEqual(JSON.stringify(oneHop).includes("secret"), false);

    const multiHop = await checkLinkTarget(`${firstOrigin}/multi-a`, options);
    assert.strictEqual(multiHop.redirectCount, 2);
    assert.deepStrictEqual(
      multiHop.redirectChain.map((hop) => hop.statusCode),
      [302, 301]
    );
    assert.strictEqual(multiHop.finalState, "ok");
    assert.strictEqual(multiHop.health, "redirected");

    const crossHost = await checkLinkTarget(`${firstOrigin}/cross-host`, options);
    assert.strictEqual(crossHost.finalUrl, `http://second.example:${port}/direct`);
    assert.strictEqual(crossHost.finalState, "ok");
    assert.ok(validatedUrls.includes("first.example/cross-host"));
    assert.ok(validatedUrls.includes("second.example/direct"));

    const restricted401 = await checkLinkTarget(`${firstOrigin}/to-401`, options);
    assert.strictEqual(restricted401.finalState, "restricted");
    assert.strictEqual(restricted401.finalStatusCode, 401);
    assert.strictEqual(restricted401.health, "restricted");
    assert.strictEqual(restricted401.isBroken, false);

    const restricted403 = await checkLinkTarget(`${firstOrigin}/to-403`, options);
    assert.strictEqual(restricted403.finalState, "restricted");
    assert.strictEqual(restricted403.finalStatusCode, 403);
    assert.strictEqual(restricted403.health, "restricted");
    assert.strictEqual(restricted403.isBroken, false);

    const broken404 = await checkLinkTarget(`${firstOrigin}/to-404`, options);
    assert.strictEqual(broken404.finalState, "client_error");
    assert.strictEqual(broken404.finalStatusCode, 404);
    assert.strictEqual(broken404.health, "broken");
    assert.strictEqual(broken404.isBroken, true);

    const broken503 = await checkLinkTarget(`${firstOrigin}/to-503`, options);
    assert.strictEqual(broken503.finalState, "server_error");
    assert.strictEqual(broken503.finalStatusCode, 503);
    assert.strictEqual(broken503.health, "broken");
    assert.strictEqual(broken503.isBroken, true);

    const redirectTimeout = await checkLinkTarget(`${firstOrigin}/to-slow`, {
      ...options,
      timeoutMs: 50,
    });
    assert.strictEqual(redirectTimeout.state, "redirect");
    assert.strictEqual(redirectTimeout.finalState, "timeout");
    assert.strictEqual(redirectTimeout.health, "unreachable");
    assert.strictEqual(redirectTimeout.isBroken, null);

    const redirectNetworkError = await checkLinkTarget(`${firstOrigin}/to-abort`, options);
    assert.strictEqual(redirectNetworkError.state, "redirect");
    assert.strictEqual(redirectNetworkError.finalState, "network_error");
    assert.strictEqual(redirectNetworkError.health, "unreachable");
    assert.strictEqual(redirectNetworkError.isBroken, null);

    const blocked = await checkLinkTarget(`${firstOrigin}/to-blocked`, options);
    assert.strictEqual(blocked.state, "redirect");
    assert.strictEqual(blocked.finalState, "blocked");
    assert.strictEqual(blocked.health, "blocked");
    assert.strictEqual(blocked.isBroken, null);
    assert.strictEqual(blocked.redirectProblem, "blocked_destination");

    const credentials = await checkLinkTarget(`${firstOrigin}/to-credentials`, options);
    assert.strictEqual(credentials.finalState, "blocked");
    assert.strictEqual(credentials.redirectProblem, "credentials_not_allowed");
    assert.strictEqual(credentials.health, "blocked");
    assert.strictEqual(JSON.stringify(credentials).includes("secret"), false);

    const unsupportedScheme = await checkLinkTarget(`${firstOrigin}/to-ftp`, options);
    assert.strictEqual(unsupportedScheme.finalState, "blocked");
    assert.strictEqual(unsupportedScheme.redirectProblem, "unsupported_scheme");
    assert.strictEqual(unsupportedScheme.isBroken, null);

    const missingLocation = await checkLinkTarget(`${firstOrigin}/missing-location`, options);
    assert.strictEqual(missingLocation.redirectProblem, "missing_location");
    assert.strictEqual(missingLocation.health, "broken");
    assert.strictEqual(missingLocation.isBroken, true);

    const invalidLocation = await checkLinkTarget(`${firstOrigin}/invalid-location`, options);
    assert.strictEqual(invalidLocation.redirectProblem, "invalid_location");
    assert.strictEqual(invalidLocation.health, "broken");
    assert.strictEqual(invalidLocation.isBroken, true);

    const loop = await checkLinkTarget(`${firstOrigin}/loop-a`, options);
    assert.strictEqual(loop.redirectProblem, "redirect_loop");
    assert.strictEqual(loop.redirectCount, 2);
    assert.strictEqual(loop.health, "broken");
    assert.strictEqual(loop.isBroken, true);

    const exhausted = await checkLinkTarget(`${firstOrigin}/limit/0`, {
      ...options,
      maxRedirects: 2,
    });
    assert.strictEqual(exhausted.redirectProblem, "too_many_redirects");
    assert.strictEqual(exhausted.redirectCount, 3);
    assert.strictEqual(exhausted.health, "broken");
    assert.strictEqual(exhausted.isBroken, true);

    const redirectMethods = await checkLinkTarget(`${firstOrigin}/status-303`, options);
    assert.deepStrictEqual(
      redirectMethods.redirectChain.map((hop) => hop.statusCode),
      [303, 307, 308]
    );
    assert.strictEqual(redirectMethods.finalState, "ok");

    const unsupportedStatus = await checkLinkTarget(
      `${firstOrigin}/unsupported-300`,
      options
    );
    assert.strictEqual(unsupportedStatus.redirectProblem, "unsupported_redirect_status");
    assert.strictEqual(unsupportedStatus.health, "broken");

    const fallback = await checkLinkTarget(`${firstOrigin}/fallback-start`, options);
    assert.strictEqual(fallback.state, "redirect");
    assert.strictEqual(fallback.finalState, "ok");
    assert.deepStrictEqual(methods.get("/fallback-start"), [
      { method: "HEAD", range: null },
      { method: "GET", range: "bytes=0-0" },
    ]);
    assert.deepStrictEqual(methods.get("/fallback-final"), [
      { method: "HEAD", range: null },
    ]);

    const sharedTimeout = await checkLinkTarget(`${firstOrigin}/slow-chain-1`, {
      ...options,
      timeoutMs: 75,
    });
    assert.strictEqual(sharedTimeout.finalState, "timeout");
    assert.strictEqual(sharedTimeout.health, "unreachable");
    assert.strictEqual(sharedTimeout.isBroken, null);
    assert.ok(sharedTimeout.redirectCount >= 1);
    assert.ok(sharedTimeout.responseTimeMs < 120);

    const validationTimeout = await checkLinkTarget(`${firstOrigin}/direct`, {
      ...options,
      timeoutMs: 20,
      validateTargetUrl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          safe: true,
          resolvedAddresses: ["127.0.0.1"],
          reason: null,
        };
      },
    });
    assert.strictEqual(validationTimeout.finalState, "timeout");
    assert.strictEqual(validationTimeout.health, "unreachable");
    assert.ok(validationTimeout.responseTimeMs < 50);

    console.log("Redirect-chain integration tests passed");
  } finally {
    await close(server);
  }
}

runTests().catch((error) => {
  console.error("Redirect-chain integration tests failed:", error);
  process.exit(1);
});
