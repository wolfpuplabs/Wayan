import { json, password, safeEqual, signToken } from './_lib.js';

export async function POST(request) {
  if (!password()) return json({ error: 'ADMIN_PASSWORD is not set on the server yet' }, 503);
  let pw = '';
  try { pw = (await request.json()).password || ''; } catch {}
  if (!safeEqual(pw, password())) {
    await new Promise(r => setTimeout(r, 600)); // slow down guessing
    return json({ error: 'Wrong password' }, 401);
  }
  return json({ token: signToken() });
}
