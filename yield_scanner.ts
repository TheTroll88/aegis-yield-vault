/**
 * yield_scanner.ts — Live APY scanner across Solana DeFi protocols
 * Used by Aegis AI Yield Vault for dynamic allocation decisions
 */

export interface ProtocolYield {
  id:          string;
  name:        string;
  apy:         number;  // annualized supply APY %
  utilization: number;  // 0–1
  tvlUsd:      number;  // total value locked
  paused:      boolean;
  score:       number;  // computed risk-adjusted score
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";

// Pool IDs on DeFiLlama for each protocol's USDC lending pool (Solana)
const LLAMA_POOL_IDS: Record<string, string> = {
  kamino:   "dc0cce65-8b63-4eeb-86d1-0e2d8e455b7e", // Kamino Main USDC
  drift:    "d4e2b2b9-8e18-44cf-9a87-f6e73c92aae9", // Drift USDC spot
  jupiter:  "c2fa7a65-7c41-4a98-987d-4f9b9a83ceaa", // Jupiter Lend USDC
  marginfi: "e45d98f4-5e2e-4a41-b9e0-8d5c98b8a5b1", // Marginfi USDC
};

// ─── DeFiLlama primary source ────────────────────────────────

let _llamaCache: any[] | null = null;
let _llamaCacheTs = 0;
const CACHE_TTL = 120_000; // 2 min

async function getLlamaYields(): Promise<any[]> {
  if (_llamaCache && Date.now() - _llamaCacheTs < CACHE_TTL) return _llamaCache;
  const res = await fetch("https://yields.llama.fi/pools", {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);
  const data = await res.json() as any;
  _llamaCache = (data?.data ?? []) as any[];
  _llamaCacheTs = Date.now();
  return _llamaCache;
}

function llamaToProtocol(
  id: string,
  name: string,
  pool: any
): ProtocolYield {
  return {
    id,
    name,
    apy:         pool.apy        ?? pool.apyBase ?? 0,
    utilization: pool.utilization ?? 0,
    tvlUsd:      pool.tvlUsd     ?? 0,
    paused:      pool.status === "inactive" || pool.outlierScore > 0.9,
    score:       0,
  };
}

// ─── Protocol-specific fetchers (use DeFiLlama; fall back to APIs) ─

async function fetchKaminoApy(): Promise<ProtocolYield | null> {
  try {
    const pools  = await getLlamaYields();
    // Match on project + symbol + chain
    const pool   = pools.find(
      (p: any) =>
        p.project?.toLowerCase().includes("kamino") &&
        p.symbol?.toUpperCase() === "USDC" &&
        p.chain?.toLowerCase() === "solana"
    );
    if (pool) return llamaToProtocol("kamino", "Kamino USDC", pool);
  } catch (e: any) {
    console.warn(`  [scan] Kamino (llama): ${e.message}`);
  }

  // API fallback
  try {
    const res = await fetch("https://api.kamino.finance/lending-markets?env=mainnet-beta", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markets = await res.json() as any[];
    const main = markets?.find?.((m: any) => m.lendingMarketName?.includes("Main"));
    const usdc = main?.reserves?.find?.((r: any) =>
      r.symbol === "USDC" || r.mintAddress === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    if (usdc) {
      return {
        id:          "kamino",
        name:        "Kamino USDC",
        apy:         parseFloat(usdc.supplyApy ?? usdc.apy ?? "0"),
        utilization: parseFloat(usdc.utilizationRate ?? "0"),
        tvlUsd:      parseFloat(usdc.totalLiquidity ?? "0"),
        paused:      false,
        score:       0,
      };
    }
  } catch (e: any) {
    console.warn(`  [scan] Kamino (api): ${e.message}`);
  }
  return null;
}

async function fetchDriftApy(): Promise<ProtocolYield | null> {
  try {
    const pools = await getLlamaYields();
    const pool  = pools.find(
      (p: any) =>
        p.project?.toLowerCase().includes("drift") &&
        p.symbol?.toUpperCase() === "USDC" &&
        p.chain?.toLowerCase() === "solana"
    );
    if (pool) return llamaToProtocol("drift", "Drift USDC", pool);
  } catch (e: any) {
    console.warn(`  [scan] Drift (llama): ${e.message}`);
  }

  // Drift public API
  try {
    const res = await fetch("https://data.api.drift.trade/spotMarkets", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markets = await res.json() as any[];
    const usdc = markets?.find?.((m: any) => m.marketIndex === 0);
    if (!usdc) return null;
    return {
      id:          "drift",
      name:        "Drift USDC",
      apy:         parseFloat(usdc.depositRate ?? "0") * 100,
      utilization: parseFloat(usdc.utilization  ?? "0"),
      tvlUsd:      parseFloat(usdc.depositBalance ?? "0"),
      paused:      false,
      score:       0,
    };
  } catch (e: any) {
    console.warn(`  [scan] Drift (api): ${e.message}`);
    return null;
  }
}

async function fetchJupiterLendApy(): Promise<ProtocolYield | null> {
  try {
    const pools = await getLlamaYields();
    const pool  = pools.find(
      (p: any) =>
        (p.project?.toLowerCase().includes("jupiter") ||
         p.project?.toLowerCase().includes("solend")) &&
        p.symbol?.toUpperCase() === "USDC" &&
        p.chain?.toLowerCase() === "solana"
    );
    if (pool) return llamaToProtocol("jupiter", "Jupiter Lend USDC", pool);
  } catch (e: any) {
    console.warn(`  [scan] Jupiter (llama): ${e.message}`);
  }
  return null;
}

async function fetchMarginfiApy(): Promise<ProtocolYield | null> {
  try {
    const pools = await getLlamaYields();
    const pool  = pools.find(
      (p: any) =>
        p.project?.toLowerCase().includes("marginfi") &&
        p.symbol?.toUpperCase() === "USDC" &&
        p.chain?.toLowerCase() === "solana"
    );
    if (pool) return llamaToProtocol("marginfi", "Marginfi USDC", pool);
  } catch (e: any) {
    console.warn(`  [scan] Marginfi (llama): ${e.message}`);
  }

  try {
    const res = await fetch("https://production.marginfi.com/api/v1/banks", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data  = await res.json() as any;
    const banks = data?.data ?? data ?? [];
    const USDC  = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const b     = banks.find((x: any) => x.mint === USDC || x.tokenSymbol === "USDC");
    if (!b) return null;
    return {
      id:          "marginfi",
      name:        "Marginfi USDC",
      apy:         parseFloat(b.lendingRate ?? b.supplyApy ?? "0"),
      utilization: parseFloat(b.utilizationRate ?? "0"),
      tvlUsd:      parseFloat(b.totalDepositsUsd ?? "0"),
      paused:      b.operationalState !== "Operational",
      score:       0,
    };
  } catch (e: any) {
    console.warn(`  [scan] Marginfi (api): ${e.message}`);
    return null;
  }
}

// ─── Scoring Engine ──────────────────────────────────────────

function computeScore(p: ProtocolYield): number {
  if (p.paused) return 0;

  // Utilization penalty: smooth ramp at 80%, hard floor at 95%
  const util = p.utilization;
  let utilizationFactor: number;
  if (util <= 0.80) {
    utilizationFactor = 1.0;
  } else if (util >= 0.95) {
    utilizationFactor = 0.0;
  } else {
    utilizationFactor = 1.0 - ((util - 0.80) / 0.15);
  }

  // TVL factor: full score at $10M, linear discount below
  const tvlFactor = Math.min(1.0, p.tvlUsd / 10_000_000);

  // APY is the prime driver
  const score = p.apy * utilizationFactor * (0.5 + 0.5 * tvlFactor);
  return Math.max(0, score);
}

function normalizeAllocation(
  protocols: ProtocolYield[],
  maxPerProtocol = 0.70
): Map<string, number> {
  const scored = protocols.filter(p => p.score > 0);
  if (scored.length === 0) {
    // Fallback: equal weight among non-paused
    const valid = protocols.filter(p => !p.paused);
    const w = 1 / valid.length;
    return new Map(valid.map(p => [p.id, w]));
  }

  const total = scored.reduce((s, p) => s + p.score, 0);
  const raw   = new Map(scored.map(p => [p.id, p.score / total]));

  // Enforce max concentration cap
  let overflow = 0;
  const cappedIds: string[] = [];
  for (const [id, w] of raw) {
    if (w > maxPerProtocol) {
      overflow += w - maxPerProtocol;
      raw.set(id, maxPerProtocol);
      cappedIds.push(id);
    }
  }

  // Redistribute overflow to uncapped
  if (overflow > 0) {
    const uncapped = scored.filter(p => !cappedIds.includes(p.id));
    const uncappedTotal = uncapped.reduce((s, p) => s + p.score, 0);
    for (const p of uncapped) {
      const extra = overflow * (p.score / uncappedTotal);
      raw.set(p.id, (raw.get(p.id) ?? 0) + extra);
    }
  }

  return raw;
}

// ─── Public API ──────────────────────────────────────────────

export async function scanYields(): Promise<ProtocolYield[]> {
  const results = await Promise.allSettled([
    fetchKaminoApy(),
    fetchDriftApy(),
    fetchJupiterLendApy(),
    fetchMarginfiApy(),
  ]);

  const protocols: ProtocolYield[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const p = r.value;
      p.score = computeScore(p);
      protocols.push(p);
    }
  }

  return protocols;
}

export function computeAllocations(
  protocols: ProtocolYield[],
  maxPerProtocol = 0.70
): Map<string, number> {
  return normalizeAllocation(protocols, maxPerProtocol);
}

export function computeDrift(
  current: Map<string, number>,
  target:  Map<string, number>
): number {
  let drift = 0;
  const allKeys = new Set([...current.keys(), ...target.keys()]);
  for (const key of allKeys) {
    drift += Math.abs((current.get(key) ?? 0) - (target.get(key) ?? 0));
  }
  return drift / 2; // normalize to 0-1
}
