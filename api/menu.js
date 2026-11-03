import { put, list, del } from '@vercel/blob';
import { json, isAuthed, blobReady } from './_lib.js';

// Each save is a new immutable blob (wayan/menu/menu-<time>-<random>.json); the newest one wins.
// That keeps a version history (last KEEP saves) and avoids stale CDN copies of an overwritten file.
const PREFIX = 'wayan/menu/';
const KEEP = 20;

async function allVersions() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function GET(request) {
  if (!blobReady()) return json({ error: 'Blob storage is not connected' }, 503);
  const versions = await allVersions();
  if (!versions.length) return json({ error: 'No menu saved yet' }, 404, { 'cache-control': 'public, s-maxage=30' });
  const r = await fetch(versions[0].url, { cache: 'no-store' });
  if (!r.ok) return json({ error: 'Could not read menu' }, 502);
  // Guests get a CDN-cached copy (≤60 s old); the admin asks with ?fresh=… and bypasses it.
  const fresh = new URL(request.url).searchParams.has('fresh');
  return new Response(await r.text(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': fresh ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
    }
  });
}

export async function PUT(request) {
  if (!isAuthed(request)) return json({ error: 'Unauthorized' }, 401);
  if (!blobReady()) return json({ error: 'Blob storage is not connected' }, 503);
  const text = await request.text();
  if (text.length > 4 * 1048576) return json({ error: 'Menu too large' }, 413);
  let menu;
  try { menu = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!menu || !Array.isArray(menu.items) || !Array.isArray(menu.tabs) || !menu.tabs.length) return json({ error: 'Not a menu' }, 400);

  const saved = await put(`${PREFIX}menu-${Date.now()}.json`, JSON.stringify(menu), {
    access: 'public', contentType: 'application/json', addRandomSuffix: true, cacheControlMaxAge: 31536000
  });
  try {
    const old = (await allVersions()).slice(KEEP).map(b => b.url);
    if (old.length) await del(old);
  } catch { /* history cleanup is best-effort */ }
  return json({ ok: true, url: saved.url });
}
