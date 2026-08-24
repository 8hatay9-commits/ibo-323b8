import solc from 'solc';
import { encodeFunctionData, decodeFunctionResult } from 'viem';
import fs from 'node:fs';

const RPC = 'https://mainnet-preconf.base.org';
const HELPER = '0x00000000000000000000000000000000Ed6e0001';
const FROM = '0x000000000000000000000000000000000000dEaD';

const TOKENS = [
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  { symbol: 'cbBTC', address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8 },
  { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
];
const NOTIONAL_USDC = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUniFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IAeroFactory {
    function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool);
}

interface IUniQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }
    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

interface IAeroQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        int24 tickSpacing;
        uint160 sqrtPriceLimitX96;
    }
    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

interface IAavePool {
    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);
}

contract EdgeLens {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    IUniFactory constant UNI_FACTORY = IUniFactory(0x33128a8fC17869897dcE68Ed026d694621f6FDfD);
    IUniQuoterV2 constant UNI_QUOTER = IUniQuoterV2(0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a);
    IAeroFactory constant AERO_FACTORY = IAeroFactory(0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A);
    IAeroQuoterV2 constant AERO_QUOTER = IAeroQuoterV2(0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0);
    IAavePool constant AAVE_POOL = IAavePool(0xA238Dd80C259a72e81d7e4664a9801593F98d1c5);

    function bestUni(address tokenIn, address tokenOut, uint256 amountIn)
        internal returns (bool ok, uint256 bestOut, uint24 bestFee, uint256 bestGas)
    {
        uint24[4] memory fees = [uint24(100), uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i; i < fees.length; ++i) {
            address pool;
            try UNI_FACTORY.getPool(tokenIn, tokenOut, fees[i]) returns (address p) { pool = p; } catch { continue; }
            if (pool == address(0)) continue;
            IUniQuoterV2.QuoteExactInputSingleParams memory p = IUniQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, fee: fees[i], sqrtPriceLimitX96: 0
            });
            try UNI_QUOTER.quoteExactInputSingle(p) returns (uint256 out, uint160, uint32, uint256 gasEstimate) {
                if (out > bestOut) { ok = true; bestOut = out; bestFee = fees[i]; bestGas = gasEstimate; }
            } catch {}
        }
    }

    function bestAero(address tokenIn, address tokenOut, uint256 amountIn)
        internal returns (bool ok, uint256 bestOut, int24 bestSpacing, uint256 bestGas)
    {
        int24[5] memory spacings = [int24(1), int24(50), int24(100), int24(200), int24(2000)];
        for (uint256 i; i < spacings.length; ++i) {
            address pool;
            try AERO_FACTORY.getPool(tokenIn, tokenOut, spacings[i]) returns (address p) { pool = p; } catch { continue; }
            if (pool == address(0)) continue;
            IAeroQuoterV2.QuoteExactInputSingleParams memory p = IAeroQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, tickSpacing: spacings[i], sqrtPriceLimitX96: 0
            });
            try AERO_QUOTER.quoteExactInputSingle(p) returns (uint256 out, uint160, uint32, uint256 gasEstimate) {
                if (out > bestOut) { ok = true; bestOut = out; bestSpacing = spacings[i]; bestGas = gasEstimate; }
            } catch {}
        }
    }

    function scan(address token, uint256 amountIn, bool uniFirst)
        external
        returns (
            bool firstOk,
            bool secondOk,
            uint256 firstOut,
            uint256 finalOut,
            int256 grossProfit,
            uint128 premiumBps,
            bool premiumOk,
            uint256 flashPremium,
            int256 netBeforeGas,
            uint24 uniFee,
            int24 aeroTickSpacing,
            uint256 quoteGasEstimate
        )
    {
        uint256 gas1;
        uint256 gas2;
        if (uniFirst) {
            (firstOk, firstOut, uniFee, gas1) = bestUni(USDC, token, amountIn);
            if (firstOk) (secondOk, finalOut, aeroTickSpacing, gas2) = bestAero(token, USDC, firstOut);
        } else {
            (firstOk, firstOut, aeroTickSpacing, gas1) = bestAero(USDC, token, amountIn);
            if (firstOk) (secondOk, finalOut, uniFee, gas2) = bestUni(token, USDC, firstOut);
        }

        try AAVE_POOL.FLASHLOAN_PREMIUM_TOTAL() returns (uint128 p) {
            premiumBps = p;
            premiumOk = true;
            flashPremium = amountIn * uint256(p) / 10000;
        } catch {
            premiumOk = false;
        }

        grossProfit = int256(finalOut) - int256(amountIn);
        netBeforeGas = grossProfit - int256(flashPremium);
        quoteGasEstimate = gas1 + gas2;
    }
}
`;

function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'EdgeLens.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const c = out.contracts['EdgeLens.sol']['EdgeLens'];
  return { abi: c.abi, runtime: '0x' + c.evm.deployedBytecode.object };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rpc(method, params, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + i, method, params }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0,300)}`);
      const j = JSON.parse(text);
      if (j.error) throw new Error(`RPC ${j.error.code}: ${j.error.message}${j.error.data ? ' data=' + JSON.stringify(j.error.data).slice(0,500) : ''}`);
      return j.result;
    } catch (e) {
      last = e;
      await sleep(250 * (i + 1));
    }
  }
  throw last;
}

