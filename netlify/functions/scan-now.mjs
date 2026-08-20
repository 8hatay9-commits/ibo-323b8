import { scan, json } from './_core.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const blocks = Number(url.searchParams.get('blocks') || 300);
    return json(await scan(blocks));
  } catch (e) {
    return json({
      ok: false,
      error: String(e?.message || e),
      signingEnabled: false,
      broadcastEnabled: false,
      observedAt: new Date().toISOString()
    }, 502);
  }
};

export const config = {
  path: '/api/scan'
};
