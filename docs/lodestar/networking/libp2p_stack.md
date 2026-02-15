# libp2p Networking Stack Deep Dive

A comprehensive guide to understanding libp2p networking as used by Ethereum consensus clients, from TCP handshakes to application protocols.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [Layer 1: TCP Connection Establishment](#layer-1-tcp-connection-establishment)
3. [Layer 2: Noise XX Security Handshake](#layer-2-noise-xx-security-handshake)
4. [Layer 3: Multiplexing (mplex)](#layer-3-multiplexing-mplex)
5. [Layer 4: Multistream-Select](#layer-4-multistream-select)
6. [Layer 5: Identify Protocol](#layer-5-identify-protocol)
7. [Layer 6: Ethereum Application Protocols](#layer-6-ethereum-application-protocols)
8. [Complete Connection Lifecycle](#complete-connection-lifecycle)
9. [Defining Your Own Protocol](#defining-your-own-protocol)

---

## The Big Picture

### The Layer Cake

```
┌─────────────────────────────────────────────────────────────┐
│  ETHEREUM APPLICATION PROTOCOLS                             │
│  Status, Goodbye, BlocksByRange, LightClientBootstrap...    │
│  (SSZ + Snappy encoding, Ethereum-specific semantics)       │
├─────────────────────────────────────────────────────────────┤
│  MULTISTREAM-SELECT                          [libp2p]       │
│  "What protocol do we speak on this stream?"                │
├─────────────────────────────────────────────────────────────┤
│  MULTIPLEXER (mplex/yamux)                   [libp2p]       │
│  "Which stream does this data belong to?"                   │
├─────────────────────────────────────────────────────────────┤
│  NOISE XX                                    [libp2p]       │
│  "Encrypt everything, authenticate peers"                   │
├─────────────────────────────────────────────────────────────┤
│  TCP                                         [OS/Standard]  │
│  "Reliable, ordered byte stream"                            │
└─────────────────────────────────────────────────────────────┘
```

### What libp2p Provides

libp2p is a **networking framework** (not a single protocol) that spans multiple layers:

```
┌─────────────────────────────────────────────────────────────┐
│  libp2p gives you:                                          │
│    • Encrypted connections (Noise)                          │
│    • Multiplexed streams (mplex)                            │
│    • Protocol negotiation (multistream-select)              │
│    • Peer identity (PeerId)                                 │
│    • Peer discovery (discv5, DHT, etc.)                     │
│                                                             │
│  You build your application ON TOP of this stack.           │
└─────────────────────────────────────────────────────────────┘
```

### Notes: Key Insights

- libp2p doesn't fit neatly into OSI model — it spans multiple layers
- The term "protocol" is overloaded — be specific about which layer you mean
- Infrastructure protocols (TCP, Noise, mplex) = plumbing, set up once per connection
- Application protocols (Status, Goodbye) = your actual methods, one per stream

---

## Layer 1: TCP Connection Establishment

### What TCP Provides

TCP (Transmission Control Protocol) provides a **reliable, ordered byte stream** between two nodes.

### The Three-Way Handshake

**SYN = Synchronize** — it's about synchronizing sequence numbers.

```
┌──────────┐                                    ┌──────────┐
│  Node A  │                                    │  Node B  │
└──────────┘                                    └──────────┘
     │                                               │
     │  SYN: seq=100                                 │
     │  "I want to start. My sequence number        │
     │   begins at 100. Let's synchronize."         │
     │─────────────────────────────────────────────▶│
     │                                               │
     │  SYN-ACK: seq=300, ack=101                    │
     │  "Acknowledged your 100, expecting 101 next. │
     │   My sequence starts at 300."                │
     │◀─────────────────────────────────────────────│
     │                                               │
     │  ACK: ack=301                                 │
     │  "Acknowledged your 300, expecting 301."     │
     │─────────────────────────────────────────────▶│
     │                                               │
     │  ═══ CONNECTION ESTABLISHED ═══              │
```

### Why Sequence Numbers?

TCP doesn't magically make packets arrive in order. Packets arrive out of order constantly on the internet. TCP uses sequence numbers to detect this and reassemble correctly.

```
EXAMPLE: Packets arrive out of order

A sends:  [seq=100, "Hel"] [seq=103, "lo "] [seq=106, "Bob"]

Network delivers: [seq=106] then [seq=100] then [seq=103]

B uses sequence numbers to reassemble:
  seq=100: "Hel"
  seq=103: "lo "  
  seq=106: "Bob"
  Result: "Hello Bob"
```

### Notes: Key Insights

- SYN/ACK messages are NOT guaranteed — TCP retries on timeout
- Sequence numbers are HOW TCP provides ordering, not separate from it
- The "guarantee" means the application layer doesn't worry about packet loss — TCP handles retransmission

---

## Layer 2: Noise XX Security Handshake

### What Security Noise Provides

| Property | Meaning |
|----------|---------|
| **Confidentiality** | Nobody can read our messages |
| **Authenticity** | I know I'm talking to who I think I am |
| **Integrity** | Messages can't be tampered with |
| **Forward Secrecy** | If my long-term key is compromised later, past conversations are still safe |

### The Two Key Types

```
STATIC KEY (identity)
├── Your long-term identity key
├── Same key across all connections
├── Hash of static public key = PeerId (your node identity)
├── Purpose: AUTHENTICATION — proves WHO you are
└── If compromised: future sessions at risk, past sessions SAFE

EPHEMERAL KEY (session)
├── Generated fresh for THIS session only
├── Thrown away after handshake completes
├── Purpose: FORWARD SECRECY
└── If compromised: ONLY that one session is at risk
```

### Why Both Keys?

**Ephemeral only = No authentication (vulnerable to man-in-the-middle)**

```
The Attack:

  You ←── encrypted channel 1 ──→ ATTACKER ←── encrypted channel 2 ──→ Your Friend

The attacker:
  1. Intercepts your ephemeral public key
  2. Sends their own ephemeral public key back to you
  3. Opens separate connection to your friend
  4. Relays messages between you, reading/modifying everything

You have no way to verify WHO you're talking to because ephemeral keys are anonymous.
```

**Static key solves this:**

```
Your friend's static public key: 0x1234abcd... (their PeerId)

You already know this from discovery/ENR.

During handshake, they prove they have the corresponding private key.
If attacker intercepts, they can't produce your friend's static key.
You detect the attack and abort.
```

### The XX Pattern Name

Noise uses compact notation. Each letter describes what happens with static keys:

| Letter | Meaning |
|--------|---------|
| N | No static key (anonymous) |
| K | Static key is Known in advance |
| X | Static key is transmitted (eXchanged) during handshake |
| I | Static key is transmitted Immediately in first message |

**XX means:** Both sides transmit (X) their static public keys during the handshake.

### The XX Handshake Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        NOISE XX HANDSHAKE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INITIATOR (A)                         RESPONDER (B)            │
│                                                                 │
│  Has: ephemeral key pair               Has: ephemeral key pair  │
│       static key pair                       static key pair     │
│                                                                 │
│  MESSAGE 1: A → B                                               │
│  ════════════════════════════════════════════════════════════   │
│        A sends: ephemeral public key (cleartext)                │
│                                                                 │
│                                                                 │
│  MESSAGE 2: B → A                                               │
│  ════════════════════════════════════════════════════════════   │
│        B sends: ephemeral public key (cleartext)                │
│                 static public key (ENCRYPTED)                   │
│                                                                 │
│        Both compute: DH(ephemeral_A, ephemeral_B) = shared_1    │
│        Both compute: DH(ephemeral_A, static_B) = shared_2       │
│                                                                 │
│                                                                 │
│  MESSAGE 3: A → B                                               │
│  ════════════════════════════════════════════════════════════   │
│        A sends: static public key (ENCRYPTED)                   │
│                                                                 │
│        Both compute: DH(static_A, ephemeral_B) = shared_3       │
│                                                                 │
│                                                                 │
│  HANDSHAKE COMPLETE                                             │
│  ════════════════════════════════════════════════════════════   │
│  Both sides now have:                                           │
│    • Shared encryption keys (derived from shared_1 + 2 + 3)     │
│    • Each other's verified static (identity) keys               │
│    • Forward secrecy (ephemeral keys will be deleted)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Diffie-Hellman (DH) in One Sentence

Two parties each have a private key, send each other public keys, and both compute the SAME shared secret without ever transmitting it.

### One-Paragraph Summary

> XX Noise is an encryption scheme where each party has a static key and an ephemeral key. After the setup, both parties will have a shared secret to encrypt with, where only the two parties can talk to each other. In addition, this scheme is such that if you lose your static private key, only future messages are not secure, and if you lose your ephemeral private key, only that session is compromised.

### Notes: Key Insights

- "Cleartext" just means unencrypted — public keys in cleartext is fine since they're designed to be shared
- Static keys ARE encrypted during transmission (sent after DH is established) to hide identity from passive observers
- PeerId = multihash(static_public_key) — never derived from ephemeral key
- Encryption (hide content) is different from signing (prove authorship)
- DH is key agreement, not direct encryption — the DH output becomes a symmetric key for actual encryption

---

## Layer 3: Multiplexing (mplex)

### The Problem Without Multiplexing

```
You want to communicate with one peer using 5 different protocols:
  - Status
  - Goodbye  
  - BlocksByRange
  - LightClientBootstrap
  - Ping

WITHOUT MULTIPLEXING:
  5 TCP connections
  5 Noise handshakes
  5× the latency and resources
  
  Multiply by 100 peers = 500 connections!
```

### With Multiplexing

```
ONE TCP connection to a peer
  └── ONE Noise session (encrypted)
       └── ONE multiplexer (mplex)
            ├── Stream 1: Status
            ├── Stream 2: Goodbye
            ├── Stream 3: BlocksByRange
            ├── Stream 4: LightClientBootstrap
            └── Stream 5: Ping

All protocols share the same TCP + Noise infrastructure.
```

### What Is A Stream?

A stream is a **virtual connection inside the real connection**.

```
ANALOGY: Apartment building

TCP Connection = The building (one address: 192.168.1.5:9000)
Streams        = Individual apartments (numbered units inside)

Mail arrives at the building:
  "Apartment 1" → goes to Status protocol handler
  "Apartment 3" → goes to BlocksByRange protocol handler
```

### How Multiplexing Works

The multiplexer adds a small header to every chunk of data:

```
WITHOUT MULTIPLEXING:
  Bytes on wire: [data][data][data]
  Problem: Which protocol does each byte belong to?

WITH MULTIPLEXING:
  Bytes on wire: [header|data][header|data][header|data]
                    │             │             │
                    │             │             └── stream 3 data
                    │             └── stream 1 data
                    └── stream 3 data

  The header says "these bytes belong to stream N"
```

### Stream Lifecycle

```
Node A                                          Node B
  │                                               │
  │  mplex: NewStream (stream=5)                  │
  │────────────────────────────────────────────▶  │
  │  "I'm creating stream 5"                      │
  │                                               │
  │  mplex: Message (stream=5, data)              │
  │────────────────────────────────────────────▶  │
  │  "Data for stream 5"                          │
  │                                               │
  │  mplex: Message (stream=5, response)          │
  │◀────────────────────────────────────────────  │
  │  "Response on stream 5"                       │
  │                                               │
  │  mplex: Close (stream=5)                      │
  │────────────────────────────────────────────▶  │
  │  "I'm done with stream 5"                     │
  │                                               │
  │  mplex: Close (stream=5)                      │
  │◀────────────────────────────────────────────  │
  │  "Me too"                                     │
  │                                               │
  │  Stream 5 is fully closed.                    │
  │  Stream ID can be reused. Memory freed.       │
```

### Half-Close

A stream can be half-closed — one side done sending, other side still sending.

```
Useful for req/resp:
  A sends request, closes send side ("I'm done asking")
  B sends response, closes send side ("I'm done answering")
  Stream fully closed.
```

### Notes: Key Insights

- Streams are cheap — just a number and some bookkeeping
- Stream ID is how multiplexer routes bytes to correct handler
- Closing streams frees the ID and memory on both sides
- GossipSub and req/resp SHARE the same TCP + Noise + mplex infrastructure

---

## Layer 4: Multistream-Select

### The Problem

You opened a new stream. It's just a blank pipe. How does the other side know what protocol you want to speak?

### The Solution

Multistream-select is a simple text-based negotiation at the start of every stream.

```
Node A                                          Node B
  │                                               │
  │  [Stream opened, empty pipe]                  │
  │                                               │
  │  "/multistream/1.0.0\n"                       │
  │────────────────────────────────────────────▶  │
  │  "I speak multistream-select 1.0.0"           │
  │                                               │
  │  "/multistream/1.0.0\n"                       │
  │◀────────────────────────────────────────────  │
  │  "Me too"                                     │
  │                                               │
  │  "/eth2/beacon_chain/req/status/2/ssz_snappy\n"
  │────────────────────────────────────────────▶  │
  │  "I want to speak Status protocol"            │
  │                                               │
  │  "/eth2/beacon_chain/req/status/2/ssz_snappy\n"
  │◀────────────────────────────────────────────  │
  │  "OK, agreed" (echo = agreement)              │
  │                                               │
  │  ═══ Now send actual Status data ═══          │
```

### What If Protocol Not Supported?

```
  │  "/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy\n"
  │────────────────────────────────────────────▶  │
  │                                               │
  │  "na\n"                                       │
  │◀────────────────────────────────────────────  │
  │  "Not available"                              │
```

### Identify vs Multistream-Select

| Purpose | When | What it tells you |
|---------|------|-------------------|
| **Identify** | Once per connection | "Here's EVERYTHING I support" — for planning |
| **Multistream-Select** | Every stream | "On THIS stream, let's speak THIS protocol" — for confirmation |

### Notes: Key Insights

- Multistream-select = version agreement + application protocol agreement
- Echo back = agreement, "na\n" = not available
- Even if Identify said they support it, you confirm per-stream

---

## Layer 5: Identify Protocol

### What Is Identify?

A libp2p protocol (not Ethereum-specific) that lets nodes exchange metadata right after connecting.

**Protocol ID:** `/ipfs/id/1.0.0`

### Why Do We Need It?

After connecting, you know:
- Their IP address and port
- Their PeerId (from Noise handshake)

You DON'T know:
- What software are they running?
- What protocols do they support?
- What other addresses can they be reached at?

### Identify Message Contents

```
Identify {
  protocolVersion: "eth2/1.0.0"
  agentVersion:    "Lighthouse/v4.5.0"
  publicKey:       <static public key bytes>
  listenAddrs:     ["/ip4/203.0.113.50/tcp/9000", ...]
  observedAddr:    "/ip4/198.51.100.23/tcp/45678"  // Your address from their perspective
  protocols:       [
    "/ipfs/id/1.0.0",
    "/eth2/beacon_chain/req/status/2/ssz_snappy",
    "/eth2/beacon_chain/req/goodbye/1/ssz_snappy",
    "/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy",
    "/meshsub/1.1.0",
    ...
  ]
}
```

### The Protocols List

This is critical — it tells you what the peer supports BEFORE you try to use it.

```
EXAMPLE: You're a light client

Their protocols list:
  ✓ /eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy

"Great, they support light client! I can request from them."

OR their list doesn't include it:

"They don't support light client. I won't bother asking."
```

### How To Tell Req/Resp vs GossipSub

```
REQ/RESP:
  /eth2/beacon_chain/req/status/2/ssz_snappy
                     ^^^
                     "req" in the path

GOSSIPSUB:
  /meshsub/1.1.0
  
  This is the GossipSub PROTOCOL itself.
  Topics are subscribed WITHIN GossipSub, not listed here.
```

### Notes: Key Insights

- Address format is "multiaddr": `/ip4/203.0.113.50/tcp/9000` — includes port
- `observedAddr` is for NAT traversal — peer tells you how they see you
- You only need bootnode ports upfront; other peers tell you their ports
- Protobuf encoding is like JSON but binary, compact, and faster

---

## Layer 6: Ethereum Application Protocols

### What Are Application Protocols?

These are the actual methods you call. Each one gets its own stream.

```
Ethereum req/resp methods:
  • Status
  • Goodbye
  • BeaconBlocksByRange
  • BeaconBlocksByRoot
  • LightClientBootstrap
  • LightClientUpdatesByRange
  • LightClientFinalityUpdate
  • LightClientOptimisticUpdate
  • Ping
  • Metadata
```

### Protocol ID Structure

```
/eth2/beacon_chain/req/{method_name}/{version}/{encoding}

Example:
/eth2/beacon_chain/req/status/2/ssz_snappy
                       ^^^^^^ ^ ^^^^^^^^^^
                       method │ encoding (SSZ + Snappy compression)
                              │
                              version
```

### Req/Resp Is Simple!

```
1. Open stream
2. Negotiate protocol via multistream-select
3. Send ONE request
4. Receive ONE response (or stream of responses for some methods)
5. Close stream

The stream opener is always the REQUESTER.
The other side is always the RESPONDER.
That's it.
```

### Response Wire Format

```
┌──────────────┬─────────────────┬────────────────────────┐
│ result_code  │ context_bytes   │ payload                │
│ (1 byte)     │ (4 bytes)       │ (SSZ + Snappy)         │
└──────────────┴─────────────────┴────────────────────────┘

result_code:
  0x00 = SUCCESS
  0x01 = INVALID_REQUEST
  0x02 = SERVER_ERROR
  0x03 = RESOURCE_UNAVAILABLE

context_bytes:
  fork_digest (so receiver knows which SSZ schema to use)
```

### Status Protocol

**Purpose:** First Ethereum protocol after Identify. Both nodes exchange chain state to verify compatibility.

**Protocol ID:** `/eth2/beacon_chain/req/status/2/ssz_snappy`

```
StatusMessage {
  fork_digest:      4 bytes    // Which fork/network
  finalized_root:   32 bytes   // Hash of finalized checkpoint
  finalized_epoch:  8 bytes    // Epoch of finalized checkpoint
  head_root:        32 bytes   // Hash of current head block
  head_slot:        8 bytes    // Slot of current head
}
```

**Validation after receiving Status:**

| Check | Pass | Fail |
|-------|------|------|
| Same fork_digest? | Same network ✓ | Wrong network → Goodbye(IRRELEVANT_NETWORK) |
| Compatible finalized checkpoint? | Chain history agrees ✓ | Conflict → disconnect |
| Useful peer? | They have data I need ✓ | Too far behind → maybe disconnect |

### Goodbye Protocol

**Purpose:** Polite disconnect — tell the other node WHY you're leaving.

**Protocol ID:** `/eth2/beacon_chain/req/goodbye/1/ssz_snappy`

| Code | Meaning |
|------|---------|
| 1 | Client shutdown |
| 2 | Irrelevant network |
| 3 | Fault/error |
| 128 | Unable to verify network |
| 129 | Too many peers |
| 250 | Bad score |
| 251 | Banned |

**Goodbye is fire-and-forget** — you send it and immediately close, don't wait for response.

### Peer Scoring

Application protocols are just agreed rules — nothing technically enforces them. Peer scoring handles misbehavior.

```
┌─────────────────────────────────────────────────────────┐
│  Peer B's Score                                         │
│  ─────────────────────────────────────────────────────  │
│  Starting score:           100                          │
│  Sent invalid message:     -10                          │
│  Timed out on request:     -5                           │
│  Sent useful block:        +1                           │
│  Current score:            86                           │
│                                                         │
│  If score drops below threshold → Goodbye + disconnect  │
└─────────────────────────────────────────────────────────┘
```

### Notes: Key Insights

- Application protocols are promises — peer scoring tracks who keeps promises
- We operate on premises to move forward; we need peers who keep their promises
- Ethereum keeps req/resp stateless per-stream intentionally — makes scoring simple
- Status is MANDATORY before any other Ethereum protocol

---

## Complete Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONNECTION LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TCP HANDSHAKE                                                │
│     SYN → SYN-ACK → ACK                                          │
│     (Connection initiator sends SYN first)                       │
│                                                                  │
│  2. NOISE XX HANDSHAKE                                           │
│     Exchange ephemeral keys → Exchange static keys               │
│     Result: Encrypted channel + mutual authentication            │
│                                                                  │
│  3. MULTIPLEXER READY                                            │
│     mplex is now active on the encrypted connection              │
│     Both sides can open streams                                  │
│                                                                  │
│  4. IDENTIFY (libp2p, automatic)                                 │
│     Exchange metadata, supported protocols                       │
│                                                                  │
│  5. STATUS (Ethereum, required)                                  │
│     Exchange chain state, verify same network                    │
│     If incompatible → Goodbye and disconnect                     │
│                                                                  │
│  6. CONNECTED LIFE (minutes/hours/days)                          │
│     Many streams opened and closed:                              │
│       - Ping/Pong                                                │
│       - BlocksByRange requests                                   │
│       - LightClientBootstrap requests                            │
│       - GossipSub messages                                       │
│                                                                  │
│  7. GOODBYE (polite)                                             │
│     "I'm disconnecting because X"                                │
│                                                                  │
│  8. TCP CLOSE                                                    │
│     FIN → FIN-ACK                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Connection Initiator vs Stream Initiator

These are TWO SEPARATE concepts:

```
CONNECTION LEVEL:
  Someone sends SYN first → CONNECTION INITIATOR
  Happens ONCE when nodes first connect.

STREAM LEVEL:
  Someone opens a stream first → STREAM INITIATOR (requester)
  Happens MANY times per connection.
  
  BOTH sides can open streams!
  
  Example:
    Node A initiated the connection.
    Stream 1: opened by A (A is requester)
    Stream 2: opened by B (B is requester)  ← B can open streams too!
    Stream 3: opened by A (A is requester)
```

**Per-stream, it IS client-server.** The P2P part is that BOTH nodes can be clients AND servers simultaneously on different streams.

---

## Defining Your Own Protocol

### Registering a Handler (Responder Side)

```javascript
// When someone opens a stream and negotiates this protocol,
// libp2p calls your handler

node.handle('/my-protocol/1.0.0', async ({ stream, connection }) => {
  // You are the RESPONDER
  // Someone else opened a stream to you
  
  const request = await readFromStream(stream);
  const response = processRequest(request);
  await writeToStream(stream, response);
  await stream.close();
});
```

### Making a Request (Initiator Side)

```javascript
// YOU open a stream to someone else

async function makeRequest(peer) {
  // You are the INITIATOR
  
  const stream = await node.dialProtocol(peer, '/my-protocol/1.0.0');
  // This:
  //   1. Connects to peer (if not already connected)
  //   2. Opens a new mplex stream
  //   3. Does multistream-select negotiation
  //   4. Returns the stream for you to use
  
  await writeToStream(stream, myRequest);
  const response = await readFromStream(stream);
  await stream.close();
  
  return response;
}
```

### Both Sides Need Both

A real node registers handlers AND makes outgoing requests:

```
┌─────────────────────────────────────────────────────────────┐
│  Node A                                                     │
│                                                             │
│  Registered handlers (responder role):                      │
│    /eth2/.../status         → handleStatusRequest()         │
│    /eth2/.../goodbye        → handleGoodbye()               │
│    /eth2/.../blocks_by_range → handleBlocksByRange()        │
│                                                             │
│  Can also dial (initiator role):                            │
│    dialProtocol(peerB, '/eth2/.../status')                  │
│    dialProtocol(peerC, '/eth2/.../blocks_by_range')         │
│                                                             │
│  Node A can be requester on some streams and responder      │
│  on others, all at the same time!                           │
└─────────────────────────────────────────────────────────────┘
```

### State Management

libp2p gives you stateless streams. If you need state, YOU manage it:

```javascript
const peerState = new Map();  // Your application state

node.handle('/my-protocol/1.0.0', async ({ stream, connection }) => {
  const peerId = connection.remotePeer.toString();
  
  // Get or create state for this peer
  if (!peerState.has(peerId)) {
    peerState.set(peerId, { /* initial state */ });
  }
  
  const state = peerState.get(peerId);
  // Update state based on messages...
});
```

---

## Quick Reference

### Protocol Layers Summary

| Layer | What | Who Defines |
|-------|------|-------------|
| TCP | Reliable byte stream | OS/Standard |
| Noise XX | Encryption + authentication | libp2p |
| mplex | Stream multiplexing | libp2p |
| multistream-select | Protocol negotiation | libp2p |
| Identify | Metadata exchange | libp2p |
| Status, Goodbye, etc. | Ethereum methods | Ethereum |

### Key Terminology

| Term | Meaning |
|------|---------|
| PeerId | Hash of static public key — node identity |
| Stream | Virtual connection inside TCP connection |
| Connection initiator | Who sent TCP SYN |
| Stream initiator | Who opened the stream (= requester) |
| Forward secrecy | Past messages safe even if keys leak later |
| Multiaddr | Address format: `/ip4/1.2.3.4/tcp/9000` |

### Encoding vs Encryption

| Concept | Purpose | Examples |
|---------|---------|----------|
| Encoding | Structure data as bytes | Protobuf, SSZ, JSON |
| Encryption | Hide data from eavesdroppers | Noise (uses keys from DH) |

Both happen: encode first, then encrypt.

---

## What We Didn't Cover (For Later)

- GossipSub (pub/sub protocol for block/attestation propagation)
- Discovery (discv5, how nodes find each other)
- ENR (Ethereum Node Records)
- Detailed mplex frame format
- Detailed Noise cryptographic operations
- SSZ encoding specifics