# IBO Live Scanner — Persistent System State

Updated: 2026-08-20 04:36 Europe/Istanbul

## Goal
Run a cloud-hosted, PC-free, read-only Base mainnet/Aave scanner with a live health endpoint, scheduled scans, and dashboard. No private keys, signing, or transaction broadcast until proof gates are satisfied.

## Production repository
- Repository: `8hatay9-commits/ibo-323b8`
- Branch: `main`
- Production deploy commit: `6043d748b1b3a85095f87c63548c3f092c5d0cfb`
- Netlify production URL: `https://vocal-marzipan-46458c.netlify.app/`
- Netlify immutable deploy URL: `https://6a8659b6d8f3370008f4214f--vocal-marzipan-46458c.netlify.app/`

## Netlify production deployment
Netlify reported a successful published production deployment for commit `6043d748b1b3a85095f87c63548c3f092c5d0cfb`.
- Build started around 04:34:47 Europe/Istanbul and completed around 04:35:00.
- Build duration: 13 seconds.
- Total deployment duration: 14 seconds.
- 5 functions deployed.
- Previous `@netlify/otel@^7.0.1` dependency-install blocker was bypassed by removing the project npm dependency path.

## Current runtime design
- Node.js pinned to 20 LTS via `.nvmrc` and `netlify.toml`.
- Root `package.json` removed from production commit to avoid Netlify/npm dependency-chain failure.
- Scanner core uses native `fetch` only.
- No `@netlify/blobs` dependency in production commit.
- `/api/opportunities` performs a live Aave scan instead of reading persisted Blob state.
- Scheduled scan runs every 2 minutes and logs scan results; persistence is temporarily disabled until the runtime is proven stable.

Functions:
- `netlify/functions/_core.mjs` — Base JSON-RPC failover/retries/timeouts + Aave Borrow-event/user-health scan core.
- `netlify/functions/health.mjs` — `/api/health`.
- `netlify/functions/scan-now.mjs` — `/api/scan` manual/on-demand scan.
- `netlify/functions/opportunities.mjs` — `/api/opportunities`, live Aave scan.
- `netlify/functions/scheduled-scan.mjs` — scheduled scan every 2 minutes, logs result.

## Canonical read-only rules
- Base chain ID expected: `8453`.
- Mode: `READ_ONLY_PROOF_FIRST`.
- Signing: disabled.
- Broadcast: disabled.
- Never claim a transaction was executed unless a future signing/broadcast layer is explicitly added and independently proven.

RPC failover order:
1. `https://mainnet.base.org`
2. `https://mainnet-preconf.base.org`
3. `https://base-rpc.publicnode.com`

Aave Pool:
- `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`

Scanner controls:
- Recent-block window defaults to 300 and is capped at 600.
- Log chunks: 150 blocks.
- Max recent borrowers checked: 80.
- Health-factor concurrency: 6.
- Near-liquidation threshold: HF < 1.08.
- Liquidatable: HF < 1.
- No signing or broadcast code.

## Production acceptance status
Deployment itself: PASS.
Runtime endpoint verification: PENDING.

Required checks before calling the scanner fully LIVE:
1. Fetch `/api/health` and require `ok:true`, `chainId:8453`, current advancing block, gas price, RPC latency, timestamp, `signingEnabled:false`, `broadcastEnabled:false`.
2. Fetch `/api/scan?blocks=300` and require a valid Aave scan response.
3. Fetch `/api/opportunities` and require a valid live Aave opportunity scan response.
4. Confirm scheduled scan function executes again without manual invocation and produces a newer head/timestamp.
5. Observe advancing Base blocks over at least 10 minutes before declaring runtime proof complete.

At 04:36 the ChatGPT execution environment could not yet resolve the freshly-created Netlify hostname because its external DNS/cache layer returned a cache miss / temporary name-resolution failure. This is an environment verification limitation, not evidence that the successful Netlify deploy failed. Do not claim endpoint PASS until an actual endpoint response is captured.

## Historical infrastructure incidents
### GitHub Actions
Multiple workflows failed before any step started. Jobs returned zero steps and log download returned `BlobNotFound`, indicating runner/job provisioning failure rather than scanner script failure. Do not use GitHub Actions as the production runtime.

### Vercel
Connected Vercel deploy tooling exposed a schema/runtime mismatch and no verified project was created. Treat old Vercel URLs as dead/unverified.

### Render
Render Blueprint UI failed to render reliably. Render is not the active production path.

## Truth rule
Never report runtime LIVE/PASS from configuration, commit success, or deployment success alone. Runtime LIVE requires current externally observed Base mainnet evidence and repeated scheduled execution.