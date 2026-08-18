const dns = require("dns").promises;
const net = require("net");

function isValidHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function isValidOptionalUrl(value) {
  return value ? isValidHttpUrl(value) : false;
}

const ALLOWED_PORTS = [80, 443];

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 0) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    if (parts[0] >= 240 && parts[0] <= 255) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
    if (normalized.startsWith("::ffff:")) {
      const v4Part = ip.substring(7);
      return isPrivateIp(v4Part);
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }
    if (normalized.startsWith("ff")) return true;
    return false;
  }

  return true;
}

async function validateTargetUrl(value) {
  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { safe: false, reason: "Unsupported protocol" };
    }

    if (parsedUrl.username || parsedUrl.password) {
      return { safe: false, reason: "Credentials in URL are not allowed" };
    }

    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : parsedUrl.protocol === "https:"
      ? 443
      : 80;

    if (!ALLOWED_PORTS.includes(port)) {
      return { safe: false, reason: "Unsupported port" };
    }

    const hostname = parsedUrl.hostname;
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');

    if (net.isIP(cleanHostname)) {
      if (isPrivateIp(cleanHostname)) {
        return { safe: false, reason: "Private IP address is not allowed" };
      }
      return {
        safe: true,
        url: value,
        hostname: hostname,
        resolvedAddresses: [cleanHostname],
        reason: null,
      };
    }

    let addresses;
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch (dnsError) {
      return { safe: false, reason: "DNS resolution failed" };
    }

    if (!addresses || addresses.length === 0) {
      return { safe: false, reason: "DNS returning no address" };
    }

    const resolvedIps = addresses.map((addr) => addr.address);

    for (const ip of resolvedIps) {
      if (isPrivateIp(ip)) {
        return { safe: false, reason: "DNS resolving to private address" };
      }
    }

    return {
      safe: true,
      url: value,
      hostname: hostname,
      resolvedAddresses: resolvedIps,
      reason: null,
    };
  } catch (error) {
    return { safe: false, reason: "Malformed URL" };
  }
}

module.exports = {
  isValidHttpUrl,
  isValidOptionalUrl,
  validateTargetUrl,
};
