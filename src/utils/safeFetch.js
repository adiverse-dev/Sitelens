const urlValidator = require('./urlValidator');

class SSRFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SSRFError';
  }
}

const MAX_REDIRECTS = 5;

async function safeFetch(url, options = {}, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    throw new SSRFError('Too many redirects');
  }

  const securityCheck = await urlValidator.validateTargetUrl(url);
  if (!securityCheck.safe) {
    throw new SSRFError(`SSRF Blocked: ${securityCheck.reason}`);
  }

  const fetchOptions = {
    ...options,
    redirect: 'manual'
  };

  const response = await fetch(url, fetchOptions);

  if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
    const location = response.headers.get('location');
    const redirectUrl = new URL(location, url).toString();
    
    // Consume response body to free memory
    await response.text().catch(() => {});
    
    return safeFetch(redirectUrl, options, redirectCount + 1);
  }

  return response;
}

module.exports = {
  safeFetch,
  SSRFError
};
