import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['player', 'pod', 'round', 'match', 'subgroup'].includes(name),
});

const CATEGORY_NAMES = { '0': 'Juniors', '1': 'Seniors', '2': 'Masters' };

/**
 * Parse a TDF file buffer and return tournament metadata, player list, and standings.
 * @param {Buffer|string} fileBuffer
 * @returns {{
 *   name: string,
 *   date: string,
 *   players: Array<{player_id: string, player_name: string}>,
 *   standings: Array<{
 *     category: string,
 *     label: string,
 *     finished: Array<{place: number, player_id: string, player_name: string}>,
 *     dnf: Array<{player_id: string, player_name: string}>
 *   }>
 * }}
 */
export function parseTDF(fileBuffer) {
  const text = fileBuffer.toString('utf-8').trim();

  let doc;
  try {
    doc = parser.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse TDF file as XML: ${err.message}`);
  }

  const root = doc.tournament;
  if (!root) {
    throw new Error('Unrecognized TDF format: missing <tournament> root element.');
  }

  // Metadata lives under <data>
  const data = root.data ?? root;
  const name = String(data.name ?? 'Unknown Tournament').trim();
  const rawDate = data.startdate ?? data.date;
  const date = rawDate
    ? normalizeDate(String(rawDate).trim())
    : new Date().toISOString().split('T')[0];

  // Build a userid → full name map from <players><player userid="...">
  const nameMap = buildNameMap(root.players?.player ?? []);

  // Collect attended player IDs from standings or fall back to the players list
  const playerIds = extractPlayerIds(root, nameMap);

  if (playerIds.length === 0) {
    throw new Error(
      'No players found in TDF file. Make sure the file contains a <players> section.'
    );
  }

  const players = playerIds.map((id) => ({
    player_id: id,
    player_name: nameMap.get(id) ?? id,
  }));

  const standings = extractStandings(root, nameMap);

  return { name, date, players, standings };
}

/**
 * Build a Map of userid (string) → "Firstname Lastname" from the <players> section.
 */
function buildNameMap(playerNodes) {
  const map = new Map();
  for (const p of [].concat(playerNodes)) {
    const id = String(p['@_userid'] ?? '').trim();
    if (!id) continue;
    const first = String(p.firstname ?? '').trim();
    const last = String(p.lastname ?? '').trim();
    const fullName = [first, last].filter(Boolean).join(' ') || id;
    map.set(id, fullName);
  }
  return map;
}

/**
 * Extract the list of unique player IDs who attended.
 *
 * Strategy (in order of preference):
 * 1. Standings pods — only players who completed the event appear here
 * 2. Fall back to the full <players> list (everyone registered)
 */
function extractPlayerIds(root, nameMap) {
  // Standings: <standings><pod ...><player id="..." place="..."/></pod></standings>
  const standingsNode = root.standings;
  if (standingsNode) {
    const pods = [].concat(standingsNode.pod ?? []);
    const seen = new Set();
    for (const pod of pods) {
      for (const p of [].concat(pod.player ?? [])) {
        const id = String(p['@_id'] ?? '').trim();
        if (id) seen.add(id);
      }
    }
    if (seen.size > 0) return [...seen];
  }

  // Fallback: use every player in the <players> section
  return [...nameMap.keys()];
}

/**
 * Extract standings grouped by category (0/1/2), each split into finished + dnf.
 * Only returns categories that have at least one player.
 */
function extractStandings(root, nameMap) {
  const standingsNode = root.standings;
  if (!standingsNode) return [];

  // Group pods by category
  const byCategory = new Map();
  for (const pod of [].concat(standingsNode.pod ?? [])) {
    const cat = String(pod['@_category'] ?? '');
    const type = String(pod['@_type'] ?? 'finished');
    if (!byCategory.has(cat)) byCategory.set(cat, { finished: [], dnf: [] });

    const players = [].concat(pod.player ?? []).map((p) => ({
      place: Number(p['@_place'] ?? 0),
      player_id: String(p['@_id'] ?? '').trim(),
      player_name: nameMap.get(String(p['@_id'] ?? '').trim()) ?? String(p['@_id'] ?? ''),
    }));

    if (type === 'dnf') {
      byCategory.get(cat).dnf.push(...players);
    } else {
      byCategory.get(cat).finished.push(...players);
    }
  }

  // Sort categories 2 → 1 → 0 (Masters first), skip empty ones
  return ['2', '1', '0']
    .filter((cat) => {
      const entry = byCategory.get(cat);
      return entry && (entry.finished.length > 0 || entry.dnf.length > 0);
    })
    .map((cat) => {
      const entry = byCategory.get(cat);
      entry.finished.sort((a, b) => a.place - b.place);
      return {
        category: cat,
        label: CATEGORY_NAMES[cat] ?? `Category ${cat}`,
        finished: entry.finished,
        dnf: entry.dnf,
      };
    });
}

function normalizeDate(raw) {
  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // MM/DD/YYYY (Tournament Manager default)
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];

  return new Date().toISOString().split('T')[0];
}
