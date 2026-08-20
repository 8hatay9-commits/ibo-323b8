import { health, json } from './_core.mjs';

export default async () => {
  try {
    return json(await health());
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
  path: '/api/health'
};
