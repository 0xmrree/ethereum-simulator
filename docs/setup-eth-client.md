# Running an Ethereum Node: Lighthouse + Reth

This guide will walk you through setting up a full Ethereum node using:
- **Reth** - Execution Layer client (fast, Rust-based)
- **Lighthouse** - Consensus Layer client (what you'll be contributing to!)

## Prerequisites

- **Storage**: ~700GB free space
- **RAM**: 16GB minimum (32GB recommended)
- **OS**: Linux or macOS
- **Time**: 8-12 hours for initial sync

---

## Part 1: Install Reth (Execution Layer)

### 1.1 Visit Reth's Official Site

Go to: **https://reth.rs**

Or directly to releases: **https://github.com/paradigmxyz/reth/releases**

### 1.2 Download Reth Binary

```bash
# Create a directory for Ethereum software
mkdir -p ~/ethereum
cd ~/ethereum

# Download the latest release (check the releases page for latest version)
# For Linux x86_64:
wget https://github.com/paradigmxyz/reth/releases/download/v1.1.3/reth-v1.1.3-x86_64-unknown-linux-gnu.tar.gz

# For macOS (ARM/M1/M2):
# wget https://github.com/paradigmxyz/reth/releases/download/v1.1.3/reth-v1.1.3-aarch64-apple-darwin.tar.gz

# Extract
tar -xzf reth-*.tar.gz

# Make executable and move to PATH
chmod +x reth
sudo mv reth /usr/local/bin/

# Verify installation
reth --version
```

### 1.3 Create JWT Secret

Reth and Lighthouse need a shared JWT secret to authenticate with each other:

```bash
# Generate a random JWT secret
openssl rand -hex 32 > ~/ethereum/jwt.hex

# Verify it was created
cat ~/ethereum/jwt.hex
```

### 1.4 Start Reth

```bash
# Create data directory
mkdir -p ~/ethereum/reth-data

# Start Reth with snap sync
reth node \
  --datadir ~/ethereum/reth-data \
  --http \
  --http.api "eth,net,web3" \
  --authrpc.jwtsecret ~/ethereum/jwt.hex \
  --authrpc.addr 127.0.0.1 \
  --authrpc.port 8551

# This will take 8-12 hours to sync
# Leave this terminal open or run in tmux/screen
```

**Reth sync progress indicators:**
- Watch for "Downloaded X headers" and "Executed X blocks"
- When you see "Canonical chain committed", you're making progress
- Full sync complete when you see blocks being processed in real-time every ~12 seconds

---

## Part 2: Install Lighthouse (Consensus Layer)

### 2.1 Visit Lighthouse's Official Site

Go to: **https://lighthouse-book.sigmaprime.io**

Or directly to releases: **https://github.com/sigp/lighthouse/releases**

### 2.2 Download Lighthouse Binary

```bash
cd ~/ethereum

# Download the latest release (check releases page for latest version)
# For Linux x86_64:
wget https://github.com/sigp/lighthouse/releases/download/v6.0.1/lighthouse-v6.0.1-x86_64-unknown-linux-gnu.tar.gz

# For macOS (ARM/M1/M2):
# wget https://github.com/sigp/lighthouse/releases/download/v6.0.1/lighthouse-v6.0.1-aarch64-apple-darwin.tar.gz

# Extract
tar -xzf lighthouse-*.tar.gz

# Make executable and move to PATH
chmod +x lighthouse
sudo mv lighthouse /usr/local/bin/

# Verify installation
lighthouse --version
```

### 2.3 Start Lighthouse with Checkpoint Sync

Open a **new terminal** (keep Reth running in the first one):

```bash
# Create data directory
mkdir -p ~/ethereum/lighthouse-data

# Start Lighthouse beacon node
lighthouse bn \
  --network mainnet \
  --datadir ~/ethereum/lighthouse-data \
  --http \
  --http-address 127.0.0.1 \
  --http-port 5052 \
  --execution-endpoint http://localhost:8551 \
  --execution-jwt ~/ethereum/jwt.hex \
  --checkpoint-sync-url https://beaconstate.info

# This will sync in 1-2 hours with checkpoint sync
```

**Lighthouse sync indicators:**
- "Syncing" with percentage shown
- "Synced" when complete
- Slot numbers updating every 12 seconds

---

## Part 3: Verify Everything is Working

### 3.1 Check Reth Status

```bash
# In a new terminal, check latest block
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq

# Should return current block number in hex
```

### 3.2 Check Lighthouse Status

```bash
# Check node syncing status
curl http://localhost:5052/eth/v1/node/syncing | jq

# Check the config endpoint (what you'll be modifying!)
curl http://localhost:5052/eth/v1/config/spec | jq | grep REORG

# Should show Lighthouse is running and serving API
```

### 3.3 Monitor Both Clients

**Reth logs to watch for:**
- `Canonical chain committed` - blocks being added
- `Stage: Execution` - processing transactions
- Block numbers increasing

**Lighthouse logs to watch for:**
- `INFO Synced` - checkpoint sync complete
- `INFO New block received` - receiving blocks from network
- Slot numbers progressing

---

## Part 4: Optional - Use Testnet Instead

If you want faster sync times for testing:

### For Reth (Holesky Testnet):
```bash
reth node \
  --chain holesky \
  --datadir ~/ethereum/reth-holesky \
  --http \
  --authrpc.jwtsecret ~/ethereum/jwt.hex
```

### For Lighthouse (Holesky Testnet):
```bash
lighthouse bn \
  --network holesky \
  --datadir ~/ethereum/lighthouse-holesky \
  --http \
  --execution-endpoint http://localhost:8551 \
  --execution-jwt ~/ethereum/jwt.hex \
  --checkpoint-sync-url https://holesky.beaconstate.info
```

---

## Troubleshooting

### "Cannot connect to execution endpoint"
- Make sure Reth is running first
- Check that JWT secret path is correct in both commands
- Verify port 8551 is not blocked

### "Checkpoint sync failed"
- Try a different checkpoint URL: `https://beaconstate.ethstaker.cc`
- Check your internet connection
- Make sure Reth has started syncing

### Reth sync is slow
- Normal! Takes 8-12 hours on good hardware/network
- Can take 24+ hours on slower setups
- Check disk I/O with `iostat -x 1` - should show activity

### Storage running out
- Reth needs ~500-600GB
- Lighthouse needs ~100GB
- Make sure you have enough space before starting

---

## Useful Commands

### Stop services gracefully
```bash
# Ctrl+C in each terminal
# Or if running in background, find PIDs:
ps aux | grep reth
ps aux | grep lighthouse
kill <PID>
```

### Check disk usage
```bash
du -sh ~/ethereum/reth-data
du -sh ~/ethereum/lighthouse-data
```

### Tail logs (if running in background)
```bash
tail -f ~/ethereum/reth.log
tail -f ~/ethereum/lighthouse.log
```

---

## Next Steps

Once both clients are synced:
1. Test the Beacon API: `curl http://localhost:5052/eth/v1/config/spec | jq`
2. Find the missing REORG parameters
3. Start working on your Lighthouse contribution!

---

## Resources

- **Reth Documentation**: https://reth.rs
- **Lighthouse Book**: https://lighthouse-book.sigmaprime.io
- **Beacon API Spec**: https://ethereum.github.io/beacon-APIs/
- **Consensus Specs**: https://github.com/ethereum/consensus-specs