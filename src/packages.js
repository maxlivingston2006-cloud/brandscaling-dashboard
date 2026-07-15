/**
 * Service catalog + plan recommendation.
 * Single source of truth for what we sell — used by the AI outreach writer
 * (src/ai.js) and surfaced in the email modal via /api/leads/:id/preview.
 * Keep prices in sync with the PACKAGES presets in dashboard/app.js.
 */
const PLANS = {
  WEBSITE_AI: {
    key: 'WEBSITE_AI',
    name: 'Website + AI',
    price: '$5,000 one-time — or $0 down when paired with a 12-month Growth plan',
    monthly: null,
    includes: 'a full 5–7 page mobile-first website, SEO foundations, online booking, and an AI chat agent trained on their business that captures and qualifies leads 24/7',
  },
  PRESENCE: {
    key: 'PRESENCE',
    name: 'Presence',
    price: '$1,200/month (+ $500 one-time setup)',
    monthly: 1200,
    includes: 'ads management on one channel, website hosting and upkeep, missed-call text-back automation, and a monthly results report',
  },
  GROWTH: {
    key: 'GROWTH',
    name: 'Growth',
    price: '$2,500/month (+ $1,000 one-time setup) — founding-client rate $1,800/month locked for 12 months',
    monthly: 2500,
    includes: 'Google + Meta ads, landing pages and conversion optimization, an AI receptionist, automated review generation, and a live AI-powered results dashboard they can check any time',
  },
  SCALE: {
    key: 'SCALE',
    name: 'Scale',
    price: '$4,500/month (+ $1,500 one-time setup)',
    monthly: 4500,
    includes: 'multi-channel ad management, unlimited landing pages and funnels, custom AI workflows and follow-up sequences, a live results dashboard, and a monthly strategy call',
  },
};

// Deterministic best-fit: the opportunity type is the primary signal
// (it's what the qualifier already learned about their gap), score breaks ties.
function recommendPackage(lead) {
  switch (lead.opportunity_type) {
    case 'NO_WEBSITE':
      return { ...PLANS.WEBSITE_AI, reason: 'they have no website — the clearest gap, fixed with a build plus AI lead capture' };
    case 'WEAK_ADVERTISING':
      return { ...PLANS.PRESENCE, reason: 'they have a site but weak visibility/reviews — an affordable always-on presence fixes that' };
    case 'HIGH_POTENTIAL':
      return { ...PLANS.GROWTH, reason: 'good business with an under-developed digital presence — the most room to grow with full ads + AI' };
    case 'SCALING_CANDIDATE':
      return { ...PLANS.SCALE, reason: 'already strong (high rating, many reviews) — they need scale infrastructure, not basics' };
    default:
      return (Number(lead.score) || 0) >= 70
        ? { ...PLANS.GROWTH, reason: 'strong lead score — full-funnel growth is the best fit' }
        : { ...PLANS.PRESENCE, reason: 'entry point — easiest yes, upgradeable later' };
  }
}

module.exports = { PLANS, recommendPackage };
