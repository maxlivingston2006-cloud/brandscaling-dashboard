// ---------------------------------------------------------------------------
// Niche template selection.
//
// The lead's `category` is whatever was typed into the scrape box ("pool
// service", "hvac", "gym"...). We match it to a niche-specific template. If no
// specific niche matches, we fall back to a broad-family template, and finally
// a universal one — so every lead gets a reasonably tailored email.
//
// Order matters: the first rule whose keyword appears in the category wins.
// ---------------------------------------------------------------------------

// Specific niches (20). Keyword lists are matched with `category.includes(kw)`.
const NICHE_RULES = [
  { file: 'pool.txt',         kws: ['pool'] },
  { file: 'hvac.txt',         kws: ['hvac', 'air conditioning', 'heating', 'cooling', 'ac repair', 'furnace'] },
  { file: 'roofing.txt',      kws: ['roof'] },
  { file: 'plumbing.txt',     kws: ['plumb'] },
  { file: 'electrical.txt',   kws: ['electric'] },
  { file: 'contractor.txt',   kws: ['general contractor', 'contractor'] },
  { file: 'construction.txt', kws: ['construction', 'remodel', 'renovation', 'builder', 'home building'] },
  { file: 'landscaping.txt',  kws: ['landscap', 'lawn', 'lawn care'] },
  { file: 'painting.txt',     kws: ['paint'] },
  { file: 'pest-control.txt', kws: ['pest', 'exterminat', 'termite'] },
  { file: 'cleaning.txt',     kws: ['cleaning', 'janitorial', 'maid'] },
  { file: 'handyman.txt',     kws: ['handyman', 'garage door', 'handy man'] },
  { file: 'gym.txt',          kws: ['gym', 'fitness', 'crossfit', 'personal train', 'health club'] },
  { file: 'dental.txt',       kws: ['dentist', 'dental', 'orthodont'] },
  { file: 'chiropractor.txt', kws: ['chiro'] },
  { file: 'medspa.txt',       kws: ['med spa', 'medspa', 'medical spa', 'aesthetic', 'skin clinic', 'botox'] },
  { file: 'salon.txt',        kws: ['salon', 'barber', 'hair', 'nails', 'nail', 'lash', 'brow'] },
  { file: 'auto-repair.txt',  kws: ['auto repair', 'mechanic', 'auto shop', 'car repair', 'body shop', 'automotive'] },
  { file: 'real-estate.txt',  kws: ['real estate', 'realtor', 'real estate agent', 'broker'] },
  { file: 'restaurant.txt',   kws: ['restaurant', 'cafe', 'café', 'coffee', 'bistro', 'diner', 'eatery'] },
];

// Broad family fallbacks when no specific niche matches.
const SERVICE_KWS = [
  'contractor', 'repair', 'install', 'service', 'clean', 'tree', 'fence',
  'floor', 'moving', 'mover', 'locksmith', 'junk', 'gutter', 'deck', 'concrete',
  'paving', 'pave', 'well', 'septic', 'pressure wash', 'power wash', 'window',
  'garage', 'door', 'welding', 'fabrication', 'excavat', 'demolition', 'drywall',
  'insulation', 'solar', 'security', 'fencing', 'masonry', 'stucco', 'tile',
  'flooring', 'carpet', 'restoration', 'waterproof', 'sealcoat', 'towing',
];
const WELLNESS_KWS = [
  'spa', 'wellness', 'massage', 'tattoo', 'nutrition', 'dietitian', 'therapy',
  'therapist', 'coach', 'coaching', 'fitness', 'health', 'beauty', 'nails',
  'lash', 'brow', 'aesthetic', 'yoga', 'pilates', 'acupuncture', 'chiro',
  'physical therap', 'med spa', 'medspa', 'clinic', 'counsel', 'mental health',
];

/**
 * Pick the outreach template file for a lead's category.
 * @param {string} category
 * @returns {string} template filename in src/templates/
 */
function selectTemplate(category) {
  const c = (category || '').toLowerCase().trim();
  if (!c) return 'general.txt';

  for (const rule of NICHE_RULES) {
    if (rule.kws.some(kw => c.includes(kw))) return rule.file;
  }
  if (SERVICE_KWS.some(kw => c.includes(kw)))  return 'general-service.txt';
  if (WELLNESS_KWS.some(kw => c.includes(kw))) return 'general-wellness.txt';
  return 'general.txt';
}

module.exports = { selectTemplate };
