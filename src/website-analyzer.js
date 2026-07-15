/**
 * Website signal analyzer — zero HTTP requests to the target site.
 *
 * Two techniques only:
 *   1. URL/hostname parsing  — instant, no network
 *   2. DNS NS record lookup  — queries your own DNS resolver, never contacts the target
 *
 * The target business never sees any traffic from this module.
 */

const dns = require('dns').promises;

// Domains businesses use as their "website" but aren't real sites
const SOCIAL_DOMAINS = [
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'yelp.com', 'linktr.ee', 'tiktok.com', 'youtube.com',
  'tripadvisor.com', 'yellowpages.com', 'thumbtack.com', 'houzz.com',
  'angieslist.com', 'nextdoor.com', 'alignable.com',
];

// Hostnames that are free-plan subdomains of page builders (e.g. mybiz.wixsite.com)
const FREE_SUBDOMAIN_ROOTS = [
  'wixsite.com', 'weebly.com', 'wordpress.com', 'squarespace.com',
  'webflow.io', 'godaddysites.com', 'strikingly.com', 'mystrikingly.com',
  'jimdosite.com', 'site123.me', 'format.com', 'cargo.site',
];

// NS record fragments → platform name (for custom-domain sites)
const NS_PLATFORMS = [
  { ns: 'wixdns.net',       platform: 'wix' },
  { ns: 'squarespace.com',  platform: 'squarespace' },
  { ns: 'myshopify.com',    platform: 'shopify' },
  { ns: 'shopify.com',      platform: 'shopify' },
  { ns: 'weebly.com',       platform: 'weebly' },
  { ns: 'webflow.com',      platform: 'webflow' },
  { ns: 'wordpress.com',    platform: 'wordpress_hosted' },
  { ns: 'strikingly.com',   platform: 'strikingly' },
  { ns: 'jimdo.com',        platform: 'jimdo' },
  { ns: 'netlify.com',      platform: 'netlify' },
  { ns: 'vercel.com',       platform: 'vercel' },
];

// How each platform affects the opportunity score (higher = more opportunity)
const PLATFORM_SCORE = {
  wix:             25,
  weebly:          25,
  strikingly:      25,
  jimdo:           20,
  wordpress_hosted:20,
  squarespace:     12,
  webflow:         10,
  shopify:          8,
  netlify:          5,
  vercel:           5,
};

function parseHostname(url) {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function apexDomain(hostname) {
  const parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

/**
 * Analyze a website URL using only URL parsing and DNS.
 * Safe to call for every lead — never contacts the target.
 *
 * @param {string|null} websiteUrl
 * @returns {Promise<{
 *   hasSite: boolean,
 *   isSocialOnly: boolean,
 *   isFreeSubdomain: boolean,
 *   platform: string|null,
 *   platformScore: number,
 *   signals: string[]
 * }>}
 */
async function analyzeWebsite(websiteUrl) {
  const out = {
    hasSite:        !!websiteUrl,
    isSocialOnly:   false,
    isFreeSubdomain:false,
    platform:       null,
    platformScore:  0,
    signals:        [],
  };

  if (!websiteUrl) { out.signals.push('no_website'); return out; }

  const hostname = parseHostname(websiteUrl);
  if (!hostname) { out.hasSite = false; out.signals.push('invalid_url'); return out; }

  // ── 1. Social / directory site used as "website" ──────────────────────────
  const isSocial = SOCIAL_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  if (isSocial) {
    out.hasSite = false;
    out.isSocialOnly = true;
    out.signals.push('social_as_website');
    return out;
  }

  // ── 2. Free subdomain of a page builder ──────────────────────────────────
  const freeRoot = FREE_SUBDOMAIN_ROOTS.find(r => hostname.endsWith('.' + r) || hostname === r);
  if (freeRoot) {
    out.isFreeSubdomain = true;
    out.platform = freeRoot.replace(/\.(com|io|site|me)$/, '');
    out.platformScore = 35; // free plan = minimal web investment
    out.signals.push('free_subdomain', `builder_${out.platform}`);
    return out;
  }

  // ── 3. DNS NS lookup for custom domains ──────────────────────────────────
  try {
    const ns = await dns.resolveNs(apexDomain(hostname));
    const nsStr = ns.join(' ').toLowerCase();

    for (const { ns: fragment, platform } of NS_PLATFORMS) {
      if (nsStr.includes(fragment)) {
        out.platform = platform;
        out.platformScore = PLATFORM_SCORE[platform] ?? 0;
        out.signals.push(`platform_${platform}`);
        break;
      }
    }

    if (!out.platform) out.signals.push('custom_hosting');
  } catch {
    out.signals.push('dns_unavailable');
  }

  return out;
}

module.exports = { analyzeWebsite };
