// Shiro Hub — Worker Cloudflare : relaie l'API Brawl Stars via le proxy RoyaleAPI (IP fixe 45.79.218.79).
// Variable secrète à créer dans Cloudflare : BRAWL_TOKEN (ta clé, autorisée pour l'IP 45.79.218.79).
const UPSTREAM = 'https://bsproxy.royaleapi.dev/v1';
const ORIGINS = ['https://shiroclaudeai-tech.github.io', 'http://localhost:3000']; // sites autorisés à appeler ce Worker
const VALID = /^[0289PYLQGRJCUV]{3,15}$/;
const TTL = { player: 30, battlelog: 30, brawlers: 6 * 3600, rankings: 300, club: 120 }; // secondes

function cleanTag(raw) {
  let t; try { t = decodeURIComponent(raw || ''); } catch { return null; }
  t = t.toUpperCase().replace(/^#/, '').replace(/O/g, '0').trim();
  return VALID.test(t) ? t : null;
}
function route(url) {
  const p = url.pathname.split('/').filter(Boolean);
  if (p[0] !== 'api') return null;
  const tagged = (kind, fn) => { const t = cleanTag(p[2]); return t && { kind, upstream: fn(t) }; };
  if (p[1] === 'player' && p[2]) return tagged('player', t => `/players/%23${t}`);
  if (p[1] === 'battlelog' && p[2]) return tagged('battlelog', t => `/players/%23${t}/battlelog`);
  if (p[1] === 'club' && p[2]) return tagged('club', t => `/clubs/%23${t}`);
  if (p[1] === 'brawlers') return { kind: 'brawlers', upstream: '/brawlers' };
  if (p[1] === 'rankings' && /^[a-zA-Z]{2,6}$/.test(p[2] || '')) {
    const c = p[2].toLowerCase() === 'global' ? 'global' : p[2].toUpperCase();
    return { kind: 'rankings', upstream: `/rankings/${c}/players?limit=50` };
  }
  return null;
}
const HINTS = {
  403: "Clé refusée : la clé doit être créée avec l'IP 45.79.218.79 (proxy RoyaleAPI) sur developer.brawlstars.com.",
  404: 'Joueur introuvable. Vérifie le tag.',
  429: 'Trop de requêtes, réessaie dans quelques secondes.',
  503: "L'API Brawl Stars est en maintenance."
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    const json = (code, obj, extra = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return json(405, { message: 'Méthode non autorisée.' });
    if (!env.BRAWL_TOKEN) return json(500, { message: 'BRAWL_TOKEN manquant dans les variables du Worker.' });
    const r = route(new URL(req.url));
    if (!r) return json(400, { message: 'Requête invalide (tag incorrect ?).' });
    try {
      const up = await fetch(UPSTREAM + r.upstream, {
        headers: { Authorization: `Bearer ${env.BRAWL_TOKEN}`, Accept: 'application/json' },
        cf: { cacheTtl: TTL[r.kind], cacheEverything: true }
      });
      const text = await up.text();
      let body; try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 200) }; }
      if (up.ok) return json(200, body);
      return json(up.status, { message: HINTS[up.status] || body.message || 'Erreur API', upstream: body });
    } catch {
      return json(502, { message: "Impossible de joindre l'API Brawl Stars (connexion ?)." });
    }
  }
};
