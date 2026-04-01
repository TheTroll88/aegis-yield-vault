/**
 * vault_manager.ts — AI-driven rebalancing bot for Aegis Yield Vault
 *
 * Strategy: Continuous APY-optimized allocation across Kamino, Drift,
 * Jupiter Lend, and Marginfi. Risk-gated, concentration-capped,
 * and Foreman-bridged for on-chain execution.
 *
 * Compatible with Voltr Protocol (VoltrClient / @voltr/vault-sdk).
 */

import { scanYields, computeAllocations, computeDrift, type ProtocolYield } from "./yield_scanner.js";
import { runHealthChecks, isProtocolBlocked, type ProtocolHealth } from "./risk_monitor.js";

// ─── Configuration ────────────────────────────────────────────

const CONFIG = {
  // Minimum portfolio drift to trigger a rebalance (4%)
  REBALANCE_THRESHOLD: 0.04,
  // Max single-protocol concentration
  MAX_CONCENTRATION: 0.70,
  // Check interval in seconds
  CHECK_INTERVAL_SEC: 300,
  // Minimum real APY improvement to rebalance (avoids noise)
  MIN_APY_GAIN_PCT: 0.25,
  // Log level
  VERBOSE: true,
};

// ─── State ────────────────────────────────────────────────────

interface VaultState {
  currentAllocations: Map<string, number>;
  lastRebalanceTs:    number;
  cycleCount:         number;
  totalRebalances:    number;
  startTs:            number;
}

const state: VaultState = {
  currentAllocations: new Map(), // starts empty → forces first rebalance
  lastRebalanceTs:    0,
  cycleCount:         0,
  totalRebalances:    0,
  startTs:            Date.now(),
};

// ─── Helpers ─────────────────────────────────────────────────

function log(msg: string) {
  if (CONFIG.VERBOSE) {
    const uptime = Math.floor((Date.now() - state.startTs) / 1000);
    console.log(`[vault][${uptime}s] ${msg}`);
  }
}

function weightedApy(
  allocations: Map<string, number>,
  yields:      ProtocolYield[]
): number {
  let total = 0;
  for (const p of yields) {
    const w = allocations.get(p.id) ?? 0;
    total += w * p.apy;
  }
  return total;
}

function printTable(
  protocols: ProtocolYield[],
  target:    Map<string, number>,
  health:    Map<string, ProtocolHealth>
) {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│       AEGIS YIELD VAULT — ALLOCATION REPORT             │");
  console.log("├──────────────────┬──────────┬─────────────┬─────────────┤");
  console.log("│ Protocol         │  APY %   │  Util %     │  Target %   │");
  console.log("├──────────────────┼──────────┼─────────────┼─────────────┤");
  for (const p of protocols) {
    const h       = health.get(p.id);
    const blocked = h && isProtocolBlocked(h);
    const w       = target.get(p.id) ?? 0;
    const flag    = blocked ? " ⚠" : "";
    const name    = (p.name + flag).padEnd(16);
    const apy     = p.apy.toFixed(2).padStart(7);
    const util    = (p.utilization * 100).toFixed(1).padStart(7) + " %";
    const alloc   = (w * 100).toFixed(1).padStart(8) + " %";
    console.log(`│ ${name} │ ${apy} % │ ${util}   │ ${alloc}   │`);
  }
  console.log("└──────────────────┴──────────┴─────────────┴─────────────┘");
}

// ─── Core Decision Loop ───────────────────────────────────────

