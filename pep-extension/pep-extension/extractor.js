// Extracts people and their positions from Malaysian public-sector web pages.
// Works on a parsed Document (DOMParser), no rendering needed.

// ---------- Honorifics ----------
const HONORIFICS = [
  'Kebawah Duli Yang Maha Mulia', 'Duli Yang Maha Mulia', 'Duli Yang Teramat Mulia', 'Duli Yang Amat Mulia',
  'Seri Paduka Baginda', 'KDYMM', 'KDYTM', 'DYMM', 'DYTM', 'DYAM', 'Tuan Yang Terutama', 'TYT',
  'Tuanku', 'Sultanah', 'Sultan', 'Almarhum', 'Almarhumah',
  'Laksamana Madya', 'Laksamana Muda', 'Laksamana Pertama', 'Marsyal Udara', 'Leftenan Kolonel', 'Mejar',
  'Timbalan Komisioner Polis', 'Senior Asisten Komisioner', 'Asisten Komisioner', 'Komisioner Polis',
  'Timbalan Komisioner', 'Superintendan', 'Inspektor', 'IGP', 'CP', 'DCP', 'SAC', 'ACP', 'Supt', 'DSP', 'ASP', 'Insp',
  'Yang Amat Berhormat', 'Yang Berhormat Mulia', 'Yang Berhormat', 'Yang Amat Mulia', 'Yang Berbahagia',
  'Yang Mulia', 'Yang Berusaha', 'Yang Amat Arif', 'Yang Arif',
  'YAB', 'YAA', 'YAM', 'YBM', 'YBhg', 'YBrs', 'YB', 'YM', 'YA',
  'Tun', 'Toh Puan', 'Tan Sri', 'Puan Sri',
  'Datuk Seri Panglima', 'Datuk Seri Utama', 'Datuk Seri', "Dato' Seri", 'Dato Seri', "Dato' Sri", 'Dato Sri',
  'Datuk Patinggi', 'Datuk Amar', 'Datuk Wira', "Dato' Wira", "Dato' Indera", 'Datuk', "Dato'", 'Dato',
  'Datin Paduka', 'Datin Seri', 'Datin Sri', 'Datin',
  'Senator', 'Profesor Madya', 'Prof Madya', 'Profesor', 'Professor', 'Prof', 'Dr', 'Ir', 'Ts', 'Sr', 'Ar', 'CA',
  'Jeneral', 'Laksamana', 'Leftenan Jeneral', 'Mejar Jeneral', 'Brigedier Jeneral', 'Kolonel', 'Kapten', 'Komisioner',
  'Haji', 'Hajah', 'Hj', 'Hjh',
  'Tuan', 'Puan', 'Encik', 'En', 'Cik', 'Mr', 'Mrs', 'Ms', 'Madam'
];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HON_RE = new RegExp(
  '^(' + [...HONORIFICS].sort((a, b) => b.length - a.length).map(esc).join('|') + ')\\.?(?=[\\s,]|$)[\\s,]*',
  'i'
);

// Connectors that appear inside Malaysian names.
const CONNECTORS = new Set(['ibni', 'ibn', 'almarhum', 'al-marhum', 'al-haj', 'al-haj.', 'bin', 'binti', 'bt', 'bte', 'b', 'a/l', 'a/p', 'al', 'ap', '@', 'anak', 'ak', 'van', 'de', 'el']);
const STRONG_CONNECTOR = /\s(ibni|bin|binti|bt\.?|bte|b\.|a\/l|a\/p|anak|ak\.)\s/i;

