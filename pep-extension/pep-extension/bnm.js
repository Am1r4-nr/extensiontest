// Maps each record to a BNM domestic PEP category, following the firm's working definition
// (BNM AML/CFT Policy Document, aligned with FATF Recommendation 12).

export const BNM_CATEGORIES = [
  'Head of state / government & cabinet',
  'Member of Parliament / State Assembly',
  'Political party senior official',
  'Senior judicial officer',
  'Military & law enforcement command',
  'SOE / GLC / statutory body / SWF management',
  'Royal family (public function)',
  'Senior government official'
];
const [HEAD, LEGIS, PARTY, JUDGE, MIL, SOE, ROYAL, SGO] = BNM_CATEGORIES;

// Source categories where the organisation decides the BNM category.
const BY_SOURCE = {
  'Political party': PARTY,
  'Military & law enforcement': MIL,
  'Royal household': ROYAL,
  'Regulator & enforcement': SOE,
  'Statutory body': SOE,
  'GLIC & sovereign fund': SOE,
  'GLC (listed)': SOE
};

// Checked in order; first match wins.
const BY_POSITION = [
  [/setiausaha politik|political secretary|pegawai khas/i, SGO],
  [/yang di-?pertua negeri|tuan yang terutama|\bTYT\b/i, HEAD],
  [/yang di-?pertuan agong|raja permaisuri|\bsultan(ah)?\b|tengku mahkota|tunku mahkota|raja muda|tengku ampuan|yang di-?pertuan besar|\braja perlis\b|pemangku raja/i, ROYAL],
  [/perdana menteri|prime minister|menteri besar|ketua menteri|\bpremier\b|\bmenteri\b|\bminister\b|\bEXCO\b|majlis mesyuarat kerajaan|state executive council/i, HEAD],
  [/ahli parlimen|member of parliament|dewan rakyat|dewan negara|\bsenator\b|\bADUN\b|dewan undangan negeri|state assembly|\bspeaker\b|yang di-?pertua dewan/i, LEGIS],
  [/hakim|\bjudge|chief justice|presiden mahkamah|ketua pendaftar|chief registrar|judicial commissioner|pesuruhjaya kehakiman/i, JUDGE],
  [/panglima|ketua staf|chief of (defence|army|navy|air) |ketua polis|inspector[\s-]general of police|komisioner polis|\bjeneral\b|laksamana|marsyal/i, MIL]
];

export function classify(position, sourceCategory) {
  const fixed = BY_SOURCE[sourceCategory];
  // For parties, the military/police and royal households, the organisation defines the role.
  if (fixed && (fixed === PARTY || fixed === MIL || fixed === ROYAL)) return fixed;
  for (const [re, cat] of BY_POSITION) if (re.test(position || '')) return cat;
  return fixed || SGO;
}

// Adjust the role tier to the definition:
//  - SOE/GLC/statutory body/SWF: board members, CEOs AND senior executives are PEPs.
//  - Political parties: top office-bearers are PEPs; wider committee members are marked for review.
const C_SUITE = /chief [a-z ]*officer|\b(CEO|CFO|COO|CIO|CRO|CSO|CTO|CDO)\b|ketua pegawai|pengarah urusan|managing director|group (chief|managing)|timbalan ketua eksekutif|deputy chief executive|ketua eksekutif|presiden/i;
const PARTY_TOP = /\bpresiden\b|\bpresident\b|naib presiden|vice[\s-]president|timbalan presiden|deputy president|setiausaha agung|secretary[\s-]general|bendahari|treasurer|ketua (pemuda|wanita|puteri|srikandi|armada)|(youth|women'?s?) (chief|wing chief)|\bpengerusi\b|\bchair(man|person)?\b|mursyidul am|ketua dewan ulama/i;
const MIL_TOP = /panglima|ketua staf|ketua polis negara|timbalan ketua polis negara|inspector[\s-]general|ketua pengarah|ketua pesuruhjaya|timbalan ketua pesuruhjaya|\bpengarah jabatan|\bjeneral\b|laksamana|marsyal|komisioner/i;

export function adjustTier(tier, position, sourceCategory) {
  const cat = BY_SOURCE[sourceCategory];
  if (cat === SOE && tier === 2 && C_SUITE.test(position || '')) return 1;
  if (cat === PARTY) return PARTY_TOP.test(position || '') ? 1 : 2;
  if (cat === MIL) return MIL_TOP.test(position || '') ? 1 : 2;
  if (cat === ROYAL) return 1;
  return tier;
}

// Family members and close associates (extended PEP status).
export const RELATIONSHIPS = {
  'Family member': ['Parent', 'Spouse', 'Child', 'Sibling', 'Parent-in-law', 'Child-in-law', 'Sibling-in-law'],
  'Close associate': ['Business partner', 'Joint venture partner', 'Shared beneficial owner', 'Legal or financial representative', 'Other close associate']
};
export function relationshipGroup(rel) {
  return RELATIONSHIPS['Family member'].includes(rel) ? 'Family member' : 'Close associate';
}
