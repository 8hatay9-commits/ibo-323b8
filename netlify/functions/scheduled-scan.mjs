import { health, scan } from './_core.mjs';

const CACHE_NAME = 'ibo-autonomous-proof';
const STATE_KEY = 'https://ibo-state.local/autonomous/latest';
const WITNESS_URL = 'https://jsonblob.io/7e5ccf4b-4fa7-4fe8-9db0-6f69bca6b301';

async function writeState(data) {
  const cache = await caches.open(CACHE_NAME);
  const response = new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=86400',
      'netlify-cdn-cache-control': 'public, durable, max-age=86400'
    }
  });
  await cache.put(STATE_KEY, response);
}

async function writeWitness(data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(WITNESS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify(data),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`WITNESS_HTTP_${response.status}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export default async () => {
  const startedAt = new Date().toISOString();
  try {
    const live = await health();
    if (!live.ok || live.chainId !== 8453) {
      throw new Error(`CHAIN_PROOF_FAILED chainId=${live.chainId} ok=${live.ok}`);
    }

    const result = await scan(120, 30);
    const proof = {
      ok: true,
      event: 'autonomous_cycle_ok',
      source: 'NETLIFY_SCHEDULED_FUNCTION',
      witnessVersion: 1,
      startedAt,
      healthObservedAt: live.observedAt,
      healthBlock: live.blockNumber,
      healthChainId: live.chainId,
      scanObservedAt: result.observedAt,
      scanHead: result.head,
      windowBlocks: result.windowBlocks,
      borrowerCap: result.borrowerCap,
      borrowLogCount: result.borrowLogCount,
      uniqueBorrowers: result.uniqueBorrowers,
      checked: result.checked,
      liquidatableCount: result.liquidatable?.length || 0,
      nearCount: result.near?.length || 0,
      liquidatable: result.liquidatable || [],
      near: result.near || [],
      lowest: result.lowest || [],
      lowestHealthFactor: result.lowest?.[0]?.healthFactor ?? null,
      errors: result.errors,
      signingEnabled: false,
      broadcastEnabled: false
    };

    await writeState(proof);
    try {
      await writeWitness(proof);
      proof.externalWitnessWritten = true;
    } catch (witnessError) {
      proof.externalWitnessWritten = false;
      proof.externalWitnessError = String(witnessError?.message || witnessError);
      console.error(JSON.stringify({ event: 'witness_write_error', error: proof.externalWitnessError }));
    }
    console.log(JSON.stringify(proof));
  } catch (e) {
    const failure = {
      ok: false,
      event: 'autonomous_cycle_error',
      source: 'NETLIFY_SCHEDULED_FUNCTION',
      witnessVersion: 1,
      startedAt,
      failedAt: new Date().toISOString(),
      error: String(e?.message || e),
      signingEnabled: false,
      broadcastEnabled: false
    };
    try { await writeState(failure); } catch (stateError) {
      console.error(JSON.stringify({ event: 'state_write_error', error: String(stateError?.message || stateError) }));
    }
    try { await writeWitness(failure); } catch (witnessError) {
      console.error(JSON.stringify({ event: 'witness_write_error', error: String(witnessError?.message || witnessError) }));
    }
    console.error(JSON.stringify(failure));
    throw e;
  }
};