// Words that never appear inside a person's name: organisation words, UI words, position words.
const STOP = new Set(`menteri timbalan ketua setiausaha pengarah pengerusi kementerian jabatan bahagian unit seksyen pejabat
lembaga majlis dewan negeri kerajaan malaysia ministry minister deputy secretary general director chairman chairperson board
office department division section management pengurusan tertinggi profil profile organisasi carta portal rasmi official
laman utama home hubungi contact berita news media kenyataan and dan of the to untuk bagi dari for in on with sila klik
click here sini read more baca lagi selanjutnya email emel tel telefon faks fax copyright hakcipta terpelihara reserved
rights policy dasar privasi privacy sitemap peta faq soalan login log masuk search carian cari visi misi mission vision
objektif fungsi sejarah history piagam pelanggan perkhidmatan services statistik tender sebut harga jawatan kosong career
kerjaya aduan feedback maklum balas pautan links galeri gallery video penerbitan publications muat turun download akta
peraturan pekeliling garis panduan program projek aktiviti events acara pengumuman announcements bajet budget laporan
report tahunan annual parlimen parliament senat senate ahli member members mesyuarat meeting commission suruhanjaya berhad
bhd sdn corporation perbadanan bank national nasional federal persekutuan state city putrajaya kuala lumpur
chief executive officer eksekutif pegawai presiden president governor gabenor commissioner pesuruhjaya speaker judge
mahkamah court team pasukan our kami about mengenai tentang welcome selamat datang overview latar belakang
agong agung darul ridzuan takzim naim aman makmur khusus ehsan iman hadapan staf tentera darat laut udara
polis diraja pemuda wanita puteri bendahari naib pemangku mahkota ampuan istana perhimpunan parti party jawatankuasa
kawasan daerah mukim kampung kg taman jalan lorong wisma menara bangunan dataran felda ladang estet
kuala sungai sg pulau bukit batu tanjung tg teluk kota bandar pekan padang pasir air ayer lembah seberang permatang simpang
parit alor kubang changkat setar kuantan
rasmikan merasmikan dirasmikan lancar melancarkan dilancarkan hadir sertai menyertai terima menerima sambut
menyambut lawat melawat umum umumkan mengumumkan tegas gesa minta kata bantah sokong tolak baharu tahniah ucap ucapan
sidang summit global halal antarabangsa kebangsaan pertandingan piala debat forum seminar karnival festival ekspo expo
anugerah award bersama perasmian pelancaran persidangan konvensyen kempen perhimpunan himpunan jelajah ziarah kunjung
tinjau meninjau bincang perbincangan dialog taklimat sesi kursus bengkel latihan pameran pesta hebahan kenyataan
launch launches visit visits meets meeting opens officiates attends conference ceremony summit tournament championship
capaian pantas perbarisan serah terima sambutan minggu lawatan kunjungan majlis cawangan zon wilayah panglima
sabah sarawak johor kedah kelantan melaka pahang perak perlis selangor terengganu penang pinang sembilan labuan`.split(/\s+/));

const ROMAN = /^(II|III|IV|VI|VII|VIII|IX|XI|XII)$/;
const POSTNOMINALS = new Set(['tudm', 'tldm', 'td', 'atm', 'pdrm', 'rmaf', 'rmn', 'psc', 'ndc', 'rmr', 'rmp']);

export function normApos(s) {
  return String(s || '').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'").replace(/\s+/g, ' ').trim();
}

