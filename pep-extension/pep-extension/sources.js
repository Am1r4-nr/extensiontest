// Source registry, built from the consolidated list of Malaysian portals.
// Each source is crawled from its homepage: the crawler looks for leadership pages
// (Pengurusan Tertinggi, Lembaga Pengarah, Jemaah Menteri, EXCO, etc.) and extracts people.
// If discovery misses the right page, pin the exact URL(s) in the Sources tab.
//
// Changes from the original list:
//  - Tracking parameters (?utm_source=...) removed.
//  - KKM and MITI links were missing ("suspicious link removed"): set to moh.gov.my and miti.gov.my.
//  - BNM AML/CFT gateway replaced with bnm.gov.my (the gateway holds guidance, not BNM's leadership).
//  - SSM4U and ePerolehan left out: they are login/paid search portals, not lists of office holders.
//  - Bursa Malaysia and the MyGovernment gateway are included but switched off by default.

export const CATEGORIES = [
  'Federal ministry',
  'Legislature, judiciary & constitutional',
  'Regulator & enforcement',
  'Statutory body',
  'GLIC & sovereign fund',
  'State government',
  'Political party',
  'Military & law enforcement',
  'Royal household',
  'Gateway'
];

const M = 'Federal ministry';
const L = 'Legislature, judiciary & constitutional';
const R = 'Regulator & enforcement';
const S = 'Statutory body';
const G = 'GLIC & sovereign fund';
const ST = 'State government';
const PP = 'Political party';
const ML = 'Military & law enforcement';
const RH = 'Royal household';

