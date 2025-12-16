# Ethereum Consensus Specs - Parameter Reference

---

## Fork Choice Parameters

### PROPOSER_SCORE_BOOST (40)

The proposer score boost is a temporary 40% committee weight boost applied to newly proposed blocks. When a block is proposed, all validators give it this boost in their fork choice calculations, helping the honest block quickly become head before attestations arrive. The boost automatically wears off at the start of the next slot, after which the block is evaluated based only on its actual attestation weight.

### REORG_HEAD_WEIGHT_THRESHOLD (20)

This parameter represents 20% of a committee's weight and determines if the current head block is "weak" enough to be reorganized. If the head block has received less than 20% of a committee's attestation weight, it's considered weak and eligible for a single-slot reorg by the next proposer.

### REORG_PARENT_WEIGHT_THRESHOLD (160)

This parameter represents 160% of a committee's weight and verifies that the parent block is "strong" enough to build upon during a reorg. The parent must have more than 160% of a committee's weight, ensuring that the missing votes from the weak head are actually assigned to the parent rather than being withheld, making it safe to reorg.

### REORG_MAX_EPOCHS_SINCE_FINALIZATION (2)

This parameter limits proposer-initiated reorgs to only occur when the chain is finalizing healthily. Reorgs are only allowed if the last finalized checkpoint was at most 2 epochs ago, preventing reorgs during periods of non-finality when the chain might be unstable.

### How Proposer Boost Reorg Works

The reorg mechanism allows a proposer to intentionally build on the parent of the current head (causing a single-slot reorg) when: the head arrived late and is weak (<20% committee weight), the parent is strong (>160% committee weight), the chain is finalizing well (≤2 epochs since finalization), and other safety conditions are met. The 40% proposer boost then helps the new block overtake the weak head, resulting in a healthier canonical chain.

---

## P2P Network Parameters

### EPOCHS_PER_SUBNET_SUBSCRIPTION (256 epochs ≈ 27 hours)

This constant defines how long a node stays subscribed to a particular attestation subnet before rotating to different subnets. Each node subscribes to a small subset of the 64 attestation subnets (typically 2 subnets) and rotates which subnets they're subscribed to every 256 epochs. This rotation is deterministic based on the node's ID, providing a stable backbone for attestation propagation while ensuring fair load distribution across all nodes over time.

### ATTESTATION_SUBNET_COUNT (64)

This defines the total number of attestation subnets in the Ethereum beacon chain's gossip network. Instead of broadcasting all attestations on a single global topic, Ethereum splits attestation gossip into 64 separate subnets numbered 0-63. Each committee is assigned to one of these subnets, distributing attestation traffic across the network so not every node needs to process every attestation immediately. The value of 64 equals MAX_COMMITTEES_PER_SLOT, allowing each committee to have its own subnet for efficient aggregation.

### ATTESTATION_SUBNET_EXTRA_BITS (0)

This parameter is currently set to 0 in Phase 0 but exists for future extensibility. It controls how many extra bits of a node's NodeID are used when deterministically mapping nodes to their long-lived subnet subscriptions. Currently, 6 bits are sufficient to represent 64 subnets. If set higher in future forks, it would create more granular distribution of nodes across subnets, potentially improving load balancing in very large networks. This parameter serves as a tuning knob that can be adjusted based on network testing results.