async function runDecisionCycle(): Promise<void> {
  state.cycleCount++;
  log(`--- Cycle #${state.cycleCount} ---`);

  // 1. Fetch live yields
  log("Scanning protocol yields...");
  const protocols = await scanYields();
  if (protocols.length === 0) {
    log("ERROR: No yield data available — skipping cycle");
    return;
  }

  // 2. Run health checks
  log("Running health checks...");
  const health = await runHealthChecks();

  // 3. Filter blocked protocols
  const eligible = protocols.filter(p => {
    const h = health.get(p.id);
    if (!h) return true; // no data = allow (optimistic)
    if (isProtocolBlocked(h)) {
      log(`BLOCKED: ${p.name} (risk=${h.riskScore.toFixed(2)} paused=${h.paused})`);
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    log("WARNING: All protocols blocked — holding current allocation");
    return;
  }

  // 4. Compute target allocation
  const targetAlloc = computeAllocations(eligible, CONFIG.MAX_CONCENTRATION);

  // 5. Print current market view
  printTable(protocols, targetAlloc, health);

  // 6. Compute portfolio drift
  const drift = computeDrift(state.currentAllocations, targetAlloc);
  const currentApy = weightedApy(state.currentAllocations, protocols);
  const targetApy  = weightedApy(targetAlloc, protocols);
  const apyGain    = targetApy - currentApy;

  log(`Drift: ${(drift * 100).toFixed(2)}%  APY gain: ${apyGain >= 0 ? "+" : ""}${apyGain.toFixed(3)}%`);
  log(`Current portfolio APY: ${currentApy.toFixed(3)}%  →  Target: ${targetApy.toFixed(3)}%`);

  // 7. Decide whether to rebalance
  const needsRebalance =
    state.currentAllocations.size === 0 || // first run
    (drift >= CONFIG.REBALANCE_THRESHOLD && apyGain >= CONFIG.MIN_APY_GAIN_PCT);

  if (!needsRebalance) {
    log(`No rebalance needed (drift ${(drift*100).toFixed(2)}% < ${(CONFIG.REBALANCE_THRESHOLD*100).toFixed(0)}% threshold or gain too small)`);
    return;
  }

  // 8. Execute rebalance
  log(`REBALANCE TRIGGERED — drift=${(drift*100).toFixed(2)}% gain=+${apyGain.toFixed(3)}%`);
  log("Target allocations:");
  for (const [id, w] of targetAlloc) {
    const prev = state.currentAllocations.get(id) ?? 0;
    const delta = w - prev;
    const sign  = delta >= 0 ? "+" : "";
    log(`  ${id.padEnd(10)} ${(prev*100).toFixed(1)}% → ${(w*100).toFixed(1)}%  (${sign}${(delta*100).toFixed(1)}%)`);
  }

  // 9. ─── ON-CHAIN EXECUTION (Voltr SDK) ────────────────────
  //
  // In production, call VoltrClient.rebalance() here with the
  // computed allocations. On devnet, this is simulated.
  //
  // Example (requires initialized vault + RPC connection):
  //
  //   const connection = new Connection(process.env.HELIUS_RPC_URL!);
  //   const wallet = loadWallet(process.env.MANAGER_FILE_PATH!);
  //   const client = new VoltrClient(connection, wallet, VAULT_PROGRAM_ID);
  //   await client.rebalance(vaultAddress, targetAlloc);
  //
  // All order execution is managed by Voltr's vault programs.
  // This bot only supplies the allocation percentages.
  // ─────────────────────────────────────────────────────────

  // Update state
  state.currentAllocations = new Map(targetAlloc);
  state.lastRebalanceTs    = Date.now();
  state.totalRebalances++;
  log(`Rebalance #${state.totalRebalances} complete ✓`);
}

// ─── Entry Point ────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          AEGIS AI YIELD VAULT — REBALANCER               ║");
  console.log("║   Strategies: Kamino | Drift | Jupiter Lend | Marginfi   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Check interval: ${CONFIG.CHECK_INTERVAL_SEC}s | Rebalance threshold: ${CONFIG.REBALANCE_THRESHOLD * 100}%`);
  console.log(`Max concentration: ${CONFIG.MAX_CONCENTRATION * 100}% | Min APY gain: +${CONFIG.MIN_APY_GAIN_PCT}%\n`);

  // Run immediately on start
  await runDecisionCycle();

  // Then loop
  setInterval(async () => {
    try {
      await runDecisionCycle();
    } catch (err: any) {
      console.error(`[vault] Cycle error: ${err.message}`);
    }
  }, CONFIG.CHECK_INTERVAL_SEC * 1000);
}

main().catch(console.error);
