// Shiro Hub — petit serveur : sert la page + relaie l'API officielle Brawl Stars.
// Aucune dépendance. Node 18+ requis.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Lecture du fichier .env (BRAWL_TOKEN=...)
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const TOKEN = process.env.BRAWL_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const API = 'https://api.brawlstars.com/v1';
const VALID = /^[0289PYLQGRJCUV]{3,15}$/;

if (!TOKEN) {
  console.error('\n✖ Il manque BRAWL_TOKEN dans le fichier .env\n');
  process.exit(1);
}

const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/bg.webp': 'bg.webp', '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest', '/icon.svg': 'icon.svg', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/ic-trophy.png': 'ic-trophy.png', '/ic-gadget.png': 'ic-gadget.png', '/ic-star.png': 'ic-star.png', '/ic-hyper.png': 'ic-hyper.png', '/ic-coin.png': 'ic-coin.png' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const cache = new Map();
const TTL = { player: 30e3, battlelog: 30e3, brawlers: 6 * 3600e3, rankings: 5 * 60e3, club: 2 * 60e3 };

function cleanTag(raw) {
  const t = decodeURIComponent(raw || '').toUpperCase().replace(/^#/, '').replace(/O/g, '0').trim();
  return VALID.test(t) ? t : null;
}

function route(url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[0] !== 'api') return null;
  if (parts[1] === 'player' && parts[2]) {
    const t = cleanTag(parts[2]);
    return t && { kind: 'player', upstream: `/players/%23${t}` };
  }
  if (parts[1] === 'battlelog' && parts[2]) {
    const t = cleanTag(parts[2]);
    return t && { kind: 'battlelog', upstream: `/players/%23${t}/battlelog` };
  }
  if (parts[1] === 'club' && parts[2]) {
    const t = cleanTag(parts[2]);
    return t && { kind: 'club', upstream: `/clubs/%23${t}` };
  }
  if (parts[1] === 'brawlers') return { kind: 'brawlers', upstream: '/brawlers' };
  if (parts[1] === 'rankings' && /^[a-zA-Z]{2,6}$/.test(parts[2] || '')) {
    const c = parts[2].toLowerCase() === 'global' ? 'global' : parts[2].toUpperCase();
    return { kind: 'rankings', upstream: `/rankings/${c}/players?limit=50` };
  }
  return null;
}

async function proxy(r, res) {
  const key = r.upstream;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL[r.kind]) return send(res, 200, hit.body);
  try {
    const up = await fetch(API + r.upstream, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
    const text = await up.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 200) }; }
    if (up.ok) {
      cache.set(key, { t: Date.now(), body });
      return send(res, 200, body);
    }
    const hints = {
      403: "Clé refusée : l'IP publique de ce PC n'est plus celle autorisée pour la clé (ou la clé est invalide). Régénère-la sur developer.brawlstars.com.",
      404: 'Joueur introuvable. Vérifie le tag.',
      429: 'Trop de requêtes, réessaie dans quelques secondes.',
      503: "L'API Brawl Stars est en maintenance.",
    };
    return send(res, up.status, { message: hints[up.status] || body.message || 'Erreur API', upstream: body });
  } catch (e) {
    return send(res, 502, { message: "Impossible de joindre l'API Brawl Stars (connexion ?)." });
  }
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const r = route(url);
    return r ? proxy(r, res) : send(res, 400, { message: 'Requête invalide (tag incorrect ?).' });
  }
  // Images locales : /img/mastery/<brawler>-<1-7>.webp et /img/ranked/<année>-<rang>.webp
  const im = url.pathname.match(/^\/img\/(mastery|ranked)\/([a-z0-9-]+)\.webp$/);
  if (im) {
    const fp = path.join(__dirname, 'img', im[1], im[2] + '.webp');
    if (fs.existsSync(fp)) {
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=604800' });
      return fs.createReadStream(fp).pipe(res);
    }
    res.writeHead(404); return res.end('Not found');
  }
  const file = STATIC[url.pathname];
  if (file) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(path.join(__dirname, file)).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Shiro Hub est lancé\n  → Sur ce PC       : http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  → Sur ton téléphone (même Wi-Fi) : http://${i.address}:${PORT}`);
  console.log('');
});
