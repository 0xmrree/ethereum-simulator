# How Optimistic Rollups Actually Work: A Technical Deep Dive

## The Ethereum Scalability Challenge

Ethereum is fundamentally a state machine where every state transition must be executed by thousands of nodes across the network. This design creates an inherent tension: increasing throughput (transactions per second) requires either faster block times, larger blocks, or higher gas limits—all of which increase hardware requirements for validators. Ethereum deliberately chooses not to pursue these paths because doing so would centralize the network by pricing out validators running on consumer hardware with residential internet connections.

This constraint is not arbitrary. Ethereum's value proposition as "credibly neutral money" depends on its ability to resist censorship and remain permissionless. If only data centers in developed nations could afford to validate, Ethereum would lose the decentralization that makes it valuable. The network must remain accessible to someone running a validator on a laptop in Jakarta or Lagos, not just on enterprise hardware in Virginia.

But users need cheap transactions. The DeFi ecosystem, NFT markets, and everyday payments cannot function at $50 per transaction. This creates the fundamental challenge that Layer 2 rollups solve: how do we scale transaction throughput by orders of magnitude while preserving Ethereum's decentralization guarantees?

## The Core Insight Behind Rollups

The breakthrough insight is deceptively simple. Consider a sequence of N state transitions, where each transition is defined by the Ethereum Virtual Machine's execution rules. From Ethereum's perspective, these N transitions can be compressed into a single aggregate state transition that we'll call X. Instead of Ethereum validators executing all N transitions individually, they can verify that transition X was computed correctly.

