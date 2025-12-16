# Proposer Boost Reorg: MEV as a Chain Health Mechanism

## The Core Insight

Ethereum's proposer boost reorg mechanism is a clever example of **using MEV incentives to maintain chain health**. The protocol doesn't explicitly tell proposers to reorg weak blocks "for the good of the network" - instead, it makes reorging weak blocks profitable, and proposers do it automatically for selfish reasons.

## Ethereum's Objective

Ethereum wants the canonical chain to consist of **strong blocks** - blocks that have received substantial attestation support (at least 20% of the committee's weight). Weak blocks with minimal attestations create a fragile chain that's more susceptible to instability.

## The Mechanism

When a block is weak (< 20% committee attestations), the protocol allows the next proposer to reorg it by building on the parent block instead. To help this reorg succeed, the protocol grants the proposer a **40% committee weight boost**.

## Why Would a Proposer Actually Reorg?

The answer is simple: **MEV extraction**.

### The Proposer's Calculation

```
Slot N: Block A (weak, <20% attestations)
  Contains: [tx1, tx2, tx3_with_juicy_MEV]

Slot N+1: I'm the proposer

Option 1 - Build on Block A (normal):
  My block: [tx4, tx5, tx6]
  Revenue: block reward + fees from my transactions

Option 2 - Reorg Block A (build on parent):
  My block: [tx3_with_juicy_MEV, tx4, tx5, tx6]
  Revenue: block reward + fees + MEV from tx3
  Bonus: 40% proposer boost to help my block win the fork choice
```

**The proposer reorgs because they can capture the MEV from the weak block's transactions.**

## Incentive Alignment

This is elegant mechanism design:

| Party | Goal | Mechanism |
|-------|------|-----------|
| **Ethereum** | Strong canonical chain (>20% attestations) | Allow reorgs of weak blocks |
| **Proposer** | Maximize MEV revenue | Reorg weak blocks to steal their transactions |
| **Result** | Weak blocks get removed, chain stays healthy | Proposers profit from doing what the protocol wants |

## The Proposer Boost's Role

The 40% boost exists specifically to **help the MEV-motivated reorg succeed**. Without it, the reorg block might not overtake the weak head in fork choice. The boost ensures that when a proposer reorgs for MEV, their block has enough weight to become the new canonical head.

## Key Constraints

The mechanism has safeguards to prevent abuse:

1. **Head must be weak (<20%)**: Can't reorg strong blocks
2. **Parent must be strong (>160%)**: Ensures the weak head's missing attestations are genuinely missing, not withheld
3. **Chain must be finalizing (≤2 epochs)**: Only works during healthy consensus
4. **Single-slot only**: Can only reorg the immediate previous slot

These constraints ensure reorgs only happen when genuinely beneficial for chain health, not arbitrarily for MEV.

## The Trade-off

Ethereum explicitly accepts MEV extraction as the cost of maintaining chain health:

**Benefits:**
- Weak blocks get naturally removed from the canonical chain
- Chain maintains strong attestation support throughout
- Better resilience to network latency and late block arrivals

**Costs:**
- Proposers can capture MEV from late/weak blocks
- Slight increase in MEV opportunities
- Transactions in weak blocks get "stolen" by the next proposer

The community consensus is that the chain health benefits outweigh the MEV concerns, especially given the strict constraints that prevent abuse.

## Conclusion

Proposer boost reorg is a prime example of **mechanism design using selfish incentives to achieve protocol goals**. Rather than relying on altruism, Ethereum makes the desired behavior (removing weak blocks) profitable through MEV, and proposers naturally do what's best for the network while pursuing their own profit.
