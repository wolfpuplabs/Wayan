// Shared helpers for the Vercel Functions (files starting with "_" are not routes).
import crypto from 'node:crypto';

const SESSION_MS = 12 * 3600 * 1000;
export const password = () => process.env.ADMIN_PASSWORD || '';
export const blobReady = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Stateless session: "<expiry>.<hmac>". The key is derived from ADMIN_PASSWORD,
// so changing the password signs everyone out.
const key = () => crypto.createHash('sha256').update('wayan-session:' + password()).digest();
const mac = exp => crypto.createHmac('sha256', key()).update(String(exp)).digest('base64url');

export function signToken() {
  const exp = Date.now() + SESSION_MS;
  return `${exp}.${mac(exp)}`;
}

export function verifyToken(token) {
  if (!password() || !token) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || !(+exp > Date.now())) return false;
  return safeEqual(sig, mac(exp));
}

export const bearer = req => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
export const isAuthed = req => verifyToken(bearer(req));
