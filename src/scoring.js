/**
 * Deterministic 0–100 lead score — no AI, no API calls, instant.
 *
 *   rating        0–25   (google rating / 5 × 25)
 *   reviews       0–20   (log scale — 200+ reviews maxes out)
 *   website       0–15   (has one, and it isn't known-broken)
 *   email         0–15   (we have somewhere to send outreach)
 *   opportunity   0–25   (how well their gap matches what we sell)
 */
const OPPORTUNITY_POINTS = {
  HIGH_POTENTIAL:    25, // good business, weak presence — ideal target
  NO_WEBSITE:        20, // clearest pitch, but often least sophisticated buyer
  SCALING_CANDIDATE: 15, // strong already, harder to land but big retainers
  WEAK_ADVERTISING:  10,
};

function computeScore(lead) {
  return getScoreBreakdown(lead).total;
}

function getScoreBreakdown(lead) {
  const rating = Math.max(0, Math.min(Number(lead.google_rating) || 0, 5));
  const reviews = Math.max(0, Number(lead.review_count) || 0);
  const hasWebsite = Boolean(lead.website && lead.website_status !== 'broken');
  const hasEmail = Boolean(lead.email && String(lead.email).includes('@'));
  const opportunityPoints = OPPORTUNITY_POINTS[lead.opportunity_type] || 0;
  const opportunityReasons = {
    HIGH_POTENTIAL: 'Strong business signals paired with a clear digital growth gap.',
    NO_WEBSITE: 'No website creates an immediate, easy-to-explain transformation opportunity.',
    SCALING_CANDIDATE: 'Established demand suggests capacity for a larger growth engagement.',
    WEAK_ADVERTISING: 'The business is credible, but its current digital acquisition signals are limited.',
  };

  const factors = [
    {
      key: 'rating', label: 'Customer rating', points: (rating / 5) * 25, max_points: 25,
      reason: rating ? `${rating.toFixed(1)}/5 Google rating indicates customer satisfaction.` : 'No Google rating is available yet.',
    },
    {
      key: 'reviews', label: 'Review credibility',
      points: Math.min(Math.log10(reviews + 1) / Math.log10(201), 1) * 20, max_points: 20,
      reason: reviews ? `${reviews} reviews provide ${reviews >= 200 ? 'strong' : reviews >= 50 ? 'solid' : 'early'} proof of demand.` : 'No review history is available yet.',
    },
    {
      key: 'website', label: 'Digital presence', points: hasWebsite ? 15 : 0, max_points: 15,
      reason: hasWebsite ? 'A working website gives prospects a clear conversion path.' : 'No working website was found, limiting online conversion.',
    },
    {
      key: 'email', label: 'Reachability', points: hasEmail ? 15 : 0, max_points: 15,
      reason: hasEmail ? `A direct outreach address is available (${lead.email}).` : 'No outreach email has been identified yet.',
    },
    {
      key: 'opportunity', label: 'Opportunity fit', points: opportunityPoints, max_points: 25,
      reason: opportunityReasons[lead.opportunity_type] || 'The opportunity type has not been qualified yet.',
    },
  ].map(factor => ({ ...factor, points: Math.round(factor.points * 10) / 10 }));

  const rawTotal = factors.reduce((sum, factor) => sum + factor.points, 0);
  return { total: Math.round(Math.min(rawTotal, 100)), factors };
}

// Startup pass: score anything unscored (mirrors backfillOpportunityTypes)
async function backfillScores() {
  const { getAllLeads, updateLeadScore } = require('./database');
  const leads = await getAllLeads();
  const missing = leads.filter(l => l.score == null);
  if (!missing.length) return 0;

  for (const lead of missing) {
    await updateLeadScore(lead.id, computeScore(lead));
  }
  console.log(`[scoring] backfilled scores for ${missing.length} leads`);
  return missing.length;
}

module.exports = { computeScore, getScoreBreakdown, backfillScores };
