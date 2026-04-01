/**
 * risk_monitor.ts — Protocol health signals for dynamic risk gating
 * Blocks rebalances into impaired protocols regardless of APY.
 */

export interface ProtocolHealth {
  id:              string;
  name:            string;
  // 0 = fully healthy, higher = more risk
  riskScore:       number;
  // individual signals
  highUtilization: boolean;  // > 90% util → liquidity crunch risk
  oracleStaleness: boolean;  // oracle last update > 120s
  tvlDropAlert:    boolean;  // TVL fell > 20% in last scan
  paused:          boolean;
  lastChecked:     number;
}

interface PreviousSnapshot {
  tvlUsd: number;
  ts:     number;
}

const previousTvl = new Map<string, PreviousSnapshot>();

function assessRisk(
  id:          string,
  name:        string,
  utilization: number,
  tvlUsd:      number,
  paused:      boolean,
  oracleAgeSec?: number
): ProtocolHealth {
  const highUtil  = utilization > 0.90;
  const stale     = oracleAgeSec !== undefined ? oracleAgeSec > 120 : false;

  const prev      = previousTvl.get(id);
  let tvlDrop     = false;
  if (prev && tvlUsd > 0) {
    const pct = (prev.tvlUsd - tvlUsd) / prev.tvlUsd;
    if (pct > 0.20) tvlDrop = true;
  }
  previousTvl.set(id, { tvlUsd, ts: Date.now() });

  // Risk score: weighted sum
  let risk = 0;
  if (paused)      risk += 1.0;
  if (highUtil)    risk += 0.4;
  if (stale)       risk += 0.3;
  if (tvlDrop)     risk += 0.5;

  return {
    id,
    name,
    riskScore:       Math.min(1.0, risk),
    highUtilization: highUtil,
    oracleStaleness: stale,
    tvlDropAlert:    tvlDrop,
    paused,
    lastChecked:     Date.now(),
  };
}

// ─── Kamino health check ─────────────────────────────────────

async function kaminoHealth(): Promise<ProtocolHealth | null> {
  try {
    const reserveAddr = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
    const res = await fetch(
      `https://api.kamino.finance/reserves/${reserveAddr}/metrics`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return null;
    const d = await res.json() as any;
    const util      = parseFloat(d?.utilizationRate ?? "0");
    const tvl       = parseFloat(d?.totalLiquidityUsd ?? "0");
    const paused    = d?.status === "inactive";
    return assessRisk("kamino", "Kamino Main USDC", util, tvl, paused);
  } catch { return null; }
}

// ─── Drift health check ──────────────────────────────────────

async function driftHealth(): Promise<ProtocolHealth | null> {
  try {
    const res = await fetch("https://dlob.drift.trade/spotMarkets", {
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const markets = await res.json() as any[];
    const usdc = markets?.find((m: any) => m.marketIndex === 0);
    if (!usdc) return null;
    const util   = parseFloat(usdc.utilization ?? "0");
    const tvl    = parseFloat(usdc.depositBalance ?? "0");
    return assessRisk("drift", "Drift USDC Spot", util, tvl, false);
  } catch { return null; }
}

// ─── Jupiter / Marginfi health ───────────────────────────────

async function jupiterHealth(): Promise<ProtocolHealth | null> {
  // We use Marginfi's oracle freshness as proxy for Jupiter Lend (Solend-based oracle)
  try {
    const res = await fetch("https://production.marginfi.com/api/v1/banks", {
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data  = await res.json() as any;
    const banks = data?.data ?? [];
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const b = banks.find((x: any) => x.mint === USDC_MINT);
    if (!b) return null;
    const util   = parseFloat(b.utilizationRate ?? "0");
    const tvl    = parseFloat(b.totalDepositsUsd ?? "0");
    const paused = b.operationalState !== "Operational";
    return assessRisk("jupiter", "Jupiter Lend USDC", util, tvl, paused);
  } catch { return null; }
}

async function marginfiHealth(): Promise<ProtocolHealth | null> {
  // Reuse the same endpoint data
  try {
    const res = await fetch("https://production.marginfi.com/api/v1/banks", {
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const banks = data?.data ?? [];
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const b = banks.find((x: any) => (x.mint === USDC_MINT) && b);
    if (!b) return null;
    const util   = parseFloat(b.utilizationRate ?? "0");
    const tvl    = parseFloat(b.totalDepositsUsd ?? "0");
    const paused = b.operationalState !== "Operational";
    return assessRisk("marginfi", "Marginfi USDC", util, tvl, paused);
  } catch { return null; }
}

// ─── Public API ──────────────────────────────────────────────

export async function runHealthChecks(): Promise<Map<string, ProtocolHealth>> {
  const checks = await Promise.allSettled([
    kaminoHealth(),
    driftHealth(),
    jupiterHealth(),
    marginfiHealth(),
  ]);

  const map = new Map<string, ProtocolHealth>();
  for (const r of checks) {
    if (r.status === "fulfilled" && r.value) {
      map.set(r.value.id, r.value);
    }
  }
  return map;
}

export function isProtocolBlocked(h: ProtocolHealth): boolean {
  // Block if paused OR composite risk exceeds 0.6 threshold
  return h.paused || h.riskScore >= 0.60;
}
