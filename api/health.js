import { json, password, blobReady } from './_lib.js';

// The page calls this on load. wayanMenu:true switches it from "demo / this browser" to live mode.
export function GET() {
  return json({ wayanMenu: blobReady(), storage: 'blob', adminReady: !!password(), version: 2 });
}
