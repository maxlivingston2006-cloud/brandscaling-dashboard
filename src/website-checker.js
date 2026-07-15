const axios = require('axios');
const https = require('https');

// Use a real browser UA and skip SSL validation — we're checking availability, not security
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
};

/**
 * Check if a website URL is reachable and returning a good status code.
 *
 * Returns one of:
 *   'ok'        — site loaded successfully (2xx/3xx)
 *   'broken'    — site returned an error status (4xx/5xx)
 *   'timeout'   — request timed out (site may be down or very slow)
 *   'uncertain' — 401/403/429: could be bot-blocking a working site
 *
 * @param {string} url
 * @returns {Promise<{ result: string, status: number|null }>}
 */
async function checkWebsite(url) {
  if (!url) return { result: 'ok', status: null };

  const normalized = url.startsWith('http') ? url : `https://${url}`;

  try {
    const { status } = await axios.get(normalized, {
      timeout:          6000,
      maxRedirects:     5,
      httpsAgent,
      headers:          HEADERS,
      validateStatus:   null,          // never throw on HTTP errors
      maxContentLength: 100_000,       // don't pull huge pages
      decompress:       true,
    });

    if (status >= 200 && status < 400)          return { result: 'ok',        status };
    if ([401, 403, 429].includes(status))        return { result: 'uncertain', status };
    return                                              { result: 'broken',    status };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return { result: 'timeout', status: null };
    }
    // DNS failure, ECONNREFUSED, ENOTFOUND, etc. — site is unreachable
    return { result: 'broken', status: null };
  }
}

/**
 * Check multiple URLs concurrently.
 * @param {string[]} urls
 * @returns {Promise<Array<{ result: string, status: number|null }>>}
 */
async function checkWebsites(urls) {
  return Promise.all(urls.map(url => checkWebsite(url).catch(() => ({ result: 'broken', status: null }))));
}

module.exports = { checkWebsite, checkWebsites };