// Strip leading honorifics. Returns { titles: [...], rest }.
export function stripHonorifics(text) {
  let rest = normApos(text).replace(/^[\s,.\-–—•·*]+/, '');
  const titles = [];
  for (let i = 0; i < 12; i++) {
    const m = rest.match(HON_RE);
    if (!m) break;
    titles.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return { titles, rest: rest.trim() };
}

// Normalised key used for de-duplication and search.
export function nameKey(bare) {
  return normApos(bare)
    .toLowerCase()
    .replace(/\b(binti|bte|bt|b)\b\.?/g, 'bin')
    .replace(/\ba\/[lp]\b/g, 'al')
    .replace(/[^\p{L}\s@]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchKey(text) {
  return nameKey(stripHonorifics(text).rest);
}

// Decide whether a string is a person's name. Returns null or { name, bareName, titles, strength }.
export function parseName(raw) {
  const text = normApos(raw);
  if (text.length < 5 || text.length > 140) return null;
  const { titles, rest } = stripHonorifics(text);
  // Drop post-nominals / trailing parts after a comma or bracket.
  const core = rest.split(/\s*[,(]\s*/)[0].replace(/[.;:]+$/, '').trim();
  if (!core || /\d/.test(core) || core.length > 90) return null;
  const tokens = core.split(/\s+/).filter(Boolean);
  // Drop trailing award or service letters: S.S.M.Z, D.P.M.T, TUDM, TLDM, PDRM ...
  while (tokens.length > 2) {
    const last = tokens[tokens.length - 1];
    if (/^(?:[A-Za-z]\.)+[A-Za-z]?\.?$/.test(last) || POSTNOMINALS.has(last.toLowerCase().replace(/\./g, ''))) tokens.pop();
    else break;
  }
  if (tokens.length < 2 || tokens.length > 10) return null;
  let nameTokens = 0;
  for (const t of tokens) {
    const tl = t.toLowerCase().replace(/[.,]/g, '');
    if (CONNECTORS.has(tl) || CONNECTORS.has(t.toLowerCase())) continue;
    if (STOP.has(tl)) return null;
    if (!/^[\p{Lu}@'(]/u.test(t)) return null; // every name token starts with a capital
    if (!/^[\p{L}@'.\-/()]+$/u.test(t)) return null;
    nameTokens++;
  }
  if (nameTokens < 2) return null;
  // Headlines often start with a role acronym (TPM, PM, MB, KSU...) inside mixed-case text.
  const mixedCase = core !== core.toUpperCase();
  if (mixedCase && tokens.some(t => /^[A-Z]{2,6}$/.test(t) && !ROMAN.test(t) && !POSTNOMINALS.has(t.toLowerCase()))) return null;
  const hasConnector = STRONG_CONNECTOR.test(' ' + tokens.join(' ') + ' ');
  const strength = titles.length || hasConnector ? 'strong' : 'weak';
  // A name with no title and no bin/binti is rarely longer than four words; longer is usually a headline.
  if (strength === 'weak' && nameTokens > 4) return null;
  const bareName = toDisplayCase(tokens.join(' '));
  return { name: [...titles.map(toDisplayCase), bareName].join(' '), bareName, titles, strength };
}

function toDisplayCase(s) {
  // Only re-case fully upper-case strings; leave mixed case as published.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-'/(@])(\p{L})/gu, (m, p, c) => p + c.toUpperCase())
    .replace(/\b(Bin|Binti|Bt|Bte|A\/L|A\/P|Anak)\b/g, w => w.toLowerCase())
    .replace(/\bYb\b/g, 'YB').replace(/\bYab\b/g, 'YAB').replace(/\bYbhg\b/g, 'YBhg')
    .replace(/\b(Dsp|Asp|Acp|Sac|Dcp|Cp|Igp|Tyt|Dymm|Kdymm|Dytm)\b/g, w => w.toUpperCase());
}

// ---------- Positions ----------
// Tier 1: roles that are clearly PEP. Tier 2: senior roles to review.
const POS_TIER2_FIRST = [
  /timbalan ketua setiausaha/i, /timbalan ketua pengarah/i, /deputy secretary[\s-]general/i, /deputy director[\s-]general/i
];
const POS_TIER1 = [
  /yang di-?pertuan agong/i, /raja permaisuri agong/i, /\bsultan(ah)?\b/i, /tengku mahkota/i, /tunku mahkota/i,
  /raja muda/i, /yang di-?pertuan besar/i, /tengku ampuan/i, /pemangku raja/i, /yang di-?pertua negeri/i,
  /timbalan presiden/i, /naib presiden/i, /deputy president/i, /vice[\s-]president/i, /setiausaha agung/i,
  /bendahari agung/i, /\btreasurer\b/i, /ketua (pemuda|wanita|puteri|srikandi|armada)/i, /(youth|women'?s?) chief/i,
  /mursyidul am/i, /ketua dewan ulama/i,
  /ketua staf/i, /chief of (defence|army|navy|air)/i, /komisioner polis/i,
  /perdana menteri/i, /prime minister/i, /menteri besar/i, /ketua menteri/i, /\bpremier\b/i,
  /timbalan menteri/i, /deputy minister/i, /\bmenteri\b/i, /\bminister\b/i,
  /setiausaha politik/i, /political secretary/i,
  /ketua setiausaha/i, /secretary[\s-]general/i, /ketua pengarah/i, /director[\s-]general/i,
  /timbalan pengerusi/i, /deputy chair/i, /\bpengerusi\b/i, /\bchair(man|person|woman)?\b/i,
  /ketua pegawai eksekutif/i, /chief executive/i, /\bCEO\b/, /\bpresiden\b/i, /\bpresident\b/i,
  /pengarah urusan/i, /managing director/i,
  /ahli lembaga pengarah/i, /board member/i, /non[\s-]executive director/i, /independent director/i, /ahli lembaga/i,
  /ahli parlimen/i, /member of parliament/i, /ahli dewan (negara|rakyat)/i, /\bsenator\b/i,
  /\bspeaker\b/i, /yang di-?pertua/i, /\bADUN\b/, /ahli dewan undangan negeri/i, /\bEXCO\b/i,
  /majlis mesyuarat kerajaan negeri/i, /setiausaha kerajaan negeri/i, /state secretary/i, /pegawai kewangan negeri/i,
  /penasihat undang-undang negeri/i, /state legal adviser/i, /state financial officer/i,
  /peguam negara/i, /attorney[\s-]general/i, /peguam cara negara/i, /solicitor[\s-]general/i,
  /ketua hakim/i, /chief justice/i, /hakim besar/i, /chief judge/i, /hakim mahkamah/i, /\bjudge\b/i,
  /presiden mahkamah/i, /ketua pendaftar/i, /chief registrar/i,
  /timbalan gabenor/i, /deputy governor/i, /\bgabenor\b/i, /\bgovernor\b/i,
  /ketua pesuruhjaya/i, /chief commissioner/i, /\bpesuruhjaya\b/i, /\bcommissioner\b/i, /ahli suruhanjaya/i,
  /ketua audit negara/i, /auditor[\s-]general/i, /ketua polis/i, /inspector[\s-]general/i, /\bpanglima\b/i,
  /duta besar/i, /\bduta\b/i, /ambassador/i, /pesuruhjaya tinggi/i, /high commissioner/i,
  /datuk bandar/i, /\bmayor\b/i, /ketua eksekutif/i
];
const POS_TIER2 = [
  /majlis tertinggi/i, /central executive committee/i, /\bCEC\b/, /majlis pimpinan/i, /ahli jawatankuasa/i,
  /ketua penerangan/i, /\bbendahari\b/i, /ketua polis (negeri|kontinjen|daerah)/i,
  /\bpengarah\b/i, /\bdirector\b/i, /chief (operating|financial|investment|risk|strategy|digital|technology) officer/i,
  /\b(CFO|COO|CIO|CRO|CSO)\b/, /ketua pegawai/i, /setiausaha akhbar/i, /press secretary/i, /setiausaha sulit/i,
  /private secretary/i, /setiausaha bahagian/i, /under[\s-]?secretary/i, /ahli majlis/i, /penasihat/i, /adviser|advisor/i,
  /\bsetiausaha\b/i, /\bsecretary\b/i, /senior vice president/i, /\bketua\b/i
];

// News datelines such as "KUANTAN, 28 Ogos 2026 – ..." are never positions.
const DATE_RE = /\b\d{1,2}\s+(jan\w*|feb\w*|mac|mar\w*|apr\w*|mei|may|jun\w*|jul\w*|ogo?s|aug\w*|sep\w*|okt\w*|oct\w*|nov\w*|dis\w*|dec\w*)\s+(19|20)\d{2}\b/i;
export function isDateline(text) {
  return DATE_RE.test(text || '') || /^[A-Z][A-Z .'-]{2,},\s/.test(normApos(text));
}

// Event names are never positions: "Pertandingan Debat Piala ... 2026", "Majlis Perasmian ...".
const EVENT_RE = /\b(pertandingan|piala|debat|majlis perasmian|perasmian|pelancaran|sambutan|karnival|festival|ekspo|expo|pameran|anugerah|award|forum|seminar|persidangan|konvensyen|summit|kempen|jelajah|program|bengkel|kursus|lawatan|kunjungan|taklimat|sidang media|conference|ceremony|tournament|launch)\b/i;
export function isEventText(text) {
  return EVENT_RE.test(text || '') || /\b(19|20)\d{2}\b/.test(text || '');
}

export function matchPosition(line) {
  const text = normApos(line);
  if (!text || text.length > 160 || isDateline(text) || isEventText(text)) return null;
  for (const re of POS_TIER2_FIRST) if (re.test(text)) return { position: clip(text), tier: 2 };
  for (const re of POS_TIER1) if (re.test(text)) return { position: clip(text), tier: 1 };
  for (const re of POS_TIER2) if (re.test(text)) return { position: clip(text), tier: 2 };
  return null;
}
const clip = s => (s.length > 160 ? s.slice(0, 157) + '…' : s).replace(/^[\s\-–—:|,•]+|[\s\-–—:|,]+$/g, '');

// Page-level context: used when a clear name has no position next to it.
const PAGE_CONTEXT = [
  [/ahli dewan rakyat|ahli parlimen|members? of parliament/i, 'Ahli Parlimen (Dewan Rakyat)', 1],
  [/ahli dewan negara|senator/i, 'Senator (Dewan Negara)', 1],
  [/ahli dewan undangan negeri|\bADUN\b|state assembly(men| members)?/i, 'Ahli Dewan Undangan Negeri', 1],
  [/majlis mesyuarat kerajaan negeri|\bEXCO\b|state executive council/i, 'Ahli Majlis Mesyuarat Kerajaan Negeri (EXCO)', 1],
  [/jemaah menteri|\bcabinet\b/i, 'Jemaah Menteri', 1],
  [/lembaga pengarah|board of directors|ahli lembaga|board members/i, 'Ahli Lembaga Pengarah', 1],
  [/anggota suruhanjaya|ahli suruhanjaya|commission members|members of the commission/i, 'Ahli Suruhanjaya', 1],
  [/hakim|judges/i, 'Hakim', 1],
  [/majlis tertinggi|majlis pimpinan (pusat|tertinggi)/i, 'Ahli Majlis Tertinggi / Pimpinan Pusat', 2],
  [/central executive committee|\bCEC\b/, 'Central Executive Committee member', 2],
  [/carta organisasi|organi[sz]ation(al)? chart|struktur organisasi/i, 'Pengurusan Tertinggi', 2],
  [/pengurusan tertinggi|top management|senior management|management team|leadership/i, 'Pengurusan Tertinggi', 2]
];

export function contextFromText(text) {
  const t = normApos(text);
  for (const [re, position, tier] of PAGE_CONTEXT) if (re.test(t)) return { position, tier, fromPage: true };
  return null;
}

function pageContext(doc) {
  const bits = [doc.title || ''];
  doc.querySelectorAll('h1, h2, .page-title, .breadcrumb, [class*="breadcrumb"]').forEach(el => bits.push(el.textContent || ''));
  return contextFromText(bits.join(' | '));
}

// ---------- DOM to lines ----------
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'NAV', 'FOOTER', 'FORM', 'SELECT', 'BUTTON', 'OBJECT']);
const INLINE = new Set(['A', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'SMALL', 'SUP', 'SUB', 'FONT', 'ABBR', 'LABEL', 'MARK', 'CITE', 'Q', 'TIME']);

export function domToLines(root) {
  const lines = [];
  let buf = '';
  const flush = () => { const t = normApos(buf); if (t) lines.push(t); buf = ''; };
  const walk = node => {
    if (node.nodeType === 3) { buf += node.nodeValue + ' '; return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (node.getAttribute && (node.getAttribute('aria-hidden') === 'true' || /(^|\s)(menu|navbar|nav-|footer|breadcrumb)/i.test(node.getAttribute('class') || ''))) return;
    if (tag === 'BR') { flush(); return; }
    if (tag === 'IMG') {
      const alt = normApos(node.getAttribute('alt') || node.getAttribute('title') || '');
      if (alt.length > 4 && !/\.(png|jpe?g|gif|webp)$/i.test(alt)) { flush(); lines.push(alt); }
      return;
    }
    const block = !INLINE.has(tag);
    if (block) flush();
    for (const child of node.childNodes) walk(child);
    if (block) flush();
  };
  walk(root);
  flush();
  return lines;
}

// ---------- Main extraction ----------
export function extractPeople(doc, pageUrl) {
  const body = doc.body || doc.documentElement;
  if (!body) return [];
  return extractFromLines(domToLines(body), pageContext(doc), pageUrl);
}

// Core extraction over plain lines. '' lines mark box boundaries (PDF / picture org charts).
export function extractFromLines(lines, ctx, pageUrl) {
  const parsed = lines.map(l => ({ line: l, name: parseName(l) }));
  const people = new Map();

  for (let i = 0; i < parsed.length; i++) {
    const { line, name } = parsed[i];
    if (!line) continue;
    let person = name;
    let inlinePos = null;

    // "Name – Position" or "Position: Name" on one line
    if (!person) {
      const parts = line.split(/\s+[–—|-]\s+|\s*:\s+/);
      if (parts.length >= 2 && parts.length <= 4) {
        for (let k = 0; k < parts.length; k++) {
          const n = parseName(parts[k]);
          if (n) {
            const others = parts.filter((_, j) => j !== k).join(' ');
            const pos = matchPosition(others);
            if (pos) { person = n; inlinePos = pos; break; }
          }
        }
      }
    } else {
      // Name followed by ", Position" on the same line
      const after = normApos(line).split(/,\s*/).slice(1).join(', ');
      if (after) inlinePos = matchPosition(after);
    }
    if (!person) continue;

    // Names without an honorific or bin/binti are accepted only on a recognised leadership page
    // (board, EXCO, cabinet...), with a position on the very next or previous line.
    if (person.strength === 'weak' && (!ctx || matchPosition(person.bareName))) continue;
    const pos = inlinePos || nearbyPosition(parsed, i, person.strength === 'strong' ? [1, 2, -1, 3, -2] : [1, -1])
      || (person.strength === 'strong' ? ctx : null);
    if (!pos) continue;

    const key = nameKey(person.bareName);
    if (!key || key.split(' ').length < 2) continue;
    const rec = {
      key,
      name: person.name,
      bareName: person.bareName,
      titles: person.titles.map(toDisplayCase).join(' '),
      position: pos.position,
      tier: pos.tier,
      confidence: person.strength === 'strong' && !pos.fromPage ? 'high' : person.strength === 'strong' ? 'medium' : 'low',
      url: pageUrl
    };
    const prev = people.get(key);
    if (!prev || better(rec, prev)) people.set(key, rec);
  }
  return [...people.values()];
}

function nearbyPosition(parsed, i, order) {
  for (const d of order) {
    const j = i + d;
    if (j < 0 || j >= parsed.length) continue;
    // Stop if another name sits between us and the candidate line.
    const step = d > 0 ? 1 : -1;
    let blocked = false;
    // Another name, or the edge of a box ('' line), stops the search in that direction.
    for (let k = i + step; k !== j; k += step) if (parsed[k].name || !parsed[k].line) { blocked = true; break; }
    if (blocked || parsed[j].name || !parsed[j].line) continue;
    const m = matchPosition(parsed[j].line);
    if (m) return m;
  }
  return null;
}

function better(a, b) {
  const rank = { high: 3, medium: 2, low: 1 };
  if (a.tier !== b.tier) return a.tier < b.tier;
  if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] > rank[b.confidence];
  return (a.position || '').length > (b.position || '').length;
}

// ---------- Link discovery ----------
const LEAD_RE = /(majlis[\s_-]*tertinggi|pimpinan[\s_-]*(pusat|tertinggi)|pucuk[\s_-]*pimpinan|central[\s_-]*executive|\bcec\b|jawatankuasa[\s_-]*kerja|office[\s_-]*bearers|our[\s_-]*leaders|\bleaders\b|yang[\s_-]*di[\s_-]*pertuan[\s_-]*agong|seri[\s_-]*paduka|institusi[\s_-]*diraja|raja[\s_-]*raja|\bdiraja\b|\bpanglima\b|barisan[\s_-]*pimpinan|pengurusan[\s_-]*tertinggi|top[\s_-]*management|senior[\s_-]*management|management[\s_-]*team|carta[\s_-]*organisasi|organi[sz]ation(al)?[\s_-]*chart|lembaga[\s_-]*pengarah|board[\s_-]*of[\s_-]*directors|board[\s_-]*members|ahli[\s_-]*lembaga|leadership|kepimpinan|barisan[\s_-]*(pentadbiran|kepimpinan|pengurusan)|profil[\s_-]*(menteri|pengurusan|kepimpinan|pimpinan)|jemaah[\s_-]*menteri|\bcabinet\b|\bexco\b|majlis[\s_-]*mesyuarat[\s_-]*kerajaan|ahli[\s_-]*dewan|ahli[\s_-]*parlimen|senarai[\s_-]*ahli|dewan[\s_-]*undangan|pentadbiran[\s_-]*kerajaan|our[\s_-]*people|anggota[\s_-]*suruhanjaya|ahli[\s_-]*suruhanjaya|members[\s_-]*of[\s_-]*the[\s_-]*commission|\bhakim\b|\bjudges\b|pimpinan|governance[\s_-]*structure)/i;
const ABOUT_RE = /(profil|mengenai[\s_-]*kami|tentang[\s_-]*kami|about[\s_-]*us|\babout\b|maklumat[\s_-]*korporat|info[\s_-]*korporat|korporat|corporate|organisasi|organisation|organization)/i;
const AVOID_RE = /(berita|kenyataan|siaran|pengumuman|announcement|press|news|media|ucapan|speech|galeri|gallery|video|tender|jawatan|career|kerjaya|aduan|faq|login|daftar|register|download|muat[\s_-]*turun|\.pdf|\.jpe?g|\.png|\.docx?|\.xlsx?|\.zip|mailto:|tel:|javascript:|facebook|twitter|instagram|youtube|tiktok|linkedin|whatsapp)/i;

// Score an address (or a page title prefixed with "x/") as a likely leadership page.
export function scoreUrl(url) {
  let hay;
  try { const u = new URL(url, 'https://x.invalid'); hay = decodeURIComponent(u.pathname + ' ' + u.search); } catch { hay = String(url || ''); }
  hay = hay.replace(/[/_.=&?+-]+/g, ' ');
  if (AVOID_RE.test(hay)) return 0;
  return LEAD_RE.test(hay) ? 3 : DIR_RE.test(hay) ? 2 : 0;
}

export function baseDomain(url) {
  try { return new URL(url).hostname.replace(/^www\d?\./, ''); } catch { return ''; }
}

const DIR_RE = /(direktori|directory|senarai[\s_-]*(pegawai|kakitangan)|staff[\s_-]*(list|directory)|pegawai[\s_-]*utama)/i;
const CHART_RE = /(carta|organi[sz]|org[\s_-]*chart|struktur|pengurusan|lembaga|board|exco|menteri|kepimpinan|leadership|pimpinan|majlis|profil|jawatankuasa|ahli)/i;

// PDFs and pictures that look like org charts or leadership lists.
export function discoverMedia(doc, pageUrl, homeUrl) {
  const home = baseDomain(homeUrl);
  const out = new Map();
  const add = (href, label, kind, bonus = 0) => {
    let abs;
    try { abs = new URL(href, pageUrl); } catch { return; }
    if (!/^https?:$/.test(abs.protocol)) return;
    const host = abs.hostname.replace(/^www\d?\./, '');
    if (!(host === home || host.endsWith('.' + home))) return;
    const hay = normApos(label) + ' ' + decodeURIComponent(abs.pathname).replace(/[/_.=&?-]+/g, ' ');
    if (/(logo|icon|banner|jata|bendera|flag|favicon|sprite|button|social|background|bg[\s_-])/i.test(hay)) return;
    let score = (CHART_RE.test(hay) ? 3 : 0) + bonus;
    if (/carta|org[\s_-]*chart|struktur organisasi|organi[sz]ation(al)? chart/i.test(hay)) score += 2;
    if (score < 2) return;
    const prev = out.get(abs.href);
    if (!prev || prev.score < score) out.set(abs.href, { url: abs.href, kind, score });
  };
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/\.pdf($|[?#])/i.test(href)) add(href, a.textContent || '', 'pdf');
    else if (/\.(png|jpe?g|webp|svg)($|[?#])/i.test(href)) add(href, a.textContent || '', 'image');
  });
  doc.querySelectorAll('img[src], object[data], embed[src], iframe[src]').forEach(el => {
    const src = el.getAttribute('src') || el.getAttribute('data') || '';
    const w = parseInt(el.getAttribute('width') || '0', 10);
    const label = (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('title') || '');
    if (/\.pdf($|[?#])/i.test(src)) add(src, label, 'pdf', 1);
    else if (el.tagName === 'IMG') add(src, label, 'image', w >= 600 ? 1 : 0);
  });
  return [...out.values()].sort((a, b) => b.score - a.score);
}

export function discoverLinks(doc, pageUrl, homeUrl) {
  const home = baseDomain(homeUrl);
  const out = new Map();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    let abs;
    try { abs = new URL(href, pageUrl); } catch { return; }
    if (!/^https?:$/.test(abs.protocol)) return;
    const host = abs.hostname.replace(/^www\d?\./, '');
    if (!(host === home || host.endsWith('.' + home))) return;
    abs.hash = '';
    const text = normApos(a.textContent || a.getAttribute('title') || '');
    const hay = text + ' ' + decodeURIComponent(abs.pathname + abs.search).replace(/[/_.=&?-]+/g, ' ');
    if (AVOID_RE.test(hay) || AVOID_RE.test(abs.href)) return;
    let score = 0;
    if (LEAD_RE.test(text)) score = 4;
    else if (LEAD_RE.test(hay)) score = 3;
    else if (DIR_RE.test(hay)) score = 2; // staff directory: read for senior officials only
    else if (ABOUT_RE.test(text)) score = 1;
    if (!score) return;
    const u = abs.href;
    const prev = out.get(u);
    if (!prev || prev.score < score) out.set(u, { url: u, score, text: text.slice(0, 80) });
  });
  return [...out.values()].sort((a, b) => b.score - a.score);
}
