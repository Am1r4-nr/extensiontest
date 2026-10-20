// One-off clean-up after an update: re-checks stored records with the current rules,
// removes entries that are not people (places, menus, headlines) and fixes names.
import { getAll, putMany, deleteOne } from './db.js';
import { parseName, nameKey, isDateline, matchPosition } from './extractor.js';

export async function cleanRegister() {
  const people = await getAll('people');
  const associates = await getAll('associates');
  const rekey = new Map();
  const removedNames = [];
  const fixed = [];
  for (const p of people) {
    if (p.method === 'upload' || p.method === 'manual') continue; // the user's own data is never auto-deleted
    const n = parseName(p.name);
    // Positions taken from the page heading (e.g. "Ahli Parlimen (Dewan Rakyat)") always pass matchPosition.
    const bad = !n || (n.strength === 'weak' && p.confidence === 'low') || isDateline(p.position) || !matchPosition(p.position)
      || (p.category === 'Political party' && p.confidence === 'low');
    if (bad) {
      await deleteOne('people', p.key);
      removedNames.push(p.bareName);
      continue;
    }
    const newKey = p.sourceId + '|' + nameKey(n.bareName);
    if (newKey !== p.key || n.bareName !== p.bareName) {
      await deleteOne('people', p.key);
      fixed.push({ ...p, key: newKey, bareName: n.bareName, name: n.name });
      rekey.set(p.key, newKey);
    }
  }
  await putMany('people', fixed);
  const relinked = associates.filter(a => rekey.has(a.pepKey)).map(a => ({ ...a, pepKey: rekey.get(a.pepKey) }));
  await putMany('associates', relinked);
  return { removed: removedNames.length, fixed: fixed.length, removedNames };
}
