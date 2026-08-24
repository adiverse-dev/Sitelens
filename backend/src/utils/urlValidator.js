const dns = require("dns").promises;
const net = require("net");

const DISALLOWED_IPS = new net.BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  DISALLOWED_IPS.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]) {
  DISALLOWED_IPS.addSubnet(network, prefix, "ipv6");
}

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
    return DISALLOWED_IPS.check(ip, "ipv4");
  }

  if (net.isIPv6(ip)) {
    return DISALLOWED_IPS.check(ip, "ipv6");
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
