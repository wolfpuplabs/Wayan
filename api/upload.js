import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { json, isAuthed, blobReady } from './_lib.js';

// Admin uploads go straight from the browser to Vercel Blob (no 4.5 MB function body limit).
// This route only hands out short-lived upload tokens to signed-in admins.
const MAX_MB = 30;
const TYPES = ['model/gltf-binary', 'model/vnd.usdz+zip', 'image/webp', 'image/png', 'image/jpeg', 'application/octet-stream'];

export async function POST(request) {
  if (!blobReady()) return json({ error: 'Blob storage is not connected' }, 503);
  const authed = isAuthed(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async pathname => {
        if (!authed) throw new Error('Unauthorized');
        if (!pathname.startsWith('wayan/assets/')) throw new Error('Invalid path');
        return {
          allowedContentTypes: TYPES,
          maximumSizeInBytes: MAX_MB * 1048576,
          addRandomSuffix: true,
          cacheControlMaxAge: 31536000
        };
      }
    });
    return json(result);
  } catch (e) {
    return json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 400);
  }
}

export async function DELETE(request) {
  if (!isAuthed(request)) return json({ error: 'Unauthorized' }, 401);
  const file = new URL(request.url).searchParams.get('file') || '';
  let u;
  try { u = new URL(file); } catch { return json({ error: 'Bad file' }, 400); }
  if (!u.hostname.endsWith('.blob.vercel-storage.com') || !u.pathname.startsWith('/wayan/assets/')) return json({ error: 'Not allowed' }, 400);
  try { await del(file); } catch { /* already gone */ }
  return json({ ok: true });
}