function stateSig(block) {
  const txs = block?.transactions || [];
  return {
    number: block?.number ?? null,
    txCount: txs.length,
    lastTx: txs.length ? txs[txs.length - 1] : null,
    timestamp: block?.timestamp ?? null,
  };
}

function toNumUSDC(v) { return Number(v) / 1e6; }
function bigToString(v) { return typeof v === 'bigint' ? v.toString() : v; }

async function main() {
  const { abi, runtime } = compile();
  const scanAbi = abi.filter(x => x.type === 'function' && x.name === 'scan');
  if (!scanAbi.length) throw new Error('scan ABI missing');

  const startBlock = await rpc('eth_getBlockByNumber', ['pending', false]);
  const chainId = await rpc('eth_chainId', []);
  const startedAt = new Date().toISOString();

  const jobs = [];
  for (const token of TOKENS) {
    for (const usd of NOTIONAL_USDC) {
      const amount = BigInt(usd) * 1_000_000n;
      for (const uniFirst of [true, false]) {
        jobs.push({ token, usd, amount, uniFirst });
      }
    }
  }

  const results = [];
  const CHUNK = 3;
  for (let offset = 0; offset < jobs.length; offset += CHUNK) {
    const chunk = jobs.slice(offset, offset + CHUNK);
    const calls = chunk.map(j => ({
      from: FROM,
      to: HELPER,
      gas: '0x989680',
      data: encodeFunctionData({ abi: scanAbi, functionName: 'scan', args: [j.token.address, j.amount, j.uniFirst] }),
    }));

    let sim;
    try {
      sim = await rpc('eth_simulateV1', [{
        blockStateCalls: [{
          calls,
          stateOverrides: { [HELPER]: { code: runtime } },
        }],
        traceTransfers: false,
        validation: false,
      }, 'pending']);
    } catch (e) {
      for (const j of chunk) results.push({
        pair: `${j.token.symbol}/USDC`, notionalUSDC: j.usd,
        direction: j.uniFirst ? 'UniV3 -> AeroSlipstream' : 'AeroSlipstream -> UniV3',
        simulationOk: false, error: String(e.message || e), status: 'NO_500_EDGE_VERIFIED',
      });
      continue;
    }

    const blockResult = Array.isArray(sim) ? sim[0] : null;
    const callResults = blockResult?.calls || [];
    for (let i = 0; i < chunk.length; i++) {
      const j = chunk[i];
      const cr = callResults[i];
      const base = {
        pair: `${j.token.symbol}/USDC`, token: j.token.address, notionalUSDC: j.usd,
        direction: j.uniFirst ? 'UniV3 -> AeroSlipstream' : 'AeroSlipstream -> UniV3',
        atomicSamePendingState: true,
        simulateGasUsed: cr?.gasUsed ?? null,
      };
      if (!cr || cr.status !== '0x1' || !cr.returnData || cr.returnData === '0x') {
        results.push({ ...base, simulationOk: false, error: cr?.error || 'simulation call failed', status: 'NO_500_EDGE_VERIFIED' });
        continue;
      }
      try {
        const d = decodeFunctionResult({ abi: scanAbi, functionName: 'scan', data: cr.returnData });
        const vals = Array.from(d);
        const [firstOk, secondOk, firstOut, finalOut, grossProfit, premiumBps, premiumOk, flashPremium, netBeforeGas, uniFee, aeroTickSpacing, quoteGasEstimate] = vals;
        const finalUSDC = toNumUSDC(finalOut);
        const grossUSDC = toNumUSDC(grossProfit);
        const premiumUSDC = toNumUSDC(flashPremium);
        const netUSDC = toNumUSDC(netBeforeGas);
        const verified = Boolean(firstOk && secondOk && premiumOk && netUSDC >= 500);
        results.push({
          ...base,
          simulationOk: true,
          firstOk: Boolean(firstOk), secondOk: Boolean(secondOk),
          firstOutBaseUnits: firstOut.toString(),
          roundTripOutUSDC: finalUSDC,
          rawGrossProfitUSDC: grossUSDC,
          liveAaveFlashPremiumBps: Number(premiumBps),
          flashPremiumUSDC: premiumUSDC,
          netBeforeExecutorGasUSDC: netUSDC,
          uniswapV3Fee: Number(uniFee),
          aerodromeTickSpacing: Number(aeroTickSpacing),
          quoterReportedGasSum: quoteGasEstimate.toString(),
          finalExecutorGasUSD: null,
          status: verified ? 'LIVE_EDGE_VERIFIED' : 'NO_500_EDGE_VERIFIED',
        });
      } catch (e) {
        results.push({ ...base, simulationOk: false, error: `decode: ${e.message}`, rawReturn: cr.returnData.slice(0,300), status: 'NO_500_EDGE_VERIFIED' });
      }
    }
    await sleep(180);
  }

  const endBlock = await rpc('eth_getBlockByNumber', ['pending', false']);
  results.sort((a,b) => (b.netBeforeExecutorGasUSDC ?? -1e99) - (a.netBeforeExecutorGasUSDC ?? -1e99));
  const top = results.find(r => r.simulationOk) || results[0] || null;
  const verified = results.filter(r => r.status === 'LIVE_EDGE_VERIFIED');
  const output = {
    probe: 'Base Flash Edge Probe',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    startedAtUTC: startedAt,
    finishedAtUTC: new Date().toISOString(),
    rpc: RPC,
    chainId,
    method: 'eth_simulateV1 pending + stateOverrides runtime bytecode',
    sameStateMeaning: 'Each two-leg route is computed inside one simulated EVM call against one pending Flashblocks state; no cross-request quote stitching.',
    scanStartPending: stateSig(startBlock),
    scanEndPending: stateSig(endBlock),
    venues: {
      uniswapV3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      uniswapV3QuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
      aerodromeSlipstreamFactory: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',
      aerodromeSlipstreamQuoter: '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0',
      aaveV3Pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    },
    thresholds: { successNetBeforeExecutorGasUSDC: 500, note: 'Executor gas is intentionally not estimated until a >=$500 pre-gas live edge exists.' },
    verifiedCount: verified.length,
    overallStatus: verified.length ? 'LIVE_EDGE_VERIFIED' : 'NO_500_EDGE_VERIFIED',
    topResult: top,
    verifiedEdges: verified,
    results,
  };
  fs.writeFileSync('result.json', JSON.stringify(output, (k,v) => bigToString(v), 2));
  console.log('===BASE_FLASH_EDGE_RESULT_BEGIN===');
  console.log(JSON.stringify(output, (k,v) => bigToString(v), 2));
  console.log('===BASE_FLASH_EDGE_RESULT_END===');
}

main().catch(err => {
  const failure = { overallStatus: 'PROBE_FAILED', error: err?.stack || String(err), atUTC: new Date().toISOString() };
  fs.writeFileSync('result.json', JSON.stringify(failure, null, 2));
  console.error('===BASE_FLASH_EDGE_RESULT_BEGIN===');
  console.error(JSON.stringify(failure, null, 2));
  console.error('===BASE_FLASH_EDGE_RESULT_END===');
  process.exit(1);
});
