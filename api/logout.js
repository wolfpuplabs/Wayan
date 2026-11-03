import { json } from './_lib.js';

// Sessions are stateless signed tokens that expire after 12 hours; the client simply forgets its token.
export function POST() {
  return json({ ok: true });
}
