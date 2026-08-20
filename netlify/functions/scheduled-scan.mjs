import { health, scan } from './_core.mjs';

export default async () => {
  const startedAt = new Date().toISOString();
  try {
    const live = await health();
    if (!live.ok || live.chainId !== 8453) {
      throw new Error(`CHAIN_PROOF_FAILED chainId=${live.chainId} ok=${live.ok}`);
    }

    const result = await scan(300);
    console.log(JSON.stringify({
      event: 'autonomous_cycle_ok',
      startedAt,
      healthObservedAt: live.observedAt,
      healthBlock: live.blockNumber,
      scanObservedAt: result.observedAt,
      scanHead: result.head,
      windowBlocks: result.windowBlocks,
      borrowLogCount: result.borrowLogCount,
      uniqueBorrowers: result.uniqueBorrowers,
      checked: result.checked,
      liquidatable: result.liquidatable?.length || 0,
      near: result.near?.length || 0,
      lowestHealthFactor: result.lowest?.[0]?.healthFactor ?? null,
      errors: result.errors,
      signingEnabled: false,
      broadcastEnabled: false
    }));
  } catch (e) {
    console.error(JSON.stringify({
      event: 'autonomous_cycle_error',
      startedAt,
      error: String(e?.message || e),
      signingEnabled: false,
      broadcastEnabled: false
    }));
    throw e;
  }
};
