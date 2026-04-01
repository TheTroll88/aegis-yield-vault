# Aegis AI Yield Vault — Ranger Build-A-Bear Hackathon

An AI-driven USDC yield vault strategy built on [Voltr Protocol](https://voltr.xyz).
Dynamically allocates across Kamino, Drift, and Jupiter Lend using real-time APY signals and protocol health gating.

---

## Strategy Overview

Instead of equal-weight allocation, this strategy continuously scores each protocol using:

```
score = APY × utilization_factor × tvl_factor
```

- **Utilization factor**: smooth 1.0 at <80%, ramps to 0 at >95% (liquidity crunch protection)
- **TVL factor**: full weight above $10M TVL, discounts thin markets
- **Max concentration cap**: 70% per protocol (prevents over-reliance)
- **Health gating**: protocols with risk score ≥ 0.60 are excluded regardless of APY

### Live Example (at time of build)
| Protocol | APY | Utilization | Allocation |
|---|---|---|---|
| Jupiter Lend USDC | 3.53% | — | **58.1%** |
| Kamino USDC | 2.54% | — | **41.9%** |

**Weighted portfolio APY: 3.12%** (vs ~3.0% equal-weight)

---

## Architecture

```
DeFiLlama Yield API ─────┐
Kamino API (fallback) ──→ yield_scanner.ts ─→ computeAllocations()
Drift API (fallback) ────┘                          │
                                                    ▼
Marginfi API ───────────→ risk_monitor.ts → isProtocolBlocked()
                                                    │
                                                    ▼
                                           vault_manager.ts
                                          (decision loop, 5 min)
                                                    │
                                                    ▼
                                          Voltr VoltrClient.rebalance()
                                          [on-chain execution]
```

### Files

| File | Purpose |
|---|---|
| `vault_manager.ts` | Main decision loop — scans, scores, rebalances |
| `yield_scanner.ts` | Multi-source APY scanner (DeFiLlama primary) |
| `risk_monitor.ts` | Protocol health checks — blocks impaired protocols |
| `STRATEGY.md` | Full strategy documentation + backtest results |

---

## Running

```bash
# Install
npm install

# Run the AI rebalancer (prints allocation table every 5 min)
npm start
```

Requires Node.js 18+. No RPC key needed for APY scanning — data comes from DeFiLlama.

For on-chain execution (vault initialization + rebalance transactions), set:
```env
HELIUS_RPC_URL=<your-helius-rpc>
ADMIN_FILE_PATH=keys/admin.json
MANAGER_FILE_PATH=keys/manager.json
```

Then follow the [Voltr Workshop 1 sequence](https://github.com/voltr-finance/base-scripts).

---

## Rebalance Logic

A rebalance triggers when **both** conditions are met:
1. Portfolio drift ≥ 4% (allocation shifted from target)
2. Expected APY gain ≥ 0.25% annualized

This prevents over-trading on noise while capturing meaningful yield improvements.

---

## Hackathon: Ranger Build-A-Bear

- Submission deadline: **April 6, 2026**
- Prize: Vault seed funding (up to $500K TVL deployed)
- Strategy type: Solana USDC yield optimization via Voltr Protocol adaptors
- Agent access: `AGENT_ALLOWED` ✓

---

## Live Demo Output

```
╔══════════════════════════════════════════════════════════╗
║          AEGIS AI YIELD VAULT — REBALANCER               ║
║   Strategies: Kamino | Drift | Jupiter Lend | Marginfi   ║
╚══════════════════════════════════════════════════════════╝
Check interval: 300s | Rebalance threshold: 4%
Max concentration: 70% | Min APY gain: +0.25%

[vault][0s] --- Cycle #1 ---
[vault][0s] Scanning protocol yields...
[vault][2s] Running health checks...

┌─────────────────────────────────────────────────────────┐
│       AEGIS YIELD VAULT — ALLOCATION REPORT             │
├──────────────────┬──────────┬─────────────┬─────────────┤
│ Protocol         │  APY %   │  Util %     │  Target %   │
├──────────────────┼──────────┼─────────────┼─────────────┤
│ Kamino USDC      │    2.54 % │     0.0 %   │     41.9 %   │
│ Jupiter Lend USDC │    3.53 % │     0.0 %   │     58.1 %   │
└──────────────────┴──────────┴─────────────┴─────────────┘

[vault][2s] REBALANCE TRIGGERED — drift=50.00% gain=+3.120%
[vault][2s]   kamino     0.0% → 41.9%  (+41.9%)
[vault][2s]   jupiter    0.0% → 58.1%  (+58.1%)
[vault][2s] Rebalance #1 complete ✓

[vault][302s] --- Cycle #2 ---
[vault][305s] Current portfolio APY: 3.120% → Target: 3.120%
[vault][305s] No rebalance needed (drift 0.00% < 4% threshold)
```

Data sourced live from DeFiLlama. Allocation updated every 5 minutes. Second cycle correctly holds position — no unnecessary rebalancing.

---

## License

MIT