This compression is the essence of rollups. The Layer 2 executes transactions off-chain (where hardware constraints don't matter), bundles thousands of them together, and presents the aggregate result to Ethereum as a single state transition. Ethereum doesn't execute the individual transactions—it merely verifies that someone else executed them correctly.

The security model relies on data availability and fraud proofs. The L2 must post all transaction data to Ethereum so that anyone can independently recompute the state transition and verify correctness. If the L2 lies about the result, anyone can submit a cryptographic proof of the fraud to Ethereum, which will reject the invalid state and slash the malicious party.

## The Mechanics: A Concrete Example

Let's walk through exactly how this works with a real example. We'll trace three users making transactions on an optimistic rollup, see how those transactions get batched and posted to Ethereum, and understand what happens during the challenge period.

### Initial State: Bridging to Layer 2

Before any L2 transactions can occur, users must bridge funds from Ethereum mainnet. When Alice wants to use Arbitrum, she calls a function on Ethereum's L1 bridge contract:

```solidity
// Ethereum L1 Bridge Contract
contract ArbitrumBridge {
    mapping(address => uint256) public deposits;
    uint256 public totalLocked;
    
    function depositETH() external payable {
        require(msg.value > 0, "Must deposit ETH");
        deposits[msg.sender] += msg.value;
        totalLocked += msg.value;
        
        emit DepositInitiated(msg.sender, msg.value);
    }
}
```

Alice sends a transaction to this contract with 10 ETH. The transaction looks like this:

```
Transaction on Ethereum L1:
    from: 0xAlice (Alice's address)
    to: 0xBridge (ArbitrumBridge contract)
    value: 10 ETH
    data: 0xf6326fb3 (depositETH function selector)
    gasPrice: 25 gwei
    gasUsed: 55,000
    cost: 0.001375 ETH in gas
```

The bridge contract locks Alice's 10 ETH on L1. The Arbitrum sequencer (a server run by Offchain Labs) observes this deposit transaction and credits Alice with 10 ETH on the L2 side. Alice now has an IOU—she owns a claim on 10 ETH locked in the bridge contract, represented as a balance in Arbitrum's state.

Similarly, Bob bridges 5 ETH and Charlie bridges 8 ETH. The bridge contract now holds 23 ETH total, and the L2 tracks:

```
Arbitrum L2 State:
    Alice: 10 ETH
    Bob: 5 ETH
    Charlie: 8 ETH
```

### Layer 2 Transaction Execution

Users now interact with the L2 by sending signed transactions to Arbitrum's sequencer. These transactions look identical to Ethereum transactions—they're signed with private keys using ECDSA and contain the same fields (nonce, to, value, data, etc.). The only difference is they're sent to Arbitrum's RPC endpoint instead of Ethereum's.

Alice wants to send 3 ETH to Bob. She creates and signs this transaction:

```
Transaction 1 (L2):
    from: 0xAlice
    to: 0xBob
    value: 3 ETH
    nonce: 0
    gasPrice: 0.1 gwei (much cheaper on L2)
    signature: 0x4f8a... (Alice's ECDSA signature)
```

The sequencer receives this transaction, validates the signature (confirming it's really from Alice), and executes it immediately. The L2 state updates:

```
After Transaction 1:
    Alice: 7 ETH (10 - 3)
    Bob: 8 ETH (5 + 3)
    Charlie: 8 ETH
```

Next, Bob sends 2 ETH to Charlie:

```
Transaction 2 (L2):
    from: 0xBob
    to: 0xCharlie
    value: 2 ETH
    nonce: 0
    signature: 0x7a2c... (Bob's ECDSA signature)
```

After execution:

```
After Transaction 2:
    Alice: 7 ETH
    Bob: 6 ETH (8 - 2)
    Charlie: 10 ETH (8 + 2)
```

Finally, Charlie sends 1 ETH back to Alice:

```
Transaction 3 (L2):
    from: 0xCharlie
    to: 0xAlice
    value: 1 ETH
    nonce: 0
    signature: 0x9b5e... (Charlie's ECDSA signature)
```

Final state after all three transactions:

```
After Transaction 3:
    Alice: 8 ETH (7 + 1)
    Bob: 6 ETH
    Charlie: 9 ETH (10 - 1)
```

These transactions cost users pennies in L2 gas fees and execute in milliseconds. The sequencer processes them immediately without waiting for Ethereum block times.

### Batching and Posting to Layer 1

The sequencer has now executed three transactions. It could post each one individually to Ethereum, but that would be expensive. Instead, it waits to accumulate many transactions (typically hundreds or thousands) and posts them as a single batch.

For our example, let's say the sequencer batches just these three transactions. It must post two pieces of information to Ethereum:

1. **The transaction data**: The actual signed transactions so anyone can verify the computation
2. **The state commitment**: A cryptographic hash representing the new state (Alice: 8, Bob: 6, Charlie: 9)

#### Understanding Calldata and Blobs

This is where Ethereum's transaction structure becomes crucial. When the sequencer posts the batch to Ethereum, it's creating a regular Ethereum transaction that calls a function on the rollup's L1 contract. But where does the transaction data go?

Before EIP-4844 (the blob upgrade in March 2024), L2s embedded their transaction data directly in the calldata field of the Ethereum transaction. Calldata is the parameter space for function calls—when you call a function with arguments, those arguments are encoded in calldata. The clever trick is that calldata gets stored in Ethereum's blockchain history permanently, so anyone can retrieve it later to verify the L2's computation.

Here's what a pre-blob batch submission looked like:

```solidity
// Ethereum L1 Rollup Contract (pre-blobs)
contract ArbitrumRollup {
    struct Batch {
        bytes32 prevStateRoot;
        bytes32 newStateRoot;
        uint256 timestamp;
    }
    
    mapping(uint256 => Batch) public batches;
    uint256 public batchCount;
    
    function submitBatch(
        bytes calldata transactionData,  // All L2 transactions compressed
        bytes32 newStateRoot              // Claimed new state
    ) external {
        require(msg.sender == sequencer, "Only sequencer");
        
        batches[batchCount] = Batch({
            prevStateRoot: batches[batchCount - 1].newStateRoot,
            newStateRoot: newStateRoot,
            timestamp: block.timestamp
        });
        
        emit BatchSubmitted(batchCount, newStateRoot, transactionData.length);
        batchCount++;
    }
}
```

The sequencer would call this with the transaction data embedded as a parameter:

```
Ethereum L1 Transaction (pre-blobs):
    from: 0xSequencer
    to: 0xRollupContract
    data: 0x8f3b8c1a  ← submitBatch function selector (4 bytes)
          0x0000000000000000000000000000000000000000000000000000000000000040  ← offset to transactionData
          0x4a7b2c8d9e3f5a1b6c8d2e4f7a9b3c5d8e1f4a6b9c2d5e8f1a4b7c0d3e6f9a2b  ← newStateRoot
          0x0000000000000000000000000000000000000000000000000000000000000180  ← length of transactionData (384 bytes)
          [384 bytes of compressed transaction data here...]
    gasPrice: 30 gwei
    gasUsed: 1,800,000
    cost: 0.054 ETH (~$100 at $2000/ETH)
```

The transaction data might look like:

```
transactionData (compressed and RLP-encoded):
    0xf86b01850174876e800825208094bob0000000000000000000000000000000000
    000029a04f8a... (Transaction 1: Alice→Bob 3 ETH)
    0xf86b01850174876e800825208094charlie00000000000000000000000000000001
    c8029a07a2c... (Transaction 2: Bob→Charlie 2 ETH)
    0xf86b01850174876e800825208094alice000000000000000000000000000000000
    884029a09b5e... (Transaction 3: Charlie→Alice 1 ETH)
```

This transaction data lives in Ethereum's blockchain forever. The contract doesn't store it in contract storage (which would be prohibitively expensive)—instead, it's part of the transaction's calldata, which exists in the blockchain's transaction history.

#### The Blob Revolution

After EIP-4844, this process became much cheaper. Instead of embedding transaction data in calldata, L2s attach it as a blob—a separate data structure that lives alongside the beacon block but isn't part of the permanent blockchain history.

The modern batch submission looks like:

```solidity
// Ethereum L1 Rollup Contract (post-blobs)
contract ArbitrumRollup {
    function submitBatch(
        bytes32 blobCommitment,  // KZG commitment to the blob (48 bytes)
        bytes32 newStateRoot      // Claimed new state
    ) external {
        require(msg.sender == sequencer, "Only sequencer");
        
        // Verify the blob commitment matches the actual blob
        // (This is done by the beacon chain consensus layer)
        
        batches[batchCount] = Batch({
            prevStateRoot: batches[batchCount - 1].newStateRoot,
            newStateRoot: newStateRoot,
            blobCommitment: blobCommitment,
            timestamp: block.timestamp
        });
        
        emit BatchSubmitted(batchCount, newStateRoot, blobCommitment);
        batchCount++;
    }
}
```

Now the Ethereum transaction looks like:

```
Ethereum L1 Transaction (with blob):
    from: 0xSequencer
    to: 0xRollupContract
    data: 0x2a5c1f9b  ← submitBatch function selector
          0x8d4e7f2a9b3c6d1e5f8a2b4c7d9e3f6a1b5c8d2e4f7a9b3c6d1e5f8a2b4c7d9e  ← blobCommitment (48 bytes)
          0x4a7b2c8d9e3f5a1b6c8d2e4f7a9b3c5d8e1f4a6b9c2d5e8f1a4b7c0d3e6f9a2b  ← newStateRoot
    blob: [125 KB of transaction data in blob sidecar]
    gasPrice: 25 gwei
    gasUsed: 180,000  ← Much less gas!
    blobGasPrice: 1 wei
    blobGasUsed: 131,072
    cost: 0.0045 ETH + ~$0.50 blob fee (~$9.50 total at $2000/ETH)
```

The transaction data now lives in a blob that's attached to the beacon block. The blob contains the same compressed transaction data as before, but it's stored separately from the calldata. The contract only stores the blob commitment—a 48-byte cryptographic commitment that proves what data is in the blob.

Crucially, blobs are pruned after approximately 18 days. This is long enough for the 7-day challenge period plus a comfortable buffer, but not forever. The cost savings are dramatic: roughly 10-100x cheaper than calldata.

### Computing the State Root

The state root is a cryptographic commitment to the entire L2 state. It's computed using a Merkle tree where each account's balance is a leaf:

```
State Merkle Tree:
                    Root: 0x4a7b...
                   /              \
          0x2c8d...                  0x9e3f...
         /        \                 /        \
    Alice: 8   Bob: 6          Charlie: 9   (empty)
```

The state root is computed by hashing pairs of leaves up the tree until you reach a single root hash. This commitment has a powerful property: anyone with the full state can recompute the root, but you can't reverse the root to get the state. It's like a fingerprint for the state.

When the sequencer posts `newStateRoot: 0x4a7b...`, they're claiming "after executing these transactions, the state's fingerprint is 0x4a7b...". This claim can be verified by anyone who downloads the transaction data and recomputes the state.

### The Challenge Period

Once the batch is submitted to Ethereum, a 7-day challenge window begins. During this time, anyone can download the transaction data (from the blob or historical calldata) and verify the sequencer's computation.

A verifier downloads the blob:

```bash
# Download blob data from beacon node
curl http://beacon-node/eth/v1/beacon/blob_sidecars/slot_12345

# Extract transaction data
blob_data = blob_sidecars[0].blob  # 125 KB of transaction data
```

They then replay the transactions:

```python
# Start with previous state
state = {
    'Alice': 10,
    'Bob': 5,
    'Charlie': 8
}

# Parse and execute each transaction
transactions = parse_blob_data(blob_data)

for tx in transactions:
    if verify_signature(tx):
        state[tx['from']] -= tx['value']
        state[tx['to']] += tx['value']

# Compute state root
computed_root = merkle_root(state)
# Result: Alice: 8, Bob: 6, Charlie: 9
# computed_root = 0x4a7b...
```

If `computed_root` matches the `newStateRoot` posted by the sequencer, the batch is valid. The verifier does nothing—they simply observe that the computation is correct.

### The Fraud Proof Mechanism

Now consider what happens if the sequencer cheats. Suppose they post:

```
Fraudulent batch submission:
    transactionData: [Transaction 1, Transaction 2, Transaction 3]  (same as before)
    newStateRoot: 0x9e2c...  (WRONG!)
    
Claimed state:
    Alice: 8 ETH ✓
    Bob: 6 ETH ✓
    Charlie: 5 ETH ✗ (should be 9!)
    Sequencer: 4 ETH (stolen from Charlie!)
```

The sequencer posts the correct transaction data (they can't fake it because users signed the transactions with their private keys), but they lie about the result. They claim Charlie has only 5 ETH when he should have 9 ETH, secretly crediting themselves with the missing 4 ETH.

Charlie (or anyone) can catch this by replaying the transactions. They download the blob data, execute the transactions, and discover the discrepancy. They then submit a fraud proof to Ethereum.

The fraud proof mechanism varies by rollup implementation. Optimism uses a single-round fraud proof system where the challenger submits the correct state along with a cryptographic proof:

```solidity
// Simplified fraud proof submission
contract OptimismRollup {
    function challengeBatch(
        uint256 batchId,
        bytes calldata transactionData,
        bytes32 correctStateRoot,
        bytes calldata merkleProof
    ) external {
        Batch memory batch = batches[batchId];
        require(block.timestamp <= batch.timestamp + 7 days, "Challenge period ended");
        
        // Verify the transaction data matches the blob commitment
        require(verify_blob_commitment(batch.blobCommitment, transactionData), "Invalid tx data");
        
        // Re-execute a portion of the transactions to verify the state
        bytes32 recomputedRoot = execute_and_hash(transactionData, merkleProof);
        
        // If the recomputed root differs from the claimed root, the batch is fraudulent
        if (recomputedRoot != batch.newStateRoot) {
            // Slash the sequencer
            slash(sequencer, SEQUENCER_BOND);
            
            // Update to correct state
            batches[batchId].newStateRoot = correctStateRoot;
            
            // Reward the challenger
            payable(msg.sender).transfer(CHALLENGER_REWARD);
            
            emit FraudProven(batchId, msg.sender);
        } else {
            // False challenge - slash the challenger
            slash(msg.sender, CHALLENGE_BOND);
        }
    }
}
```

Arbitrum uses an interactive fraud proof protocol. Instead of re-executing everything on-chain (which would be expensive), they use a bisection game:

1. Challenger says: "I disagree with the state transition"
2. Contract asks: "Which half of the computation is wrong?"
3. They narrow down the dispute through binary search
4. Eventually they reach a single instruction that's disputed
5. Contract executes that single instruction on-chain to determine who's right

This approach requires multiple rounds of interaction but is gas-efficient because only a tiny portion of the computation is executed on L1.

In our example, Charlie submits a fraud proof with the correct transaction data and state. The contract verifies:

```
Transaction data hash matches blob commitment: ✓
Re-executing transactions yields Alice: 8, Bob: 6, Charlie: 9: ✓
Posted state root claimed Charlie: 5: ✗

Fraud proven!
```

The contract then:
1. Rejects the fraudulent state root `0x9e2c...`
2. Updates to the correct state root `0x4a7b...`
3. Slashes the sequencer's bond (they posted collateral that now gets burned or given to Charlie)
4. Rewards Charlie for catching the fraud

The economic incentive is clear: the sequencer loses money if they cheat, and challengers are rewarded for catching fraud. This makes cheating irrational.

### Finalization

If the 7-day challenge period passes without any valid fraud proofs, the batch is finalized. The state commitment becomes canonical and immutable. At this point, users can safely withdraw funds back to L1 based on this finalized state.

```solidity
function finalizeWithdrawal(
    uint256 batchId,
    address recipient,
    uint256 amount,
    bytes32[] calldata merkleProof
) external {
    Batch memory batch = batches[batchId];
    require(block.timestamp > batch.timestamp + 7 days, "Not finalized");
    require(!batch.fraudProven, "Batch was proven fraudulent");
    
    // Verify the user had this balance in the finalized state
    require(verify_balance_proof(batch.newStateRoot, recipient, amount, merkleProof), "Invalid proof");
    
    // Release funds from bridge
    totalLocked -= amount;
    payable(recipient).transfer(amount);
}
```

Charlie can now prove he has 9 ETH in the finalized L2 state and withdraw it back to Ethereum mainnet. The bridge contract checks that the batch is finalized (7+ days have passed with no fraud), verifies Charlie's balance using a Merkle proof against the state root, and releases 9 ETH to him.

## Why This Works: The Security Model

The optimistic rollup security model rests on several pillars:

**Data Availability**: All transaction data must be posted to Ethereum. Without this, verifiers couldn't check the sequencer's work. The transition from calldata to blobs maintains data availability while reducing costs—blobs are still available for 18 days, which exceeds the 7-day challenge window.

**Cryptographic Signatures**: Users sign transactions with their private keys. The sequencer cannot forge transactions or claim a user sent money they didn't. The transaction data posted to Ethereum contains these signatures, which anyone can verify.

**Fraud Proofs**: Anyone can challenge invalid state transitions. The economic incentives align perfectly—challengers are rewarded, fraudsters are slashed. The sequencer knows that even a single fraudulent batch will be caught and punished.

**Ethereum as the Court**: Ethereum's consensus layer acts as an impartial judge. When disputes arise, Ethereum re-executes the computation and determines truth. No amount of L2 collusion can override Ethereum's verdict.

**Economic Finality**: After 7 days, the state is final. This delay is the price of optimistic security—we assume honesty but need time to catch fraud.

The beauty is that fraud proofs almost never need to be used. The threat of fraud proofs keeps everyone honest. In practice, no major optimistic rollup has experienced a successful fraud attack in production, because the economics make cheating irrational.

## The Scalability Math

Consider the scaling improvement. On Ethereum L1, each transaction:
- Uses ~21,000 gas for a simple transfer
- At 30 million gas per block and 12-second blocks, that's ~119 transfers per second
- At 25 gwei gas price, each transfer costs ~$1.00 (at $2000/ETH)

With an optimistic rollup posting batches via blobs:
- 1000 transactions compressed into one batch
- Batch costs ~$10 total (mostly blob fees)
- Per-transaction cost: $0.01
- Throughput: thousands of TPS (limited only by sequencer hardware)

The rollup achieves 100x cost reduction and >10x throughput improvement while maintaining Ethereum's security. Users get fast, cheap transactions. Ethereum maintains decentralization. This is the fundamental value proposition of Layer 2 scaling.

## Current Limitations and Future Directions

Despite their promise, optimistic rollups have notable limitations:

**Centralized Sequencers**: Currently, a single company (Offchain Labs for Arbitrum, OP Labs for Optimism, Coinbase for Base) controls each rollup's sequencer. They have power over transaction ordering (enabling MEV extraction) and can censor transactions. The industry is working toward decentralized sequencers, but progress is slow because the revenue from controlling the sequencer is substantial.

**Training Wheels**: Most rollups still have Security Councils—multisig groups that can pause withdrawals or upgrade contracts if bugs are found. This centralizes trust. The goal is to eventually remove these councils, but doing so requires extreme confidence in the system's security, which hasn't been achieved yet.

**7-Day Withdrawal Delay**: The week-long challenge period creates friction for users who want to move funds back to L1 quickly. Various fast-exit solutions exist (liquidity providers who give you instant liquidity in exchange for a small fee), but the fundamental delay remains.

**Unproven Fraud Proofs**: Remarkably, fraud proofs have never been used in production to catch a real theft attempt. This means the mechanism hasn't been battle-tested in adversarial conditions. The system works preventatively, but we don't know for certain how it would perform if a sophisticated attacker tried to steal funds.

The future of optimistic rollups involves addressing these limitations through decentralized sequencing, removing training wheels, and potentially reducing challenge periods through more efficient fraud proof systems. The technology is maturing rapidly, but we're still in the early stages of L2-based Ethereum scaling.

## Conclusion

Optimistic rollups represent a profound insight about blockchain scalability: you don't need everyone to execute everything. By compressing N state transitions into one aggregate transition and providing cryptographic proofs of correctness, rollups achieve order-of-magnitude scaling improvements while preserving the security properties that make Ethereum valuable.

The system works because of a careful interplay between data availability, economic incentives, and Ethereum's role as a neutral arbiter. Users sign transactions that can't be forged, sequencers post data that can be verified, challengers have incentives to catch fraud, and Ethereum enforces the rules impartially.

The transition from calldata to blobs demonstrates how the ecosystem evolves. By recognizing that L2s only need temporary data availability, Ethereum introduced a cheaper storage mechanism that maintains security while dramatically reducing costs. This is infrastructure building at its finest—identifying the essential requirements and optimizing accordingly.

As Ethereum continues to scale through rollups, we're witnessing a fundamental shift in blockchain architecture. The base layer becomes a settlement and data availability layer, while execution moves to specialized L2s. This separation of concerns allows each layer to optimize for different goals—L1 for decentralization and security, L2 for speed and cost. The result is a more scalable, more accessible Ethereum that maintains the properties that make it valuable: permissionless participation, censorship resistance, and credible neutrality.