import { json } from './_core.mjs';

const CACHE_NAME = 'ibo-autonomous-proof';
const STATE_KEY = 'https://ibo-state.local/autonomous/latest';

export default async () => {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(STATE_KEY);
    if (!response) {
      return json({
        ok: false,
        error: 'NO_AUTONOMOUS_CYCLE_YET',
        signingEnabled: false,
        broadcastEnabled: false
      }, 404);
    }

    const state = await response.json();
    const observedAt = state.scanObservedAt || state.failedAt || state.startedAt || null;
    const ageSeconds = observedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(observedAt)) / 1000)) : null;

    return json({
      ...state,
      ageSeconds,
      stale: ageSeconds === null ? true : ageSeconds > 300,
      stateSource: 'NETLIFY_CACHE_API',
      signingEnabled: false,
      broadcastEnabled: false
    });
  } catch (e) {
    return json({
      ok: false,
      error: String(e?.message || e),
      signingEnabled: false,
      broadcastEnabled: false
    }, 502);
  }
};

export const config = {
  path: '/api/state'
};
