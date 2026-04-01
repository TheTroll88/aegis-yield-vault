# Aegis AI Yield Vault — Ranger Build-A-Bear Hackathon

An AI-driven USDC yield vault built on [Voltr Protocol](https://voltr.xyz) with a two-layer strategy: dynamic lending allocation (Layer 1) + Drift delta-neutral funding rate capture (Layer 2). Managed autonomously by Foreman — a persistent AI agent with browser automation and on-chain execution.

---

## Strategy Overview

### Layer 1 — Lending Base (always active)
Foreman continuously scans Loopscale, Kamino, Jupiter Lend, and Marginfi for the best risk-adjusted USDC yield. Allocation uses a composite score:

```
score = APY x utilization_factor x tvl_factor x health_factor
```

- **Utilization factor**: 1.0 at <80% utilization, ramps to 0 at >95%
- **TVL factor**: full weight above $10M TVL, discounts thin markets
- **Max concentration cap**: 70% per protocol
- **Health gating**: protocols with risk score >= 0.60 are excluded

### Layer 2 — Drift Delta-Neutral Overlay (regime-activated)
When SOL-PERP funding rates exceed **10% APY annualized**, Foreman allocates up to **40% of the vault** to a delta-neutral position (long SOL spot + short SOL-PERP on Drift). Net directional exposure: ~zero.

Combined target: **10-25% APY** in neutral/bullish regimes.

### Live Output (April 1, 2026)

```
┌─────────────────────────────────────────────────────────┐
│       AEGIS YIELD VAULT — ALLOCATION REPORT             │
├──────────────────┬──────────┬─────────────┬─────────────┤
│ Protocol         │  APY %   │  Util %     │  Target %   │
├──────────────────┼──────────┼─────────────┼─────────────┤
│ Kamino USDC      │   2.90 % │     0.0 %   │    26.6 %   │
│ Loopscale USDC   │   8.49 % │     0.0 %   │    39.7 %   │
│ Jupiter Lend USDC│   3.69 % │     0.0 %   │    33.7 %   │
└──────────────────┴──────────┴─────────────┴─────────────┘
[vault][4s] SOL-PERP funding: -0.0005%/hr (-4.7% APY) via hyperliquid
[vault][4s] Funding below entry threshold (10%) — lending-only mode
[vault][4s] Portfolio APY: 5.39% (bearish regime, Layer 2 inactive)
```

Current bearish regime: funding is negative -> Layer 2 inactive -> **5.4% lending APY**
Bull/neutral regime (Q1 2026 backtest): Layer 2 active -> **17-32% blended APY**

---

## Backtest Performance (Q1 2026)

| Period | Funding APY | Blended APY | Regime |
|--------|------------|-------------|--------|
| Jan 2026 | +71.8% | **32.0%** | Bullish (SOL $180->$230) |
| Feb 2026 | +35.9% | **17.6%** | Neutral |
| Mar 2026 | +16.6% | **9.9%** (Layer 2 exits) | Consolidating |
| **Q1 Average** | | **~18.5%** | |

Full backtest: [STRATEGY.md](./STRATEGY.md)

---

## Architecture

```
DeFiLlama Yield API ─────> yield_scanner.ts ─> computeAllocations()
Hyperliquid/OKX API ────-> drift_funding.ts -> recommendDeltaNeutralAllocation()
Marginfi API ──────────-> risk_monitor.ts  -> isProtocolBlocked()
                                   v
                          vault_manager.ts (5 min loop)
                                   v
                   Layer 1 Rebalance + Layer 2 Delta-Neutral
```

| File | Purpose |
|---|---|
| `vault_manager.ts` | Main decision loop |
| `yield_scanner.ts` | Multi-source APY scanner (DeFiLlama primary) |
| `drift_funding.ts` | Delta-neutral module (funding rate fetch + allocation) |
| `risk_monitor.ts` | Protocol health gates |
| `STRATEGY.md` | Full docs + backtest results |

---

## Running

```bash
npm install
node node_modules/tsx/dist/cli.mjs vault_manager.ts
```

Requires Node.js 18+. No API keys needed — DeFiLlama and Hyperliquid are free public APIs.

---

## Hackathon Info

- Deadline: April 6, 2026
- Prize: Vault seed funding (up to $500K TVL)
- Protocol: Voltr (vault-sdk)
- AGENT_ALLOWED: yes
