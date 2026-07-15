/**
 * Classifies a business into one of four opportunity types.
 *
 * Rules (applied in priority order):
 *   NO_WEBSITE        — no website at all
 *   SCALING_CANDIDATE — website + 200+ reviews AND rating 4.5+
 *   HIGH_POTENTIAL    — website + 50-200 reviews AND rating 4.0+
 *   WEAK_ADVERTISING  — website + reviews < 50 OR rating < 4.0
 *
 * Catch-all (200+ reviews, rating 4.0-4.5): HIGH_POTENTIAL
 *
 * @param {string|null} website
 * @param {number}      rating
 * @param {number}      reviewCount
 * @returns {'NO_WEBSITE'|'WEAK_ADVERTISING'|'HIGH_POTENTIAL'|'SCALING_CANDIDATE'}
 */
function qualify(website, rating, reviewCount) {
  const r = rating      ?? 0;
  const n = reviewCount ?? 0;

  if (!website)                          return 'NO_WEBSITE';
  if (n >= 200 && r >= 4.5)             return 'SCALING_CANDIDATE';
  if (n >= 50 && n <= 200 && r >= 4.0)  return 'HIGH_POTENTIAL';
  if (n < 50 || r < 4.0)                return 'WEAK_ADVERTISING';
  return 'HIGH_POTENTIAL';
}

const OPPORTUNITY_LABELS = {
  NO_WEBSITE:         'No Website',
  WEAK_ADVERTISING:   'Weak Advertising',
  HIGH_POTENTIAL:     'High Potential',
  SCALING_CANDIDATE:  'Scaling Candidate',
};

const OPPORTUNITY_TEMPLATES = {
  NO_WEBSITE:         'no-website.txt',
  WEAK_ADVERTISING:   'weak-advertising.txt',
  HIGH_POTENTIAL:     'high-potential.txt',
  SCALING_CANDIDATE:  'scaling-candidate.txt',
};

/**
 * Advanced qualifier — uses website analysis + Google signals for a scored result.
 *
 * @param {string|null}  website
 * @param {number}       rating
 * @param {number}       reviewCount
 * @param {object|null}  analysis     — result of analyzeWebsite()
 * @param {number}       photoCount   — number of Google photos on the listing
 */
function qualifyAdvanced(website, rating, reviewCount, analysis = null, photoCount = 0) {
  const r = rating      ?? 0;
  const n = reviewCount ?? 0;

  // No real web presence
  if (!website || (analysis && !analysis.hasSite)) return 'NO_WEBSITE';

  let score = 0;

  // ── Platform / website quality ────────────────────────────────────────────
  if (analysis) score += analysis.platformScore ?? 0;

  // ── Review count (low reviews = low marketing investment) ─────────────────
  if      (n < 15)  score += 28;
  else if (n < 40)  score += 20;
  else if (n < 80)  score += 12;
  else if (n < 150) score +=  6;
  // 150+: no bonus — they have traction

  // ── Rating signals ────────────────────────────────────────────────────────
  if      (r >= 4.3 && n >= 150) score -= 12; // well-established, lower urgency
  else if (r >= 4.0)             score +=  5; // good service but underseen
  else if (r < 3.5)              score -=  5; // risky client

  // ── Google listing completeness ───────────────────────────────────────────
  if      (photoCount === 0) score += 8; // neglected listing
  else if (photoCount <= 3)  score += 4;

  // ── Map score → category ──────────────────────────────────────────────────
  if (score >= 42) return 'WEAK_ADVERTISING';
  if (score >= 16) return 'HIGH_POTENTIAL';
  return 'SCALING_CANDIDATE';
}

module.exports = { qualify, qualifyAdvanced, OPPORTUNITY_LABELS, OPPORTUNITY_TEMPLATES };
