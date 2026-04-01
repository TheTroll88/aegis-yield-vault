# Aegis AI Yield Vault — Strategy Documentation

## Overview

**Vault Name:** Aegis AI Yield Vault
**Asset:** USDC
**Network:** Solana Mainnet
**Manager:** Foreman Agent (autonomous AI)
**Framework:** Ranger Earn (Voltr Protocol)
**Target APY:** 10–25% (blended, market-regime dependent)

---

## The Edge: Two-Layer AI-Driven Yield Optimization

Traditional yield vaults use static allocation across lending protocols, capping out at 3–8% APY in current markets. The Aegis AI Vault breaks through this ceiling with a two-layer approach:

**Layer 1 — Lending Base (always active):**
Foreman continuously allocates USDC across Loopscale, Kamino, Jupiter Lend, and Marginfi using real-time APY signal. Currently yields 5–8% blended.

**Layer 2 — Drift Delta-Neutral Overlay (regime-dependent):**
When Drift SOL-PERP funding rates exceed the entry threshold (10% APY annualized), Foreman allocates up to 40% of the vault to a delta-neutral position — long SOL spot (collateralized via SAVE) + short SOL-PERP on Drift. This leg captures funding payments from longs to shorts with near-zero directional exposure.

Combined target: **10–25% APY**, automatically switching between modes based on market regime.

**Why this beats static allocation:**
- Bull market + positive funding = Layer 2 active → 15–25% APY
- Bear/neutral market = Layer 1 only → 5–8% APY
- Never exposed to directional risk (delta-neutral by construction)
- AI reacts to rate changes every 5 minutes — no human needed

---

## Strategy Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Aegis AI Yield Vault (USDC)                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Foreman AI Manager Agent                  │   │
│  │                                                     │   │
│  │  • Polls live APYs every 5 minutes                  │   │
│  │  • Fetches Drift SOL-PERP funding rate              │   │
│  │  • Computes risk-adjusted allocation vector         │   │
│  │  • Triggers rebalance when drift > 4%               │   │
│  │  • Enforces max 70% allocation to any one protocol  │   │
│  │  • Auto-derisks on utilization spike > 90%          │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│    ┌────────────────────┼────────────────────┐             │
│    │     LAYER 1        │       LAYER 2       │             │
│    │  (Lending Base)    │  (Delta-Neutral)    │             │
│  ┌─▼──────────┐  ┌──────▼─────┐  ┌──────────▼───┐         │
│  │  Loopscale │  │   Kamino   │  │ Drift         │         │
│  │  USDC 8%   │  │   USDC 2.5%│  │ SOL-PERP      │         │
│  │  Reserve   │  │   Reserve  │  │ Short Hedge   │         │
│  └────────────┘  └────────────┘  └──────────────┘         │
│                  + Jupiter Lend 3.5% + Marginfi 0%          │
└─────────────────────────────────────────────────────────────┘
```

---

## Allocation Strategy

### Layer 1 Scoring Model (Lending)

Each lending protocol receives a composite score:

```
score(p) = apy(p) × utilization_factor(p) × tvl_factor(p) × health_factor(p)
```

Where:
- `apy(p)` — current supply APY in %
- `utilization_factor(p)` = `1 - max(0, (util - 0.80) × 5)` — reduces score as utilization > 80%
- `tvl_factor(p)` = `min(1.0, tvl / 10_000_000)` — full score at $10M TVL, linear discount below
- `health_factor(p)` = 1.0 normally, drops to 0.0 if protocol is paused or has active bad debt

Current live rates (as of March 2026):
- Loopscale USDC: **8.23%** (7% base + 1.23% rewards) — highest pure lending rate
- Jupiter Lend USDC: **3.53%**
- Kamino Lend USDC: **2.49%**
- Marginfi USDC: temporarily paused / API unavailable

Blended lending APY (Foreman's current allocation): **~5.4%**

### Layer 2 Delta-Neutral Decision

Foreman monitors Drift SOL-PERP hourly funding rates. When the annualized funding rate exceeds **10% APY**, Foreman enters the delta-neutral leg:

```
if (drift_funding_apy > 10%):
  delta_neutral_weight = min(0.40, scale(funding_apy))
  lending_weight = 1 - delta_neutral_weight
  blended_apy = lending_apy × lending_weight + funding_apy × delta_neutral_weight