export const DEFAULT_SOURCES = [
  // Part I: Federal ministries
  { id: 'jpm', name: "Prime Minister's Department (JPM)", category: M, url: 'https://www.pmo.gov.my/' },
  { id: 'mof', name: 'Ministry of Finance (MOF)', category: M, url: 'https://www.mof.gov.my/' },
  { id: 'kpkm', name: 'Ministry of Agriculture and Food Security (KPKM)', category: M, url: 'https://www.kpkm.gov.my/' },
  { id: 'komunikasi', name: 'Ministry of Communications', category: M, url: 'https://www.komunikasi.gov.my/' },
  { id: 'mindef', name: 'Ministry of Defence (MINDEF)', category: M, url: 'https://www.mod.gov.my/' },
  { id: 'digital', name: 'Ministry of Digital', category: M, url: 'https://www.digital.gov.my/' },
  { id: 'kpdn', name: 'Ministry of Domestic Trade and Cost of Living (KPDN)', category: M, url: 'https://www.kpdn.gov.my/' },
  { id: 'ekonomi', name: 'Ministry of Economy', category: M, url: 'https://www.ekonomi.gov.my/' },
  { id: 'kpm', name: 'Ministry of Education (KPM)', category: M, url: 'https://www.moe.gov.my/' },
  { id: 'petra', name: 'Ministry of Energy Transition and Water Transformation (PETRA)', category: M, url: 'https://www.petra.gov.my/' },
  { id: 'kuskop', name: 'Ministry of Entrepreneur and Cooperatives Development (KUSKOP)', category: M, url: 'https://www.kuskop.gov.my/' },
  { id: 'kln', name: 'Ministry of Foreign Affairs (Wisma Putra)', category: M, url: 'https://www.kln.gov.my/' },
  { id: 'kkm', name: 'Ministry of Health (KKM)', category: M, url: 'https://www.moh.gov.my/' },
  { id: 'kpt', name: 'Ministry of Higher Education (KPT)', category: M, url: 'https://www.mohe.gov.my/' },
  { id: 'kdn', name: 'Ministry of Home Affairs (KDN)', category: M, url: 'https://www.moha.gov.my/' },
  { id: 'kpkt', name: 'Ministry of Housing and Local Government (KPKT)', category: M, url: 'https://www.kpkt.gov.my/' },
  { id: 'kesuma', name: 'Ministry of Human Resources (KESUMA)', category: M, url: 'https://www.mohr.gov.my/' },
  { id: 'miti', name: 'Ministry of Investment, Trade and Industry (MITI)', category: M, url: 'https://www.miti.gov.my/' },
  { id: 'perpaduan', name: 'Ministry of National Unity', category: M, url: 'https://www.perpaduan.gov.my/' },
  { id: 'nres', name: 'Ministry of Natural Resources and Environmental Sustainability (NRES)', category: M, url: 'https://www.nres.gov.my/' },
  { id: 'kpk', name: 'Ministry of Plantation and Commodities (KPK)', category: M, url: 'https://www.kpk.gov.my/' },
  { id: 'kkdw', name: 'Ministry of Rural and Regional Development (KKDW)', category: M, url: 'https://www.rurallink.gov.my/' },
  { id: 'mosti', name: 'Ministry of Science, Technology and Innovation (MOSTI)', category: M, url: 'https://www.mosti.gov.my/' },
  { id: 'motac', name: 'Ministry of Tourism, Arts and Culture (MOTAC)', category: M, url: 'https://www.motac.gov.my/' },
  { id: 'mot', name: 'Ministry of Transport (MOT)', category: M, url: 'https://www.mot.gov.my/' },
  { id: 'kpwkm', name: 'Ministry of Women, Family and Community Development (KPWKM)', category: M, url: 'https://www.kpwkm.gov.my/' },
  { id: 'kkr', name: 'Ministry of Works (KKR)', category: M, url: 'https://www.kkr.gov.my/' },
  { id: 'kbs', name: 'Ministry of Youth and Sports (KBS)', category: M, url: 'https://www.kbs.gov.my/' },

  // Part II: Executive, legislative, judicial & constitutional
  { id: 'parlimen', name: 'Parliament of Malaysia', category: L, url: 'https://www.parlimen.gov.my/' },
  { id: 'agc', name: "Attorney General's Chambers (AGC)", category: L, url: 'https://www.agc.gov.my/' },
  { id: 'kehakiman', name: 'Judiciary (Federal Court / Chief Registrar)', category: L, url: 'https://www.kehakiman.gov.my/' },
  { id: 'spa', name: 'Public Services Commission (SPA)', category: L, url: 'https://www.spa.gov.my/' },
  { id: 'spr', name: 'Election Commission (SPR)', category: L, url: 'https://www.spr.gov.my/' },

  // Part III: Registries & regulators (leadership only)
  { id: 'ssm', name: 'Companies Commission of Malaysia (SSM)', category: R, url: 'https://www.ssm.com.my/' },
  { id: 'myipo', name: 'Intellectual Property Corporation of Malaysia (MyIPO)', category: R, url: 'https://www.myipo.gov.my/' },
  { id: 'bnm', name: 'Bank Negara Malaysia (BNM)', category: R, url: 'https://www.bnm.gov.my/' },
  { id: 'sprm', name: 'Malaysian Anti-Corruption Commission (MACC / SPRM)', category: ML, url: 'https://www.sprm.gov.my/' },
  { id: 'sc', name: 'Securities Commission Malaysia (SC)', category: R, url: 'https://www.sc.com.my/' },
  { id: 'bursa', name: 'Bursa Malaysia', category: R, url: 'https://www.bursamalaysia.com/', enabled: false },
  { id: 'nfcc', name: 'National Anti-Financial Crime Centre (NFCC)', category: R, url: 'https://nfcc.jpm.gov.my/' },
  { id: 'lhdn', name: 'Inland Revenue Board (LHDN)', category: R, url: 'https://www.hasil.gov.my/' },

  // Part IV: Statutory bodies & commissions
  { id: 'kwsp', name: 'Employees Provident Fund (EPF / KWSP)', category: S, url: 'https://www.kwsp.gov.my/' },
  { id: 'perkeso', name: 'Social Security Organisation (PERKESO)', category: S, url: 'https://www.perkeso.gov.my/' },
  { id: 'mida', name: 'Malaysian Investment Development Authority (MIDA)', category: S, url: 'https://www.mida.gov.my/' },
  { id: 'mcmc', name: 'Communications and Multimedia Commission (MCMC)', category: S, url: 'https://www.mcmc.gov.my/' },
  { id: 'st', name: 'Energy Commission (Suruhanjaya Tenaga)', category: S, url: 'https://www.st.gov.my/' },
  { id: 'span', name: 'National Water Services Commission (SPAN)', category: S, url: 'https://www.span.gov.my/' },
  { id: 'skm', name: 'Cooperative Commission of Malaysia (SKM)', category: S, url: 'https://www.skm.gov.my/' },
  { id: 'mara', name: 'Majlis Amanah Rakyat (MARA)', category: S, url: 'https://www.mara.gov.my/' },
  { id: 'matrade', name: 'MATRADE', category: S, url: 'https://www.matrade.gov.my/' },
  { id: 'smecorp', name: 'SME Corp Malaysia', category: S, url: 'https://www.smecorp.gov.my/' },

  // Part V: Sovereign wealth funds & GLICs
  { id: 'khazanah', name: 'Khazanah Nasional Berhad', category: G, url: 'https://www.khazanah.com.my/' },
  { id: 'pnb', name: 'Permodalan Nasional Berhad (PNB)', category: G, url: 'https://www.pnb.com.my/' },
  { id: 'th', name: 'Lembaga Tabung Haji (TH)', category: G, url: 'https://www.tabunghaji.gov.my/' },
  { id: 'ltat', name: 'Armed Forces Fund Board (LTAT)', category: G, url: 'https://www.ltat.org.my/' },
  { id: 'kwap', name: 'Retirement Fund Incorporated (KWAP)', category: G, url: 'https://www.kwap.gov.my/' },
  { id: 'petronas', name: 'PETRONAS', category: G, url: 'https://www.petronas.com/' },

  // Part VI: State governments
  { id: 'johor', name: 'Johor State Government', category: ST, url: 'https://www.johor.gov.my/' },
  { id: 'kedah', name: 'Kedah State Government', category: ST, url: 'https://www.kedah.gov.my/' },
  { id: 'kelantan', name: 'Kelantan State Government', category: ST, url: 'https://www.kelantan.gov.my/' },
  { id: 'melaka', name: 'Melaka State Government', category: ST, url: 'https://www.melaka.gov.my/' },
  { id: 'nsembilan', name: 'Negeri Sembilan State Government', category: ST, url: 'https://www.ns.gov.my/' },
  { id: 'pahang', name: 'Pahang State Government', category: ST, url: 'https://www.pahang.gov.my/' },
  { id: 'penang', name: 'Penang State Government', category: ST, url: 'https://www.penang.gov.my/' },
  { id: 'perak', name: 'Perak State Government', category: ST, url: 'https://www.perak.gov.my/' },
  { id: 'perlis', name: 'Perlis State Government', category: ST, url: 'https://www.perlis.gov.my/' },
  { id: 'sabah', name: 'Sabah State Government', category: ST, url: 'https://www.sabah.gov.my/' },
  { id: 'sarawak', name: 'Sarawak State Government', category: ST, url: 'https://www.sarawak.gov.my/' },
  { id: 'selangor', name: 'Selangor State Government', category: ST, url: 'https://www.selangor.gov.my/' },
  { id: 'terengganu', name: 'Terengganu State Government', category: ST, url: 'https://www.terengganu.gov.my/' },

  // Added for the BNM definition: Syariah judiciary
  { id: 'jksm', name: 'Syariah Judiciary Department (JKSM)', category: L, url: 'https://www.jksm.gov.my/' },

  // Added for the BNM definition: military & law enforcement command
  { id: 'atm', name: 'Malaysian Armed Forces HQ (ATM)', category: ML, url: 'https://www.mafhq.mil.my/' },
  { id: 'army', name: 'Malaysian Army (Tentera Darat)', category: ML, url: 'https://army.mil.my/' },
  { id: 'navy', name: 'Royal Malaysian Navy (TLDM)', category: ML, url: 'https://www.navy.mil.my/' },
  { id: 'airforce', name: 'Royal Malaysian Air Force (TUDM)', category: ML, url: 'https://www.airforce.mil.my/' },
  { id: 'pdrm', name: 'Royal Malaysia Police (PDRM)', category: ML, url: 'https://www.rmp.gov.my/' },
  { id: 'mmea', name: 'Malaysian Maritime Enforcement Agency (APMM)', category: ML, url: 'https://www.mmea.gov.my/' },
  { id: 'imigresen', name: 'Immigration Department (JIM)', category: ML, url: 'https://www.imi.gov.my/' },
  { id: 'kastam', name: 'Royal Malaysian Customs (JKDM)', category: ML, url: 'https://www.customs.gov.my/' },

  // Added for the BNM definition: royal household (state portals also carry their Ruler's pages)
  { id: 'istana', name: 'Istana Negara', category: RH, url: 'https://www.istananegara.gov.my/' },

  // Added for the BNM definition: political parties (national office-bearers).
  // Party sites change often; check the Refresh log after the first run and pin or correct URLs.
  { id: 'umno', name: 'UMNO', category: PP, url: 'https://umno-online.my/' },
  { id: 'pkr', name: 'Parti Keadilan Rakyat (PKR)', category: PP, url: 'https://www.keadilanrakyat.org/' },
  { id: 'dap', name: 'Democratic Action Party (DAP)', category: PP, url: 'https://dapmalaysia.org/' },
  { id: 'pas', name: 'Parti Islam Se-Malaysia (PAS)', category: PP, url: 'https://pas.org.my/' },
  { id: 'amanah', name: 'Parti Amanah Negara (Amanah)', category: PP, url: 'https://www.amanah.org.my/' },
  { id: 'bersatu', name: 'Parti Pribumi Bersatu Malaysia (Bersatu)', category: PP, url: 'https://mybersatu.org/' },
  { id: 'mca', name: 'Malaysian Chinese Association (MCA)', category: PP, url: 'https://www.mca.org.my/' },
  { id: 'mic', name: 'Malaysian Indian Congress (MIC)', category: PP, url: 'https://www.mic.org.my/' },
  { id: 'gerakan', name: 'Parti Gerakan Rakyat Malaysia', category: PP, url: 'https://www.gerakan.org.my/' },

  // Part VII: Central gateway
  { id: 'mygov', name: 'MyGovernment Official Gateway', category: 'Gateway', url: 'https://www.malaysia.gov.my/', enabled: false }
];
