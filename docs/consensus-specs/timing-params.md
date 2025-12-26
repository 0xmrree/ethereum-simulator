# Ethereum Beacon Chain Timing Parameters Reference

## Overview

The Ethereum beacon chain uses **basis points (BPS)** to express timing deadlines as percentages of slot duration. This ensures deterministic, integer-only arithmetic across all consensus clients while avoiding floating-point calculations that could lead to consensus failures.

## What are Basis Points?

A **basis point (bp or bps)** is a unit equal to one one-hundredth of a percentage point, or 0.01% (0.0001 as a decimal).

- **1 basis point** = 0.01% = 0.0001
- **100 basis points** = 1%
- **10,000 basis points** = 100%

**Example**: A rate increasing from 4.00% to 4.25% is a rise of 25 basis points.

## The BASIS_POINTS Constant

`BASIS_POINTS = 10000` ([specs/phase0/fork-choice.md:111](specs/phase0/fork-choice.md#L111))

This constant represents **100%** and acts as the **denominator** when converting basis points to fractions. While the name could be clearer (e.g., `BASIS_POINTS_MAX` or `BASIS_POINTS_DENOMINATOR`), it serves as the conversion factor throughout the spec.

## How BPS Parameters Work

All timing BPS parameters are **percentages of `SLOT_DURATION_MS`**, which defines the total duration of a slot in milliseconds.

### Conversion Formula

```python
def get_slot_component_duration_ms(basis_points: uint64) -> uint64:
    """Calculate the duration of a slot component in milliseconds."""
    return basis_points * SLOT_DURATION_MS // BASIS_POINTS
```

This is mathematically equivalent to:
```
(basis_points / BASIS_POINTS) * SLOT_DURATION_MS
```

But by **multiplying first, then using integer division**, it preserves precision without floating-point arithmetic.

### Example Calculation

For `ATTESTATION_DUE_BPS = 3333` and `SLOT_DURATION_MS = 12000`:

```python
3333 * 12000 // 10000
= 39,996,000 // 10000
= 3999 ms  (~4 seconds into a 12-second slot)
```

This represents 33.33% of the slot duration.

## Core Timing Parameters

### SLOT_DURATION_MS
- **Location**: [specs/phase0/beacon-chain.md:338](specs/phase0/beacon-chain.md#L338)
- **Value**: 12000 ms (12 seconds) on mainnet, 6000 ms on minimal config
- **Purpose**: The total duration of a slot

### ATTESTATION_DUE_BPS
- **Location**: [specs/phase0/validator.md:113](specs/phase0/validator.md#L113)
- **Value**: 3333 basis points (~33% of slot = ~4 seconds on mainnet)
- **Purpose**: Deadline for when attestations should be produced/published
- **Usage**: Called via `get_attestation_due_ms(epoch)` ([specs/phase0/fork-choice.md:497-498](specs/phase0/fork-choice.md#L497-L498))

### AGGREGATE_DUE_BPS
- **Location**: [specs/phase0/validator.md:114](specs/phase0/validator.md#L114)
- **Value**: 6667 basis points (~67% of slot = ~8 seconds on mainnet)
- **Purpose**: Deadline for when aggregate attestations should be produced/published
- **Usage**: Called via `get_aggregate_due_ms(epoch)` ([specs/phase0/fork-choice.md:511-512](specs/phase0/fork-choice.md#L511-L512))

### SYNC_MESSAGE_DUE_BPS
- **Location**: [specs/altair/validator.md:88](specs/altair/validator.md#L88)
- **Value**: 3333 basis points (~33% of slot = ~4 seconds on mainnet)
- **Purpose**: Deadline for sync committee messages (introduced in Altair fork)
- **Background**: Sync committees (512 validators serving for 256 epochs) help light clients by signing beacon block roots

### CONTRIBUTION_DUE_BPS
- **Location**: [specs/altair/validator.md:89](specs/altair/validator.md#L89)
- **Value**: 6667 basis points (~67% of slot = ~8 seconds on mainnet)
- **Purpose**: Deadline for sync committee contribution aggregates (introduced in Altair fork)

## Relationship to Committees

### Attestation Committees
- Different validators each slot
- Attest to beacon chain head
- **Aggregation**: Selected validators combine individual attestations with identical `attestation_data` into aggregate attestations using BLS signature aggregation, reducing bandwidth and block space

### Sync Committees
- 512 validators serving for 256 epochs (~27 hours)
- Sign beacon block roots to help light clients
- Completely separate from attestation committees
- Introduced in Altair fork for light client support

## GLOAS Fork Changes

The **GLOAS fork** (EIP-7732: Enshrined Proposer-Builder Separation) moves all timing deadlines earlier to accommodate the new Payload Timeliness Committee (PTC):

| Parameter | Phase 0/Altair | GLOAS | Change |
|-----------|----------------|-------|--------|
| `ATTESTATION_DUE_BPS` | 3333 (~33%) | 2500 (25%) | -8.33% |
| `AGGREGATE_DUE_BPS` | 6667 (~67%) | 5000 (50%) | -16.67% |
| `SYNC_MESSAGE_DUE_BPS` | 3333 (~33%) | 2500 (25%) | -8.33% |
| `CONTRIBUTION_DUE_BPS` | 6667 (~67%) | 5000 (50%) | -16.67% |

**New parameter**:
- `PAYLOAD_ATTESTATION_DUE_BPS = 7500` (75% of slot) - deadline for PTC attestations

**Why**: The PTC needs to attest to execution payload timeliness, so existing deadlines are moved earlier to make room for this new responsibility.

**Documentation**: [specs/gloas/validator.md:36-104](specs/gloas/validator.md#L36-L104)

## Why This Design?

### Avoiding Floating Point
Consensus-critical code must be **deterministic** - all clients must compute identical values. Floating-point arithmetic can have rounding differences across architectures, so the spec uses **only integer arithmetic**.

### Proportional Scaling
By expressing deadlines as percentages of `SLOT_DURATION_MS`, if you change the slot duration (e.g., for testnets), all deadlines scale automatically. You only need to update one parameter (`SLOT_DURATION_MS`), not recalculate multiple absolute timing values.

### Example
- **Mainnet**: `SLOT_DURATION_MS = 12000` ms
- **Minimal config**: `SLOT_DURATION_MS = 6000` ms

Both use the **same BPS values**, but they result in different absolute millisecond deadlines that maintain the same proportional timing relationships.

## How to Know a BPS Parameter Corresponds to Slot Duration

You can determine this by:

1. **Reading the function implementation**: `get_slot_component_duration_ms()` explicitly multiplies by `SLOT_DURATION_MS`
2. **Reading the documentation**: Config tables explicitly state relationships like "~33% of `SLOT_DURATION_MS`"
3. **Tracing usage**: Following where BPS parameters are used shows they always go through `get_slot_component_duration_ms()`

It's a **convention enforced by code structure** - any BPS parameter used with `get_slot_component_duration_ms()` becomes a percentage of `SLOT_DURATION_MS` by definition.

## Key Takeaways

- Basis points provide **precise, integer-based percentage calculations**
- All timing deadlines are **proportional to slot duration**
- The design ensures **deterministic consensus** across all clients
- Understanding BPS is essential for working with Ethereum's timing and validator responsibilities