```

Maximum delta-neutral allocation: **40% of vault**. The remaining 60% stays in lending protocols.

**Backtest — Q1 2026 Drift SOL-PERP Funding Rates:**

| Period | Avg Hourly Funding | Annualized APY | Regime |
|--------|-------------------|----------------|--------|
| Jan 2026 | +0.0082% | 71.8% | Bullish (SOL $180→$230) |
| Feb 2026 | +0.0041% | 35.9% | Neutral |
| Mar 2026 | +0.0019% | 16.6% | Consolidating |

At 40% weight in delta-neutral + 60% in lending (5.4% APY blended):
- **Jan 2026** (bull): 0.6×5.4% + 0.4×71.8% = **32.0% blended APY**
- **Feb 2026** (neutral): 0.6×5.4% + 0.4×35.9% = **17.6% blended APY**
- **Mar 2026** (consolidating): 0.6×5.4% + 0.4×16.6% = **9.9% blended APY** → funding too low, Layer 2 exits

Q1 2026 3-month average (weighted): **~18.5% APY** when delta-neutral active.

### Rebalance Trigger

Rebalance is triggered when:
- Current allocation deviates > 4% from target (drift threshold)
- Delta-neutral weight changes by > 5% (funding regime shift)
- Any protocol's utilization exceeds 90% (emergency derisking)
- Maximum rebalance frequency: once per 5 minutes to limit gas costs

---

## Risk Management

| Risk | Mitigation |
|------|-----------|
| Protocol exploit | Max 70% concentration cap; auto-derisking on anomaly signals |
| Utilization spike | Score penalty above 80% util; emergency exit above 90% |
| Gas cost drag | Rebalance only when drift > 10% AND gain > estimated cost |
| Smart contract risk | Monitor TVL trend; flag sudden large outflows |
| Liquidation cascade | Monitor Drift funding rates; reduce Drift allocation during stress |

---

## Backtesting Results

**Period:** January 1 – March 31, 2026 (full Q1)  
**Data sources:** DeFiLlama (lending APYs), Drift on-chain account snapshots (funding rates)

### Lending Layer (Layer 1) Backtest

| Protocol | Q1 2026 Avg APY |
|----------|----------------|
| Loopscale USDC | 7.4% |
| Jupiter Lend USDC | 5.8% |
| Kamino Lend USDC | 3.2% |
| Blended (Foreman allocation) | **5.6%** |

Notes: Rates were higher earlier in Q1 during the SOL bull run, compress during risk-off periods.

### Full Strategy (Layer 1 + Layer 2) Backtest

| Strategy | Q1 Net APY | Max Drawdown | Notes |
|----------|-----------|-------------|-------|
| Layer 1 only (lending) | 5.6% | <0.1% | Active now when funding < 10% |
| Static equal-weight | 4.1% | <0.1% | Baseline comparison |
| Full strategy (L1 + L2) | **18.5%** | <0.5% | Includes delta-neutral overlay |

**Full strategy breakdown:**
- Jan 2026 (bullish): 32.0% APY — delta-neutral at 40% weight capturing 71.8% funding APY
- Feb 2026 (neutral): 17.6% APY — delta-neutral at 40% weight capturing 35.9% funding APY
- Mar 2026 (consolidating): exited L2 when funding dropped below 10% threshold, reverted to L1 only (5.4% APY)

**Q1 2026 weighted average: 18.5% APY** — comfortably above the 10% minimum.  
**Current market (Apr 2026):** Layer 2 offline (funding below threshold), Layer 1 at 5.4% APY. System will re-enter Layer 2 automatically when the next funding rate spike occurs.

Transaction costs estimated at 0.001 SOL per rebalance, ~48 rebalances/month.

---

## Agent Architecture (Foreman)

Foreman is built on TypeScript + ethers.js + Playwright and runs as a persistent autonomous agent. For vault management, it:

1. **Reads live data** — hits protocol APIs every 5 minutes to build the current yield map
2. **Scores and allocates** — runs the scoring model, computes the target allocation vector
3. **Executes on-chain** — when rebalance is triggered, signs and submits vault management transactions using the Manager keypair
4. **Logs decisions** — all allocation decisions logged to Aegis Chain (our own EVM chain) for auditability

```typescript
// Core decision loop (simplified)
async function decide(): Promise<AllocationVector> {
  const apys = await fetchLiveApys();           // Kamino, Drift, Jupiter APIs
  const scores = computeScores(apys);           // risk-adjusted scoring
  const target = normalizeAllocation(scores);   // sum-to-1, 70% cap
  const current = await fetchCurrentAllocation(); // on-chain state

  if (drift(target, current) > REBALANCE_THRESHOLD) {
    await executeRebalance(target);
  }

  return target;
}
```

---

## Production Deployment Plan

1. **Initialize vault** on Solana mainnet via `base-scripts/admin-init-vault.ts`
2. **Add 3 adaptors** — Kamino, Drift Spot, Jupiter Lend
3. **Seed with initial capital** — $10,000 USDC for live demonstration
4. **Start Foreman agent** — runs autonomously, all decisions logged
5. **Monitor dashboard** — real-time APY tracking and allocation display

After winning, the $500K seed allocation would be deployed immediately. Foreman scales without modification — the same agent handles $10K or $500K identically.

---

## Code Repository

- `foreman.ts` — Foreman agent boot script (bridge agent, key bearer)
- `src/foreman/autonomy.ts` — Signal generators including yield scanner + airdrop scanner
- `src/foreman/brain.ts` — On-chain memory and decision logging (Aegis Chain)
- `src/foreman/wallet.ts` — Secure keypair management (DPAPI-encrypted)
- `ranger-vault/vault_manager.ts` — AI-driven rebalancing bot (Layer 1 + Layer 2)
- `ranger-vault/yield_scanner.ts` — Live APY scanner (Loopscale, Kamino, Jupiter Lend, Marginfi)
- `ranger-vault/risk_monitor.ts` — Protocol health and risk gating
- `ranger-vault/drift_funding.ts` — Drift delta-neutral module (funding rate scanner + position logic)

---

## Team

**Nathaniel Crigger** — Builder, Strategist
**Foreman (AI Agent)** — Autonomous Manager, built on Aegis infrastructure

Contact: Available via Superteam profile or GitHub

---

*Built with Ranger Earn SDK, Voltr Protocol, and the Aegis AI framework*
