
================================================================================
// FILE: __tests__/blsSignatures.test.ts
================================================================================

/**
 * Unit tests for BLS signature functions
 * Tests BLS12-381 signature generation, verification, and aggregation
 */

import {
  generateBLSKeyPair,
  generateBLSSignature,
  verifyBLSSignature,
  aggregateBLSSignatures
} from '../utils/cryptoUtils';

describe('BLS Signatures (BLS12-381)', () => {
  describe('Key Generation', () => {
    it('should generate a valid BLS key pair', () => {
      const keyPair = generateBLSKeyPair();
      
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(typeof keyPair.privateKey).toBe('string');
      expect(typeof keyPair.publicKey).toBe('string');
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
    });

    it('should generate different key pairs each time', () => {
      const keyPair1 = generateBLSKeyPair();
      const keyPair2 = generateBLSKeyPair();
      
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe('Single Signature', () => {
    it('should sign and verify a message with string input', () => {
      const keyPair = generateBLSKeyPair();
      const message = 'Hello, Ethereum!';
      
      const signature = generateBLSSignature(message, keyPair.privateKey);
      const isValid = verifyBLSSignature(message, signature, keyPair.publicKey);
      
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(isValid).toBe(true);
    });

    it('should sign and verify a message with Uint8Array input', () => {
      const keyPair = generateBLSKeyPair();
      const message = new Uint8Array([1, 2, 3, 4, 5]);
      
      const signature = generateBLSSignature(message, keyPair.privateKey);
      const isValid = verifyBLSSignature(message, signature, keyPair.publicKey);
      
      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong public key', () => {
      const keyPair1 = generateBLSKeyPair();
      const keyPair2 = generateBLSKeyPair();
      const message = 'Test message';
      
      const signature = generateBLSSignature(message, keyPair1.privateKey);
      const isValid = verifyBLSSignature(message, signature, keyPair2.publicKey);
      
      expect(isValid).toBe(false);
    });

    it('should fail verification with modified message', () => {
      const keyPair = generateBLSKeyPair();
      const originalMessage = 'Original message';
      const modifiedMessage = 'Modified message';
      
      const signature = generateBLSSignature(originalMessage, keyPair.privateKey);
      const isValid = verifyBLSSignature(modifiedMessage, signature, keyPair.publicKey);
      
      expect(isValid).toBe(false);
    });

    it('should be deterministic - same message and key produce same signature', () => {
      const keyPair = generateBLSKeyPair();
      const message = 'Deterministic test';
      
      const signature1 = generateBLSSignature(message, keyPair.privateKey);
      const signature2 = generateBLSSignature(message, keyPair.privateKey);
      
      expect(signature1).toBe(signature2);
    });
  });

  describe('Signature Aggregation', () => {
    it('should aggregate multiple signatures into one', () => {
      const message = 'Common message for all validators';
      
      // Create 3 validators
      const validator1 = generateBLSKeyPair();
      const validator2 = generateBLSKeyPair();
      const validator3 = generateBLSKeyPair();
      
      // Each validator signs the same message
      const sig1 = generateBLSSignature(message, validator1.privateKey);
      const sig2 = generateBLSSignature(message, validator2.privateKey);
      const sig3 = generateBLSSignature(message, validator3.privateKey);
      
      // Aggregate the signatures
      const aggregatedSig = aggregateBLSSignatures([sig1, sig2, sig3]);
      
      expect(aggregatedSig).toBeDefined();
      expect(typeof aggregatedSig).toBe('string');
      // Aggregated signature should be different from individual signatures
      expect(aggregatedSig).not.toBe(sig1);
      expect(aggregatedSig).not.toBe(sig2);
      expect(aggregatedSig).not.toBe(sig3);
    });

    it('should handle single signature aggregation', () => {
      const keyPair = generateBLSKeyPair();
      const message = 'Single signature';
      
      const signature = generateBLSSignature(message, keyPair.privateKey);
      const aggregated = aggregateBLSSignatures([signature]);
      
      // Single signature aggregation should return the same signature
      expect(aggregated).toBe(signature);
      
      // Should still verify correctly
      const isValid = verifyBLSSignature(message, aggregated, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should throw error when aggregating empty array', () => {
      expect(() => {
        aggregateBLSSignatures([]);
      }).toThrow('Cannot aggregate empty signature array');
    });
  });
});


================================================================================
// FILE: __tests__/core/blockchainTree.test.ts
================================================================================

/**
 * Unit tests for BlockchainTree class
 * Tests tree structure, block addition, chain retrieval, and fork handling
 */

import { BlockchainTree, BlockTreeNode } from '../../core/blockchain/blockchainTree';
import { Block } from '../../types/types';

describe('BlockchainTree', () => {
  let tree: BlockchainTree;

  /**
   * Helper to create a simple block
   */
  function createBlock(hash: string, parentHash: string, height: number, slot: number = 0): Block {
    return {
      hash,
      header: {
        transactionHash: '',
        timestamp: Date.now(),
        previousHeaderHash: parentHash,
        height,
        slot,
      },
      transactions: [],
      attestations: [],
      randaoReveal: 'test-randao',
    };
  }

  beforeEach(() => {
    tree = new BlockchainTree();
  });

  describe('addBlock', () => {
    it('should add genesis block as root', () => {
      // Given: Genesis block
      const genesis = createBlock('genesis', '', 0);
      
      // When: Add genesis
      const node = tree.addBlock(genesis);
      
      // Then: Should be added as root
      expect(node).not.toBeNull();
      expect(node?.hash).toBe('genesis');
      expect(node?.parent).toBeNull();
      expect(tree.getRoot()).toBe(node);
    });

    it('should add child block to parent', () => {
      // Given: Genesis and child block
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      
      tree.addBlock(genesis);
      
      // When: Add child
      const nodeA = tree.addBlock(blockA);
      
      // Then: Should be added as child of genesis
      expect(nodeA).not.toBeNull();
      expect(nodeA?.parent?.hash).toBe('genesis');
      expect(tree.getRoot()?.children).toContain(nodeA);
    });

    it('should reject block if parent not found', () => {
      // Given: Block with unknown parent
      const blockA = createBlock('blockA', 'unknownParent', 1);
      
      // When: Try to add block
      const node = tree.addBlock(blockA);
      
      // Then: Should return null
      expect(node).toBeNull();
      expect(tree.getNode('blockA')).toBeUndefined();
    });

    it('should reject duplicate block', () => {
      // Given: Block already in tree
      const genesis = createBlock('genesis', '', 0);
      tree.addBlock(genesis);
      
      // When: Try to add same block again
      const node = tree.addBlock(genesis);
      
      // Then: Should return null
      expect(node).toBeNull();
    });

    it('should handle fork creation', () => {
      // Given: Genesis and two children (fork)
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'genesis', 1);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      
      // When: Add second child (creates fork)
      const nodeB = tree.addBlock(blockB);
      
      // Then: Both should be children of genesis
      expect(nodeB).not.toBeNull();
      expect(tree.getRoot()?.children.length).toBe(2);
      expect(tree.getRoot()?.children.map(c => c.hash)).toContain('blockA');
      expect(tree.getRoot()?.children.map(c => c.hash)).toContain('blockB');
    });

    it('should update leaves correctly', () => {
      // Given: Chain of blocks
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      
      tree.addBlock(genesis);
      
      // When: Add blockA
      tree.addBlock(blockA);
      
      // Then: Genesis should no longer be a leaf
      const leaves1 = tree.getLeaves();
      expect(leaves1.map(l => l.hash)).not.toContain('genesis');
      expect(leaves1.map(l => l.hash)).toContain('blockA');
      
      // When: Add blockB
      tree.addBlock(blockB);
      
      // Then: blockA should no longer be a leaf
      const leaves2 = tree.getLeaves();
      expect(leaves2.map(l => l.hash)).not.toContain('blockA');
      expect(leaves2.map(l => l.hash)).toContain('blockB');
    });
  });

  describe('getChain', () => {
    it('should return chain from genesis to specified block', () => {
      // Given: Chain genesis -> A -> B -> C
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      const blockC = createBlock('blockC', 'blockB', 3);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      tree.addBlock(blockB);
      tree.addBlock(blockC);
      
      // When: Get chain to blockC
      const chain = tree.getChain('blockC');
      
      // Then: Should return all blocks in order
      expect(chain.length).toBe(4);
      expect(chain.map(b => b.hash)).toEqual(['genesis', 'blockA', 'blockB', 'blockC']);
    });

    it('should return empty chain for non-existent block', () => {
      // Given: Tree with genesis
      const genesis = createBlock('genesis', '', 0);
      tree.addBlock(genesis);
      
      // When: Get chain for non-existent block
      const chain = tree.getChain('unknownBlock');
      
      // Then: Should return empty array
      expect(chain).toEqual([]);
    });

    it('should return only genesis for genesis block', () => {
      // Given: Tree with only genesis
      const genesis = createBlock('genesis', '', 0);
      tree.addBlock(genesis);
      
      // When: Get chain for genesis
      const chain = tree.getChain('genesis');
      
      // Then: Should return only genesis
      expect(chain.length).toBe(1);
      expect(chain[0].hash).toBe('genesis');
    });
  });

  describe('getNode', () => {
    it('should retrieve node by hash', () => {
      // Given: Tree with blocks
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      
      // When: Get node by hash
      const node = tree.getNode('blockA');
      
      // Then: Should return correct node
      expect(node).not.toBeUndefined();
      expect(node?.hash).toBe('blockA');
      expect(node?.block.hash).toBe('blockA');
    });

    it('should return undefined for non-existent hash', () => {
      // Given: Tree with genesis
      const genesis = createBlock('genesis', '', 0);
      tree.addBlock(genesis);
      
      // When: Get non-existent node
      const node = tree.getNode('unknownBlock');
      
      // Then: Should return undefined
      expect(node).toBeUndefined();
    });
  });

  describe('getRoot', () => {
    it('should return null for empty tree', () => {
      // Given: Empty tree
      
      // When: Get root
      const root = tree.getRoot();
      
      // Then: Should return null
      expect(root).toBeNull();
    });

    it('should return genesis block as root', () => {
      // Given: Tree with genesis
      const genesis = createBlock('genesis', '', 0);
      tree.addBlock(genesis);
      
      // When: Get root
      const root = tree.getRoot();
      
      // Then: Should return genesis
      expect(root).not.toBeNull();
      expect(root?.hash).toBe('genesis');
    });
  });

  describe('getAllNodes', () => {
    it('should return all nodes in tree', () => {
      // Given: Tree with multiple blocks
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      tree.addBlock(blockB);
      
      // When: Get all nodes
      const nodes = tree.getAllNodes();
      
      // Then: Should return all 3 nodes
      expect(nodes.length).toBe(3);
      expect(nodes.map(n => n.hash).sort()).toEqual(['blockA', 'blockB', 'genesis']);
    });

    it('should return empty array for empty tree', () => {
      // Given: Empty tree
      
      // When: Get all nodes
      const nodes = tree.getAllNodes();
      
      // Then: Should return empty array
      expect(nodes).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics for linear chain', () => {
      // Given: Linear chain with 4 blocks
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      const blockC = createBlock('blockC', 'blockB', 3);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      tree.addBlock(blockB);
      tree.addBlock(blockC);
      
      // When: Get stats
      const stats = tree.getStats();
      
      // Then: Should return correct counts
      expect(stats.totalBlocks).toBe(4);
      expect(stats.numberOfLeaves).toBe(1);
      // numberOfForks = leaves - 1 (for linear chain, 1 - 1 = 0)
      expect(stats.numberOfForks).toBe(0);
    });

    it('should return correct statistics for forked tree', () => {
      // Given: Tree with fork
      //     genesis
      //        |
      //        A
      //       / \
      //      B   C
      //          |
      //          D
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      const blockC = createBlock('blockC', 'blockA', 2);
      const blockD = createBlock('blockD', 'blockC', 3);
      
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      tree.addBlock(blockB);
      tree.addBlock(blockC);
      tree.addBlock(blockD);
      
      // When: Get stats
      const stats = tree.getStats();
      
      // Then: Should return correct counts
      expect(stats.totalBlocks).toBe(5);
      expect(stats.numberOfLeaves).toBe(2); // B and D
      expect(stats.numberOfForks).toBe(1); // 2 leaves - 1 = 1 fork
    });
  });

  describe('Integration: Complex tree operations', () => {
    it('should handle complex fork scenario with multiple branches', () => {
      // Given: Complex tree structure
      //         genesis
      //            |
      //            A
      //          / | \
      //         B  C  D
      //        /      |
      //       E       F
      
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      const blockC = createBlock('blockC', 'blockA', 2);
      const blockD = createBlock('blockD', 'blockA', 2);
      const blockE = createBlock('blockE', 'blockB', 3);
      const blockF = createBlock('blockF', 'blockD', 3);
      
      // When: Build tree
      tree.addBlock(genesis);
      tree.addBlock(blockA);
      tree.addBlock(blockB);
      tree.addBlock(blockC);
      tree.addBlock(blockD);
      tree.addBlock(blockE);
      tree.addBlock(blockF);
      
      // Then: Verify structure
      expect(tree.getAllNodes().length).toBe(7);
      expect(tree.getLeaves().length).toBe(3); // C, E, F
      expect(tree.getLeaves().map(l => l.hash).sort()).toEqual(['blockC', 'blockE', 'blockF']);
      
      // Verify chains
      const chainE = tree.getChain('blockE');
      expect(chainE.map(b => b.hash)).toEqual(['genesis', 'blockA', 'blockB', 'blockE']);
      
      const chainF = tree.getChain('blockF');
      expect(chainF.map(b => b.hash)).toEqual(['genesis', 'blockA', 'blockD', 'blockF']);
      
      // Verify parent-child relationships
      const nodeA = tree.getNode('blockA');
      expect(nodeA?.children.length).toBe(3);
      expect(nodeA?.children.map(c => c.hash).sort()).toEqual(['blockB', 'blockC', 'blockD']);
    });

    it('should maintain tree integrity when adding blocks out of order', () => {
      // Given: Blocks added in non-sequential order
      const genesis = createBlock('genesis', '', 0);
      const blockA = createBlock('blockA', 'genesis', 1);
      const blockB = createBlock('blockB', 'blockA', 2);
      const blockC = createBlock('blockC', 'blockB', 3);
      
      // When: Add in order: genesis, C (fails), B, A, C (succeeds)
      tree.addBlock(genesis);
      
      const nodeC1 = tree.addBlock(blockC); // Should fail - parent not found
      expect(nodeC1).toBeNull();
      
      const nodeB1 = tree.addBlock(blockB); // Should fail - parent not found
      expect(nodeB1).toBeNull();
      
      const nodeA = tree.addBlock(blockA); // Should succeed
      expect(nodeA).not.toBeNull();
      
      const nodeB2 = tree.addBlock(blockB); // Should succeed now
      expect(nodeB2).not.toBeNull();
      
      const nodeC2 = tree.addBlock(blockC); // Should succeed now
      expect(nodeC2).not.toBeNull();
      
      // Then: Tree should be correct
      expect(tree.getAllNodes().length).toBe(4);
      const chain = tree.getChain('blockC');
      expect(chain.map(b => b.hash)).toEqual(['genesis', 'blockA', 'blockB', 'blockC']);
    });
  });
});


================================================================================
// FILE: __tests__/core/casperFFG.test.ts
================================================================================

/**
 * Unit tests for CasperFFG class
 * Tests checkpoint computation for Casper FFG finality
 */

import { CasperFFG } from '../../core/consensus/casperFFG';
import { Block } from '../../types/types';
import { SimulatorConfig } from '../../config/config';

describe('CasperFFG', () => {
  
  /**
   * Helper to create a test block
   */
  function createBlock(hash: string, slot: number, height: number): Block {
    return {
      hash,
      header: {
        transactionHash: '',
        timestamp: Date.now(),
        previousHeaderHash: '',
        height,
        slot,
      },
      transactions: [],
      attestations: [],
      randaoReveal: 'test-randao',
    };
  }
  
  describe('computeCheckpoints', () => {
    it('should compute checkpoints for slot in middle of epoch', () => {
      // Given: SLOTS_PER_EPOCH = 4, current slot = 6 (epoch 1)
      // Target epoch = 1 (checkpoint slot 4), Source = justified checkpoint
      const canonicalChain = [
        createBlock('genesis', -1, 0),
        createBlock('block1', 0, 1),
        createBlock('block2', 2, 2),
        createBlock('block3', 4, 3),
        createBlock('block4', 6, 4),
      ];
      
      const mockBeaconState = {
        justifiedCheckpoint: { epoch: 0, root: 'block1' }
      };
      
      // When: Compute checkpoints for slot 6
      const checkpoints = CasperFFG.computeCheckpoints(6, canonicalChain, mockBeaconState);
      
      // Then: Source = justified checkpoint, Target = epoch 1 (block at slot 4)
      expect(checkpoints.source.epoch).toBe(0);
      expect(checkpoints.source.root).toBe('block1'); // Justified checkpoint
      expect(checkpoints.target.epoch).toBe(1);
      expect(checkpoints.target.root).toBe('block3'); // Slot 4
    });
    
    it('should handle empty checkpoint slots by using previous block', () => {
      // Given: Checkpoint slot 4 is empty, use block at slot 3
      const canonicalChain = [
        createBlock('genesis', -1, 0),
        createBlock('block1', 0, 1),
        createBlock('block2', 3, 2), // Slot 3 (before checkpoint 4)
        createBlock('block3', 6, 3),
      ];
      
      const mockBeaconState = {
        justifiedCheckpoint: { epoch: 0, root: 'block1' }
      };
      
      // When: Compute checkpoints for slot 6 (epoch 1, checkpoint slot 4)
      const checkpoints = CasperFFG.computeCheckpoints(6, canonicalChain, mockBeaconState);
      
      // Then: Target should use block at slot 3 (closest before checkpoint 4)
      expect(checkpoints.target.epoch).toBe(1);
      expect(checkpoints.target.root).toBe('block2'); // Slot 3 < checkpoint 4
    });
    
    it('should handle epoch 0 with source = epoch 0', () => {
      // Given: Current slot = 2 (epoch 0)
      const canonicalChain = [
        createBlock('genesis', -1, 0),
        createBlock('block1', 0, 1),
        createBlock('block2', 2, 2),
      ];
      
      const mockBeaconState = {
        justifiedCheckpoint: { epoch: -1, root: null }
      };
      
      // When: Compute checkpoints for slot 2
      const checkpoints = CasperFFG.computeCheckpoints(2, canonicalChain, mockBeaconState);
      
      // Then: Both source and target should be epoch 0
      expect(checkpoints.source.epoch).toBe(0);
      expect(checkpoints.target.epoch).toBe(0);
      expect(checkpoints.source.root).toBe('block1'); // Slot 0
      expect(checkpoints.target.root).toBe('block1'); // Slot 0
    });
    
    it('should handle first slot of epoch', () => {
      // Given: Current slot = 4 (first slot of epoch 1)
      const canonicalChain = [
        createBlock('genesis', -1, 0),
        createBlock('block1', 0, 1),
        createBlock('block2', 4, 2), // Exactly at checkpoint
      ];
      
      const mockBeaconState = {
        justifiedCheckpoint: { epoch: 1, root: 'block3' }
      };
      
      // When: Compute checkpoints for slot 8 (epoch 2)
      const checkpoints = CasperFFG.computeCheckpoints(8, canonicalChain, mockBeaconState);
      
      // Then: Target should use block at exact checkpoint slot
      expect(checkpoints.target.epoch).toBe(1);
      expect(checkpoints.target.root).toBe('block2'); // Exact match at slot 4
    });
    
    it('should handle sparse chain with large gaps', () => {
      // Given: Large gaps between blocks
      const canonicalChain = [
        createBlock('genesis', -1, 0),
        createBlock('block1', 1, 1),
        createBlock('block2', 10, 2), // Big gap
      ];
      
      const mockBeaconState = {
        justifiedCheckpoint: { epoch: -1, root: null }
      };
      
      // When: Compute checkpoints for slot 0 (first slot of epoch 0)
      const checkpoints = CasperFFG.computeCheckpoints(0, canonicalChain, mockBeaconState);
      
      // Then: Should use block1 for target (closest before checkpoint 8)
      expect(checkpoints.target.epoch).toBe(2);
      expect(checkpoints.target.root).toBe('block1'); // Slot 1 < checkpoint 8
    });
  });
  
  describe('getCheckpointSlot', () => {
    it('should calculate checkpoint slot for epoch', () => {
      // SLOTS_PER_EPOCH = 4
      expect(CasperFFG.getCheckpointSlot(0)).toBe(0);
      expect(CasperFFG.getCheckpointSlot(1)).toBe(4);
      expect(CasperFFG.getCheckpointSlot(2)).toBe(8);
      expect(CasperFFG.getCheckpointSlot(10)).toBe(40);
    });
  });
  
  describe('getEpoch', () => {
    it('should calculate epoch from slot', () => {
      // SLOTS_PER_EPOCH = 4
      expect(CasperFFG.getEpoch(0)).toBe(0);
      expect(CasperFFG.getEpoch(3)).toBe(0);
      expect(CasperFFG.getEpoch(4)).toBe(1);
      expect(CasperFFG.getEpoch(7)).toBe(1);
      expect(CasperFFG.getEpoch(8)).toBe(2);
      expect(CasperFFG.getEpoch(15)).toBe(3);
    });
  });
});


================================================================================
// FILE: __tests__/core/casperFFGFinality.test.ts
================================================================================

/**
 * Unit tests for Casper FFG Finality Tracking
 * Tests justification and finalization logic
 */

import { CasperFFG } from '../../core/consensus/casperFFG';

describe('CasperFFG Finality Tracking', () => {
  
  /**
   * Helper to create a mock BeaconState
   */
  function createMockBeaconState(validatorCount: number) {
    const validators = Array.from({ length: validatorCount }, (_, i) => ({
      nodeAddress: `validator${i}`,
      stakedEth: 32
    }));
    
    return {
      validators,
      justifiedCheckpoint: { epoch: -1, root: null },
      previousJustifiedCheckpoint: null,
      finalizedCheckpoint: null,
      ffgVoteCounts: {},
      latestAttestationByValidator: {}
    };
  }
  
  /**
   * Helper to create an attestation
   */
  function createAttestation(
    validatorAddress: string,
    blockHash: string,
    sourceEpoch: number,
    sourceRoot: string | null,
    targetEpoch: number,
    targetRoot: string
  ) {
    return {
      validatorAddress,
      blockHash,
      timestamp: Date.now(),
      ffgSource: { epoch: sourceEpoch, root: sourceRoot },
      ffgTarget: { epoch: targetEpoch, root: targetRoot }
    };
  }
  
  describe('applyAttestationsToBeaconState', () => {
    
    it('should not justify epoch with insufficient votes (< 2/3)', () => {
      // Given: 4 validators, threshold = 3 (ceil(2*4/3))
      const beaconState = createMockBeaconState(4);
      
      // When: Only 2 validators attest (< 2/3)
      const attestations = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 0 should NOT be justified (only 2/3 votes)
      expect(beaconState.justifiedCheckpoint.epoch).toBe(-1);
      expect(beaconState.previousJustifiedCheckpoint).toBeNull();
      expect(beaconState.finalizedCheckpoint).toBeNull();
    });
    
    it('should justify epoch with exactly 2/3 votes', () => {
      // Given: 4 validators, threshold = 3
      const beaconState = createMockBeaconState(4);
      
      // When: Exactly 3 validators attest (2/3)
      const attestations = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator2', 'block1', -1, null, 0, 'block1')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 0 should be justified, and epoch -1 finalized (consecutive)
      expect(beaconState.justifiedCheckpoint.epoch).toBe(0);
      expect(beaconState.justifiedCheckpoint.root).toBe('block1');
      expect(beaconState.previousJustifiedCheckpoint?.epoch).toBe(-1);
      expect(beaconState.finalizedCheckpoint?.epoch).toBe(-1); // Finalized! (epochs -1 and 0 are consecutive)
    });
    
    it('should justify epoch with more than 2/3 votes', () => {
      // Given: 4 validators, threshold = 3
      const beaconState = createMockBeaconState(4);
      
      // When: All 4 validators attest (> 2/3)
      const attestations = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator2', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator3', 'block1', -1, null, 0, 'block1')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 0 should be justified
      expect(beaconState.justifiedCheckpoint.epoch).toBe(0);
      expect(beaconState.justifiedCheckpoint.root).toBe('block1');
    });
    
    it('should finalize epoch when consecutive epochs are justified', () => {
      // Given: 4 validators, epoch 0 already justified
      const beaconState = createMockBeaconState(4);
      beaconState.justifiedCheckpoint = { epoch: 0, root: 'block1' };
      
      // When: 3 validators attest to epoch 1 with source = epoch 0
      const attestations = [
        createAttestation('validator0', 'block2', 0, 'block1', 1, 'block2'),
        createAttestation('validator1', 'block2', 0, 'block1', 1, 'block2'),
        createAttestation('validator2', 'block2', 0, 'block1', 1, 'block2')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 1 justified, Epoch 0 finalized
      expect(beaconState.justifiedCheckpoint.epoch).toBe(1);
      expect(beaconState.justifiedCheckpoint.root).toBe('block2');
      expect(beaconState.previousJustifiedCheckpoint?.epoch).toBe(0);
      expect(beaconState.finalizedCheckpoint?.epoch).toBe(0);
      expect(beaconState.finalizedCheckpoint?.root).toBe('block1');
    });
    
    it('should NOT finalize when justified epochs are not consecutive', () => {
      // Given: Epoch 0 justified, skip to epoch 2
      const beaconState = createMockBeaconState(4);
      beaconState.justifiedCheckpoint = { epoch: 0, root: 'block1' };
      
      // When: Justify epoch 2 (skipping epoch 1)
      const attestations = [
        createAttestation('validator0', 'block3', 0, 'block1', 2, 'block3'),
        createAttestation('validator1', 'block3', 0, 'block1', 2, 'block3'),
        createAttestation('validator2', 'block3', 0, 'block1', 2, 'block3')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 2 justified but nothing finalized (not consecutive)
      expect(beaconState.justifiedCheckpoint.epoch).toBe(2);
      expect(beaconState.previousJustifiedCheckpoint?.epoch).toBe(0);
      expect(beaconState.finalizedCheckpoint).toBeNull(); // Not consecutive!
    });
    
    it('should ignore attestations with wrong source checkpoint', () => {
      // Given: Epoch 0 justified
      const beaconState = createMockBeaconState(4);
      beaconState.justifiedCheckpoint = { epoch: 0, root: 'block1' };
      
      // When: Attestations with wrong source (source = -1 instead of 0)
      const attestations = [
        createAttestation('validator0', 'block2', -1, null, 1, 'block2'),
        createAttestation('validator1', 'block2', -1, null, 1, 'block2'),
        createAttestation('validator2', 'block2', -1, null, 1, 'block2')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Attestations ignored, nothing changes
      expect(beaconState.justifiedCheckpoint.epoch).toBe(0); // Still 0
      expect(beaconState.finalizedCheckpoint).toBeNull();
    });
    
    it('should replace validator old vote when new attestation received', () => {
      // Given: Validator0 already voted for block1
      const beaconState = createMockBeaconState(4);
      const oldAttestation = createAttestation('validator0', 'block1', -1, null, 0, 'block1');
      CasperFFG.applyAttestationsToBeaconState(beaconState, [oldAttestation]);
      
      // When: Validator0 votes for block2 instead
      const newAttestation = createAttestation('validator0', 'block2', -1, null, 0, 'block2');
      CasperFFG.applyAttestationsToBeaconState(beaconState, [newAttestation]);
      
      // Then: Old vote removed, new vote counted
      expect(beaconState.latestAttestationByValidator['validator0'].blockHash).toBe('block2');
      // Old vote bucket cleaned up (empty after removal)
      expect(beaconState.ffgVoteCounts[0]?.['block1']).toBeUndefined();
      expect(beaconState.ffgVoteCounts[0]?.['block2']?.has('validator0')).toBe(true);
    });
    
    it('should handle multiple blocks competing for same epoch', () => {
      // Given: 4 validators
      const beaconState = createMockBeaconState(4);
      
      // When: 2 validators vote for block1, 2 vote for block2 (split vote)
      const attestations = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator2', 'block2', -1, null, 0, 'block2'),
        createAttestation('validator3', 'block2', -1, null, 0, 'block2')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Neither block justified (each has only 2/4 votes, need 3)
      expect(beaconState.justifiedCheckpoint.epoch).toBe(-1);
      expect(beaconState.ffgVoteCounts[0]['block1'].size).toBe(2);
      expect(beaconState.ffgVoteCounts[0]['block2'].size).toBe(2);
    });
    
    it('should garbage collect old vote buckets after finalization', () => {
      // Given: Finalize epoch 0
      const beaconState = createMockBeaconState(4);
      
      // Justify epoch 0
      const attestations1 = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator2', 'block1', -1, null, 0, 'block1')
      ];
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations1);
      
      // Justify epoch 1 (finalizes epoch 0)
      const attestations2 = [
        createAttestation('validator0', 'block2', 0, 'block1', 1, 'block2'),
        createAttestation('validator1', 'block2', 0, 'block1', 1, 'block2'),
        createAttestation('validator2', 'block2', 0, 'block1', 1, 'block2')
      ];
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations2);
      
      // Then: Vote buckets for epoch 0 and below should be garbage collected
      expect(beaconState.ffgVoteCounts[-1]).toBeUndefined();
      expect(beaconState.ffgVoteCounts[0]).toBeUndefined();
      expect(beaconState.ffgVoteCounts[1]).toBeDefined(); // Epoch 1 still there
    });
    
    it('should maintain monotonicity - justified epoch never decreases', () => {
      // Given: Epoch 2 already justified
      const beaconState = createMockBeaconState(4);
      beaconState.justifiedCheckpoint = { epoch: 2, root: 'block3' };
      
      // When: Try to justify epoch 1 (lower than current)
      const attestations = [
        createAttestation('validator0', 'block2', 2, 'block3', 1, 'block2'),
        createAttestation('validator1', 'block2', 2, 'block3', 1, 'block2'),
        createAttestation('validator2', 'block2', 2, 'block3', 1, 'block2')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Justified checkpoint stays at epoch 2 (monotonicity - fancy word hehehe - preserved)
      expect(beaconState.justifiedCheckpoint.epoch).toBe(2);
    });
    
    it('should handle 3 validators with threshold of 2', () => {
      // Given: 3 validators, threshold = 2 (ceil(2*3/3))
      const beaconState = createMockBeaconState(3);
      
      // When: 2 validators attest (exactly 2/3)
      const attestations = [
        createAttestation('validator0', 'block1', -1, null, 0, 'block1'),
        createAttestation('validator1', 'block1', -1, null, 0, 'block1')
      ];
      
      CasperFFG.applyAttestationsToBeaconState(beaconState, attestations);
      
      // Then: Epoch 0 justified
      expect(beaconState.justifiedCheckpoint.epoch).toBe(0);
    });
  });
});


================================================================================
// FILE: __tests__/core/lmdGhost.test.ts
================================================================================

/**
 * Unit tests for LmdGhost class
 * Tests incremental tree decoration, fork choice, and attestation handling
 */

import { LmdGhost } from '../../core/consensus/lmdGhost';
import { BlockchainTree, BlockTreeNode } from '../../core/blockchain/blockchainTree';
import { Block } from '../../types/types';
import { BeaconState, Validator } from '../../core/consensus/beaconState';

describe('LmdGhost', () => {
  let tree: BlockchainTree;
  let beaconState: BeaconState;
  let genesisBlock: Block;
  let blockA: Block;
  let blockB: Block;
  let blockC: Block;

  /**
   * Helper to create a simple block
   */
  function createBlock(hash: string, parentHash: string, height: number, slot: number = 0): Block {
    return {
      hash,
      header: {
        transactionHash: '',
        timestamp: Date.now(),
        previousHeaderHash: parentHash,
        height,
        slot,
      },
      transactions: [],
      attestations: [],
      randaoReveal: 'test-randao',
    };
  }

  /**
   * Helper to create an attestation
   */
  function createAttestation(validatorAddress: string, blockHash: string, timestamp: number) {
    return {
      validatorAddress,
      blockHash,
      timestamp,
    };
  }

  /**
   * Helper to initialize node metadata (BlockchainTree doesn't do this by default)
   */
  function initializeNodeMetadata(node: BlockTreeNode) {
    if (!node.metadata) {
      node.metadata = { attestedEth: 0 };
    }
  }

  beforeEach(() => {
    // Create a simple blockchain tree:
    //     genesis
    //        |
    //        A
    //       / \
    //      B   C
    
    genesisBlock = createBlock('genesis', '', 0);
    blockA = createBlock('blockA', 'genesis', 1);
    blockB = createBlock('blockB', 'blockA', 2);
    blockC = createBlock('blockC', 'blockA', 2);

    tree = new BlockchainTree();
    tree.addBlock(genesisBlock);  // Add genesis first
    tree.addBlock(blockA);
    tree.addBlock(blockB);
    tree.addBlock(blockC);

    // Initialize metadata for all nodes
    const genesisNode = tree.getNode('genesis');
    const nodeA = tree.getNode('blockA');
    const nodeB = tree.getNode('blockB');
    const nodeC = tree.getNode('blockC');
    
    if (genesisNode) initializeNodeMetadata(genesisNode);
    if (nodeA) initializeNodeMetadata(nodeA);
    if (nodeB) initializeNodeMetadata(nodeB);
    if (nodeC) initializeNodeMetadata(nodeC);

    // Create beacon state with 3 validators
    const genesisTime = Math.floor(Date.now() / 1000);
    const validators: Validator[] = [
      { nodeAddress: 'validator1', stakedEth: 32 },
      { nodeAddress: 'validator2', stakedEth: 32 },
      { nodeAddress: 'validator3', stakedEth: 32 },
    ];
    beaconState = new BeaconState(genesisTime, validators);
  });

  describe('onLatestAttestChange', () => {
    it('should increment attestedEth when new attestation added', () => {
      // Given: No attestations yet
      const att1 = createAttestation('validator1', 'blockB', 1000);
      
      // When: Add attestation to blockB
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att1);
      
      // Then: blockB and its ancestors should have +32 ETH
      const nodeB = tree.getNode('blockB')!;
      const nodeA = tree.getNode('blockA')!;
      const nodeGenesis = tree.getNode('genesis')!;
      
      expect(nodeB.metadata.attestedEth).toBe(32);
      expect(nodeA.metadata.attestedEth).toBe(32);
      expect(nodeGenesis.metadata.attestedEth).toBe(32);
      
      // blockC should have 0 or undefined (different fork, no attestations)
      const nodeC = tree.getNode('blockC')!;
      expect(nodeC.metadata.attestedEth || 0).toBe(0);
    });

    it('should decrement old and increment new when attestation changes', () => {
      // Given: validator1 attests to blockB
      const att1 = createAttestation('validator1', 'blockB', 1000);
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att1);
      
      // When: validator1 changes attestation to blockC
      const att2 = createAttestation('validator1', 'blockC', 2000);
      LmdGhost.onLatestAttestChange(beaconState, tree, att1, att2);
      
      // Then: blockB path should be decremented, blockC path incremented
      const nodeB = tree.getNode('blockB')!;
      const nodeC = tree.getNode('blockC')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeB.metadata.attestedEth).toBe(0);  // Decremented
      expect(nodeC.metadata.attestedEth).toBe(32); // Incremented
      expect(nodeA.metadata.attestedEth).toBe(32); // Still has C's attestation
    });

    it('should handle attestation to non-existent block gracefully', () => {
      // Given: Attestation to block we don't have
      const att = createAttestation('validator1', 'unknownBlock', 1000);
      
      // When: Try to add attestation
      expect(() => {
        LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att);
      }).not.toThrow();
      
      // Then: No changes to tree
      const nodeB = tree.getNode('blockB')!;
      expect(nodeB.metadata.attestedEth || 0).toBe(0);
    });

    it('should handle multiple attestations accumulating', () => {
      // Given: Three validators attest to blockB
      const att1 = createAttestation('validator1', 'blockB', 1000);
      const att2 = createAttestation('validator2', 'blockB', 1000);
      const att3 = createAttestation('validator3', 'blockB', 1000);
      
      // When: Add all attestations
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att1);
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att2);
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att3);
      
      // Then: blockB and ancestors should have 96 ETH (3 * 32)
      const nodeB = tree.getNode('blockB')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeB.metadata.attestedEth).toBe(96);
      expect(nodeA.metadata.attestedEth).toBe(96);
    });
  });

  describe('onNewAttestations', () => {
    it('should process multiple attestations correctly', () => {
      // Given: Multiple new attestations
      const attestations = [
        createAttestation('validator1', 'blockB', 1000),
        createAttestation('validator2', 'blockC', 1000),
        createAttestation('validator3', 'blockB', 1000),
      ];
      
      // When: Process all attestations
      LmdGhost.onNewAttestations(beaconState, tree, attestations);
      
      // Then: Attestations should be recorded and tree decorated
      expect(beaconState.latestAttestations.size).toBe(3);
      
      const nodeB = tree.getNode('blockB')!;
      const nodeC = tree.getNode('blockC')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeB.metadata.attestedEth).toBe(64); // 2 validators
      expect(nodeC.metadata.attestedEth).toBe(32); // 1 validator
      expect(nodeA.metadata.attestedEth).toBe(96); // Both forks (2 + 1)
    });

    it('should only update with newer attestations', () => {
      // Given: validator1 attests to blockB at time 2000
      const oldAtt = createAttestation('validator1', 'blockB', 2000);
      LmdGhost.onNewAttestations(beaconState, tree, [oldAtt]);
      
      // When: Try to add older attestation from same validator
      const newerAtt = createAttestation('validator1', 'blockC', 1000);
      LmdGhost.onNewAttestations(beaconState, tree, [newerAtt]);
      
      // Then: Old attestation should remain
      const nodeB = tree.getNode('blockB')!;
      const nodeC = tree.getNode('blockC')!;
      
      expect(nodeB.metadata.attestedEth).toBe(32); // Still has attestation
      expect(nodeC.metadata.attestedEth || 0).toBe(0);  // Rejected (older)
    });
  });

  describe('onNewBlock', () => {
    it('should increment attestedEth when existing attestations point to new block', () => {
      // Given: Attestations already exist pointing to a block hash
      beaconState.latestAttestations.set('validator1', createAttestation('validator1', 'blockD', 1000));
      beaconState.latestAttestations.set('validator2', createAttestation('validator2', 'blockD', 1000));
      
      // When: New block arrives with that hash
      const blockD = createBlock('blockD', 'blockA', 2);
      tree.addBlock(blockD);
      LmdGhost.onNewBlock(blockD, tree, beaconState);
      
      // Then: blockD and ancestors should have attestedEth
      const nodeD = tree.getNode('blockD')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeD.metadata.attestedEth).toBe(64); // 2 * 32
      expect(nodeA.metadata.attestedEth).toBe(64);
    });

    it('should handle block with no attestations', () => {
      // Given: No attestations pointing to blockD
      const blockD = createBlock('blockD', 'blockA', 2);
      tree.addBlock(blockD);
      
      // When: Process new block
      expect(() => {
        LmdGhost.onNewBlock(blockD, tree, beaconState);
      }).not.toThrow();
      
      // Then: No changes
      const nodeD = tree.getNode('blockD')!;
      expect(nodeD.metadata.attestedEth || 0).toBe(0);
    });
  });

  describe('markNodeInvalid', () => {
    it('should mark node invalid and decrement parent attestedEth', () => {
      // Given: blockB has 32 ETH from attestation
      const att = createAttestation('validator1', 'blockB', 1000);
      LmdGhost.onLatestAttestChange(beaconState, tree, undefined, att);
      
      const nodeB = tree.getNode('blockB')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeB.metadata.attestedEth).toBe(32);
      expect(nodeA.metadata.attestedEth).toBe(32);
      
      // When: Mark blockB as invalid
      LmdGhost.markNodeInvalid(nodeB);
      
      // Then: blockB should be invalid with 0 ETH, parent decremented
      expect(nodeB.metadata.isInvalid).toBe(true);
      expect(nodeB.metadata.attestedEth).toBe(0);
      expect(nodeA.metadata.attestedEth).toBe(0); // Decremented by 32
    });

    it('should not decrement if node has no attestedEth', () => {
      // Given: blockB has no attestations
      const nodeB = tree.getNode('blockB')!;
      const nodeA = tree.getNode('blockA')!;
      
      expect(nodeB.metadata.attestedEth || 0).toBe(0);
      
      // When: Mark blockB as invalid
      LmdGhost.markNodeInvalid(nodeB);
      
      // Then: No changes to parent
      expect(nodeB.metadata.isInvalid).toBe(true);
      expect(nodeA.metadata.attestedEth || 0).toBe(0);
    });
  });

  describe('computeGhostHead', () => {
    it('should use smallest hash tiebreaker when no attestations', () => {
      // Given: No attestations (all children have equal attestedEth = 0)
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockB (smallest hash: 'blockB' < 'blockC')
      // Tree: genesis -> blockA -> [blockB, blockC] (tie at 0 ETH, blockB wins)
      expect(ghostHead).toBe('blockB');
    });

    it('should follow heaviest chain', () => {
      // Given: blockB has more attestations than blockC
      const attestations = [
        createAttestation('validator1', 'blockB', 1000),
        createAttestation('validator2', 'blockB', 1000),
        createAttestation('validator3', 'blockC', 1000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations);
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockB (64 ETH > 32 ETH)
      expect(ghostHead).toBe('blockB');
    });

    it('should use smallest hash as tiebreaker when children have equal attestedEth', () => {
      // Given: blockB and blockC have equal attestations
      const attestations = [
        createAttestation('validator1', 'blockB', 1000),
        createAttestation('validator2', 'blockC', 1000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations);
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockB (smallest hash: 'blockB' < 'blockC')
      expect(ghostHead).toBe('blockB');
    });

    it('should skip invalid nodes', () => {
      // Given: blockB has more attestations but is invalid
      const attestations = [
        createAttestation('validator1', 'blockB', 1000),
        createAttestation('validator2', 'blockB', 1000),
        createAttestation('validator3', 'blockC', 1000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations);
      
      const nodeB = tree.getNode('blockB')!;
      LmdGhost.markNodeInvalid(nodeB);
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockC (blockB is invalid)
      expect(ghostHead).toBe('blockC');
    });

    it('should return parent when all children are invalid', () => {
      // Given: Both blockB and blockC are invalid
      const nodeB = tree.getNode('blockB')!;
      const nodeC = tree.getNode('blockC')!;
      
      LmdGhost.markNodeInvalid(nodeB);
      LmdGhost.markNodeInvalid(nodeC);
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockA (no valid children)
      expect(ghostHead).toBe('blockA');
    });

    it('should handle deep chain correctly', () => {
      // Given: A longer chain
      //     genesis -> A -> B -> D -> E
      //                  \-> C
      const blockD = createBlock('blockD', 'blockB', 3);
      const blockE = createBlock('blockE', 'blockD', 4);
      tree.addBlock(blockD);
      tree.addBlock(blockE);
      
      // All validators attest to blockE
      const attestations = [
        createAttestation('validator1', 'blockE', 1000),
        createAttestation('validator2', 'blockE', 1000),
        createAttestation('validator3', 'blockE', 1000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations);
      
      // When: Compute GHOST-HEAD
      const ghostHead = LmdGhost.computeGhostHead(tree);
      
      // Then: Should return blockE (deepest with attestations)
      expect(ghostHead).toBe('blockE');
    });
  });

  describe('Integration: Complex fork choice scenario', () => {
    it('should handle realistic fork with attestation changes and invalidation', () => {
      // Given: Complex scenario
      //     genesis -> A -> B -> D
      //                  \-> C
      
      const blockD = createBlock('blockD', 'blockB', 3);
      tree.addBlock(blockD);
      
      // Step 1: Initial attestations favor blockD
      const attestations1 = [
        createAttestation('validator1', 'blockD', 1000),
        createAttestation('validator2', 'blockD', 1000),
        createAttestation('validator3', 'blockC', 1000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations1);
      
      expect(LmdGhost.computeGhostHead(tree)).toBe('blockD');
      
      // Step 2: validator1 changes to blockC (now tied 64-64)
      const attestations2 = [
        createAttestation('validator1', 'blockC', 2000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations2);
      
      // With validator1 on C (32 ETH) and validator2 on D->B (32 ETH), blockB and blockC are tied
      // But blockD is a child of blockB, so blockB path has 32 ETH total
      // Actually after the change, validator1 moved from D to C, so:
      // - blockC: 32 ETH (validator1)
      // - blockB->D: 32 ETH (validator2)
      // They're tied at blockA level, but blockC is a direct child
      // GHOST should pick blockC since it has equal weight and is simpler
      expect(LmdGhost.computeGhostHead(tree)).toBe('blockC');
      
      // Step 3: Mark blockD as invalid
      const nodeD = tree.getNode('blockD')!;
      LmdGhost.markNodeInvalid(nodeD);
      
      // After marking blockD invalid, blockB path lost its attestations
      // blockB: 0 ETH (validator2 was on blockD which is now invalid)
      // blockC: 32 ETH (validator1)
      // So blockC should win
      expect(LmdGhost.computeGhostHead(tree)).toBe('blockC');
      
      // Step 4: validator2 moves to blockC
      const attestations3 = [
        createAttestation('validator2', 'blockC', 3000),
      ];
      LmdGhost.onNewAttestations(beaconState, tree, attestations3);
      
      // Now blockC should win (96 ETH vs 0 ETH)
      expect(LmdGhost.computeGhostHead(tree)).toBe('blockC');
    });
  });
});


================================================================================
// FILE: __tests__/core/randao.test.ts
================================================================================

/**
 * Unit tests for RANDAO class
 * Tests validator scheduling, RANDAO reveals, and mix updates
 */

import { RANDAO } from '../../core/consensus/randao';
import { BeaconState, Validator } from '../../core/consensus/beaconState';
import { Node } from '../../core/node';

describe('RANDAO', () => {
  let beaconState: BeaconState;
  let validators: Validator[];
  let genesisTime: number;

  beforeEach(() => {
    // Set up test beacon state with 4 validators
    genesisTime = Math.floor(Date.now() / 1000);
    validators = [
      { nodeAddress: 'address1', stakedEth: 32 },
      { nodeAddress: 'address2', stakedEth: 32 },
      { nodeAddress: 'address3', stakedEth: 16 }, // Half stake
      { nodeAddress: 'address4', stakedEth: 32 },
    ];
    beaconState = new BeaconState(genesisTime, validators);
  });

  describe('getProposerSchedule', () => {
    it('should return 32 proposer addresses for target epoch', () => {
      const targetEpoch = 1;
      const schedule = RANDAO.getProposerSchedule(beaconState, targetEpoch);
      
      expect(schedule).toHaveLength(32);
      expect(schedule.every(addr => typeof addr === 'string')).toBe(true);
    });

    it('should only select from active validators', () => {
      const targetEpoch = 1;
      const schedule = RANDAO.getProposerSchedule(beaconState, targetEpoch);
      const validAddresses = validators.map(v => v.nodeAddress);
      
      schedule.forEach(address => {
        expect(validAddresses).toContain(address);
      });
    });

    it('should be deterministic for same beacon state and epoch', () => {
      const targetEpoch = 2;
      const schedule1 = RANDAO.getProposerSchedule(beaconState, targetEpoch);
      const schedule2 = RANDAO.getProposerSchedule(beaconState, targetEpoch);
      
      expect(schedule1).toEqual(schedule2);
    });

    it('should produce different schedules for different epochs', () => {
      const schedule1 = RANDAO.getProposerSchedule(beaconState, 1);
      const schedule2 = RANDAO.getProposerSchedule(beaconState, 2);
      
      expect(schedule1).not.toEqual(schedule2);
    });
  });

  describe('calculateRandaoReveal', () => {
    it('should generate BLS signature for epoch', () => {
      const node = new Node('TestNode', genesisTime, validators);
      const epoch = 5;
      
      const reveal = RANDAO.calculateRandaoReveal(epoch, node);
      
      expect(typeof reveal).toBe('string');
      expect(reveal.length).toBeGreaterThan(0);
    });

    it('should generate different reveals for different epochs', () => {
      const node = new Node('TestNode', genesisTime, validators);
      
      const reveal1 = RANDAO.calculateRandaoReveal(1, node);
      const reveal2 = RANDAO.calculateRandaoReveal(2, node);
      
      expect(reveal1).not.toEqual(reveal2);
    });

    it('should be deterministic for same epoch and node', () => {
      const node = new Node('TestNode', genesisTime, validators);
      const epoch = 3;
      
      const reveal1 = RANDAO.calculateRandaoReveal(epoch, node);
      const reveal2 = RANDAO.calculateRandaoReveal(epoch, node);
      
      expect(reveal1).toEqual(reveal2);
    });
  });

  describe('updateRandaoMix', () => {
    it('should update RANDAO mix with XOR of current mix and reveal', () => {
      const epoch = 0;
      const initialMix = beaconState.getRandaoMix(epoch);
      const reveal = 'abcdef1234567890';
      
      RANDAO.updateRandaoMix(beaconState, epoch, reveal);
      
      const updatedMix = beaconState.getRandaoMix(epoch);
      expect(updatedMix).not.toEqual(initialMix);
      expect(typeof updatedMix).toBe('string');
    });

    it('should accumulate multiple reveals via XOR', () => {
      const epoch = 1;
      const reveal1 = 'aaaa';
      const reveal2 = 'bbbb';
      
      RANDAO.updateRandaoMix(beaconState, epoch, reveal1);
      const afterFirst = beaconState.getRandaoMix(epoch);
      
      RANDAO.updateRandaoMix(beaconState, epoch, reveal2);
      const afterSecond = beaconState.getRandaoMix(epoch);
      
      expect(afterFirst).not.toEqual(afterSecond);
    });
  });
});


================================================================================
// FILE: __tests__/utils/cryptoUtils.test.ts
================================================================================

import { 
  sha256Hash,
  isHashBelowCeiling,
  generatePrivateKey,
  derivePublicKey,
  generateAddress,
  generateSignature,
  verifySignature,
  hexToBuffer,
  bufferToHex
} from '../../utils/cryptoUtils';

// Mock console methods
const originalConsole = { ...console };
beforeAll(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
});

afterAll(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
});

describe('Crypto Utilities', () => {
  describe('sha256Hash', () => {
    it('should create consistent hashes for the same input', () => {
      const input = { test: 'data' };
      const hash1 = sha256Hash(input);
      const hash2 = sha256Hash(input);
      
      expect(hash1).toBe(hash2);
    });
    
    it('should create different hashes for different inputs', () => {
      const input1 = { test: 'data1' };
      const input2 = { test: 'data2' };
      
      const hash1 = sha256Hash(input1);
      const hash2 = sha256Hash(input2);
      
      expect(hash1).not.toBe(hash2);
    });
    
    it('should handle string inputs', () => {
      const input = 'test string';
      const hash = sha256Hash(input);
      
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 produces a 64-character hex string
    });
  });
  
  describe('isHashBelowCeiling', () => {
    it('should return true when hash is below ceiling', () => {
      const hash = '0000000000000000000000000000000000000000000000000000000000000001';
      const ceiling = '0000000000000000000000000000000000000000000000000000000000000002';
      
      expect(isHashBelowCeiling(hash, ceiling)).toBe(true);
    });
    
    it('should return false when hash is above ceiling', () => {
      const hash = '0000000000000000000000000000000000000000000000000000000000000002';
      const ceiling = '0000000000000000000000000000000000000000000000000000000000000001';
      
      expect(isHashBelowCeiling(hash, ceiling)).toBe(false);
    });
    
    it('should handle equal values', () => {
      const hash = '0000000000000000000000000000000000000000000000000000000000000001';
      const ceiling = '0000000000000000000000000000000000000000000000000000000000000001';
      
      expect(isHashBelowCeiling(hash, ceiling)).toBe(false);
    });
  });
  
  describe('Key Generation and Derivation', () => {
    it('should generate consistent private keys for the same node ID', () => {
      const nodeId = 'test-node';
      const key1 = generatePrivateKey(nodeId);
      const key2 = generatePrivateKey(nodeId);
      
      expect(key1).toBe(key2);
    });
    
    it('should derive consistent public keys from the same private key', () => {
      const privateKey = generatePrivateKey('test-node');
      const publicKey1 = derivePublicKey(privateKey);
      const publicKey2 = derivePublicKey(privateKey);
      
      expect(publicKey1).toBe(publicKey2);
    });
    
    it('should generate different private keys for different node IDs', () => {
      const key1 = generatePrivateKey('node1');
      const key2 = generatePrivateKey('node2');
      
      expect(key1).not.toBe(key2);
    });
    
    it('should generate consistent addresses from the same public key', () => {
      const publicKey = derivePublicKey(generatePrivateKey('test-node'));
      const address1 = generateAddress(publicKey);
      const address2 = generateAddress(publicKey);
      
      expect(address1).toBe(address2);
    });
  });
  
  describe('Signatures', () => {
    const testData = {
      sourceOutputId: 'test-output',
      allOutputs: [{ idx: 0, nodeId: 'test-node', value: 10, lock: 'test-lock' }],
      txid: 'test-txid'
    };
    
    it('should generate and verify valid signatures', async () => {
      const privateKey = generatePrivateKey('test-node');
      const publicKey = derivePublicKey(privateKey);
      
      const signature = await generateSignature(testData, privateKey);
      const isValid = await verifySignature(testData, signature, publicKey);
      
      expect(isValid).toBe(true);
    });
    
    it('should reject invalid signatures', async () => {
      const privateKey1 = generatePrivateKey('node1');
      const privateKey2 = generatePrivateKey('node2');
      
      // Sign with privateKey1 but verify with publicKey2
      const signature = await generateSignature(testData, privateKey1);
      const isValid = await verifySignature(testData, signature, derivePublicKey(privateKey2));
      
      expect(isValid).toBe(false);
    });
    
    it('should reject signatures for modified data', async () => {
      const privateKey = generatePrivateKey('test-node');
      const publicKey = derivePublicKey(privateKey);
      
      const signature = await generateSignature(testData, privateKey);
      
      // Modify the data
      const modifiedData = {
        ...testData,
        sourceOutputId: 'modified-output'
      };
      
      const isValid = await verifySignature(modifiedData, signature, publicKey);
      expect(isValid).toBe(false);
    });
  });
  
  describe('Buffer Conversion', () => {
    it('should convert hex to buffer and back', () => {
      const originalHex = '0123456789abcdef';
      const buffer = hexToBuffer(originalHex);
      const resultHex = bufferToHex(buffer);
      
      expect(resultHex).toBe(originalHex);
    });
    
    it('should handle empty hex string', () => {
      const buffer = hexToBuffer('');
      const resultHex = bufferToHex(buffer);
      
      expect(resultHex).toBe('');
    });
  });
});


================================================================================
// FILE: app/App.tsx
================================================================================

import React from 'react';
import AppRouter from './router/AppRouter';
import './styles/theme.css';
import './App.css';

/**
 * Main App component that serves as the entry point for the application
 */

/**
 * App component that serves as the entry point for the application
 */
const App: React.FC = () => {
  return <AppRouter />;
};

export default App;


================================================================================
// FILE: app/components/AddTransactionModal.tsx
================================================================================

import React, { useState } from 'react';
import { Account } from '../../types/types';
import './AddTransactionModal.css';

interface AddTransactionModalProps {
  nodeId: string;
  nodeAddress: string;
  worldState: Record<string, Account>;
  onClose: () => void;
  onSubmit: (recipient: string, amount: number) => void;
}

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  nodeId,
  nodeAddress,
  worldState,
  onClose,
  onSubmit
}) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  
  // Get list of accounts for dropdown
  const accounts = Object.keys(worldState).filter(addr => addr !== nodeAddress);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    console.log('AddTransactionModal: Form submitted', { recipient, amount });

    // Validate recipient
    if (!recipient.trim()) {
      setError('Recipient address is required');
      console.log('AddTransactionModal: Validation failed - no recipient');
      return;
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Amount must be a positive number');
      console.log('AddTransactionModal: Validation failed - invalid amount');
      return;
    }

    console.log('AddTransactionModal: Calling onSubmit', { recipient: recipient.trim(), amount: amountNum });
    // Submit the transaction
    onSubmit(recipient.trim(), amountNum);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container add-tx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Transaction to Mempool</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <div className="add-tx-info">
            <p><strong>From:</strong> {nodeId} ({nodeAddress.slice(0, 10)}...)</p>
          </div>

          <form onSubmit={handleSubmit} className="add-tx-form">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="recipient">To:</label>
                <select
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="form-input"
                  required
                >
                  <option value="">Select recipient...</option>
                  {accounts.map(addr => (
                    <option key={addr} value={addr}>
                      {addr === '0xEPM_PAINT_CONTRACT' 
                        ? '🎨 EPM Paint Contract' 
                        : `${addr.slice(0, 10)}...${addr.slice(-8)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="amount">Amount (ETH):</label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="form-input"
                  required
                />
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="form-actions">
              <button type="button" onClick={onClose} className="cancel-button">
                Cancel
              </button>
              <button type="submit" className="submit-button">
                Add to Mempool
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddTransactionModal;


================================================================================
// FILE: app/components/AttestationCircle.tsx
================================================================================

import React from 'react';
import { Attestation, Block } from '../../types/types';
import { getNodeColorCSS } from '../../utils/nodeColorUtils';
import './AttestationCircle.css';

interface AttestationCircleProps {
  attestation: Attestation;
  blocks: Block[];
  addressToNodeId: Record<string, string>;
  onClick?: () => void;
  simplified?: boolean; // Optional: show simplified view for block tree
  size?: number; // Optional: override size in pixels (default: 80 for normal, 40 for simplified)
}

const AttestationCircle: React.FC<AttestationCircleProps> = ({ 
  attestation, 
  blocks, 
  addressToNodeId,
  onClick,
  simplified = false,
  size
}) => {
  // Check if this attestation's block hash is in the canonical chain
  const isCanonical = blocks.some((b: Block) => b.hash === attestation.blockHash);
  
  // Find the block being attested to get its height
  const attestedBlock = blocks.find((b: Block) => b.hash === attestation.blockHash);
  const blockHeight = attestedBlock ? attestedBlock.header.height : '?';
  
  // Get node name (color) from address using context
  const nodeName = addressToNodeId[attestation.validatorAddress] || attestation.validatorAddress.slice(-4);
  const nodeColor = getNodeColorCSS(nodeName);
  
  // Get last 6 hex characters of block hash
  const hashSuffix = attestation.blockHash.slice(-6);
  
  // Determine size - use prop if provided, otherwise defaults
  const circleSize = size || (simplified ? 40 : 80);
  
  // Simplified view for block tree
  if (simplified) {
    // Format time as MM:SS
    const date = new Date(attestation.timestamp);
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const timeStr = `${minutes}:${seconds}`;
    
    return (
      <div 
        className="attestation-circle attestation-simplified"
        style={{ 
          borderColor: nodeColor,
          width: `${circleSize}px`,
          height: `${circleSize}px`
        }}
        title={`Validator: ${nodeName}\nBlock: ${attestation.blockHash}\nHeight: ${blockHeight}`}
        onClick={onClick}
      >
        <div className="attestation-circle-content">
          <div className="attestation-latest">Latest</div>
          <div className="attestation-label">Attest</div>
          <div className="attestation-time">{timeStr}</div>
        </div>
      </div>
    );
  }
  
  // Default view
  return (
    <div 
      className={`attestation-circle ${isCanonical ? 'attestation-canonical' : ''}`}
      style={{ 
        borderColor: nodeColor,
        width: `${circleSize}px`,
        height: `${circleSize}px`
      }}
      title={`Validator: ${nodeName}\nBlock: ${attestation.blockHash}\nHeight: ${blockHeight}`}
      onClick={onClick}
    >
      <div className="attestation-circle-content">
        <div className="attestation-block-label">Block</div>
        <div className="attestation-block-number">{blockHeight}</div>
        <div className="attestation-hash-suffix">{hashSuffix}</div>
        {isCanonical && <div className="attestation-check">✓</div>}
      </div>
    </div>
  );
};

export default AttestationCircle;


================================================================================
// FILE: app/components/BeaconStateView.tsx
================================================================================

import React, { useState } from 'react';
import { BeaconState } from '../../core/consensus/beaconState';
import { Block } from '../../types/types';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import { getNodeColorCSS, getNodeColorEmoji } from '../../utils/nodeColorUtils';
import AttestationCircle from './AttestationCircle';
import ProposerScheduleTimeline from './ProposerScheduleTimeline';
import { SimulatorConfig } from '../../config/config';
import './BeaconStateView.css';

interface BeaconStateViewProps {
  beaconState: BeaconState;
  blockchain: Block[];
  blockchainTree?: any; // Blockchain tree for looking up blocks on forks
  onClose: () => void;
}

/**
 * BeaconStateView - Displays the Consensus Layer (CL) beacon state
 */
const BeaconStateView: React.FC<BeaconStateViewProps> = ({ beaconState, blockchain, blockchainTree, onClose }) => {
  const { addressToNodeId } = useSimulatorContext();
  const [selectedAttestation, setSelectedAttestation] = useState<any | null>(null);
  const currentSlot = beaconState.getCurrentSlot();
  const currentEpoch = beaconState.getCurrentEpoch();
  const validators = beaconState.validators;
  const randaoMixes = Array.from(beaconState.randaoMixes.entries());

  return (
    <div className="beacon-state-modal-overlay" onClick={onClose}>
      <div className="beacon-state-modal" onClick={(e) => e.stopPropagation()}>
        <div className="beacon-modal-header">
          <h2>Beacon State (Consensus Layer)</h2>
          <button className="beacon-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="beacon-modal-content">
          {/* Time & Epoch Info */}
          <div className="beacon-section">
            <h3>Time & Epoch Information</h3>
            <div className="beacon-info-grid">
              <div className="beacon-info-item">
                <span className="beacon-label">Genesis Time:</span>
                <span className="beacon-value">{new Date(beaconState.genesisTime * 1000).toLocaleString()}</span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Current Slot:</span>
                <span className="beacon-value">{currentSlot}</span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Current Epoch:</span>
                <span className="beacon-value">{currentEpoch}</span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Slot Duration:</span>
                <span className="beacon-value">{SimulatorConfig.SECONDS_PER_SLOT} seconds</span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Slots per Epoch:</span>
                <span className="beacon-value">{SimulatorConfig.SLOTS_PER_EPOCH}</span>
              </div>
            </div>
          </div>

          {/* Casper FFG Checkpoints */}
          <div className="beacon-section">
            <h3>Casper FFG Checkpoints</h3>
            <div className="beacon-info-grid">
              <div className="beacon-info-item">
                <span className="beacon-label">Finalized:</span>
                <span className="beacon-value">
                  {beaconState.finalizedCheckpoint ? (
                    <>
                      Epoch {beaconState.finalizedCheckpoint.epoch}
                      {beaconState.finalizedCheckpoint.root && (
                        <span className="checkpoint-hash"> (...{beaconState.finalizedCheckpoint.root.slice(-8)})</span>
                      )}
                    </>
                  ) : (
                    <span className="empty-checkpoint">None</span>
                  )}
                </span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Justified:</span>
                <span className="beacon-value">
                  Epoch {beaconState.justifiedCheckpoint.epoch}
                  {beaconState.justifiedCheckpoint.root && (
                    <span className="checkpoint-hash"> (...{beaconState.justifiedCheckpoint.root.slice(-8)})</span>
                  )}
                </span>
              </div>
              <div className="beacon-info-item">
                <span className="beacon-label">Prev Justified:</span>
                <span className="beacon-value">
                  {beaconState.previousJustifiedCheckpoint ? (
                    <>
                      Epoch {beaconState.previousJustifiedCheckpoint.epoch}
                      {beaconState.previousJustifiedCheckpoint.root && (
                        <span className="checkpoint-hash"> (...{beaconState.previousJustifiedCheckpoint.root.slice(-8)})</span>
                      )}
                    </>
                  ) : (
                    <span className="empty-checkpoint">None</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* FFG Vote Counts - Show votes for current epoch targets */}
          <div className="beacon-section">
            <h3>FFG Vote Counts (Current Epoch Targets)</h3>
            <div className="ffg-votes-container">
              {(() => {
                const ffgVoteCounts = beaconState.ffgVoteCounts || {};
                const epochs = Object.keys(ffgVoteCounts).map(Number).sort((a, b) => b - a);
                
                if (epochs.length === 0) {
                  return <p className="empty-message">No FFG votes yet</p>;
                }
                
                return epochs.slice(0, 3).map(epoch => {
                  const targets = ffgVoteCounts[epoch];
                  const targetRoots = Object.keys(targets);
                  
                  return (
                    <div key={epoch} className="epoch-votes">
                      <h4 className="epoch-votes-title">Epoch {epoch}</h4>
                      {targetRoots.map(targetRoot => {
                        const voters = Array.from(targets[targetRoot] || []);
                        const threshold = Math.ceil((2 * validators.length) / 3);
                        const hasThreshold = voters.length >= threshold;
                        
                        return (
                          <div key={targetRoot} className={`target-votes ${hasThreshold ? 'has-threshold' : ''}`}>
                            <div className="target-header">
                              <span className="target-label">Target: ...{targetRoot.slice(-8)}</span>
                              <span className={`vote-count ${hasThreshold ? 'threshold-met' : ''}`}>
                                {voters.length}/{threshold} votes {hasThreshold && '✓'}
                              </span>
                            </div>
                            <div className="voters-list">
                              {voters.map(voterAddress => {
                                const nodeId = addressToNodeId[voterAddress] || 'Unknown';
                                const nodeColor = getNodeColorCSS(nodeId);
                                const nodeEmoji = getNodeColorEmoji(nodeId);
                                return (
                                  <span 
                                    key={voterAddress} 
                                    className="voter-badge"
                                    style={{ 
                                      backgroundColor: nodeColor,
                                      borderColor: nodeColor
                                    }}
                                    title={`${nodeId} (${voterAddress.slice(0, 8)}...)`}
                                  >
                                    {nodeEmoji} {nodeId}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Validators */}
          <div className="beacon-section">
            <h3>Validators ({validators.length})</h3>
            <div className="validators-list">
              {validators.length === 0 ? (
                <p className="empty-message">No validators registered</p>
              ) : (
                <div className="validators-grid">
                  {validators.map((validator, idx) => {
                    const nodeId = addressToNodeId[validator.nodeAddress] || 'Unknown';
                    const addressSuffix = validator.nodeAddress.slice(-6);
                    const nodeColor = getNodeColorCSS(nodeId);
                    const nodeEmoji = getNodeColorEmoji(nodeId);
                    return (
                      <div 
                        key={idx} 
                        className="validator-item"
                        style={{ borderLeftColor: nodeColor, borderLeftWidth: '4px' }}
                      >
                        <div className="validator-header">
                          <span className="validator-index">#{idx}</span>
                          <span className="validator-stake">{validator.stakedEth} ETH</span>
                        </div>
                        <div className="validator-node-info">
                          <span className="validator-node-id" style={{ color: nodeColor }}>
                            {nodeId} {nodeEmoji}
                          </span>
                          <span className="validator-address-suffix">({addressSuffix})</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RANDAO Mixes */}
          <div className="beacon-section">
            <h3>RANDAO Mixes</h3>
            <div className="randao-list">
              {randaoMixes.length === 0 ? (
                <p className="empty-message">No RANDAO mixes yet</p>
              ) : (
                randaoMixes.map(([epoch, mix]) => (
                  <div key={epoch} className="randao-item">
                    <span className="randao-epoch">Epoch {epoch}:</span>
                    <span className="randao-mix">{mix}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Proposer Schedule Timeline - Compact Visualization */}
          <ProposerScheduleTimeline 
            beaconState={beaconState}
            addressToNodeId={addressToNodeId}
          />

          {/* Latest Attestations (LMD GHOST Fork Choice) */}
          <div className="beacon-section">
            <h3>Latest Attestations (Fork Choice)</h3>
            <div className="beacon-pool-info">
              <span className="beacon-label">Total Validators:</span>
              <span className="beacon-value">{beaconState.latestAttestations.size}</span>
            </div>
            <div className="beacon-pool-list">
              {beaconState.latestAttestations.size === 0 ? (
                <p className="empty-message">No latest attestations</p>
              ) : (
                <div className="attestations-grid-compact">
                  {Array.from(beaconState.latestAttestations.values()).map((attestation, index) => {
                    // Find the block being attested - check tree first (includes forks), then canonical chain
                    let attestedBlock = blockchainTree?.getNode(attestation.blockHash)?.block;
                    if (!attestedBlock) {
                      attestedBlock = blockchain.find((b: Block) => b.hash === attestation.blockHash);
                    }
                    
                    // Debug logging
                    if (!attestedBlock) {
                      console.log(`[BeaconStateView] Cannot find block ${attestation.blockHash.slice(0, 8)} - tree has node:`, !!blockchainTree?.getNode(attestation.blockHash), 'canonical has:', blockchain.some((b: Block) => b.hash === attestation.blockHash));
                    }
                    
                    const blockHeight = attestedBlock ? attestedBlock.header.height : '?';
                    
                    // Get node name (color) from address using context
                    const nodeName = addressToNodeId[attestation.validatorAddress] || 'Unknown';
                    
                    // Check if canonical for modal data
                    const isCanonical = blockchain.some((b: Block) => b.hash === attestation.blockHash);

                    return (
                      <AttestationCircle
                        key={`latest-${attestation.validatorAddress}-${attestation.timestamp}-${index}`}
                        attestation={attestation}
                        blocks={blockchain}
                        addressToNodeId={addressToNodeId}
                        onClick={() => setSelectedAttestation({ ...attestation, blockHeight, nodeName, isCanonical })}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Beacon Pool (Attestations) */}
          <div className="beacon-section">
            <h3>Beacon Pool (Attestations)</h3>
            <div className="beacon-pool-info">
              <span className="beacon-label">Total Attestations:</span>
              <span className="beacon-value">{beaconState.beaconPool.length}</span>
            </div>
            <div className="beacon-pool-list">
              {beaconState.beaconPool.length === 0 ? (
                <p className="empty-message">No attestations in beacon pool</p>
              ) : (
                <div className="attestations-grid-compact">
                  {beaconState.beaconPool.slice().reverse().map((attestation, index) => {
                    // Find the block being attested - check tree first (includes forks), then canonical chain
                    let attestedBlock = blockchainTree?.getNode(attestation.blockHash)?.block;
                    if (!attestedBlock) {
                      attestedBlock = blockchain.find((b: Block) => b.hash === attestation.blockHash);
                    }
                    const blockHeight = attestedBlock ? attestedBlock.header.height : '?';
                    
                    // Get node name (color) from address using context
                    const nodeName = addressToNodeId[attestation.validatorAddress] || 'Unknown';
                    
                    // Check if canonical for modal data
                    const isCanonical = blockchain.some((b: Block) => b.hash === attestation.blockHash);

                    return (
                      <AttestationCircle
                        key={`${attestation.validatorAddress}-${attestation.timestamp}-${index}`}
                        attestation={attestation}
                        blocks={blockchain}
                        addressToNodeId={addressToNodeId}
                        onClick={() => setSelectedAttestation({ ...attestation, blockHeight, nodeName, isCanonical })}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="beacon-modal-footer">
          <button className="beacon-button" onClick={onClose}>Close</button>
        </div>
      </div>
      
      {/* Attestation Detail Modal */}
      {selectedAttestation && (
        <div className="block-modal-overlay" onClick={() => setSelectedAttestation(null)}>
          <div className="block-modal attestation-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Attestation Details</h3>
              <button className="close-button" onClick={() => setSelectedAttestation(null)}>×</button>
            </div>
            
            <div className="block-modal-content">
              <div className="attestation-detail-section">
                <div className="info-row">
                  <span className="info-label">Validator Node:</span>
                  <span className="info-value" style={{ color: getNodeColorCSS(selectedAttestation.nodeName), fontWeight: 'bold' }}>
                    {selectedAttestation.nodeName}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Validator Address:</span>
                  <span className="info-value hash-value">{selectedAttestation.validatorAddress}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Hash:</span>
                  <span className="info-value hash-value">{selectedAttestation.blockHash}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Height:</span>
                  <span className="info-value">{selectedAttestation.blockHeight}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Timestamp:</span>
                  <span className="info-value">{new Date(selectedAttestation.timestamp).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Canonical Chain:</span>
                  <span className="info-value">
                    {selectedAttestation.isCanonical ? 
                      <span className="valid-hash">Yes ✓</span> : 
                      <span className="invalid-hash">No (Forked)</span>
                    }
                  </span>
                </div>
              </div>
              
              <div className="attestation-raw-data">
                <h4>Raw Data</h4>
                <pre className="raw-data-display">
                  {JSON.stringify({
                    validatorAddress: selectedAttestation.validatorAddress,
                    blockHash: selectedAttestation.blockHash,
                    timestamp: selectedAttestation.timestamp
                  }, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BeaconStateView;


================================================================================
// FILE: app/components/BlockTreeView.tsx
================================================================================

import React, { useMemo, useState } from 'react';
import Tree from 'react-d3-tree';
import { BlockchainTree, BlockTreeNode } from '../../core/blockchain/blockchainTree';
import { Block } from '../../types/types';
import { calculateBlockHeaderHash } from '../../core/validation/blockValidator';
import { isHashBelowCeiling } from '../../utils/cryptoUtils';
import { SimulatorConfig } from '../../config/config';
import TransactionView from './TransactionView';
import AttestationCircle from './AttestationCircle';
import { getNodeColorCSS } from '../../utils/nodeColorUtils';
import { MdContentCopy, MdCheck } from 'react-icons/md';
import { BiFork } from 'react-icons/bi';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import './BlockTreeView.css';

interface BlockTreeViewProps {
  blockchainTree: BlockchainTree;
  beaconState?: any; // Optional beacon state for showing latest attestations
  onClose: () => void;
}

interface TreeNodeData {
  name: string;
  attributes?: {
    height?: string;
    hash?: string;
    canonical?: string;
    invalid?: string;
  };
  children?: TreeNodeData[];
}

/**
 * BlockTreeView - Visualizes the blockchain tree structure using react-d3-tree
 * Shows null root, all genesis blocks, and all forks with canonical chain highlighted
 */
const BlockTreeView: React.FC<BlockTreeViewProps> = ({ blockchainTree, beaconState, onClose }) => {
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [isSelectedBlockCanonical, setIsSelectedBlockCanonical] = useState(true);
  const [selectedAttestation, setSelectedAttestation] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateTrigger, setUpdateTrigger] = useState(0);
  const [errorModalData, setErrorModalData] = useState<{blockHash: string; error: string} | null>(null);
  const { addressToNodeId } = useSimulatorContext();
  const stats = blockchainTree.getStats();
  
  // Poll for tree changes to update view in real-time
  React.useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTrigger(prev => prev + 1);
    }, 500); // Update every 500ms
    
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const validateBlockHash = (block: Block) => {
    const hash = calculateBlockHeaderHash(block.header);
    const isValid = true; // PoS blocks don't use PoW hash validation
    const isGenesis = block.header.height === 0;
    return { hash, isValid, isGenesis };
  };
  
  // Convert BlockchainTree to react-d3-tree format
  const treeData = useMemo(() => {
    const root = blockchainTree.getRoot();
    
    // Handle empty tree
    if (!root) {
      return {
        name: 'Empty Tree',
        attributes: { canonical: 'no' }
      };
    }
    
    const canonicalHead = blockchainTree.getCanonicalHead();
    
    // Build set of canonical node hashes (walk from head to genesis)
    const canonicalHashes = new Set<string>();
    let current: BlockTreeNode | null = canonicalHead;
    while (current) {
      canonicalHashes.add(current.hash);
      current = current.parent;
    }
    
    const convertNode = (node: BlockTreeNode): TreeNodeData => {
      const isCanonical = canonicalHashes.has(node.hash);
      const height = node.block.header.height;
      const shortHash = node.hash.slice(-6); // Last 6 characters
      const isGenesis = height === 0;
      const isInvalid = node.metadata?.isInvalid || false;
      
      // Add ❌ to name if invalid
      const blockName = isGenesis ? `Genesis` : `Block ${height}`;
      const displayName = isInvalid ? `❌ ${blockName}` : blockName;
      
      return {
        name: displayName,
        attributes: {
          height: `${height}`,
          hash: shortHash,
          canonical: isCanonical ? 'yes' : isGenesis ? 'genesis' : 'no',
          invalid: isInvalid ? 'yes' : 'no'
        },
        children: node.children.map(convertNode)
      };
    };
    
    return convertNode(root);
  }, [blockchainTree, updateTrigger]);
  
  return (
    <div className="block-tree-modal">
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content block-tree-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Blockchain Tree Structure</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          
          <div className="tree-stats">
            <div className="stat-item">
              <span className="stat-label">Total Blocks:</span>
              <span className="stat-value">{stats.totalBlocks}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Canonical Chain:</span>
              <span className="stat-value">{stats.canonicalChainLength} blocks</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Forks:</span>
              <span className="stat-value">{stats.numberOfForks}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Chain Tips:</span>
              <span className="stat-value">{stats.numberOfLeaves}</span>
            </div>
            
            <div className="legends-container">
              <div className="stat-item legend-stat">
                <span className="stat-label">Legend:</span>
                <div className="legend-items">
                  <span className="legend-item"><span className="legend-dot root"></span> Genesis</span>
                  <span className="legend-item"><span className="legend-dot canonical"></span> Canonical</span>
                  <span 
                    className="legend-item" 
                    title="LMD-GHOST HEAD: Latest Message Driven - Greedy Heaviest Observed SubTree. The canonical chain head chosen by following the fork with the most attested ETH at each branch."
                  >
                    <span className="legend-dot ghost-head"></span> LMD GHOST HEAD
                  </span>
                  <span className="legend-item"><span className="legend-dot fork"></span> Fork</span>
                  <span className="legend-item legend-attestations">
                    <span className="attestation-color-dot green"></span>
                    <span className="attestation-color-dot yellow"></span>
                    <span className="attestation-color-dot red"></span>
                    <span className="attestation-color-dot blue"></span>
                    Latest Attestations
                  </span>
                </div>
              </div>
              <div className="stat-item legend-stat">
                <span className="stat-label">Casper FFG:</span>
                <div className="legend-items">
                  <span 
                    className="legend-item" 
                    title="Finalized Checkpoint: Block has reached finality with 2/3+ validator votes across consecutive epochs. Cannot be reverted (irreversible)."
                  >
                    <span className="checkpoint-badge finalized">Finalized</span>
                  </span>
                  <span 
                    className="legend-item" 
                    title="Justified Checkpoint: Block has received 2/3+ validator votes. Candidate for finalization if next epoch is also justified."
                  >
                    <span className="checkpoint-badge justified">Justified</span>
                  </span>
                  <span 
                    className="legend-item" 
                    title="Previous Justified Checkpoint: The justified checkpoint from the previous epoch. Used as source for new attestations."
                  >
                    <span className="checkpoint-badge prev-justified">Prev Justified</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tree-container">
            <Tree
              data={treeData}
              orientation="vertical"
              pathFunc="step"
              translate={{ x: 400, y: 50 }}
              nodeSize={{ x: 220, y: 120 }}
              separation={{ siblings: 2, nonSiblings: 2.5 }}
              zoom={0.7}
              scaleExtent={{ min: 0.1, max: 2 }}
              enableLegacyTransitions={true}
              pathClassFunc={() => 'tree-link'}
              renderCustomNodeElement={(rd3tProps) => {
                const { nodeDatum } = rd3tProps;
                const isCanonical = nodeDatum.attributes?.canonical === 'yes';
                const isRoot = nodeDatum.attributes?.canonical === 'root';
                
                // Find the actual block from the tree by searching all nodes
                let blockNode: BlockTreeNode | null = null;
                if (nodeDatum.attributes?.hash && !isRoot) {
                  // Search through all nodes in the tree to find matching hash
                  const allNodes = Array.from(blockchainTree['nodesByHash'].values());
                  blockNode = allNodes.find(node => 
                    node.block && node.hash.slice(-6) === nodeDatum.attributes?.hash
                  ) || null;
                }
                
                // Check if this node is the GHOST-HEAD
                const ghostHeadNode = blockchainTree.getGhostHead();
                const isGhostHead = ghostHeadNode && blockNode && ghostHeadNode.hash === blockNode.hash;
                
                // Check if this node is a Casper FFG checkpoint
                let checkpointLabel = '';
                let checkpointType: 'finalized' | 'justified' | 'prev-justified' | '' = '';
                
                if (beaconState && blockNode?.hash) {
                  const isFinalized = beaconState.finalizedCheckpoint?.root === blockNode.hash;
                  const isJustified = beaconState.justifiedCheckpoint?.root === blockNode.hash;
                  const isPrevJustified = beaconState.previousJustifiedCheckpoint?.root === blockNode.hash;
                  
                  // Combine labels if block is both prev justified and finalized
                  if (isFinalized && isPrevJustified) {
                    checkpointLabel = 'Prev Justified + Finalized';
                    checkpointType = 'finalized';
                  } else if (isFinalized) {
                    checkpointLabel = 'Finalized';
                    checkpointType = 'finalized';
                  } else if (isJustified) {
                    checkpointLabel = 'Justified';
                    checkpointType = 'justified';
                  } else if (isPrevJustified) {
                    checkpointLabel = 'Prev Justified';
                    checkpointType = 'prev-justified';
                  }
                }
                
                const handleClick = () => {
                  if (blockNode?.block) {
                    // If block is invalid, show error modal instead of block details
                    if (blockNode.metadata?.isInvalid && blockNode.metadata?.validationError) {
                      setErrorModalData({
                        blockHash: blockNode.hash,
                        error: blockNode.metadata.validationError
                      });
                    } else {
                      setSelectedBlock(blockNode.block);
                      setIsSelectedBlockCanonical(isCanonical);
                    }
                  }
                };
                
                return (
                  <g 
                    onClick={handleClick}
                    style={{ cursor: blockNode?.block ? 'pointer' : 'default' }}
                    className={isCanonical && !isRoot ? 'tree-node canonical-node' : 'tree-node'}
                  >
                    {/* Main circle - larger to fit text */}
                    <circle
                      r={30}
                      fill={isRoot ? '#4d4d4d' : isCanonical ? '#667eea' : '#6c757d'}
                      stroke={isGhostHead ? '#ff9800' : isRoot ? 'none' : isCanonical ? '#764ba2' : '#95a5a6'}
                      strokeWidth={isGhostHead ? 3 : isRoot ? 0 : 2}
                    />
                    
                    {/* LMD GHOST HEAD text for GHOST-HEAD node - positioned to the left */}
                    {isGhostHead && (
                      <g transform="translate(-150, 0)">
                        <foreignObject width="110" height="20">
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            color: '#ff9800',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.5px'
                          }}>
                            LMD GHOST HEAD
                          </div>
                        </foreignObject>
                      </g>
                    )}
                    
                    {/* Casper FFG Checkpoint label - purple box with white text, two lines */}
                    {checkpointLabel && (
                      <g transform={isGhostHead ? "translate(-40, 10)" : "translate(-40, -15)"}>
                        <foreignObject x="-140" y="0" width="210" height="40" style={{ pointerEvents: 'none' }}>
                          <div 
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: '6px',
                              width: '100%',
                              pointerEvents: 'none'
                            }}
                            title={
                              checkpointType === 'finalized' 
                                ? 'Finalized Checkpoint: Block has reached finality with 2/3+ validator votes across consecutive epochs. Cannot be reverted (irreversible).'
                                : checkpointType === 'justified'
                                ? 'Justified Checkpoint: Block has received 2/3+ validator votes. Candidate for finalization if next epoch is also justified.'
                                : 'Previous Justified Checkpoint: The justified checkpoint from the previous epoch. Used as source for new attestations.'
                            }
                          >
                            <div style={{
                              backgroundColor: checkpointType === 'finalized' ? '#6a1b9a' : checkpointType === 'justified' ? '#9b59b6' : '#ab47bc',
                              color: 'white',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '8px',
                              fontWeight: 'bold',
                              lineHeight: '1.3',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.2)',
                              textAlign: 'center'
                            }}>
                              <div>Casper FFG Checkpoint</div>
                              <div style={{ fontSize: '9px', marginTop: '1px' }}>{checkpointLabel}</div>
                            </div>
                            <span style={{ fontSize: '14px', color: checkpointType === 'finalized' ? '#6a1b9a' : '#9b59b6' }}>→</span>
                          </div>
                        </foreignObject>
                      </g>
                    )}
                    
                    {/* Fork icon for non-canonical blocks - positioned outside to the right */}
                    {!isCanonical && !isRoot && (
                      <g transform="translate(35, -2)">
                        <foreignObject width="16" height="16">
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            color: '#95a5a6',
                            fontSize: '16px'
                          }}>
                            <BiFork />
                          </div>
                        </foreignObject>
                      </g>
                    )}
                    
                    {/* Attested ETH - blue color with two lines */}
                    {!isRoot && blockNode?.metadata?.attestedEth !== undefined && blockNode.metadata.attestedEth > 0 && (
                      <>
                        <text
                          fill="#667eea"
                          stroke="none"
                          x={!isCanonical ? 55 : 40}
                          y="2"
                          textAnchor="start"
                          fontSize="11"
                          fontWeight="bold"
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {blockNode.metadata.attestedEth} ETH
                        </text>
                        <text
                          fill="#667eea"
                          stroke="none"
                          x={!isCanonical ? 55 : 40}
                          y="13"
                          textAnchor="start"
                          fontSize="9"
                          fontWeight="normal"
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          Attested
                        </text>
                        
                        {/* Attestation circles - with stopPropagation to prevent block modal */}
                        {beaconState && (() => {
                          const attestationsForThisBlock = Array.from(beaconState.latestAttestations?.values() || [])
                            .filter((att: any) => att.blockHash === blockNode.hash);
                          
                          if (attestationsForThisBlock.length === 0) return null;
                          
                          const allBlocks = blockchainTree.getAllBlocks();
                          const baseX = (!isCanonical ? 55 : 40) + 50;
                          
                          return attestationsForThisBlock.map((att: any, idx: number) => {
                            const attestedBlock = allBlocks.find((b: Block) => b.hash === att.blockHash);
                            const blockHeight = attestedBlock ? attestedBlock.header.height : '?';
                            const nodeName = addressToNodeId[att.validatorAddress] || 'Unknown';
                            const isCanonical = allBlocks.some((b: Block) => b.hash === att.blockHash);
                            
                            return (
                              <foreignObject
                                key={`att-circle-${idx}`}
                                x={baseX + (idx * 65)}
                                y="-27"
                                width="60"
                                height="60"
                                onClick={(e: any) => {
                                  e.stopPropagation();
                                  setSelectedAttestation({ ...att, blockHeight, nodeName, isCanonical });
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <AttestationCircle
                                  attestation={att}
                                  blocks={allBlocks}
                                  addressToNodeId={addressToNodeId}
                                  simplified={true}
                                  size={55}
                                />
                              </foreignObject>
                            );
                          });
                        })()}
                      </>
                    )}
                    
                    {/* Block name or empty set symbol inside circle */}
                    <text
                      fill="#ffffff"
                      stroke="none"
                      x="0"
                      y="5"
                      textAnchor="middle"
                      fontSize={isRoot ? "24" : "14"}
                      fontWeight="bold"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {isRoot ? '∅' : nodeDatum.name}
                    </text>
                    
                    {/* Hash below circle - white and bold (only for non-root blocks) */}
                    {nodeDatum.attributes?.hash && !isRoot && (
                      <text
                        fill="#ffffff"
                        stroke="none"
                        x="0"
                        y="50"
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="bold"
                        fontFamily="monospace"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {nodeDatum.attributes.hash}
                      </text>
                    )}
                  </g>
                );
              }}
            />
          </div>
        </div>
      </div>

      {/* Block Detail Modal - Using BlockchainView style */}
      {selectedBlock && (
        <div className="block-modal-overlay" onClick={() => setSelectedBlock(null)}>
          <div className="block-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Block {selectedBlock.header.height}</h3>
              <div className="modal-header-actions">
                <button 
                  className="copy-button" 
                  onClick={() => copyToClipboard(JSON.stringify(selectedBlock, null, 2))}
                  title="Copy block data"
                >
                  {copied ? <MdCheck /> : <MdContentCopy />}
                </button>
                <button className="close-button" onClick={() => setSelectedBlock(null)}>×</button>
              </div>
            </div>

            {/* Non-Canonical Warning Banner */}
            {!isSelectedBlockCanonical && (
              <div className="non-canonical-warning">
                ⚠️ <strong>Warning:</strong> This block is NOT on the canonical chain. It is part of a fork branch that was not selected as the main chain.
              </div>
            )}
            
            <div className="block-modal-content">
              <div className="block-info">
                <div className="info-row">
                  <span className="info-label">Height:</span>
                  <span className="info-value">{selectedBlock.header.height}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Slot:</span>
                  <span className="info-value">{selectedBlock.header.slot}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Hash:</span>
                  <span className="info-value hash-value">0x{calculateBlockHeaderHash(selectedBlock.header)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Previous Hash:</span>
                  <span className="info-value hash-value">0x{selectedBlock.header.previousHeaderHash}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Nonce:</span>
                  <span className="info-value">{selectedBlock.header.nonce}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Timestamp:</span>
                  <span className="info-value">{new Date(selectedBlock.header.timestamp).toLocaleString()}</span>
                </div>
                {selectedBlock.randaoReveal && (
                  <div className="info-row">
                    <span className="info-label">RANDAO Reveal:</span>
                    <span className="info-value hash-value">{selectedBlock.randaoReveal.slice(0, 16)}...{selectedBlock.randaoReveal.slice(-8)}</span>
                  </div>
                )}
                <div className="modal-row">
                  <div className="modal-label">Valid Hash:</div>
                  <div className="modal-value">
                    {validateBlockHash(selectedBlock).isGenesis ? (
                      <span className="genesis-hash">Genesis Block (Always Valid)</span>
                    ) : validateBlockHash(selectedBlock).isValid ? (
                      <span className="valid-hash">Yes ✓</span>
                    ) : (
                      <span className="invalid-hash">No ✗</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="transactions-container">
                <h3>Transactions ({selectedBlock.transactions.length})</h3>
                
                {selectedBlock.transactions.map((tx, index) => (
                  <TransactionView 
                    key={index} 
                    transaction={tx} 
                  />
                ))}
              </div>

              {/* Attestations Section */}
              {selectedBlock.attestations && Array.isArray(selectedBlock.attestations) && selectedBlock.attestations.length > 0 && (
                <div className="attestations-section">
                  <h3>Included Attestations ({selectedBlock.attestations.length})</h3>
                  <p className="section-description">
                    Attestations are votes from validators supporting blocks in the canonical chain and voting for Casper FFG finality checkpoints.
                  </p>
                  
                  {selectedBlock.attestations.map((attestation: any, index: number) => {
                    const validatorNodeId = addressToNodeId.get(attestation.validatorAddress) || 'Unknown';
                    const validatorColor = getNodeColorCSS(validatorNodeId);
                    
                    return (
                      <div key={index} className="attestation-card">
                        <div className="attestation-validator-header">
                          <span className="validator-label">Validator:</span>
                          <span 
                            className="validator-name" 
                            style={{ color: validatorColor }}
                          >
                            {validatorNodeId}
                          </span>
                          <span className="validator-address">({attestation.validatorAddress.slice(0, 8)}...{attestation.validatorAddress.slice(-6)})</span>
                        </div>
                        
                        <div className="attestation-subsection">
                          <div className="subsection-title">LMD GHOST Vote</div>
                          <div className="subsection-description">Block this validator is voting for as the chain head</div>
                          <div className="attestation-field">
                            <span className="field-label">Attested Block:</span>
                            <span className="field-value">{attestation.blockHash}</span>
                          </div>
                        </div>
                        
                        {attestation.ffgSource && attestation.ffgTarget && (
                          <div className="attestation-subsection">
                            <div className="subsection-title">Casper FFG Finality Vote</div>
                            <div className="subsection-description">Checkpoint votes for Ethereum's finality mechanism</div>
                            <div className="attestation-field">
                              <span className="field-label">Source Checkpoint:</span>
                              <span className="field-value">Epoch {attestation.ffgSource.epoch} → {attestation.ffgSource.root}</span>
                            </div>
                            <div className="attestation-field">
                              <span className="field-label">Target Checkpoint:</span>
                              <span className="field-value">Epoch {attestation.ffgTarget.epoch} → {attestation.ffgTarget.root}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Attestation Detail Modal */}
      {selectedAttestation && (
        <div className="block-modal-overlay" onClick={() => setSelectedAttestation(null)}>
          <div className="block-modal attestation-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Attestation Details</h3>
              <button className="close-button" onClick={() => setSelectedAttestation(null)}>×</button>
            </div>
            
            <div className="block-modal-content">
              <div className="attestation-detail-section">
                <div className="info-row">
                  <span className="info-label">Validator Node:</span>
                  <span className="info-value" style={{ fontWeight: 'bold' }}>
                    {selectedAttestation.nodeName}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Validator Address:</span>
                  <span className="info-value hash-value">{selectedAttestation.validatorAddress}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Hash:</span>
                  <span className="info-value hash-value">{selectedAttestation.blockHash}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Height:</span>
                  <span className="info-value">{selectedAttestation.blockHeight}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Timestamp:</span>
                  <span className="info-value">{new Date(selectedAttestation.timestamp).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Canonical:</span>
                  <span className="info-value">{selectedAttestation.isCanonical ? '✓ Yes' : '✗ No'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Validation Error Modal */}
      {errorModalData && (
        <div className="block-modal-overlay" onClick={() => setErrorModalData(null)}>
          <div className="block-modal" onClick={(e) => e.stopPropagation()}>
            <div className="block-modal-header" style={{ borderBottom: '2px solid #f44336' }}>
              <h3 style={{ color: '#f44336' }}>❌ Validation Error</h3>
              <button className="close-button" onClick={() => setErrorModalData(null)}>×</button>
            </div>
            
            <div className="block-modal-content">
              <div className="attestation-detail-section">
                <div className="info-row">
                  <span className="info-label">Block Hash:</span>
                  <span className="info-value hash-value">{errorModalData.blockHash}</span>
                </div>
                <div className="info-row" style={{ marginTop: '1rem' }}>
                  <span className="info-label">Error:</span>
                  <span className="info-value" style={{ 
                    color: '#f44336', 
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    display: 'block',
                    marginTop: '0.5rem',
                    padding: '1rem',
                    background: 'rgba(244, 67, 54, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(244, 67, 54, 0.3)'
                  }}>
                    {errorModalData.error}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlockTreeView;


================================================================================
// FILE: app/components/BlockchainView.tsx
================================================================================

import React, { useState } from 'react';
import { Block, Account } from '../../types/types';
import { ReceiptsDatabase } from '../../types/receipt';
import { calculateBlockHeaderHash } from '../../core/validation/blockValidator';
import TransactionView from './TransactionView';
import AttestationCircle from './AttestationCircle';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import { getNodeColorCSS, getNodeBackgroundTint } from '../../utils/nodeColorUtils';
import { BiFork } from "react-icons/bi";
import { MdContentCopy, MdCheck } from 'react-icons/md';
import './BlockchainView.css';

interface BlockchainViewProps {
  blocks: Block[];
  worldState?: Record<string, Account>; // Optional world state for smart contract display
  receipts?: ReceiptsDatabase; // Optional receipts database
  beaconState?: any; // Optional beacon state for showing finalized checkpoint
  nodeId?: string; // Node ID for background tinting
}

const BlockchainView: React.FC<BlockchainViewProps> = ({ blocks, worldState, receipts, beaconState, nodeId }) => {
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [selectedAttestation, setSelectedAttestation] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const { forkStartHeight, addressToNodeId } = useSimulatorContext();
  
  // Refs for detecting rows
  const itemRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const blocksContainerRef = React.useRef<HTMLDivElement>(null);
  const [rowEpochs, setRowEpochs] = useState<Array<{ epochRange: string; top: number }>>([]);
  
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Determine if a block is part of a fork
  const isForkedBlock = (block: Block): boolean => {
    if (forkStartHeight === null) return false;
    return block.header.height >= forkStartHeight;
  };
  
  // Check if a block is the finalized Casper FFG checkpoint
  const isFinalizedCheckpoint = (block: Block): boolean => {
    if (!beaconState?.finalizedCheckpoint) return false;
    const blockHash = calculateBlockHeaderHash(block.header);
    return beaconState.finalizedCheckpoint.root === blockHash;
  };
  
  // Check if a block is the LMD-GHOST head
  // The GHOST head is the last block in the canonical chain (highest height)
  const isGhostHead = (block: Block): boolean => {
    if (!blocks || blocks.length === 0) return false;
    
    // Find the block with the highest height (the head of the chain)
    const maxHeight = Math.max(...blocks.map(b => b.header.height));
    const headBlock = blocks.find(b => b.header.height === maxHeight);
    
    if (!headBlock) return false;
    
    const blockHash = calculateBlockHeaderHash(block.header);
    const headHash = calculateBlockHeaderHash(headBlock.header);
    
    return blockHash === headHash;
  };
  
  // Get the last 6 characters of a hash for display
  const shortenHash = (hash: string) => hash.substring(hash.length - 6);
  
  // Sort blocks by height
  const sortedBlocks = [...blocks].sort((a, b) => a.header.height - b.header.height);
  
  // PoS block validation - all blocks are valid by default
  // TODO: Implement BLS signature verification for RANDAO reveals and proposer signatures
  const validateBlockHash = (block: Block) => {
    const hash = calculateBlockHeaderHash(block.header);
    const isValid = true; // PoS blocks don't use PoW hash validation
    const isGenesis = block.header.height === 0;
    return { hash, isValid, isGenesis };
  };
  
  // Create display items including blocks and empty slot placeholders
  const getBlocksForDisplay = () => {
    // Sort blocks by height
    const sorted = [...sortedBlocks].sort((a, b) => a.header.height - b.header.height);
    
    // Create array of display items (blocks + empty slots)
    const displayItems: Array<{ type: 'block' | 'empty-slot', block?: Block, slots?: number[] }> = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const currentBlock = sorted[i];
      const prevBlock = i > 0 ? sorted[i - 1] : null;
      
      // Check for slot gap between consecutive blocks
      if (prevBlock && currentBlock.header.slot > prevBlock.header.slot + 1) {
        const missedSlots: number[] = [];
        for (let slot = prevBlock.header.slot + 1; slot < currentBlock.header.slot; slot++) {
          missedSlots.push(slot);
        }
        
        // Add single empty slot placeholder for the entire range
        displayItems.push({ type: 'empty-slot', slots: missedSlots });
      }
      
      // Add the actual block
      displayItems.push({ type: 'block', block: currentBlock });
    }
    
    return displayItems;
  };
  
  // Determine if a block is the last one in the chain (for arrow display)
  const isLastBlock = (index: number, totalBlocks: number) => {
    // Only the very last block should have no outgoing arrow
    return index === totalBlocks - 1;
  };
  
  const sortedBlocksForDisplay = getBlocksForDisplay();
  
  // Detect actual rows and calculate epochs after render
  React.useEffect(() => {
    if (itemRefs.current.size === 0 || !blocksContainerRef.current) return;
    
    const SLOTS_PER_EPOCH = 4;
    const getEpochForSlot = (slot: number) => Math.floor(slot / SLOTS_PER_EPOCH);
    
    const containerRect = blocksContainerRef.current.getBoundingClientRect();
    
    // Group items by their vertical position (row)
    const rowGroups = new Map<number, { indices: number[]; top: number }>(); // rowTop -> data
    
    itemRefs.current.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      const rowTop = Math.round(rect.top / 10) * 10; // Round to nearest 10px
      
      if (!rowGroups.has(rowTop)) {
        rowGroups.set(rowTop, { indices: [], top: rect.top - containerRect.top });
      }
      rowGroups.get(rowTop)!.indices.push(index);
    });
    
    // Calculate epoch range and position for each row
    const epochs: Array<{ epochRange: string; top: number }> = [];
    Array.from(rowGroups.keys()).sort((a, b) => a - b).forEach(rowTop => {
      const rowData = rowGroups.get(rowTop)!;
      const rowEpochSet = new Set<number>();
      
      rowData.indices.forEach(idx => {
        const item = sortedBlocksForDisplay[idx];
        if (item.type === 'block') {
          rowEpochSet.add(getEpochForSlot(item.block!.header.slot));
        } else {
          item.slots!.forEach(slot => rowEpochSet.add(getEpochForSlot(slot)));
        }
      });
      
      const epochArray = Array.from(rowEpochSet).sort((a, b) => a - b);
      let minEpoch = epochArray[0];
      let maxEpoch = epochArray[epochArray.length - 1];
      
      // Special case: display epoch -1 as epoch 0 for simplicity
      if (minEpoch === -1) minEpoch = 0;
      if (maxEpoch === -1) maxEpoch = 0;
      
      const epochRange = minEpoch === maxEpoch ? `${minEpoch}` : `${minEpoch}-${maxEpoch}`;
      
      // Center the label vertically within the 75px block height
      // Epoch label content is roughly 30px tall, so offset by (75 - 30) / 2 = 22.5px
      epochs.push({ epochRange, top: rowData.top + 22 });
    });
    
    setRowEpochs(epochs);
  }, [sortedBlocksForDisplay]);
  
  return (
    <div className="blockchain-container" style={{ background: nodeId ? getNodeBackgroundTint(nodeId) : undefined }}>
      {/* Epoch column on the left */}
      <div className="epoch-column">
        {rowEpochs.map((epochData, rowIndex) => (
          <div 
            key={`epoch-${rowIndex}`} 
            className="epoch-indicator"
            style={{ top: `${epochData.top}px` }}
          >
            <div className="epoch-indicator-content">
              <div className="epoch-indicator-label">EPOCH</div>
              <div className="epoch-indicator-value">{epochData.epochRange}</div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Blocks container on the right */}
      <div className="blocks-container" ref={blocksContainerRef}>
        <div className="blockchain-row">
          {sortedBlocksForDisplay.map((item, index) => {
            // Handle empty slot placeholders
            if (item.type === 'empty-slot') {
              const slots = item.slots!;
              const firstSlot = slots[0];
              const lastSlot = slots[slots.length - 1];
              
              // For slot numbers >= 100, split "Slot" and the range onto separate lines
              const needsLineBreak = firstSlot >= 100 || lastSlot >= 100;
              
              let slotDisplay;
              if (slots.length === 1) {
                slotDisplay = needsLineBreak ? (
                  <>Slot<br />{firstSlot}</>
                ) : `Slot ${firstSlot}`;
              } else {
                slotDisplay = needsLineBreak ? (
                  <>Slot<br />{firstSlot}-{lastSlot}</>
                ) : `Slot ${firstSlot}-${lastSlot}`;
              }
              
              return (
                <div 
                  key={`empty-slot-${firstSlot}-${lastSlot}`}
                  className="empty-slot-item"
                  ref={(el) => {
                    if (el) itemRefs.current.set(index, el);
                  }}
                >
                  <div className="empty-slot-content">
                    <div className="empty-slot-label">EMPTY</div>
                    <div className="empty-slot-number">{slotDisplay}</div>
                  </div>
                </div>
              );
            }
            
            // Handle actual blocks
            const block = item.block!;
            const { hash, isValid, isGenesis } = validateBlockHash(block);
            const isLast = isLastBlock(index, sortedBlocksForDisplay.length);
            const isFinalized = isFinalizedCheckpoint(block);
            const isGhost = isGhostHead(block);
            const isForked = isForkedBlock(block);
            
            return (
              <div 
                key={hash} 
                className={`block-item ${selectedBlock === block ? 'selected' : ''} ${isGenesis ? 'genesis-block' : ''} ${isLast ? 'last-in-row' : ''} ${isForked ? 'forked-block' : ''} ${isFinalized ? 'finalized-checkpoint' : ''} ${isGhost ? 'ghost-head-block' : ''}`}
                onClick={() => setSelectedBlock(block === selectedBlock ? null : block)}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el);
                }}
              >
                <div className="block-height">{block.header.height}</div>
                <div className="block-hash">{shortenHash(hash)}</div>
                <div className="block-validation">
                  {isGenesis ? 
                    <span className="genesis-text">GENESIS</span> :
                    isValid ? 
                      <span className="valid-block">✓</span> : 
                      <span className="invalid-block">✗</span>
                  }
                </div>
                <div className="block-counts-row">
                  <div className="block-tx-count">{block.transactions.length} tx</div>
                  {block.attestations && block.attestations.length > 0 && (
                    <div className="block-attestation-count">{block.attestations.length} att</div>
                  )}
                </div>
                {isForkedBlock(block) && <div className="fork-icon"><BiFork /></div>}
              </div>
            );
          })}
        </div>
      </div>
      
      {selectedBlock && (
        <div className="block-modal-overlay" onClick={() => setSelectedBlock(null)}>
          <div className="block-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Block {selectedBlock.header.height}</h3>
              <div className="modal-header-actions">
                <button 
                  className="copy-button" 
                  onClick={() => copyToClipboard(JSON.stringify(selectedBlock, null, 2))}
                  title="Copy block data"
                >
                  {copied ? <MdCheck /> : <MdContentCopy />}
                </button>
                <button className="close-button" onClick={() => setSelectedBlock(null)}>×</button>
              </div>
            </div>
            
            <div className="block-modal-content">
              <div className="block-info">
                <div className="info-row">
                  <span className="info-label">Height:</span>
                  <span className="info-value">{selectedBlock.header.height}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Slot:</span>
                  <span className="info-value">{selectedBlock.header.slot}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Hash:</span>
                  <span className="info-value hash-value">0x{calculateBlockHeaderHash(selectedBlock.header)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Previous Hash:</span>
                  <span className="info-value hash-value">0x{selectedBlock.header.previousHeaderHash}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Nonce:</span>
                  <span className="info-value">{selectedBlock.header.nonce}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Timestamp:</span>
                  <span className="info-value">{new Date(selectedBlock.header.timestamp).toLocaleString()}</span>
                </div>
                {selectedBlock.randaoReveal && (
                  <div className="info-row">
                    <span className="info-label">RANDAO Reveal:</span>
                    <span className="info-value hash-value">{selectedBlock.randaoReveal.slice(0, 16)}...{selectedBlock.randaoReveal.slice(-8)}</span>
                  </div>
                )}
                <div className="modal-row">
                  <div className="modal-label">Valid Hash:</div>
                  <div className="modal-value">
                    {validateBlockHash(selectedBlock).isGenesis ? (
                      <span className="genesis-hash">Genesis Block (Always Valid)</span>
                    ) : validateBlockHash(selectedBlock).isValid ? (
                      <span className="valid-hash">Yes ✓</span>
                    ) : (
                      <span className="invalid-hash">No ✗</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="transactions-container">
                <h3>Transactions ({selectedBlock.transactions.length})</h3>
                
                {selectedBlock.transactions.map((tx, index) => {
                  // Look up receipt for this transaction
                  const receipt = receipts && selectedBlock.hash && receipts[selectedBlock.hash] 
                    ? receipts[selectedBlock.hash][tx.txid] 
                    : undefined;
                  
                  return (
                    <TransactionView 
                      key={index} 
                      transaction={tx} 
                      worldState={worldState}
                      receipt={receipt}
                    />
                  );
                })}
              </div>
              
              {/* Attestations Section */}
              {selectedBlock.attestations && Array.isArray(selectedBlock.attestations) && selectedBlock.attestations.length > 0 && (
                <div className="attestations-section">
                  <h3>Included Attestations ({selectedBlock.attestations.length})</h3>
                  <p className="section-description">
                    Attestations are votes from validators supporting blocks in the canonical chain and voting for Casper FFG finality checkpoints.
                  </p>
                  
                  {selectedBlock.attestations.map((attestation: any, index: number) => {
                    const validatorNodeId = addressToNodeId[attestation.validatorAddress] || 'Unknown';
                    const validatorColor = getNodeColorCSS(validatorNodeId);
                    
                    return (
                      <div key={index} className="attestation-card">
                        <div className="attestation-validator-header">
                          <span className="validator-label">Validator:</span>
                          <span 
                            className="validator-name" 
                            style={{ color: validatorColor }}
                          >
                            {validatorNodeId}
                          </span>
                          <span className="validator-address">({attestation.validatorAddress.slice(0, 8)}...{attestation.validatorAddress.slice(-6)})</span>
                        </div>
                        
                        <div className="attestation-subsection">
                          <div className="subsection-title">LMD GHOST Vote</div>
                          <div className="subsection-description">Block this validator is voting for as the chain head</div>
                          <div className="attestation-field">
                            <span className="field-label">Attested Block:</span>
                            <span className="field-value">{attestation.blockHash}</span>
                          </div>
                        </div>
                        
                        {attestation.ffgSource && attestation.ffgTarget && (
                          <div className="attestation-subsection">
                            <div className="subsection-title">Casper FFG Finality Vote</div>
                            <div className="subsection-description">Checkpoint votes for Ethereum's finality mechanism</div>
                            <div className="attestation-field">
                              <span className="field-label">Source Checkpoint:</span>
                              <span className="field-value">Epoch {attestation.ffgSource.epoch} → {attestation.ffgSource.root}</span>
                            </div>
                            <div className="attestation-field">
                              <span className="field-label">Target Checkpoint:</span>
                              <span className="field-value">Epoch {attestation.ffgTarget.epoch} → {attestation.ffgTarget.root}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Attestation Detail Modal */}
      {selectedAttestation && (
        <div className="block-modal-overlay" onClick={() => setSelectedAttestation(null)}>
          <div className="block-modal attestation-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Attestation Details</h3>
              <button className="close-button" onClick={() => setSelectedAttestation(null)}>×</button>
            </div>
            
            <div className="block-modal-content">
              <div className="attestation-detail-section">
                <div className="info-row">
                  <span className="info-label">Validator Node:</span>
                  <span className="info-value" style={{ color: getNodeColorCSS(selectedAttestation.nodeName), fontWeight: 'bold' }}>
                    {selectedAttestation.nodeName}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Validator Address:</span>
                  <span className="info-value hash-value">{selectedAttestation.validatorAddress}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Hash:</span>
                  <span className="info-value hash-value">{selectedAttestation.blockHash}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Block Height:</span>
                  <span className="info-value">{selectedAttestation.blockHeight}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Timestamp:</span>
                  <span className="info-value">{new Date(selectedAttestation.timestamp).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Canonical Chain:</span>
                  <span className="info-value">
                    {selectedAttestation.isCanonical ? 
                      <span className="valid-hash">Yes ✓</span> : 
                      <span className="invalid-hash">No (Forked)</span>
                    }
                  </span>
                </div>
              </div>
              
              <div className="attestation-raw-data">
                <h4>Raw Data</h4>
                <pre className="raw-data-display">
                  {JSON.stringify({
                    validatorAddress: selectedAttestation.validatorAddress,
                    blockHash: selectedAttestation.blockHash,
                    timestamp: selectedAttestation.timestamp
                  }, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlockchainView;


================================================================================
// FILE: app/components/EPMDisplay.tsx
================================================================================

/**
 * EPMDisplay Component
 * 
 * Pure display component that visualizes an EPM contract account.
 * Takes an Account with EPM storage and renders the painted Pokemon.
 * 
 * This component handles all the visual rendering logic:
 * - Loading the Pokemon PNG
 * - Reading original pixel colors
 * - Tinting pixels based on paint colors
 * - Preserving original shading with color tint
 */

import React from 'react';
import { Account } from '../../types/types';
import { EPMStorage, PaintColor } from '../../core/epm/EPM';
import './EPMDisplay.css';

// Import all Pokemon images
import bulbasaur from '../../core/epm/pokemon/bulbasaur.png';
import charmander from '../../core/epm/pokemon/charmander.png';
import hippo from '../../core/epm/pokemon/hippo.png';
import squirtle from '../../core/epm/pokemon/squirtle.png';

// Map image filenames to imported images
const POKEMON_IMAGES: Record<string, string> = {
  'bulbasaur.png': bulbasaur,
  'charmander.png': charmander,
  'hippo.png': hippo,
  'squirtle.png': squirtle,
};

interface EPMDisplayProps {
  account: Account;
}

/**
 * Display component for EPM contract visualization
 */
const EPMDisplay: React.FC<EPMDisplayProps> = ({ account }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [layoutReady, setLayoutReady] = React.useState(false);
  const [showStorage, setShowStorage] = React.useState(false);
  const storage = account.storage as EPMStorage;
  
  // Force layout recalculation after mount to fix initial render glitch
  React.useEffect(() => {
    const timer = setTimeout(() => setLayoutReady(true), 10);
    return () => clearTimeout(timer);
  }, []);
  
  React.useEffect(() => {
    if (!canvasRef.current || !storage || !layoutReady) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get the Pokemon image based on the account's code field
    const imageFilename = account.code || 'squirtle.png'; // Default to squirtle
    const imageSrc = POKEMON_IMAGES[imageFilename];
    
    if (!imageSrc) {
      console.error(`Unknown Pokemon image: ${imageFilename}`);
      return;
    }
    
    // Load the Pokemon PNG
    const img = new Image();
    img.src = imageSrc;
    
    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Create a temporary canvas to read the original image pixels
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;
      
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      tempCtx.drawImage(img, 0, 0);
      
      // Get the image data to read original pixel colors
      const originalImageData = tempCtx.getImageData(0, 0, img.width, img.height);
      const originalPixels = originalImageData.data;
      
      // Calculate pixel size for grid mapping
      const pixelWidth = img.width / storage.width;
      const pixelHeight = img.height / storage.height;
      
      // Render each painted grid cell
      for (let y = 0; y < storage.height; y++) {
        for (let x = 0; x < storage.width; x++) {
          const colorId = storage.pixels[y][x];
          
          // Only render painted pixels
          if (colorId > 0) {
            // Get the tint color RGB values
            let tintR = 0, tintG = 0, tintB = 0;
            switch (colorId) {
              case PaintColor.BLUE: tintR = 59; tintG = 130; tintB = 246; break;
              case PaintColor.GREEN: tintR = 16; tintG = 185; tintB = 129; break;
              case PaintColor.RED: tintR = 239; tintG = 68; tintB = 68; break;
              case PaintColor.YELLOW: tintR = 251; tintG = 191; tintB = 36; break;
            }
            
            // Calculate pixel bounds for this grid cell
            const startX = Math.floor(x * pixelWidth);
            const startY = Math.floor(y * pixelHeight);
            const endX = Math.ceil((x + 1) * pixelWidth);
            const endY = Math.ceil((y + 1) * pixelHeight);
            
            // Tint each pixel in this grid cell
            for (let py = startY; py < endY && py < img.height; py++) {
              for (let px = startX; px < endX && px < img.width; px++) {
                const idx = (py * img.width + px) * 4;
                const origR = originalPixels[idx];
                const origG = originalPixels[idx + 1];
                const origB = originalPixels[idx + 2];
                const alpha = originalPixels[idx + 3];
                
                // Only tint non-transparent pixels
                if (alpha > 0) {
                  // Calculate brightness of original pixel (0-1)
                  const brightness = (origR + origG + origB) / (3 * 255);
                  
                  // Add minimum brightness bias so dark pixels show color
                  // This makes black outlines appear as dark colored instead of pure black
                  const minBrightness = 0.2; // 20% minimum brightness
                  const adjustedBrightness = minBrightness + (brightness * (1 - minBrightness));
                  
                  // Apply tint while preserving brightness gradient
                  const newR = tintR * adjustedBrightness;
                  const newG = tintG * adjustedBrightness;
                  const newB = tintB * adjustedBrightness;
                  
                  // Draw the tinted pixel
                  ctx.fillStyle = `rgb(${newR}, ${newG}, ${newB})`;
                  ctx.fillRect(px, py, 1, 1);
                }
              }
            }
          }
        }
      }
    };
  }, [storage, layoutReady]);
  
  if (!storage) {
    return <div className="epm-display-error">No EPM contract storage found</div>;
  }
  
  // Calculate color statistics at runtime (not stored in contract)
  const totalPixels = storage.totalPixels;
  const colorCounts = storage.colorCounts;
  const unpaintedCount = totalPixels - Object.values(colorCounts).reduce((sum, count) => sum + count, 0);
  
  // Calculate percentages
  const bluePercent = (colorCounts[PaintColor.BLUE] / totalPixels * 100).toFixed(1);
  const greenPercent = (colorCounts[PaintColor.GREEN] / totalPixels * 100).toFixed(1);
  const redPercent = (colorCounts[PaintColor.RED] / totalPixels * 100).toFixed(1);
  const yellowPercent = (colorCounts[PaintColor.YELLOW] / totalPixels * 100).toFixed(1);
  const unpaintedPercent = (unpaintedCount / totalPixels * 100).toFixed(1);
  
  // Determine if painting is complete
  const isPaintingComplete = unpaintedCount === 0;
  
  return (
    <div className="epm-display">
      <div className="epm-content">
        <div className="epm-canvas-container">
          <canvas ref={canvasRef} className="epm-canvas" />
        </div>
        
        <div className="epm-stats">
          <div className="stats-header">
            <h3>Paint Statistics</h3>
            <button 
              className="storage-toggle-btn"
              onClick={() => setShowStorage(!showStorage)}
              title="View full contract storage"
            >
              {showStorage ? '📊 Stats' : '🔍 Storage'}
            </button>
          </div>
          
          {showStorage ? (
            /* Full Storage View */
            <div className="storage-view">
              <h4>Contract Storage</h4>
              <div className="storage-content">
                <div className="storage-section">
                  <strong>Balance:</strong> {account.balance} ETH
                </div>
                <div className="storage-section">
                  <strong>Nonce:</strong> {account.nonce}
                </div>
                <div className="storage-section">
                  <strong>Code:</strong> {account.code || 'N/A'}
                </div>
                <div className="storage-section">
                  <strong>Total Pixels:</strong> {storage.totalPixels}
                </div>
                <div className="storage-section">
                  <strong>Dimensions:</strong> {storage.width} x {storage.height}
                </div>
                <div className="storage-section">
                  <strong>Pixels Array:</strong>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    {storage.height} x {storage.width} grid stored on-chain
                  </div>
                  <pre style={{ maxHeight: '150px', overflow: 'auto' }}>
                    {JSON.stringify(storage.pixels.slice(0, 10), null, 2)}
                    {storage.pixels.length > 10 && '\n... (showing first 10 rows)'}
                  </pre>
                </div>
                <div className="storage-section">
                  <strong>Color Counts:</strong>
                  <pre>{JSON.stringify(storage.colorCounts, null, 2)}</pre>
                </div>
                <div className="storage-section">
                  <strong>Color Painters:</strong>
                  <pre>{JSON.stringify(storage.colorPainters, null, 2)}</pre>
                </div>
                {storage.winnerColor && (
                  <>
                    <div className="storage-section">
                      <strong>Winner Color:</strong> {storage.winnerColor}
                    </div>
                    <div className="storage-section">
                      <strong>Winner Address:</strong> {storage.winnerAddress}
                    </div>
                    <div className="storage-section">
                      <strong>Reward Amount:</strong> {storage.rewardAmount} ETH
                    </div>
                    <div className="storage-section">
                      <strong>Completed At Block:</strong> {storage.completedAtBlock?.substring(0, 16)}...
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Stats View */
            <>
          {/* Pie Chart */}
          <div className="epm-pie-chart">
            <svg viewBox="0 0 100 100" className="pie-svg">
              {/* Calculate pie slices */}
              {(() => {
                let currentAngle = 0;
                const slices = [];
                
                // Helper to create pie slice path
                const createSlice = (percent: number, color: string) => {
                  if (percent === 0) return null;
                  
                  // Special case: if 100%, draw a full circle instead of a path
                  if (percent >= 99.9) {
                    return (
                      <circle
                        key={color}
                        cx="50"
                        cy="50"
                        r="50"
                        fill={color}
                        stroke="white"
                        strokeWidth="0.5"
                      />
                    );
                  }
                  
                  const startAngle = currentAngle;
                  const angle = (percent / 100) * 360;
                  currentAngle += angle;
                  
                  const startX = 50 + 50 * Math.cos((startAngle - 90) * Math.PI / 180);
                  const startY = 50 + 50 * Math.sin((startAngle - 90) * Math.PI / 180);
                  const endX = 50 + 50 * Math.cos((startAngle + angle - 90) * Math.PI / 180);
                  const endY = 50 + 50 * Math.sin((startAngle + angle - 90) * Math.PI / 180);
                  
                  const largeArc = angle > 180 ? 1 : 0;
                  
                  return (
                    <path
                      key={color}
                      d={`M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`}
                      fill={color}
                      stroke="white"
                      strokeWidth="0.5"
                    />
                  );
                };
                
                slices.push(createSlice(parseFloat(bluePercent), '#3b82f6'));
                slices.push(createSlice(parseFloat(greenPercent), '#22c55e'));
                slices.push(createSlice(parseFloat(redPercent), '#ef4444'));
                slices.push(createSlice(parseFloat(yellowPercent), '#eab308'));
                slices.push(createSlice(parseFloat(unpaintedPercent), '#6b7280'));
                
                return slices;
              })()}
            </svg>
          </div>
          
          {/* Color percentages */}
          <div className="epm-color-stats">
            <div className={`stat-item ${isPaintingComplete && storage.winnerColor === 'blue' ? 'winner-row' : ''}`}>
              <span className="stat-color" style={{ backgroundColor: '#3b82f6' }}>🔵</span>
              <span className="stat-label">Blue:</span>
              <span className="stat-value">{bluePercent}%</span>
              {isPaintingComplete && storage.winnerColor === 'blue' && storage.rewardAmount !== undefined && (
                <span className="reward-badge">🏆 Winner +{storage.rewardAmount.toFixed(2)} ETH</span>
              )}
            </div>
            <div className={`stat-item ${isPaintingComplete && storage.winnerColor === 'green' ? 'winner-row' : ''}`}>
              <span className="stat-color" style={{ backgroundColor: '#22c55e' }}>🟢</span>
              <span className="stat-label">Green:</span>
              <span className="stat-value">{greenPercent}%</span>
              {isPaintingComplete && storage.winnerColor === 'green' && storage.rewardAmount !== undefined && (
                <span className="reward-badge">🏆 Winner +{storage.rewardAmount.toFixed(2)} ETH</span>
              )}
            </div>
            <div className={`stat-item ${isPaintingComplete && storage.winnerColor === 'red' ? 'winner-row' : ''}`}>
              <span className="stat-color" style={{ backgroundColor: '#ef4444' }}>🔴</span>
              <span className="stat-label">Red:</span>
              <span className="stat-value">{redPercent}%</span>
              {isPaintingComplete && storage.winnerColor === 'red' && storage.rewardAmount !== undefined && (
                <span className="reward-badge">🏆 Winner +{storage.rewardAmount.toFixed(2)} ETH</span>
              )}
            </div>
            <div className={`stat-item ${isPaintingComplete && storage.winnerColor === 'yellow' ? 'winner-row' : ''}`}>
              <span className="stat-color" style={{ backgroundColor: '#eab308' }}>🟡</span>
              <span className="stat-label">Yellow:</span>
              <span className="stat-value">{yellowPercent}%</span>
              {isPaintingComplete && storage.winnerColor === 'yellow' && storage.rewardAmount !== undefined && (
                <span className="reward-badge">🏆 Winner +{storage.rewardAmount.toFixed(2)} ETH</span>
              )}
            </div>
            <div className="stat-item">
              <span className="stat-color" style={{ backgroundColor: '#6b7280' }}>⚪</span>
              <span className="stat-label">Unpainted:</span>
              <span className="stat-value">{unpaintedPercent}%</span>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default EPMDisplay;


================================================================================
// FILE: app/components/NetworkVisualization.tsx
================================================================================

import React, { useState } from 'react';
import Xarrow from 'react-xarrows';
import { NodeState } from '../../types/types';
import { COLOR_CSS, getNodePaintColor } from '../../utils/nodeColorUtils';
import './NetworkVisualization.css';

interface NetworkVisualizationProps {
  nodeStates?: Record<string, NodeState>;
}

const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({ nodeStates = {} }) => {
  const [networkType, setNetworkType] = useState<'mesh'>('mesh');
  
  // Get node IDs and their data
  const nodeIds = Object.keys(nodeStates);
  const nodeCount = nodeIds.length || 4;
  
  // Get color for a node ID
  const getNodeColor = (nodeId: string): string => {
    const colorName = getNodePaintColor(nodeId);
    return COLOR_CSS[colorName];
  };
  
  // Calculate node positions in a circle
  const getNodePosition = (index: number) => {
    const angle = (index * Math.PI * 2) / nodeCount - Math.PI / 2;
    const x = 200 + Math.cos(angle) * 100;
    const y = 150 + Math.sin(angle) * 100;
    return { x, y };
  };

  return (
    <div className="network-visualization">
      {/* Network Type Selector */}
      <div className="network-controls">
        <div className="network-control-group">
          <label className="network-label">Network Type</label>
          <select
            className="network-select"
            value={networkType}
            onChange={(e) => setNetworkType(e.target.value as 'mesh')}
          >
            <option value="mesh">Mesh Network</option>
          </select>
          <span className="network-description">
            In a mesh network, every node is connected to every other node
          </span>
        </div>
      </div>

      {/* Network Graph */}
      <div className="network-graph-container">
        {/* Legend - Left Side */}
        <div className="network-legend">
          <h4>Nodes</h4>
          <div className="legend-items">
            {nodeIds.map((nodeId) => {
              const nodeColor = getNodeColor(nodeId);
              return (
                <div key={`legend-${nodeId}`} className="legend-item">
                  <div
                    className="legend-color"
                    style={{ backgroundColor: nodeColor }}
                  />
                  <span>{nodeId}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Node Graph - Right Side */}
        <div className="network-nodes-container">
          {/* Draw nodes */}
          {nodeIds.map((nodeId, index) => {
            const { x, y } = getNodePosition(index);
            const nodeColor = getNodeColor(nodeId);
            
            return (
              <div
                key={`node-${nodeId}`}
                id={`network-node-${nodeId}`}
                className="network-node"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  backgroundColor: nodeColor,
                }}
              >
                {nodeId}
              </div>
            );
          })}

          {/* Draw arrows between all nodes */}
          {nodeIds.map((nodeId1, i) => {
            return nodeIds.map((nodeId2, j) => {
              if (j <= i) return null; // Only draw each connection once
              
              return (
                <Xarrow
                  key={`arrow-${nodeId1}-${nodeId2}`}
                  start={`network-node-${nodeId1}`}
                  end={`network-node-${nodeId2}`}
                  color="rgba(255, 255, 255, 0.3)"
                  strokeWidth={2}
                  headSize={6}
                  path="straight"
                  showHead={true}
                />
              );
            });
          })}
        </div>
      </div>
    </div>
  );
};

export default NetworkVisualization;


================================================================================
// FILE: app/components/NodePanel.tsx
================================================================================

import React, { useState, useMemo } from 'react';
import { NodeState } from '../../types/types';
import BlockchainView from './BlockchainView';
import WorldStateView from './WorldStateView';
import BeaconStateView from './BeaconStateView';
import BlockTreeView from './BlockTreeView';
import NodeToolbar from './NodeToolbar';
import AddTransactionModal from './AddTransactionModal';
import { NodeSettingsModal } from './NodeSettingsModal';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import { getNodeColorEmoji, getNodeColorCSS, getNodeBackgroundTint } from '../../utils/nodeColorUtils';
import './NodePanel.css';

interface NodePanelProps {
  nodeState: NodeState;
  allNodeIds?: string[];
  onAddTransaction?: (nodeId: string, recipient: string, amount: number) => void;
  onUpdateNetworkDelay?: (nodeId: string, multiplier: number) => void;
}

const NodePanel: React.FC<NodePanelProps> = ({ nodeState, allNodeIds = [], onAddTransaction, onUpdateNetworkDelay }) => {
  const [showUtxoModal, setShowUtxoModal] = useState(false);
  const [showBeaconStateModal, setShowBeaconStateModal] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBlockTreeModal, setShowBlockTreeModal] = useState(false);
  const { addressToNodeId } = useSimulatorContext();
  
  // Find the address for this node
  const nodeAddress = useMemo(() => {
    return Object.entries(addressToNodeId)
      .find(([_, nodeId]) => nodeId === nodeState.nodeId)?.[0];
  }, [addressToNodeId, nodeState.nodeId]);
  
  // Get the account balance - updates only when the actual balance changes
  const totalEth = nodeAddress ? (nodeState.worldState?.[nodeAddress]?.balance || 0) : 0;
  
  // Handler for adding transaction to mempool
  const handleAddTransaction = (recipient: string, amount: number) => {
    if (onAddTransaction) {
      onAddTransaction(nodeState.nodeId, recipient, amount);
    }
  };
  
  // Handler for updating network delay multiplier
  const handleSaveNetworkDelay = (multiplier: number) => {
    if (onUpdateNetworkDelay) {
      onUpdateNetworkDelay(nodeState.nodeId, multiplier);
    }
  };
  
  return (
    <div className="node-panel" style={{ background: getNodeBackgroundTint(nodeState.nodeId) }}>
      <div className="node-header">
        <div className="node-info">
          <div className="node-id-container">
            <h2 
              style={{ color: getNodeColorCSS(nodeState.nodeId) }}
              title={nodeAddress ? `Address: ${nodeAddress}` : undefined}
            >
              {nodeState.nodeId} {getNodeColorEmoji(nodeState.nodeId)}
            </h2>
          </div>
          <NodeToolbar 
            isMining={nodeState.isMining}
            consensusStatus={nodeState.consensusStatus}
            totalEth={totalEth}
            onUtxoClick={() => setShowUtxoModal(true)}
            onBeaconStateClick={() => setShowBeaconStateModal(true)}
            onAddTransaction={() => setShowAddTxModal(true)}
            onSettingsClick={() => setShowSettingsModal(true)}
            onBlockTreeClick={() => setShowBlockTreeModal(true)}
            nodeId={nodeState.nodeId}
          />
        </div>
      </div>
      
      <BlockchainView 
        blocks={nodeState.blockchain} 
        worldState={nodeState.worldState}
        receipts={nodeState.receipts}
        beaconState={nodeState.beaconState}
        nodeId={nodeState.nodeId}
      />
      
      {/* UTXO Modal */}
      {showUtxoModal && (
        <div className="modal-overlay" onClick={() => setShowUtxoModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{nodeState.nodeId} Node</h3>
              <button className="close-button" onClick={() => setShowUtxoModal(false)}>×</button>
            </div>
            <div className="modal-content">
              <WorldStateView 
                worldState={nodeState.worldState || {}} 
                receipts={nodeState.receipts}
                mempool={nodeState.mempool}
                blockchainTree={nodeState.blockchainTree}
                beaconState={nodeState.beaconState}
                allNodeIds={allNodeIds} 
                nodeId={nodeState.nodeId} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTxModal && nodeAddress && (
        <AddTransactionModal
          nodeId={nodeState.nodeId}
          nodeAddress={nodeAddress}
          worldState={nodeState.worldState || {}}
          onClose={() => setShowAddTxModal(false)}
          onSubmit={handleAddTransaction}
        />
      )}

      {/* Beacon State Modal */}
      {showBeaconStateModal && nodeState.beaconState && (
        <BeaconStateView
          beaconState={nodeState.beaconState}
          blockchain={nodeState.blockchain}
          blockchainTree={nodeState.blockchainTree}
          onClose={() => setShowBeaconStateModal(false)}
        />
      )}
      
      {/* Node Settings Modal */}
      {showSettingsModal && (
        <NodeSettingsModal
          nodeId={nodeState.nodeId}
          currentMultiplier={nodeState.networkDelayMultiplier || 1.0}
          onClose={() => setShowSettingsModal(false)}
          onSave={handleSaveNetworkDelay}
        />
      )}
      
      {/* Block Tree Modal */}
      {showBlockTreeModal && nodeState.blockchainTree && (
        <BlockTreeView
          blockchainTree={nodeState.blockchainTree}
          beaconState={nodeState.beaconState}
          onClose={() => setShowBlockTreeModal(false)}
        />
      )}
    </div>
  );
};

export default NodePanel;


================================================================================
// FILE: app/components/NodeSettingsModal.tsx
================================================================================

import React, { useState } from 'react';
import './NodeSettingsModal.css';

interface NodeSettingsModalProps {
  nodeId: string;
  currentMultiplier: number;
  onClose: () => void;
  onSave: (multiplier: number) => void;
}

/**
 * Modal for configuring per-node settings like network delay multiplier
 */
export const NodeSettingsModal: React.FC<NodeSettingsModalProps> = ({
  nodeId,
  currentMultiplier,
  onClose,
  onSave,
}) => {
  const [multiplier, setMultiplier] = useState(currentMultiplier);

  const handleSave = () => {
    onSave(multiplier);
    onClose();
  };

  return (
    <div className="node-settings-modal-overlay" onClick={onClose}>
      <div className="node-settings-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="node-settings-modal-header">
          <h3>Node Settings: {nodeId}</h3>
          <button className="node-settings-modal-close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="node-settings-modal-body">
          <div className="node-settings-modal-setting-group">
            <label htmlFor="delay-multiplier">
              Network Delay Multiplier: {multiplier.toFixed(1)}x
            </label>
            <p className="node-settings-modal-setting-description">
              Controls how slow this node's network is. Higher values increase the chance of forks.
            </p>
            <input
              id="delay-multiplier"
              type="range"
              min="1"
              max="10000"
              step="1"
              value={multiplier}
              onChange={(e) => setMultiplier(parseFloat(e.target.value))}
              className="node-settings-modal-slider"
            />
            <div className="node-settings-modal-slider-labels">
              <span>1x (Normal)</span>
              <span>100x (Slow)</span>
              <span>10,000x (Network Partition)</span>
            </div>
          </div>
        </div>
        
        <div className="node-settings-modal-footer">
          <button className="node-settings-modal-button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="node-settings-modal-button-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};


================================================================================
// FILE: app/components/NodeToolbar.tsx
================================================================================

import React, { useState } from 'react';
import { RxDividerVertical } from "react-icons/rx";
import { FaEarthAmericas } from "react-icons/fa6";
import { IoMdAdd } from "react-icons/io";
import { GiLighthouse } from "react-icons/gi";
import './NodeToolbar.css';

// Question mark icon
const QuestionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

interface NodeToolbarProps {
  isMining: boolean;
  consensusStatus?: 'idle' | 'validating' | 'proposing';
  totalEth: number;
  onUtxoClick: () => void;
  onBeaconStateClick: () => void;
  onAddTransaction: () => void;
  onSettingsClick: () => void;
  onBlockTreeClick: () => void;
  nodeId: string;
}

const NodeToolbar: React.FC<NodeToolbarProps> = ({ 
  isMining,
  consensusStatus = 'idle',
  totalEth, 
  onUtxoClick,
  onBeaconStateClick,
  onAddTransaction,
  onSettingsClick,
  onBlockTreeClick,
  nodeId
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  
  // Get status display text and class
  const getStatusDisplay = () => {
    if (consensusStatus === 'proposing') return { text: 'Proposing', class: 'proposing' };
    if (consensusStatus === 'validating') return { text: 'Validating', class: 'validating' };
    return { text: 'Idle', class: 'idle' };
  };
  
  const status = getStatusDisplay();

  return (
    <>
      <div className="node-toolbar">
        <div className={`toolbar-item node-status ${status.class}`}>
          <span>{status.text}</span>
        </div>
        
        <div className="divider"><RxDividerVertical size={20} color="var(--border-color)" /></div>
        
        <div className="toolbar-item node-balance">
          <div className="balance-container">
            <span className="balance-label">Balance</span>
            <div className="balance-value-container">
              <span className="balance-value">{totalEth.toFixed(2)} ETH</span>
              <div 
                className="tooltip-icon" 
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltipPosition({ 
                    x: rect.left + window.scrollX, 
                    y: rect.bottom + window.scrollY 
                  });
                  setShowTooltip(true);
                }}
                onMouseLeave={() => setShowTooltip(false)}
              >
                <QuestionIcon />
              </div>
            </div>
          </div>
        </div>
        
        <div className="divider"><RxDividerVertical size={20} color="var(--border-color)" /></div>
        
        <div className="toolbar-item toolbar-actions">
          <button 
            className="toolbar-button world-state-button"
            onClick={onUtxoClick}
            title="View World State"
          >
            <FaEarthAmericas size={14} />
            <span>World State</span>
          </button>
          <button 
            className="toolbar-button beacon-state-button"
            onClick={onBeaconStateClick}
            title="View Beacon State (Consensus Layer)"
          >
            <GiLighthouse size={14} />
            <span>Beacon State</span>
          </button>
          <button 
            className="toolbar-button add-tx-button"
            onClick={onAddTransaction}
            title="Add Transaction to Mempool"
          >
            <IoMdAdd size={16} />
          </button>
          <button 
            className="toolbar-button settings-button"
            onClick={onSettingsClick}
            title="Node Settings"
          >
            <span>Settings</span>
          </button>
          <button 
            className="toolbar-button block-tree-button"
            onClick={onBlockTreeClick}
            title="View Block Tree"
          >
            <span>Block Tree</span>
          </button>
        </div>
      </div>

      {/* Standalone Tooltip */}
      {showTooltip && (
        <div 
          className="standalone-tooltip" 
          style={{
            position: 'fixed',
            top: tooltipPosition.y + 10,
            left: tooltipPosition.x - 100,
            zIndex: 9999
          }}
        >
          This balance represents the total Ethereum owned by node {nodeId}, stored in the account's balance in the World State.
        </div>
      )}
    </>
  );
};

export default NodeToolbar;


================================================================================
// FILE: app/components/ProposerScheduleTimeline.tsx
================================================================================

import React, { useEffect, useRef } from 'react';
import { BeaconState } from '../../core/consensus/beaconState';
import { getNodeColorCSS } from '../../utils/nodeColorUtils';
import './ProposerScheduleTimeline.css';

interface ProposerScheduleTimelineProps {
  beaconState: BeaconState;
  addressToNodeId: { [address: string]: string };
}

/**
 * ProposerScheduleTimeline - Compact grid visualization of proposer schedules
 * Shows epochs 0-24+ in a space-efficient grid with colored cells
 * Auto-scrolls to show latest epochs while allowing manual scroll to view history
 */
const ProposerScheduleTimeline: React.FC<ProposerScheduleTimelineProps> = ({ 
  beaconState, 
  addressToNodeId 
}) => {
  const currentSlot = beaconState.getCurrentSlot();
  const currentEpoch = beaconState.getCurrentEpoch();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  
  // Get all proposer schedules sorted by epoch
  const proposerSchedules = Array.from(beaconState.proposerSchedules.entries())
    .sort(([epochA], [epochB]) => epochA - epochB);
  
  // Get unique node colors for legend
  const uniqueNodes = new Set<string>();
  proposerSchedules.forEach(([_, schedule]) => {
    schedule.forEach((address) => {
      const nodeId = addressToNodeId[address];
      if (nodeId) uniqueNodes.add(nodeId);
    });
  });
  const nodeColors = Array.from(uniqueNodes).map(nodeId => ({
    nodeId,
    color: getNodeColorCSS(nodeId)
  }));
  
  // Auto-scroll to bottom when new epochs are added
  useEffect(() => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollTop = gridContainerRef.current.scrollHeight;
    }
  }, [proposerSchedules.length]); // Scroll when number of epochs changes
  
  return (
    <div className="schedule-timeline-panel">
      <div className="timeline-panel-header">
        <div>
          <h3>Proposer Schedule</h3>
          <span className="timeline-subtitle">Epochs {proposerSchedules[0]?.[0] ?? 0} - {proposerSchedules[proposerSchedules.length - 1]?.[0] ?? 0}</span>
        </div>
        <div className="timeline-status">
          <span className="status-item">Slot: <strong>{currentSlot}</strong></span>
          <span className="status-item">Epoch: <strong>{currentEpoch}</strong></span>
        </div>
      </div>
      
      {/* Legend */}
      <div className="schedule-legend">
        <div className="legend-item">
          <div className="legend-boxes">
            {nodeColors.map(({ nodeId, color }) => (
              <div 
                key={nodeId}
                className="legend-box current-outline"
                style={{ backgroundColor: color }}
                title={nodeId}
              />
            ))}
          </div>
          <span className="legend-label">= Current Proposer (orange outline)</span>
        </div>
      </div>
      
      {/* Epoch Grid - Scrollable Container */}
      <div className="epochs-grid-container" ref={gridContainerRef}>
        <div className="epochs-grid">
        {proposerSchedules.map(([epoch, schedule]) => {
          const slots = Array.from(schedule.entries()).sort(([slotA], [slotB]) => slotA - slotB);
          const isCurrentEpoch = epoch === currentEpoch;
          
          return (
            <div key={epoch} className={`epoch-cell ${isCurrentEpoch ? 'current-epoch' : ''}`}>
              <div className="epoch-cell-header">Epoch {epoch}</div>
              <div className="epoch-slots-grid">
                {slots.map(([slot, validatorAddress]) => {
                  const nodeId = addressToNodeId[validatorAddress] || 'Unknown';
                  const nodeColor = getNodeColorCSS(nodeId);
                  const isCurrentSlot = slot === currentSlot;
                  const isPastSlot = slot < currentSlot;
                  
                  return (
                    <div
                      key={slot}
                      className={`slot-cell ${isCurrentSlot ? 'current-slot' : ''} ${isPastSlot ? 'past-slot' : ''}`}
                      style={{ 
                        backgroundColor: nodeColor,
                        opacity: isPastSlot ? 0.4 : 1
                      }}
                      title={`Slot ${slot}: ${nodeId}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      
      {proposerSchedules.length === 0 && (
        <div className="timeline-empty">No proposer schedules computed yet</div>
      )}
    </div>
  );
};

export default ProposerScheduleTimeline;


================================================================================
// FILE: app/components/SimulatorSettingsModal.tsx
================================================================================

import React, { useState } from 'react';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import 'react-tabs/style/react-tabs.css';
import { SimulatorConfig } from '../../config/config';
import { NodeState } from '../../types/types';
import NetworkVisualization from './NetworkVisualization';
import './SimulatorSettingsModal.css';

interface SimulatorSettingsModalProps {
  onClose: () => void;
  onSave: (newConfig: typeof SimulatorConfig) => void;
  nodeStates?: Record<string, NodeState>;
}

const SimulatorSettingsModal: React.FC<SimulatorSettingsModalProps> = ({ onClose, onSave, nodeStates }) => {
  // Initialize state with current config values
  const [config, setConfig] = useState({ ...SimulatorConfig });

  const handleChange = (key: keyof typeof SimulatorConfig, value: string) => {
    const originalValue = SimulatorConfig[key];
    
    // Preserve the original type
    let parsedValue: any;
    if (typeof originalValue === 'number') {
      parsedValue = parseFloat(value);
    } else if (typeof originalValue === 'boolean') {
      parsedValue = value === 'true';
    } else {
      parsedValue = value; // Keep as string
    }
    
    setConfig(prev => ({ ...prev, [key]: parsedValue }));
  };

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const handleReset = () => {
    setConfig({ ...SimulatorConfig });
  };

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Simulator Settings</h2>
          <button className="settings-modal-close" onClick={onClose}>×</button>
        </div>

        <Tabs>
          <TabList>
            <Tab>Config</Tab>
            <Tab>Network</Tab>
          </TabList>

          <TabPanel>
            <div className="settings-modal-content">
              <>
              {/* Issuance Parameters */}
              <div className="settings-section">
            <h3>Issuance Parameters</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Block Reward (ETH)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.BLOCK_REWARD}
                  onChange={(e) => handleChange('BLOCK_REWARD', e.target.value)}
                />
                <span className="setting-description">ETH rewarded to proposers</span>
              </div>
            </div>
          </div>

          {/* Network Parameters */}
          <div className="settings-section">
            <h3>Network Parameters</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Node Count</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.NODE_COUNT}
                  onChange={(e) => handleChange('NODE_COUNT', e.target.value)}
                />
                <span className="setting-description">Number of nodes in the network</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Min Network Delay (ms)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.MIN_NETWORK_DELAY_MS}
                  onChange={(e) => handleChange('MIN_NETWORK_DELAY_MS', e.target.value)}
                />
                <span className="setting-description">Minimum network delay</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Max Network Delay (ms)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.MAX_NETWORK_DELAY_MS}
                  onChange={(e) => handleChange('MAX_NETWORK_DELAY_MS', e.target.value)}
                />
                <span className="setting-description">Maximum network delay</span>
              </div>
            </div>
          </div>

          {/* Transaction Parameters */}
          <div className="settings-section">
            <h3>Transaction Parameters</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Redistribution Ratio</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  className="setting-input"
                  value={config.REDISTRIBUTION_RATIO}
                  onChange={(e) => handleChange('REDISTRIBUTION_RATIO', e.target.value)}
                />
                <span className="setting-description">Ratio of coins to redistribute (0-1)</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Max Block Transactions</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.MAX_BLOCK_TRANSACTIONS}
                  onChange={(e) => handleChange('MAX_BLOCK_TRANSACTIONS', e.target.value)}
                />
                <span className="setting-description">Maximum transactions per block</span>
              </div>
            </div>
          </div>

          {/* Proof of Stake Parameters */}
          <div className="settings-section">
            <h3>Proof of Stake (PoS) Parameters</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Seconds Per Slot</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.SECONDS_PER_SLOT}
                  onChange={(e) => handleChange('SECONDS_PER_SLOT', e.target.value)}
                />
                <span className="setting-description">Duration of each slot in seconds</span>
                <span className="setting-warning">⚠️ Warning: Changing this will probably break the simulator</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Slots Per Epoch</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.SLOTS_PER_EPOCH}
                  onChange={(e) => handleChange('SLOTS_PER_EPOCH', e.target.value)}
                />
                <span className="setting-description">Number of slots per epoch</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Proposer Buffer (ms)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.PROPOSER_BUFFER_MS}
                  onChange={(e) => handleChange('PROPOSER_BUFFER_MS', e.target.value)}
                />
                <span className="setting-description">Buffer time before next proposal</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Sync Interval (ms)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.SYNC_INTERVAL_MS}
                  onChange={(e) => handleChange('SYNC_INTERVAL_MS', e.target.value)}
                />
                <span className="setting-description">Interval for broadcasting LMD-GHOST heads</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Max Effective Balance (ETH)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.MAX_EFFECTIVE_BALANCE}
                  onChange={(e) => handleChange('MAX_EFFECTIVE_BALANCE', e.target.value)}
                />
                <span className="setting-description">Maximum effective balance for validators</span>
              </div>
            </div>
          </div>

          {/* UI Parameters */}
          <div className="settings-section">
            <h3>UI Parameters</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Mining Batch Size</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.MINING_BATCH_SIZE}
                  onChange={(e) => handleChange('MINING_BATCH_SIZE', e.target.value)}
                />
                <span className="setting-description">Number of hash attempts per batch</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Update Interval (ms)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={config.UPDATE_INTERVAL_MS}
                  onChange={(e) => handleChange('UPDATE_INTERVAL_MS', e.target.value)}
                />
                <span className="setting-description">UI update interval</span>
              </div>
            </div>
          </div>

          {/* Debug Logging */}
          <div className="settings-section">
            <h3>Debug Logging Toggles</h3>
            <div className="settings-grid">
              <div className="setting-item">
                <label className="setting-label">Debug Sync</label>
                <select
                  className="setting-input"
                  value={config.DEBUG_SYNC.toString()}
                  onChange={(e) => handleChange('DEBUG_SYNC', e.target.value)}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <span className="setting-description">Enable sync-related console logs</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Debug Block Creator</label>
                <select
                  className="setting-input"
                  value={config.DEBUG_BLOCK_CREATOR.toString()}
                  onChange={(e) => handleChange('DEBUG_BLOCK_CREATOR', e.target.value)}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <span className="setting-description">Enable BlockCreator debug logs</span>
              </div>
              <div className="setting-item">
                <label className="setting-label">Debug Consensus</label>
                <select
                  className="setting-input"
                  value={config.DEBUG_CONSENSUS.toString()}
                  onChange={(e) => handleChange('DEBUG_CONSENSUS', e.target.value)}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <span className="setting-description">Enable Consensus debug logs</span>
              </div>
            </div>
          </div>
              </>
            </div>
          </TabPanel>
          
          <TabPanel>
            <NetworkVisualization nodeStates={nodeStates} />
          </TabPanel>
          
        </Tabs>

        <div className="settings-modal-footer">
          <button className="settings-button settings-button-secondary" onClick={handleReset}>
            Reset to Current
          </button>
          <div className="settings-button-group">
            <button className="settings-button settings-button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="settings-button settings-button-primary" onClick={handleSave}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulatorSettingsModal;


================================================================================
// FILE: app/components/TransactionModal.tsx
================================================================================

import React from 'react';
import './NodePanel.css';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ isOpen, onClose, nodeId }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create Transaction</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          {/* Transaction form will go here */}
          <p>Transaction form for node: {nodeId}</p>
        </div>
      </div>
    </div>
  );
};

export default TransactionModal;


================================================================================
// FILE: app/components/TransactionView.tsx
================================================================================

import React, { useState } from 'react';
import { EthereumTransaction, Account } from '../../types/types';
import { TransactionReceipt } from '../../types/receipt';
import { SimulatorConfig } from '../../config/config';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import { getNodeColorCSS } from '../../utils/nodeColorUtils';
import Xarrow from 'react-xarrows';
import { MdContentCopy, MdCheck } from 'react-icons/md';
import EPMDisplay from './EPMDisplay';
import './TransactionView.css';

interface TransactionViewProps {
  transaction: EthereumTransaction;
  worldState?: Record<string, Account>; // Optional world state for smart contract display
  receipt?: TransactionReceipt; // Optional receipt to show status
}

const TransactionView: React.FC<TransactionViewProps> = ({ transaction, worldState, receipt }) => {
  const { addressToNodeId } = useSimulatorContext();
  const [copied, setCopied] = useState(false);
  const [selectedContract, setSelectedContract] = useState<{ account: Account; address: string } | null>(null);
  
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Check if this is a coinbase transaction
  const isCoinbase = transaction.from === SimulatorConfig.PROTOCOL_NODE_ID;
  
  // Check if this is a smart contract transaction
  const isSmartContract = transaction.to === '0xEPM_PAINT_CONTRACT';
  
  // Get the contract account if this is a smart contract transaction
  const contractAccount = isSmartContract && worldState 
    ? worldState[transaction.to]
    : null;
  
  // Get node IDs from addresses for the visualization
  const fromNodeId = isCoinbase ? SimulatorConfig.PROTOCOL_NODE_ID : (addressToNodeId[transaction.from] || 'Unknown');
  const toNodeId = isSmartContract ? 'Smart Contract' : 
                   transaction.to === '0x0' ? 'PROTOCOL' :
                   (addressToNodeId[transaction.to] || 'Unknown');
  
  // Generate unique IDs for this transaction
  const txId = `tx-${transaction.txid?.substring(0, 6) || Math.random().toString(36).substring(2, 8)}`;
  
  // Format timestamp elegantly
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="transaction-item">
      <div className="transaction-header">
        <div className={`tx-badge ${isCoinbase ? 'coinbase' : ''}`}>
          {isCoinbase ? 'Coinbase' : 'Transfer'}
        </div>
        <div className="tx-timestamp">{formatTimestamp(transaction.timestamp)}</div>
        <button 
          className="copy-button" 
          onClick={() => copyToClipboard(JSON.stringify(transaction, null, 2))}
          title="Copy transaction data"
        >
          {copied ? <MdCheck /> : <MdContentCopy />}
        </button>
      </div>
      
      <div className="transaction-flow-container">
        {/* From Section */}
        <div className="tx-inputs-section">
          <div className="section-title">From</div>
          <div 
            className={`tx-input ${isCoinbase ? 'coinbase-input' : ''}`} 
            id={`${txId}-from`}
            style={!isCoinbase && fromNodeId !== 'Unknown' ? {
              borderColor: getNodeColorCSS(fromNodeId),
              color: getNodeColorCSS(fromNodeId)
            } : {}}
          >
            <div className="node-id">{fromNodeId}</div>
          </div>
        </div>
        
        {/* Total Value Section */}
        <div className="tx-total-section" id={`${txId}-total`}>
          <div className="tx-total-value">{transaction.value.toFixed(4)}</div>
          <div className="tx-currency">ETH</div>
        </div>
        
        {/* To Section */}
        <div className="tx-outputs-section">
          <div className="section-title">To</div>
          <div 
            className="tx-output" 
            id={`${txId}-to`}
            style={!isSmartContract && toNodeId !== 'Unknown' && toNodeId !== 'PROTOCOL' ? {
              borderColor: getNodeColorCSS(toNodeId),
              color: getNodeColorCSS(toNodeId)
            } : toNodeId === 'PROTOCOL' ? {
              borderColor: '#ff9800',
              color: '#ff9800'
            } : {}}
          >
            {isSmartContract && contractAccount ? (
              <button 
                className="smart-contract-button"
                onClick={() => setSelectedContract({ account: contractAccount, address: transaction.to })}
                title="View Smart Contract"
              >
                {toNodeId}
              </button>
            ) : (
              <div className="node-id">
                {toNodeId}
              </div>
            )}
          </div>
        </div>
        
        {/* Bezier Arrows */}
        <Xarrow
          key={`arrow-in`}
          start={`${txId}-from`}
          end={`${txId}-total`}
          color="var(--primary-color)"
          strokeWidth={2}
          curveness={0.8}
          startAnchor="right"
          endAnchor="left"
          path="smooth"
        />
        
        <Xarrow
          key={`arrow-out`}
          start={`${txId}-total`}
          end={`${txId}-to`}
          color="var(--primary-color)"
          strokeWidth={2}
          curveness={0.8}
          startAnchor="right"
          endAnchor="left"
          path="smooth"
        />
      </div>

      {/* Transaction Details - Elegant and Subtle */}
      <div className="transaction-metadata">
        {/* Reverted Status Banner */}
        {receipt && receipt.status === 0 && (
          <div className="reverted-banner">
            <span className="reverted-icon">⚠️</span>
            <span className="reverted-text">Transaction Reverted</span>
            {receipt.revertReason && (
              <span className="revert-reason">: {receipt.revertReason}</span>
            )}
          </div>
        )}
        
        <div className="metadata-grid">
          <div className="metadata-item">
            <div className="metadata-label">Transaction ID</div>
            <div className="metadata-value monospace">{transaction.txid}</div>
          </div>
          
          <div className="metadata-item">
            <div className="metadata-label">From Address</div>
            <div className="metadata-value monospace">{transaction.from}</div>
          </div>
          
          <div className="metadata-item">
            <div className="metadata-label">To Address</div>
            <div className="metadata-value monospace">{transaction.to}</div>
          </div>
          
          {!isCoinbase && (
            <div className="metadata-item">
              <div className="metadata-label">Nonce</div>
              <div className="metadata-value">{transaction.nonce}</div>
            </div>
          )}
        </div>
      </div>

      {/* Smart Contract Modal */}
      {selectedContract && (
        <div className="smart-contract-modal-overlay" onClick={() => setSelectedContract(null)}>
          <div className="smart-contract-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-contract-modal-header">
              <h2>
                Smart Contract 
                <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: '8px' }}>
                  {selectedContract.address}
                </span>
              </h2>
              <button 
                className="smart-contract-modal-close"
                onClick={() => setSelectedContract(null)}
              >
                ×
              </button>
            </div>
            <div className="smart-contract-modal-content">
              <EPMDisplay account={selectedContract.account} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionView;


================================================================================
// FILE: app/components/WorldStateView.tsx
================================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { Account, EthereumTransaction } from '../../types/types';
import { ReceiptsDatabase } from '../../types/receipt';
import Select from 'react-select';
import { useSimulatorContext } from '../contexts/SimulatorContext';
import EPMDisplay from './EPMDisplay';
import TransactionView from './TransactionView';
import BlockTreeView from './BlockTreeView';
import { BlockchainTree } from '../../core/blockchain/blockchainTree';
import './WorldStateView.css';

// Icons for copy buttons
const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

interface WorldStateViewProps {
  worldState: Record<string, Account>; // Address -> Account mapping
  receipts?: ReceiptsDatabase; // Optional receipts database
  mempool?: EthereumTransaction[]; // Optional mempool transactions
  blockchainTree?: BlockchainTree; // Blockchain tree for visualization
  beaconState?: any; // Optional beacon state for showing latest attestations
  allNodeIds?: string[];
  nodeId?: string; // Current node ID for which the modal is opened
}

// Define the option type for react-select
interface NodeOption {
  value: string;
  label: string;
}

const WorldStateView: React.FC<WorldStateViewProps> = ({ worldState, receipts, mempool, blockchainTree, beaconState, allNodeIds = [], nodeId }) => {
  const { addressToNodeId } = useSimulatorContext();
  const [selectedNodes, setSelectedNodes] = useState<NodeOption[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedContract, setSelectedContract] = useState<{ account: Account; address: string } | null>(null);
  const [showReceipts, setShowReceipts] = useState(false);
  const [showMempool, setShowMempool] = useState(false);
  const [showBlockTree, setShowBlockTree] = useState(false);
  const itemsPerPage = 10;

  // Extract unique node IDs from the world state using address mapping
  const uniqueNodeIds = useMemo(() => {
    if (allNodeIds && allNodeIds.length > 0) return allNodeIds;
    
    // Extract unique node IDs from address mapping
    const nodeIds = new Set(Object.values(addressToNodeId));
    return Array.from(nodeIds).sort();
  }, [addressToNodeId, allNodeIds]);
  
  // Create options for react-select
  const nodeOptions = useMemo(() => {
    return uniqueNodeIds.map(nodeId => ({
      value: nodeId,
      label: nodeId
    }));
  }, [uniqueNodeIds]);
  
  // Convert worldState to array of [address, account] with nodeId for filtering
  const accountsWithNodeIds = useMemo(() => {
    return Object.entries(worldState).map(([address, account]) => ({
      address,
      account,
      nodeId: addressToNodeId[address] || 'Unknown'
    }));
  }, [worldState, addressToNodeId]);
  
  // Filter accounts by selected nodes
  const filteredAccounts = useMemo(() => {
    // If no nodes are selected, show all accounts
    if (selectedNodes.length === 0) {
      return accountsWithNodeIds;
    }
    
    // Create a Set of selected node IDs for faster lookup
    const selectedNodeIds = new Set(selectedNodes.map(node => node.value));
    
    // Filter accounts by selected node IDs
    return accountsWithNodeIds.filter(item => selectedNodeIds.has(item.nodeId));
  }, [accountsWithNodeIds, selectedNodes]);
  
  // Reset to page 1 when selected nodes change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedNodes]);

  // Find the address for this node
  const nodeAddress = useMemo(() => {
    if (!nodeId) return undefined;
    return Object.entries(addressToNodeId)
      .find(([_, nId]) => nId === nodeId)?.[0];
  }, [addressToNodeId, nodeId]);
  
  // Get the account balance - updates only when the actual balance changes
  const totalEth = nodeAddress ? (worldState[nodeAddress]?.balance || 0) : 0;

  // Calculate pagination values using useMemo to prevent unnecessary recalculations
  const { totalPages, currentAccounts } = useMemo(() => {
    const totalPages = Math.ceil(filteredAccounts.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentAccounts = filteredAccounts.slice(startIndex, endIndex);
    
    return { totalPages, currentAccounts };
  }, [filteredAccounts, currentPage, itemsPerPage]);

  // Handle pagination
  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Format address for display (truncate if too long)
  const formatAddress = (address: string) => {
    if (address.length > 20) {
      return `${address.substring(0, 10)}...${address.substring(address.length - 10)}`;
    }
    return address;
  };

  // Copy a single account to clipboard
  const copyToClipboard = (address: string, account: Account) => {
    const accountData = {
      address,
      nodeId: addressToNodeId[address] || 'Unknown',
      balance: account.balance,
      nonce: account.nonce
    };
    
    navigator.clipboard.writeText(JSON.stringify(accountData, null, 2))
      .then(() => {
        setCopiedItem(address);
        setTimeout(() => setCopiedItem(null), 2000);
      })
      .catch(err => console.error('Failed to copy: ', err));
  };
  
  // Copy entire world state to clipboard
  const copyAllToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(worldState, null, 2))
      .then(() => {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      })
      .catch(err => console.error('Failed to copy all: ', err));
  };

  return (
    <>
      <div className="utxo-view">
        <div className="utxo-header-actions">
        <div className="utxo-title-container">
          <h3 className="utxo-title">World State</h3>
          <div className="utxo-stats">
            <div className="utxo-count">
              Total Accounts: <span className="utxo-stat-value">{Object.keys(worldState).length}</span>
            </div>
            {nodeId && (
              <div className="node-total-eth">
                Node Balance: <span className="eth-value">{totalEth.toFixed(2)} ETH</span>
              </div>
            )}
          </div>
        </div>
        <div className="header-buttons">
          {mempool && (
            <button 
              className="view-mempool-button" 
              onClick={() => setShowMempool(true)}
              title="View pending transactions in mempool"
            >
              View Mempool
            </button>
          )}
          {receipts && (
            <button 
              className="view-receipts-button" 
              onClick={() => setShowReceipts(true)}
              title="View transaction receipts"
            >
              View Receipts
            </button>
          )}
          {blockchainTree && (
            <button 
              className="view-tree-button" 
              onClick={() => setShowBlockTree(true)}
              title="View blockchain tree structure"
            >
              View Block Tree
            </button>
          )}
          <button 
            className="copy-all-button" 
            onClick={copyAllToClipboard}
            title="Copy entire UTXO set as JSON"
          >
            {copiedAll ? <span className="copied-text"><CheckIcon /> Copied!</span> : <span><CopyIcon /> Copy All</span>}
          </button>
        </div>
      </div>
      <div className="utxo-filters">
        <div className="utxo-filter utxo-filter-full">
          <label className="utxo-filter-label">Filter by Node IDs</label>
          <div className="filter-row">
            <Select
              isMulti
              name="nodeIds"
              options={nodeOptions}
              className="react-select-container"
              classNamePrefix="react-select"
              placeholder="Select node IDs to filter..."
              value={selectedNodes}
              onChange={(selected) => setSelectedNodes(selected as NodeOption[])}
              isClearable={true}
              isSearchable={true}
            />
            
            {selectedNodes.length > 0 && (
              <button 
                className="utxo-filter-reset" 
                onClick={() => setSelectedNodes([])}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="utxo-header">
        <div className="utxo-id-header">Address</div>
        <div className="utxo-node-header">Node ID</div>
        <div className="utxo-value-header">Balance</div>
        <div className="utxo-address-header">Nonce</div>
        <div className="utxo-code-header">Code</div>
        <div className="utxo-storage-header">Storage</div>
        <div className="utxo-actions-header">Actions</div>
      </div>

      <div className="utxo-list">
        {currentAccounts.length > 0 ? (
          currentAccounts.map(({ address, account, nodeId: accountNodeId }) => {
            // Check if this is a smart contract (has code field)
            const isSmartContract = account.code && account.code.length > 0;
            const displayNodeId = isSmartContract ? 'Smart Contract' : accountNodeId;
            
            return (
              <div key={address} className="utxo-item">
                <div className="utxo-id" title={address}>{formatAddress(address)}</div>
                <div className="utxo-node">
                  {isSmartContract ? (
                    <button 
                      className="smart-contract-button"
                      onClick={() => setSelectedContract({ account, address })}
                      title="View Smart Contract"
                    >
                      {displayNodeId}
                    </button>
                  ) : (
                    displayNodeId
                  )}
                </div>
                <div className="utxo-value">{account.balance.toFixed(2)} ETH</div>
                <div className="utxo-address">{account.nonce}</div>
                <div className="utxo-code" title={account.code || 'None'}>
                  {account.code || '-'}
                </div>
                <div className="utxo-storage" title={account.storage ? 'Has storage' : 'None'}>
                  {account.storage ? '✓' : '-'}
                </div>
                <div className="utxo-actions">
                  <button 
                    className="copy-button" 
                    onClick={() => copyToClipboard(address, account)}
                    title="Copy account data as JSON"
                  >
                    {copiedItem === address ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="utxo-empty">
            {selectedNodes.length > 0 
              ? 'No accounts found for the selected nodes' 
              : 'No accounts available'}
          </div>
        )}
      </div>

      {filteredAccounts.length > 0 && (
        <div className="utxo-pagination">
          <button 
            onClick={handlePrevPage} 
            disabled={currentPage === 1}
            className="pagination-button"
          >
            &lt; Prev
          </button>
          <span className="pagination-info">
            Page {currentPage} of {totalPages} 
            ({filteredAccounts.length} Accounts)
          </span>
          <button 
            onClick={handleNextPage} 
            disabled={currentPage === totalPages}
            className="pagination-button"
          >
            Next &gt;
          </button>
        </div>
      )}
      </div>
      
      {/* Smart Contract Modal */}
      {selectedContract && (
        <div className="smart-contract-modal-overlay" onClick={() => setSelectedContract(null)}>
          <div className="smart-contract-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-contract-modal-header">
              <h2>
                Smart Contract 
                <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: '8px' }}>
                  {selectedContract.address}
                </span>
              </h2>
              <button 
                className="smart-contract-modal-close"
                onClick={() => setSelectedContract(null)}
              >
                ×
              </button>
            </div>
            <div className="smart-contract-modal-content">
              <EPMDisplay account={selectedContract.account} />
            </div>
          </div>
        </div>
      )}
      
      {/* Receipts Modal */}
      {showReceipts && receipts && (
        <div className="smart-contract-modal-overlay" onClick={() => setShowReceipts(false)}>
          <div className="smart-contract-modal receipts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-contract-modal-header">
              <h2>📋 Transaction Receipts (Chaindata)</h2>
              <button 
                className="smart-contract-modal-close"
                onClick={() => setShowReceipts(false)}
              >
                ×
              </button>
            </div>
            <div className="smart-contract-modal-content receipts-content">
              <div className="receipts-info">
                <p><strong>Transaction Receipts</strong> - Results of all executed transactions</p>
                <p>Each receipt shows: transaction hash, status (1=success, 0=reverted), gas used, sender, recipient, and revert reason (if failed).</p>
                <p>Total Blocks with Receipts: <strong>{Object.keys(receipts).length}</strong></p>
                <p>Total Transactions: <strong>{Object.values(receipts).reduce((sum: number, block: any) => sum + Object.keys(block).length, 0)}</strong></p>
              </div>
              <div className="receipts-data">
                <pre>{JSON.stringify(receipts, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Mempool Modal */}
      {showMempool && mempool && (
        <div className="smart-contract-modal-overlay" onClick={() => setShowMempool(false)}>
          <div className="smart-contract-modal mempool-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-contract-modal-header">
              <h2>🔄 Mempool - Pending Transactions</h2>
              <button 
                className="smart-contract-modal-close"
                onClick={() => setShowMempool(false)}
              >
                ×
              </button>
            </div>
            <div className="smart-contract-modal-content receipts-content">
              <div className="receipts-info">
                <p><strong>Mempool</strong> - Queue of pending transactions waiting to be included in a block</p>
                <p>These transactions have been broadcast but not yet mined into a block.</p>
                <p>Total Pending Transactions: <strong>{mempool.length}</strong></p>
                {mempool.length === 0 && <p><em>Mempool is currently empty</em></p>}
              </div>
              {mempool.length > 0 && (
                <div className="mempool-transactions">
                  {mempool.map((transaction, index) => (
                    <div key={transaction.txid || index} className="mempool-transaction-item">
                      <h4 style={{ color: 'var(--primary-color)', marginBottom: '0.5rem' }}>
                        Pending Transaction #{index + 1}
                      </h4>
                      <TransactionView 
                        transaction={transaction} 
                        worldState={worldState}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Block Tree Modal */}
      {showBlockTree && blockchainTree && (
        <BlockTreeView 
          blockchainTree={blockchainTree}
          beaconState={beaconState}
          onClose={() => setShowBlockTree(false)}
        />
      )}
    </>
  );
};

export default WorldStateView;


================================================================================
// FILE: app/contexts/SimulatorContext.tsx
================================================================================

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { NodeState } from '../../types/types';
import { ForkDetectionService } from '../utils/forkDetectionService';

interface SimulatorContextType {
  forkStartHeight: number | null;
  detectForks: (nodeStates: Record<string, NodeState>) => void;
  addressToNodeId: Record<string, string>; // Maps address (sha256 of publicKey) to human-readable nodeId
  setAddressToNodeId: (mapping: Record<string, string>) => void;
}

const SimulatorContext = createContext<SimulatorContextType | undefined>(undefined);

export const useSimulatorContext = () => {
  const context = useContext(SimulatorContext);
  if (context === undefined) {
    throw new Error('useSimulatorContext must be used within a SimulatorProvider');
  }
  return context;
};

interface SimulatorProviderProps {
  children: ReactNode;
}

export const SimulatorProvider: React.FC<SimulatorProviderProps> = ({ children }) => {
  const [forkStartHeight, setForkStartHeight] = useState<number | null>(null);
  const [addressToNodeId, setAddressToNodeId] = useState<Record<string, string>>({});

  const detectForks = (nodeStates: Record<string, NodeState>) => {
    const newForkHeight = ForkDetectionService.detectForks(nodeStates);
    setForkStartHeight(newForkHeight);
  };

  return (
    <SimulatorContext.Provider value={{ 
      forkStartHeight, 
      detectForks,
      addressToNodeId,
      setAddressToNodeId
    }}>
      {children}
    </SimulatorContext.Provider>
  );
};


================================================================================
// FILE: app/pages/EPMDemo.tsx
================================================================================

/**
 * EPM Demo Page
 * 
 * Demonstrates the EPM (Ethereum Painting Machine) contract with mock transactions.
 * 
 * This page:
 * 1. Loads the Pokemon PNG and creates an EPM contract account
 * 2. Executes mock paint transactions using EPM.executeTransaction()
 * 3. Displays the result using the EPMDisplay component
 * 
 * This demonstrates the clean interface that will be used for blockchain integration.
 */

import React, { useState, useEffect } from 'react';
import { Account } from '../../types/types';
import { EPM } from '../../core/epm/EPM';
import EPMDisplay from '../components/EPMDisplay';
import './EPMDemo.css';

// Import Pokemon image for loading pixel data
import hippoImage from '../../core/epm/pokemon/hippo.png';

/**
 * Demo wrapper that creates an EPM contract and executes mock transactions
 */
const EPMDemo: React.FC = () => {
  const [contractAccount, setContractAccount] = useState<Account | null>(null);
  
  useEffect(() => {
    // Load the Pokemon PNG and extract pixel data
    const img = new Image();
    img.src = hippoImage;
    
    img.onload = () => {
      // Create canvas to read pixel data
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Get pixel data
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const pixels = imageData.data;
      
      // Create grid based on alpha channel (transparency)
      // High resolution for complete coverage (128x128)
      const gridSize = 128;
      const scaleX = img.width / gridSize;
      const scaleY = img.height / gridSize;
      
      const grid: number[][] = [];
      for (let y = 0; y < gridSize; y++) {
        const row: number[] = [];
        for (let x = 0; x < gridSize; x++) {
          // Sample the original image at this scaled position
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);
          const idx = (srcY * img.width + srcX) * 4;
          const alpha = pixels[idx + 3];
          
          // If alpha > 128, pixel is part of Pokemon (paintable)
          row.push(alpha > 128 ? 1 : 0);
        }
        grid.push(row);
      }
      
      // Initialize EPM contract storage
      const initialStorage = EPM.initialize(grid);
      
      // Create EPM contract account
      // The 'code' field stores the Pokemon image filename
      let account: Account = {
        address: '0xEPM_CONTRACT',
        balance: 0,
        nonce: 0,
        code: 'hippo.png', // Specifies which Pokemon to paint
        storage: initialStorage,
        codeHash: 'epm-v1'
      };
      
      // Mock transactions to paint the Pokemon
      const transactions = [
        { color: 'red', eth: 50, blockHash: '0xfff' },
      ];
      
      // Execute each transaction using the clean EPM interface
      for (const tx of transactions) {
        // Create mock Ethereum transaction
        const ethTx = {
          from: '0xMOCK_SENDER',
          to: account.address,
          value: tx.eth,
          nonce: 0,
          data: JSON.stringify({ color: tx.color }),
          publicKey: 'mock',
          signature: 'mock',
          timestamp: Date.now(),
          txid: `mock-${tx.color}`
        };
        
        // Execute transaction with block hash for entropy
        const result = EPM.executeTransaction(account, ethTx, tx.blockHash);
        
        if (result.success) {
          account = result.account;
          console.log(`✅ Painted with ${tx.color}: ${tx.eth} ETH`);
        } else {
          console.error(`❌ Failed to paint with ${tx.color}: ${result.error}`);
        }
      }
      
      // Set the final contract account
      setContractAccount(account);
    };
  }, []);
  
  if (!contractAccount) {
    return <div className="epm-demo-page">Loading EPM...</div>;
  }
  
  return (
    <div className="epm-demo-page">
      <h1>EPM Demo</h1>
      <p>Ethereum Painting Machine - Collaborative Pokemon Painting</p>
      <EPMDisplay account={contractAccount} />
      <div className="epm-stats">
        <p>Contract Balance: {contractAccount.balance} ETH</p>
        <p>Contract Address: {contractAccount.address}</p>
      </div>
    </div>
  );
};

export default EPMDemo;


================================================================================
// FILE: app/pages/SimulatorContent.tsx
================================================================================

import React, { useState, useEffect, useRef } from 'react';
import { NetworkManager } from '../../network/networkManager';
import { NodeState } from '../../types/types';
import NodePanel from '../components/NodePanel';
import SimulatorSettingsModal from '../components/SimulatorSettingsModal';
import { SimulatorProvider, useSimulatorContext } from '../contexts/SimulatorContext';
import { SimulatorConfig } from '../../config/config';
import { FaPlay, FaPause, FaSync } from 'react-icons/fa';

/**
 * Inner simulator component that uses the simulator context
 */
const SimulatorContentInner: React.FC = () => {
  // State for node states
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  
  // State for network running status
  const [isNetworkRunning, setIsNetworkRunning] = useState(true);
  
  // State for sync enabled status
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  
  // State for settings modal
  const [showSettings, setShowSettings] = useState(false);
  
  // Get context functions
  const { detectForks, setAddressToNodeId } = useSimulatorContext();
  
  // Reference to the network manager instance
  const networkManagerRef = useRef<NetworkManager | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const ghostHeadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const slotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Initialize the network on component mount
  useEffect(() => {
    // Create network manager
    const networkManager = new NetworkManager();
    networkManagerRef.current = networkManager;
    
    // Create a fully connected network with 4 nodes
    networkManager.createFullyConnectedNetwork(4);
    
    // Build address-to-nodeId mapping for UI
    const mapping = networkManager.getAddressToNodeIdMapping();
    setAddressToNodeId(mapping);
    
    // Update the UI with initial node states
    updateNodeStates();

    // Set up interval to update UI
    intervalRef.current = setInterval(() => {
      updateNodeStates();
    }, 500);
    
    // Set up interval to broadcast LMD-GHOST heads every second
    ghostHeadIntervalRef.current = setInterval(() => {
      networkManager.broadcastAllGhostHeads();
    }, SimulatorConfig.SYNC_INTERVAL_MS);
    
    // Set up interval to process consensus slots (configurable PoS slot time)
    slotIntervalRef.current = setInterval(() => {
      networkManager.processAllSlots();
    }, SimulatorConfig.SECONDS_PER_SLOT * 1000 + SimulatorConfig.PROPOSER_BUFFER_MS);
    
    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (ghostHeadIntervalRef.current) {
        clearInterval(ghostHeadIntervalRef.current);
      }
      if (slotIntervalRef.current) {
        clearInterval(slotIntervalRef.current);
      }
      networkManager.stopAllNodes();
    };
  }, []);
  
  // Function to update node states from the network manager
  const updateNodeStates = () => {
    if (networkManagerRef.current) {
      const states = networkManagerRef.current.getNetworkState();
      setNodeStates(states);
      
      // Detect forks in the network
      detectForks(states);
    }
  };
  
  // Handle adding transaction to a node's mempool
  const handleAddTransaction = async (nodeId: string, recipient: string, amount: number) => {
    if (!networkManagerRef.current) return;
    
    const success = await networkManagerRef.current.addTransactionToNodeMempool(nodeId, recipient, amount);
    if (success) {
      console.log(`Added transaction to ${nodeId}'s mempool: ${amount} ETH to ${recipient}`);
      
      // Small delay to ensure state is fully updated
      setTimeout(() => {
        updateNodeStates();
        
        // Debug: Check mempool size after update
        const states = networkManagerRef.current?.getNetworkState();
        if (states && states[nodeId]) {
          console.log(`${nodeId} mempool size after update:`, states[nodeId].mempool?.length || 0);
        }
      }, 100);
    } else {
      console.error(`Failed to add transaction to ${nodeId}'s mempool`);
    }
  };
  
  // Handle updating node network delay multiplier
  const handleUpdateNetworkDelay = (nodeId: string, multiplier: number) => {
    if (!networkManagerRef.current) return;
    
    networkManagerRef.current.setNodeNetworkDelayMultiplier(nodeId, multiplier);
    console.log(`Updated ${nodeId} network delay multiplier to ${multiplier}x`);
    updateNodeStates();
  };
  
  // Toggle network running state
  const toggleNetwork = () => {
    if (!networkManagerRef.current) return;
    
    if (isNetworkRunning) {
      // Stop the network
      if (slotIntervalRef.current) {
        clearInterval(slotIntervalRef.current);
        slotIntervalRef.current = null;
      }
      // Set all nodes to idle
      networkManagerRef.current.setAllConsensusStatus('idle');
      setIsNetworkRunning(false);
      console.log('[Network] Stopped');
    } else {
      // Start the network
      slotIntervalRef.current = setInterval(() => {
        networkManagerRef.current?.processAllSlots();
      }, SimulatorConfig.SECONDS_PER_SLOT * 1000 + SimulatorConfig.PROPOSER_BUFFER_MS);
      setIsNetworkRunning(true);
      console.log('[Network] Started');
    }
  };
  
  // Toggle sync (LMD-GHOST head broadcasting)
  const toggleSync = () => {
    if (!networkManagerRef.current) return;
    
    if (isSyncEnabled) {
      // Stop syncing
      if (ghostHeadIntervalRef.current) {
        clearInterval(ghostHeadIntervalRef.current);
        ghostHeadIntervalRef.current = null;
      }
      setIsSyncEnabled(false);
      console.log('[Sync] Disabled');
    } else {
      // Start syncing
      ghostHeadIntervalRef.current = setInterval(() => {
        networkManagerRef.current?.broadcastAllGhostHeads();
      }, SimulatorConfig.SYNC_INTERVAL_MS);
      setIsSyncEnabled(true);
      console.log('[Sync] Enabled');
    }
  };
  
  // Handle saving settings
  const handleSaveSettings = (newConfig: typeof SimulatorConfig) => {
    // Update the config object
    Object.assign(SimulatorConfig, newConfig);
    console.log('[Settings] Configuration updated:', SimulatorConfig);
    
    // Restart intervals with new config values if network is running
    if (isNetworkRunning && slotIntervalRef.current) {
      clearInterval(slotIntervalRef.current);
      slotIntervalRef.current = setInterval(() => {
        networkManagerRef.current?.processAllSlots();
      }, SimulatorConfig.SECONDS_PER_SLOT * 1000 + SimulatorConfig.PROPOSER_BUFFER_MS);
    }
    
    if (isSyncEnabled && ghostHeadIntervalRef.current) {
      clearInterval(ghostHeadIntervalRef.current);
      ghostHeadIntervalRef.current = setInterval(() => {
        networkManagerRef.current?.broadcastAllGhostHeads();
      }, SimulatorConfig.SYNC_INTERVAL_MS);
    }
  };
  
  return (
    <div className="app-container">
      {/* Unified Single-Line Header Banner */}
      <header className="unified-header-banner">
        <h1 className="simulator-title">Ethereum Simulator</h1>
        
        <div className="controls-container">
          <button 
            className={`control-button ${isNetworkRunning ? 'active' : 'inactive'}`}
            onClick={toggleNetwork}
            title={isNetworkRunning ? 'Stop block production' : 'Start block production'}
          >
            {isNetworkRunning ? <FaPause /> : <FaPlay />}
            <span>{isNetworkRunning ? 'Network Running' : 'Network Stopped'}</span>
          </button>
          <button 
            className={`control-button ${isSyncEnabled ? 'active' : 'inactive'}`}
            onClick={toggleSync}
            title={isSyncEnabled ? 'Disable sync broadcasting' : 'Enable sync broadcasting'}
          >
            <FaSync className={isSyncEnabled ? 'spinning' : ''} />
            <span>{isSyncEnabled ? 'Sync Enabled' : 'Sync Disabled'}</span>
          </button>
        </div>
        
        <div className="legend-divider"></div>
        
        <div className="legend-items-inline">
          <div className="legend-item-compact" title="Casper FFG Finalized Checkpoint: Block has reached finality with 2/3+ validator votes across consecutive epochs. Cannot be reverted (irreversible).">
            <div className="legend-square finalized-square"></div>
            <span className="legend-text-two-line">
              <span className="legend-line-1">Casper FFG</span>
              <span className="legend-line-2">Finalized Checkpoint</span>
            </span>
          </div>
          <div className="legend-item-compact" title="LMD-GHOST Head: The current head of the chain according to the Latest Message Driven Greedy Heaviest Observed SubTree fork choice rule.">
            <div className="legend-square ghost-square"></div>
            <span className="legend-text-two-line">
              <span className="legend-line-1">LMD-GHOST</span>
              <span className="legend-line-2">Head</span>
            </span>
          </div>
          <div className="legend-item-compact" title="Fork: Block is part of a fork where nodes disagree on the canonical chain. Indicates chain divergence.">
            <div className="legend-square fork-square"></div>
            <span>Fork</span>
          </div>
          <div className="legend-item-compact" title="Canonical Block: Block with consensus across all nodes. Part of the agreed-upon main chain.">
            <div className="legend-square canonical-square"></div>
            <span>Canonical</span>
          </div>
          <div className="legend-item-compact" title="Empty Slot: A slot in the blockchain where no block was proposed. Represents a missed block proposal opportunity.">
            <div className="legend-square empty-slot-square"></div>
            <span>Empty Slot</span>
          </div>
          <button className="legend-settings-button" title="Settings" onClick={() => setShowSettings(true)}>
            ⚙️
          </button>
        </div>
      </header>
      
      <main className="nodes-container">
        {Object.entries(nodeStates).map(([nodeId, nodeState]) => (
          <NodePanel 
            key={nodeId} 
            nodeState={nodeState}
            onAddTransaction={handleAddTransaction}
            onUpdateNetworkDelay={handleUpdateNetworkDelay}
          />
        ))}
      </main>
      
      {/* Settings Modal */}
      {showSettings && (
        <SimulatorSettingsModal
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
          nodeStates={nodeStates}
        />
      )}
    </div>
  );
};

/**
 * Main simulator component that provides the context
 */
const SimulatorContent: React.FC = () => {
  return (
    <SimulatorProvider>
      <SimulatorContentInner />
    </SimulatorProvider>
  );
};

export default SimulatorContent;


================================================================================
// FILE: app/router/AppRouter.tsx
================================================================================

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SimulatorContent from '../pages/SimulatorContent';
import EPMDemo from '../pages/EPMDemo';

/**
 * Application router component that handles all routes
 */
const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/simulator" replace />} />
        <Route path="/simulator" element={<SimulatorContent />} />
        <Route path="/epm-demo" element={<EPMDemo />} />
        <Route path="*" element={<Navigate to="/simulator" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default AppRouter;


================================================================================
// FILE: app/utils/forkDetectionService.ts
================================================================================

import { NodeState } from '../../types/types';
import { calculateBlockHeaderHash } from '../../core/validation/blockValidator';

export class ForkDetectionService {
  /**
   * Detect forks by comparing blocks at each height across all nodes
   * @param nodeStates The current state of all nodes in the network
   * @returns The height at which the fork begins, or null if no fork exists
   */
  public static detectForks(nodeStates: Record<string, NodeState>): number | null {
    // Group blocks by height across all nodes
    const blocksByHeight: Record<number, Set<string>> = {};
    
    // Collect all blocks from all nodes, grouped by height
    Object.values(nodeStates).forEach(nodeState => {
      nodeState.blockchain.forEach(block => {
        const height = block.header.height;
        const blockHash = calculateBlockHeaderHash(block.header);
        
        if (!blocksByHeight[height]) {
          blocksByHeight[height] = new Set();
        }
        blocksByHeight[height].add(blockHash);
      });
    });
    
    // Find the first height where there are multiple different blocks
    const heights = Object.keys(blocksByHeight).map(Number).sort((a, b) => a - b);
    for (const height of heights) {
      if (blocksByHeight[height].size > 1) {
        return height;
      }
    }
    
    return null;
  }
}


================================================================================
// FILE: config/config.ts
================================================================================

/**
 * Configuration system for the Bitcoin simulator
 * Contains parameters that can be easily adjusted
 */

export let SimulatorConfig = {
  // Issuance parameters
  BLOCK_REWARD: 4,           // ETH rewarded to proposers
  
  // Network parameters
  NODE_COUNT: 4,             // Number of nodes in the network
  MIN_NETWORK_DELAY_MS: 1,  // Minimum network delay in milliseconds
  MAX_NETWORK_DELAY_MS: 5, // Maximum network delay in milliseconds
  
  // Transaction parameters
  REDISTRIBUTION_RATIO: 0.5, // Ratio of coins to redistribute (0-1)
  MAX_BLOCK_TRANSACTIONS: 10, // Maximum number of transactions per block
  
  // Proof of Stake (PoS) parameters
  SECONDS_PER_SLOT: 1,      // Duration of each slot in seconds
  SLOTS_PER_EPOCH: 4,        // Number of slots per epoch (Ethereum mainnet: 32)
  PROPOSER_BUFFER_MS: 100,   // Buffer time in ms to ensure slot increments before next proposal
  SYNC_INTERVAL_MS: 4000,    // Interval for broadcasting LMD-GHOST heads (sync)
  MAX_EFFECTIVE_BALANCE: 64, // Maximum effective balance in ETH for validators
  GENESIS_RANDAO_MIX: '0x0000000000000000000000000000000000000000000000000000000000000000', // RANDAO mix for epoch -1 (32 bytes of zeros)
  GENESIS_RANDAO_REVEAL: '0x0000000000000000000000000000000000000000000000000000000000000001', // RANDAO reveal for genesis block (epoch 0)
  
  // Constants
  PROTOCOL_NODE_ID: "COINBASE-REWARD",
  GENESIS_PREV_HASH: "0000000000000000000000000000000000000000000000000000000000000000", // Previous hash for genesis blocks
  
  // UI parameters
  MINING_BATCH_SIZE: 1000,   // Number of hash attempts per batch
  UPDATE_INTERVAL_MS: 500,   // UI update interval in milliseconds
  
  // Debug logging toggles
  DEBUG_SYNC: false,         // Enable/disable sync-related console logs
  DEBUG_BLOCK_CREATOR: true, // Enable/disable BlockCreator debug logs
  DEBUG_CONSENSUS: true,     // Enable/disable Consensus debug logs
};


================================================================================
// FILE: core/blockchain/blockCreator.ts
================================================================================

import { EthereumTransaction, PeerInfoMap, Block } from '../../types/types';
import { SimulatorConfig } from '../../config/config';
import { 
  createCoinbaseTransaction, 
  createPeerPaymentTransactions,
  createSignatureInput
} from './transaction';
import { calculateTransactionHash, calculateBlockHeaderHash } from '../validation/blockValidator';
import { generateSignature as cryptoGenerateSignature } from '../../utils/cryptoUtils';
import { Node } from '../node';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getNodePaintColor } from '../../utils/nodeColorUtils';
import { Mempool } from '../mempool/mempool';
import { Blockchain } from './blockchain';

/**
 * BlockCreator - Utility class for creating block transactions and blocks
*Consensus (PoS) classes
 * 
 * Provides static methods for:
 * - Creating genesis block
 * - Creating block transactions (coinbase, mempool, peer payments, paint)
 * - Creating paint transactions
 * - Getting valid peers
 * 
 * Note: Painting complete flag is stored per-node in Node class,
 * not in BlockCreator (to avoid shared state across nodes)
 */
export class BlockCreator {
  
  /**
   * Creates the shared genesis block for PoS
   * All nodes have the same genesis block (no coinbase, only EPM contract deployment)
   * This ensures all nodes start with identical state and same genesis hash
   */
  public static createGenesisBlock(): any {
    // Create a special transaction to deploy the EPM contract
    // This is a genesis-only transaction that creates the contract account
    // In Ethereum, sending to 0x0 creates a new contract
    const epmDeployTransaction: EthereumTransaction = {
      from: SimulatorConfig.PROTOCOL_NODE_ID, // System deploys the contract
      to: '0x0', // Contract creation address
      value: 0, // No ETH transferred
      nonce: 0,
      data: 'bulbasaur.png', // Image filename for the EPM contract
      publicKey: 'genesis',
      signature: 'genesis',
      timestamp: 0, // Fixed timestamp for deterministic hash
      txid: 'genesis-epm-deploy'
    };
    
    const transactions = [epmDeployTransaction];
    
    // Create block header (PoS - no ceiling or nonce)
    const header = {
      transactionHash: calculateTransactionHash(transactions),
      timestamp: 0, // Fixed timestamp for deterministic genesis hash
      previousHeaderHash: SimulatorConfig.GENESIS_PREV_HASH,
      height: 0,
      slot: -1 // Genesis is at slot -1 (before slot 0)
    };
    
    // Create genesis block with RANDAO reveal
    const block = {
      header,
      transactions,
      attestations: [],
      randaoReveal: SimulatorConfig.GENESIS_RANDAO_REVEAL,
      hash: calculateBlockHeaderHash(header)
    };
    
    return block;
  }
  
  /**
   * Gets peers with valid addresses
   * @param node The node to get peers from
   * @returns PeerInfoMap containing only peers with valid addresses
   */
  public static getValidPeers(node: Node): PeerInfoMap {
    const peers = node.getPeerInfos();
    return Object.entries(peers).reduce((validPeers, [peerId, info]) => {
      // Only include peers that have a defined non-empty address
      if (info?.address !== undefined && info.address !== '') {
        validPeers[peerId] = { 
          address: info.address
        };
      }
      return validPeers;
    }, {} as PeerInfoMap);
  }
  
  /**
   * Create a complete PoS block ready to broadcast
   * @param node - The proposing node
   * @param blockchain - Blockchain instance
   * @param mempool - Mempool instance
   * @param beaconState - Beacon state with attestation pool
   * @param slot - Slot number for this block
   * @param randaoReveal - RANDAO reveal for this block
   * @param paintingComplete - Whether painting is complete
   * @returns Complete block with header, transactions, and hash
   */
  public static async createBlock(
    node: Node,
    blockchain: Blockchain,
    mempool: Mempool,
    beaconState: any,
    slot: number,
    randaoReveal: string,
    paintingComplete: boolean
  ): Promise<Block> {
    // Get latest block to build on top of
    const latestBlock = blockchain.getLatestBlock();
    if (!latestBlock) {
      throw new Error('[BlockCreator] Cannot create block: no latest block');
    }
    
    // Create all transactions for the block
    const transactions = await BlockCreator.createBlockTransactions(
      node,
      blockchain,
      mempool,
      latestBlock.header.height + 1,
      paintingComplete
    );
    
    // Create block header (PoS - no ceiling or nonce)
    const header = {
      transactionHash: calculateTransactionHash(transactions),
      timestamp: Date.now(),
      previousHeaderHash: latestBlock.hash || '',
      height: latestBlock.header.height + 1,
      slot: slot
    };
    
    // Compute block hash first (we need it to filter attestations)
    const blockHash = calculateBlockHeaderHash(header);
    
    // Include attestations from beacon pool that point to canonical chain blocks
    // Exclude attestations for the current block we're creating
    const canonicalChain = blockchain.getCanonicalChain();
    const canonicalHashes = new Set(canonicalChain.map(b => b.hash));
    
    const includedAttestations = beaconState.beaconPool.filter((attestation: any) => {
      // Include if attestation points to a block in canonical chain
      // Exclude if attestation points to the block we're currently creating
      return canonicalHashes.has(attestation.blockHash) && attestation.blockHash !== blockHash;
    });
    
    // Create block with RANDAO reveal and attestations
    const block: Block = {
      header,
      transactions,
      attestations: includedAttestations,
      randaoReveal: randaoReveal,
      hash: blockHash
    };
    
    return block;
  }
  
  /**
   * Creates transactions for a new block
   * Includes: coinbase, mempool transactions, peer payments, and paint transaction
   * @param node The node creating the block
   * @param blockchain The blockchain instance
   * @param mempool The mempool instance
   * @param height Block height
   * @param paintingComplete Whether painting is complete for this node
   * @returns Promise resolving to array of transactions for the block
   */
  public static async createBlockTransactions(
    node: Node,
    blockchain: Blockchain,
    mempool: Mempool,
    height: number,
    paintingComplete: boolean
  ): Promise<EthereumTransaction[]> {
    const nodeAddress = node.getAddress();
    
    // Create coinbase transaction (block creator receives block reward)
    const coinbaseTransaction = createCoinbaseTransaction(nodeAddress);
    
    const transactions: EthereumTransaction[] = [coinbaseTransaction];
    
    // Get peers with valid addresses
    const validPeers = BlockCreator.getValidPeers(node);
    
    if (Object.keys(validPeers).length === 0) {
      console.warn('[BlockCreator] No peers with valid addresses available for peer payments');
      return transactions;
    }
    
    // Get node's current nonce from world state
    // Coinbase transactions don't increment nonce, so we use the node's current nonce
    const worldState = blockchain.getWorldState();
    const nodeAccount = worldState[nodeAddress];
    const baseNonce = nodeAccount ? nodeAccount.nonce : 0;
    
    console.log(`[BlockCreator] Creating block transactions for ${nodeAddress.slice(0, 8)}: baseNonce=${baseNonce}, balance=${nodeAccount?.balance || 0}`);
    
    // IMPORTANT: Add mempool transactions FIRST
    // This ensures peer payments and paint transactions use nonces that come after mempool transactions
    const maxMempoolSlots = SimulatorConfig.MAX_BLOCK_TRANSACTIONS - 1 - Object.keys(validPeers).length; // Reserve slots for coinbase, peer payments, and paint tx
    const mempoolTransactions = mempool.getTransactions(Math.max(0, maxMempoolSlots));
    transactions.push(...mempoolTransactions);
    
    console.log(`[BlockCreator] Mempool transactions: ${mempoolTransactions.length}, peerCount: ${Object.keys(validPeers).length}`);
    
    // Calculate starting nonce for peer payments (after mempool transactions)
    const peerPaymentStartNonce = baseNonce + mempoolTransactions.length;
    console.log(`[BlockCreator] Calculating peer payment start nonce: baseNonce=${baseNonce}, mempoolTransactions.length=${mempoolTransactions.length}, peerPaymentStartNonce=${peerPaymentStartNonce}`);
    
    console.log(`[BlockCreator] Peer payment start nonce: ${peerPaymentStartNonce}`);
    
    // Create peer payment transactions (one per peer)
    const peerPayments = await createPeerPaymentTransactions(
      nodeAddress,
      peerPaymentStartNonce,
      node.getPrivateKey(),
      node.getPublicKey(),
      validPeers
    );
    
    // Add all peer payment transactions to the block
    transactions.push(...peerPayments);
    
    // After peer payments, create a paint transaction with remaining ETH (truncated to integer)
    const paintNonce = peerPaymentStartNonce + peerPayments.length;
    const paintTransaction = await BlockCreator.createPaintTransaction(node, blockchain, paintNonce, paintingComplete);
    if (paintTransaction) {
      transactions.push(paintTransaction);
    }
    
    return transactions;
  }
  
  /**
   * Creates a paint transaction to send remaining ETH (truncated to integer) to EPM contract
   * @param node The node creating the transaction
   * @param blockchain The blockchain instance
   * @param nonce The nonce to use for this transaction
   * @param paintingComplete Whether painting is complete for this node
   * @returns Paint transaction or null if insufficient balance
   */
  public static async createPaintTransaction(
    node: Node,
    blockchain: Blockchain,
    nonce: number,
    paintingComplete: boolean
  ): Promise<EthereumTransaction | null> {
    // Don't create paint transactions if painting is complete
    if (paintingComplete) {
      console.log('[BlockCreator] Painting complete, skipping paint transaction');
      return null;
    }
    
    const nodeAddress = node.getAddress();
    
    // Get node's current account state
    const worldState = blockchain.getWorldState();
    const nodeAccount = worldState[nodeAddress];
    
    if (!nodeAccount) {
      console.log(`[BlockCreator] No account found for ${nodeAddress.slice(0, 8)}, skipping paint transaction`);
      return null;
    }
    
    // Calculate how much ETH will be spent on peer payments
    const validPeers = BlockCreator.getValidPeers(node);
    const peerCount = Object.keys(validPeers).length;
    const redistributionAmount = SimulatorConfig.BLOCK_REWARD * SimulatorConfig.REDISTRIBUTION_RATIO;
    const totalPeerPayments = peerCount > 0 ? redistributionAmount : 0;
    
    // Calculate balance AFTER coinbase is applied (coinbase will be added in this block)
    const balanceAfterCoinbase = nodeAccount.balance + SimulatorConfig.BLOCK_REWARD;
    
    // Calculate remaining balance after peer payments
    const balanceAfterPeerPayments = balanceAfterCoinbase - totalPeerPayments;
    
    // Calculate ETH to send (truncate to integer)
    const ethToSend = Math.floor(balanceAfterPeerPayments / 2);
    
    console.log(`[BlockCreator] Paint tx check for ${nodeAddress.slice(0, 8)}: currentBalance=${nodeAccount.balance}, +coinbase=${SimulatorConfig.BLOCK_REWARD}, afterCoinbase=${balanceAfterCoinbase}, -peerPayments=${totalPeerPayments}, remaining=${balanceAfterPeerPayments}, ethToSend=${ethToSend}`);
    
    // Only send if we have at least 1 ETH after peer payments
    if (ethToSend < 1) {
      console.log(`[BlockCreator] Insufficient balance for paint transaction (need at least 1 ETH, have ${ethToSend})`);
      return null;
    }
    
    const timestamp = Date.now();
    
    // Calculate txid (hash of transaction data)
    // NOTE: Must match validator's calculateTxid - does NOT include data field
    const txString = JSON.stringify({ 
      from: nodeAddress, 
      to: '0xEPM_PAINT_CONTRACT', 
      value: ethToSend, 
      nonce, 
      timestamp
    });
    const txid = bytesToHex(sha256(new TextEncoder().encode(txString)));
    
    // Create signature input (just the txid)
    const signatureInput = createSignatureInput({ txid });
    
    // Generate signature
    let signature;
    try {
      signature = await cryptoGenerateSignature(signatureInput, node.getPrivateKey());
    } catch (error) {
      console.error('[BlockCreator] Error generating signature for paint transaction:', error);
      signature = `error-${timestamp}`;
    }
    
    // Choose a deterministic color for this node based on its ID
    // This ensures each node consistently paints the same color
    const nodeId = node.getNodeId();
    const nodeColor = getNodePaintColor(nodeId);
    
    // Build complete paint transaction with color data
    return {
      from: nodeAddress,
      to: '0xEPM_PAINT_CONTRACT',
      value: ethToSend,
      nonce,
      data: JSON.stringify({ color: nodeColor }),
      publicKey: node.getPublicKey(),
      signature,
      timestamp,
      txid
    };
  }
}


================================================================================
// FILE: core/blockchain/blockchain.ts
================================================================================

import { Block, Account } from '../../types/types';
import { BlockCreator } from './blockCreator';
import { WorldState } from './worldState';
import { validateBlock, calculateBlockHeaderHash } from '../validation/blockValidator';
import { lightValidateChain } from '../validation/chainValidator';
import { BlockchainTree, BlockTreeNode } from './blockchainTree';
import { LmdGhost } from '../consensus/lmdGhost';
import { RANDAO } from '../consensus/randao';
import { CasperFFG } from '../consensus/casperFFG';
import { SimulatorConfig } from '../../config/config';

/**
 * Blockchain class with tree structure for fork management
 * Uses null root architecture to support multiple genesis blocks
 * Tree is single source of truth, canonical chain computed from HEAD pointer
 */
export class Blockchain {
  private blockTree: BlockchainTree;  // Block Tree with null root (single source of truth)
  private worldState: WorldState;
  private nodeId: string;
  private minerAddress: string;
  private beaconState: any;  // Reference to BeaconState for RANDAO and attestation processing
  
  constructor(nodeId: string, minerAddress: string, beaconState: any) {
    this.nodeId = nodeId;
    this.minerAddress = minerAddress;
    this.beaconState = beaconState;
    this.worldState = new WorldState();
    
    // Initialize tree with null root
    this.blockTree = new BlockchainTree();
    
    // Create and add shared genesis block (same for all nodes)
    const genesisBlock = BlockCreator.createGenesisBlock();
    this.blockTree.addBlock(genesisBlock);
    
    // Apply genesis block to both execution and consensus layers
    this.applyBlockToElAndClState(genesisBlock);
    
    // Set blockchain reference in BeaconState for eager tree updates
    this.beaconState.setBlockchain(this);
  }
  
  /**
   * Gets the BeaconState reference
   */
  getBeaconState(): any {
    return this.beaconState;
  }
  
  /**
   * Gets all blocks in the canonical blockchain (computed from GHOST-HEAD)
   * Uses the current GHOST-HEAD automatically
   */
  getCanonicalChain(): Block[] {
    return this.blockTree.getCanonicalChain();
  }
  
  /**
   * Gets all blocks in the canonical blockchain (alias for getCanonicalChain)
   */
  getBlocks(): Block[] {
    return this.getCanonicalChain();
  }
  
  /**
   * Gets the blockchain tree (for visualization and fork analysis)
   */
  getTree(): BlockchainTree {
    return this.blockTree;
  }
  
  /**
   * Gets the current world state accounts
   */
  getWorldState(): Record<string, Account> {
    return this.worldState.accounts;
  }
  
  /**
   * Gets the WorldState object for validation
   */
  getWorldStateObject(): WorldState {
    return this.worldState;
  }
  
  /**
   * Gets the transaction receipts database
   */
  getReceipts(): any {
    return this.worldState.receipts;
  }
  
  /**
   * Gets the latest block (canonical chain tip from GHOST-HEAD)
   * Uses current GHOST-HEAD automatically
   */
  getLatestBlock(): Block | null {
    const head = this.blockTree.getCanonicalHead();
    return head ? head.block : null;
  }
  
  /**
   * Gets the current blockchain height (latest block height)
   */
  getHeight(): number {
    const latestBlock = this.getLatestBlock();
    return latestBlock ? latestBlock.header.height : 0;
  }
  
  /**
   * Adds a single block to the blockchain
   * 
   * GHOST-HEAD Change Rule:
   * - If block extends canonical chain → GHOST-HEAD moves forward (forward progress)
   * - If block creates a fork → GHOST-HEAD stays the same
   * - CANNOT cause reorg (attestations in block are not considered for fork choice)
   * 
   * Note: Reorgs only happen when new attestation messages arrive (see onAttestationReceived)
   * 
   * Returns true if block was added successfully, false otherwise
   */
  async addBlock(block: Block): Promise<boolean> {
    // 1. Ensure block has a hash
    if (!block.hash) {
      block.hash = calculateBlockHeaderHash(block.header);
    }
    
    // 2. Get old GHOST-HEAD before adding block
    const oldGhostHead = this.blockTree.getGhostHead(this.beaconState);
    
    // 3. Add block to tree (creates tree node, doesn't validate yet)
    // and if valid, update tree decorations
    const newNode = this.blockTree.addBlock(block);
    if (!newNode) {
      console.error(`[Blockchain] Failed to add block ${block.hash} - parent not found`);
      return false;
    } 
    // update tree decorations if new block is referenced by any attestation
    LmdGhost.onNewBlock(block, this.blockTree, this.beaconState); 
    
    // 3.5. Process any queued attestations for this block
    const queuedAttestations = this.beaconState.pendingAttestations.get(block.hash!);
    if (queuedAttestations && queuedAttestations.length > 0) {
      console.log(`[Blockchain] Processing ${queuedAttestations.length} queued attestations for block ${block.hash!.slice(0, 8)}`);
      
      // Process all queued attestations now that the block exists
      LmdGhost.onNewAttestations(this.beaconState, this.blockTree, queuedAttestations);
      
      // Remove from queue
      this.beaconState.pendingAttestations.delete(block.hash!);
    }
    
    // 4. Get new GHOST-HEAD (recomputed via LMD-GHOST using incrementally updated attestedEth)
    const newGhostHead = this.blockTree.getGhostHead(this.beaconState);
    
    // 5. handle GHOST-HEAD change if occured
    await this.handleGhostHeadChange(oldGhostHead, newGhostHead);;
    return true
  }

  private async handleGhostHeadChange(
    oldGhostHead: BlockTreeNode | null,
    newGhostHead: BlockTreeNode | null
  ): Promise<void> {
    // Check if GHOST-HEAD changed
    if (oldGhostHead?.hash !== newGhostHead?.hash) {
      const needsRewind = !this.isDescendant(newGhostHead, oldGhostHead);
      
      if (needsRewind) {
        // ❌ Reorganization: GHOST-HEAD switched to a different fork or backwards
        console.log(`[Blockchain] REORG: ${oldGhostHead?.hash?.slice(0, 8)} → ${newGhostHead?.hash?.slice(0, 8)}`);
        await this.handleBacktrack();
      } else {
        // ✅ Forward Progress: GHOST-HEAD moved down same chain
        console.log(`[Blockchain] GHOST-HEAD moved forward: ${oldGhostHead?.hash?.slice(0, 8)} → ${newGhostHead?.hash?.slice(0, 8)}`);
        await this.handleForwardProgress(oldGhostHead, newGhostHead);
      }
    }
    // else: GHOST-HEAD stayed same - no action needed
  }
  
  
  /**
   * Adds a chain of blocks to the blockchain
   * Used during sync when receiving multiple blocks from peers
   * 
   * GHOST-HEAD Change Rule:
   * - If chain extends canonical chain → GHOST-HEAD moves forward (forward progress)
   * - If chain creates forks → GHOST-HEAD stays the same
   * - CANNOT cause reorg (attestations in blocks are not considered for fork choice)
   * 
   * Note: Reorgs only happen when new attestation messages arrive (see onAttestationReceived)
   * 
   * Returns true if all blocks were added successfully, false otherwise
   */
  async addChain(newBlocks: Block[]): Promise<boolean> {
    // Validate the chain structure first
    const isValid = await this.isValidChain(newBlocks);
    if (!isValid) {
      console.error('[Blockchain] Invalid chain structure');
      return false;
    }
    
    // Filter out blocks we already have
    // Start from the beginning and find the first block we don't have
    const tree = this.blockTree;
    const blocksToAdd: Block[] = [];
    
    for (const block of newBlocks) {
      const existingNode = tree.getNode(block.hash || '');
      if (!existingNode) {
        // We don't have this block, add it and all subsequent blocks
        blocksToAdd.push(block);
      }
      // If we have it, continue checking (we might have gaps)
    }
    
    if (blocksToAdd.length === 0) {
      // We already have all blocks in this chain
      return true;
    }
    
    // Add each new block using addBlock to ensure proper validation and state updates
    // Each addBlock call will move GHOST-HEAD forward if block extends canonical
    for (const block of blocksToAdd) {
      if (!await this.addBlock(block)) {
        console.warn(`[Blockchain] Failed to add block ${block.hash?.slice(0, 8)} at height ${block.header.height}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Validates a chain of blocks
   */
  private async isValidChain(chain: Block[]): Promise<boolean> {
    return await lightValidateChain(chain);
  }
  
  /**
   * Applies a block's state changes to both world state and beacon state
   * This is the single source of truth for how blocks modify state
   */
  private applyBlockToElAndClState(block: Block): void {
    // ========== World State Updates (Execution Layer) ==========
    // Apply all transactions in the block to world state
    for (let i = 0; i < block.transactions.length; i++) {
      this.worldState.updateWithTransaction(
        block.transactions[i],
        block.hash,
        block.header.height,
        i
      );
    }
    
    // ========== Beacon State Updates (Consensus Layer) ==========
    // Calculate epoch from slot: epoch = floor(slot / SLOTS_PER_EPOCH)
    const epoch = Math.floor(block.header.slot / SimulatorConfig.SLOTS_PER_EPOCH);
    
    // Update RANDAO mix for current epoch: new_mix = current_mix XOR reveal
    // All blocks including genesis have RANDAO reveal
    RANDAO.updateRandaoMix(this.beaconState, epoch, block.randaoReveal!);
    
    // Mark all attestations in this block as processed and remove from beacon pool
    if (block.attestations && block.attestations.length > 0) {
      const poolSizeBefore = this.beaconState.beaconPool.length;
      for (const attestation of block.attestations) {
        // Update latest attestation for this validator (for LMD-GHOST)
        const existing = this.beaconState.latestAttestations.get(attestation.validatorAddress);
        if (!existing || attestation.timestamp > existing.timestamp) {
          this.beaconState.latestAttestations.set(attestation.validatorAddress, attestation);
        }
        
        // Mark as processed to prevent duplicate inclusion
        this.beaconState.markAttestationAsProcessed(attestation.blockHash, attestation.validatorAddress);
        
        // Remove from beacon pool (cleanup)
        const poolSizeBeforeFilter = this.beaconState.beaconPool.length;
        this.beaconState.beaconPool = this.beaconState.beaconPool.filter(
          (att: any) => !(att.validatorAddress === attestation.validatorAddress && att.blockHash === attestation.blockHash)
        );
        const removed = poolSizeBeforeFilter - this.beaconState.beaconPool.length;
        if (removed === 0) {
          console.warn(`[Blockchain] Attestation not found in beacon pool: ${attestation.blockHash.slice(0, 8)}-${attestation.validatorAddress.slice(-4)}`);
        }
      }
      console.log(`[Blockchain] Beacon pool cleanup: ${poolSizeBefore} -> ${this.beaconState.beaconPool.length} (removed ${poolSizeBefore - this.beaconState.beaconPool.length})`);
      
      // Apply Casper FFG finality tracking
      CasperFFG.applyAttestationsToBeaconState(this.beaconState, block.attestations);
      
      // Note: Tree decoration is now handled incrementally in addBlock() via LmdGhost.updateTreeDecorations()
      // No need to redecorate entire tree here
    }
  }
  
  /**
   * Called when a new attestation message is received
   * This is the single source of truth for attestation processing
   * 
   * Complete Flow:
   * 1. Update latest attestations (per-validator map)
   * 2. Update tree attestedEth values
   * 3. Compute new GHOST-HEAD based on attestations
   * 4. Check if GHOST-HEAD moved:
   *    - Stayed same → No action needed
   *    - Moved forward → Validate and apply new blocks to state
   *    - Moved to different fork → Reorg (rebuild entire state, validate all blocks)
   * 
   * This is the ONLY way reorgs can happen (not via block/chain addition)
   * 
   * @param attestation - The attestation to process
   */
  async onAttestationReceived(attestation: any): Promise<void> {
    // Check if we have the block this attestation is for
    const blockNode = this.blockTree.getNode(attestation.blockHash);
    
    if (!blockNode) {
      // Block doesn't exist yet - queue the attestation for later processing
      console.log(`[Blockchain] Queuing attestation for unknown block ${attestation.blockHash.slice(0, 8)} from ${attestation.validatorAddress}`);
      
      if (!this.beaconState.pendingAttestations.has(attestation.blockHash)) {
        this.beaconState.pendingAttestations.set(attestation.blockHash, []);
      }
      this.beaconState.pendingAttestations.get(attestation.blockHash)!.push(attestation);
      return; // Don't process further until block arrives
    }
    
    // Block exists - process attestation normally
    // Save old GHOST-HEAD to detect changes
    const oldGhostHead = this.blockTree.getGhostHead(this.beaconState);
    
    // 1. Possibly update decorations as per new incoming attestation
    LmdGhost.onNewAttestations(this.beaconState, this.blockTree, [attestation]);
    
    // 2. Get new GHOST-HEAD after attestation update
    const newGhostHead = this.blockTree.getGhostHead(this.beaconState);
    
    // 3. Handle GHOST-HEAD change (reorg or forward progress)
    await this.handleGhostHeadChange(oldGhostHead, newGhostHead);
  }
  


  /**
   * Handle reorganization: GHOST-HEAD switched to a different fork or moved backwards
   * 
   * Strategy:
   * 1. Clear all state (world state, beacon state)
   * 2. Get all blocks on new canonical chain
   * 3. Apply blocks with retry logic if invalid blocks encountered
   * 4. Each invalid block triggers: mark invalid → recompute GHOST-HEAD → retry
   */
  private async handleBacktrack(): Promise<void> {
    // Clear state and get blocks to apply from new canonical chain
    this.clearAllState();
    
    // Retry loop: if we encounter invalid blocks, GHOST-HEAD will change
    // and we'll need to rebuild from the new canonical chain
    for (let attempt = 0; attempt < 10; attempt++) {
      const blocksToApply = this.getCanonicalChain();
      const success = await this.applyBlocksSequentially(blocksToApply);
      
      if (success) {
        console.log(`[Blockchain] Reorg complete - applied ${blocksToApply.length} blocks`);
        return; // Success!
      }
      
      // Invalid block encountered - GHOST-HEAD has changed, retry with new canonical chain
      const newHead = this.blockTree.getGhostHead(this.beaconState);
      console.log(`[Blockchain] Invalid block (retry ${attempt + 1}/10) - new head: ${newHead?.hash?.slice(0, 8)}`);
    }
    
    console.error(`[Blockchain] Reorg failed after 10 attempts`);
  }
  
  /**
   * Handle forward progress: GHOST-HEAD moved down the same chain
   * 
   * Strategy:
   * 1. Get blocks between old and new GHOST-HEAD
   * 2. Apply blocks sequentially
   * 3. If invalid block encountered, fall back to full reorg
   */
  private async handleForwardProgress(oldHead: BlockTreeNode | null, newHead: BlockTreeNode | null): Promise<void> {
    if (!oldHead || !newHead) return;
    
    const blocksToApply = this.getBlocksBetween(oldHead, newHead);
    const success = await this.applyBlocksSequentially(blocksToApply);
    
    if (!success) {
      // Invalid block encountered during forward progress
      // Fall back to full reorg to ensure consistency
      console.log(`[Blockchain] Invalid block during forward progress - falling back to full reorg`);
      await this.handleBacktrack();
    } else {
      console.log(`[Blockchain] Forward progress complete - applied ${blocksToApply.length} blocks`);
    }
  }
  
  /**
   * Apply blocks sequentially, validating each one
   * 
   * @param blocks - Blocks to apply in order
   * @returns true if all blocks applied successfully, false if any block invalid
   */
  private async applyBlocksSequentially(blocks: Block[]): Promise<boolean> {
    for (const block of blocks) {
      const blockPrevHash = block.header.previousHeaderHash;
      const applied = await this.validateAndApplyBlock(block, blockPrevHash);
      
      if (!applied) {
        // Block is invalid - mark it and stop
        console.log(`[Blockchain] Block ${block.hash?.slice(0, 8)} invalid - stopping`);
        return false;
      }
    }
    
    return true; // All blocks applied successfully
  }
  
  /**
   * Clear all blockchain state (world state and beacon state)
   * Called during reorg to reset to clean state before rebuilding
   * 
   * Clears:
   * - World state (account balances, nonces, etc.)
   * - Processed attestations
   * - RANDAO mixes (re-initialized to genesis)
   * - Proposer schedules
   */
  private clearAllState(): void {
    this.worldState = new WorldState();
    this.beaconState.clearProcessedAttestations();
    this.beaconState.clearRandaoState();
  }
  
  /**
   * Validate and apply a block to world state and beacon state
   * If validation fails, marks the block as invalid in the tree
   * 
   * @param block - Block to validate and apply
   * @param previousHash - Hash of the previous block (for validation context)
   * @returns true if block is valid and was applied, false if invalid
   */
  private async validateAndApplyBlock(block: Block, previousHash: string): Promise<boolean> {
    // Get the tree node for this block
    const node = this.blockTree.getNode(block.hash || '');
    if (!node) {
      console.error(`[Blockchain] Cannot validate block ${block.hash} - not in tree`);
      return false;
    }
    
    // Skip if already marked invalid
    if (node.metadata.isInvalid) {
      return false;
    }
    
    // Validate block against current world state (skip for genesis block)
    const validationResult = (block.header.height != 0) ? await validateBlock(block, this.worldState, previousHash) : {valid: true};
    
    if (!validationResult.valid) {
      // Store validation error in metadata
      node.metadata.validationError = validationResult.error;
      
      // Mark block as invalid and redecorate tree accordingly (attestedEth for invalid accounts will no longer count for parent nodes)
      LmdGhost.markNodeInvalid(node);
      console.log(`[Blockchain] Block ${block.hash?.slice(0, 8)} marked invalid: ${validationResult.error}`);
      return false;
    } else {
      // Block is valid - apply state changes
      this.applyBlockToElAndClState(block);
      return true; 
    }
  }
  
  /**
   * Check if newHead is a descendant of oldHead
   * Used to determine if GHOST-HEAD change is forward progress or reorg
   */
  private isDescendant(newHead: BlockTreeNode | null, oldHead: BlockTreeNode | null): boolean {
    if (!newHead || !oldHead) return false;
    if (newHead.hash === oldHead.hash) return true;
    
    // Walk up from new head to see if we reach old head
    let current: BlockTreeNode | null | undefined = newHead;
    while (current) {
      if (current.hash === oldHead.hash) {
        return true;  // newHead is descendant of oldHead
      }
      current = current.parent;
    }
    
    return false;  // newHead is NOT descendant of oldHead (reorg!)
  }
  
  /**
   * Get blocks between oldHead and newHead (exclusive of oldHead, inclusive of newHead)
   * Used when GHOST-HEAD moves forward to apply new blocks to state
   */
  private getBlocksBetween(oldHead: BlockTreeNode | null, newHead: BlockTreeNode | null): Block[] {
    if (!newHead) return [];
    
    const blocks: Block[] = [];
    let current: BlockTreeNode | null | undefined = newHead;
    
    // Walk up from new head to old head, collecting blocks
    while (current && current.hash !== oldHead?.hash) {
      if (current.block) {
        blocks.unshift(current.block);  // Add to front to maintain order
      }
      current = current.parent;
    }
    
    return blocks;
  }
  
  /**
   * Gets a block by its hash (searches tree)
   */
  getBlockByHash(hash: string): Block | undefined {
    const node = this.blockTree.getNode(hash);
    return node?.block || undefined;
  }
  
  /**
   * Gets a block by its height (from canonical chain determined by GHOST-HEAD)
   */
  getBlockByHeight(height: number): Block | undefined {
    const canonicalChain = this.getCanonicalChain();
    return height >= 0 && height < canonicalChain.length ? canonicalChain[height] : undefined;
  }
}


================================================================================
// FILE: core/blockchain/blockchainTree.ts
================================================================================

/**
 * Blockchain Tree Structure with Genesis Root
 * 
 * Architecture:
 * - Genesis block (height 0) is the root of the tree
 * - All nodes share the same deterministic genesis block
 * - All other blocks descend from genesis
 * - Supports GHOST/LMD-GHOST fork-choice
 */

import { Block } from '../../types/types';
import { LmdGhost }  from '../consensus/lmdGhost';
/**
 * Tree node wrapping a block with metadata
 * Extensible for future metadata (attestations, weight, etc.)
 */
export interface BlockTreeNode {
  block: Block;
  hash: string;
  parent: BlockTreeNode | null;  // null only for genesis (root)
  children: BlockTreeNode[];
  
  // Metadata (extensible for future use)
  metadata: {
    weight?: number;           // For GHOST: total attestation weight
    attestationCount?: number; // Number of attestations
    attestedEth?: number;      // For LMD GHOST: total staked ETH attesting to this subtree
    isInvalid?: boolean;       // True if block is invalid (failed validation), false/undefined = valid
    validationError?: string;  // Error message if block failed validation
    [key: string]: any;        // Allow any future metadata
  };
}

/**
 * Blockchain Tree class with Genesis Root
 * Maintains a tree of all blocks starting from a shared genesis block
 * Stores the LMD-GHOST HEAD for fork choice
 */
export class BlockchainTree {
  private root: BlockTreeNode | null;              // Genesis block (root of tree)
  private nodesByHash: Map<string, BlockTreeNode>; // Fast lookup by hash
  private leaves: Set<BlockTreeNode>;              // All leaf nodes (chain tips)
  
  constructor() {
    this.root = null;  // Will be set when genesis block is added
    this.nodesByHash = new Map();
    this.leaves = new Set();
  }
  
  /**
   * Adds a block to the tree
   * Returns the new node if successful, null if parent not found
   */
  addBlock(block: Block): BlockTreeNode | null {
    // Check if block already exists
    if (this.nodesByHash.has(block.hash || '')) {
      console.warn(`Block ${block.hash} already exists in tree`);
      return null;
    }
    
    // Determine parent
    let parentNode: BlockTreeNode | null = null;
    if (block.header.height === 0) {
      // Genesis block - becomes the root (no parent)
      parentNode = null;
    } else {
      // Regular block - find parent by previousHeaderHash
      const parentHash = block.header.previousHeaderHash;
      parentNode = this.nodesByHash.get(parentHash) || null;
      
      if (!parentNode) {
        console.warn(`Parent block ${parentHash} not found in tree`);
        return null;
      }
    }
    
    // Create new node
    const newNode: BlockTreeNode = {
      block,
      hash: block.hash || '',
      parent: parentNode,
      children: [],
      metadata: {
        weight: 0
      }
    };
    
    // If this is genesis (height 0), set as root
    if (block.header.height === 0) {
      this.root = newNode;
    } else {
      // Add to parent's children
      if (parentNode) {
        parentNode.children.push(newNode);
        
        // Update leaves: remove parent if it was a leaf
        if (this.leaves.has(parentNode)) {
          this.leaves.delete(parentNode);
        }
      }
    }
    
    // Add to lookup map
    this.nodesByHash.set(newNode.hash, newNode);
    
    // Add new node as a leaf
    this.leaves.add(newNode);
    
    // Note: Tree decoration is handled by caller via LmdGhost.updateTreeDecorations()
    // GHOST-HEAD is computed on-demand via getGhostHead()
    
    return newNode;
  }
  
  /**
   * Get chain from a specific block hash to genesis
   * Returns blocks in order from genesis to the specified hash
   * 
   * @param blockHash - Hash of the block to get chain for
   */
  getChain(blockHash: string): Block[] {
    const chain: Block[] = [];
    let current: BlockTreeNode | null | undefined = this.nodesByHash.get(blockHash);
    
    // Walk up from block to genesis, collecting blocks
    while (current) {
      if (current.block) {
        chain.unshift(current.block);  // Add to front to maintain order
      }
      current = current.parent;
    }
    
    return chain;
  }
  
  /**
   * Get the canonical chain (from current GHOST-HEAD to genesis)
   * Returns blocks in order from genesis to GHOST-HEAD
   * 
   * For getting chain of a specific hash, use getChain(hash) instead
   */
  getCanonicalChain(): Block[] {
    const headHash = this.getGhostHead()?.hash;
    if (!headHash) {
      return [];
    }
    return this.getChain(headHash);
  }
  
  /**
   * Gets a block node by hash
   */
  getNode(hash: string): BlockTreeNode | undefined {
    return this.nodesByHash.get(hash);
  }
  
  /**
   * Gets all leaf nodes (chain tips)
   */
  getLeaves(): BlockTreeNode[] {
    return Array.from(this.leaves);
  }
  
  /**
   * Get the canonical head node (current GHOST-HEAD)
   * 
   * For getting a specific node by hash, use getNode(hash) instead
   */
  getCanonicalHead(): BlockTreeNode | null {
    return this.getGhostHead();
  }
  
  /**
   * Gets the genesis block (root of tree)
   */
  getRoot(): BlockTreeNode | null {
    return this.root;
  }
  

  
  /**
   * Gets all blocks in the tree (for debugging/visualization)
   */
  getAllNodes(): BlockTreeNode[] {
    return Array.from(this.nodesByHash.values());
  }
  
  /**
   * Gets tree statistics
   */
  getStats(): {
    totalBlocks: number;
    canonicalChainLength: number;
    numberOfLeaves: number;
    numberOfForks: number;
  } {
    return {
      totalBlocks: this.nodesByHash.size,
      canonicalChainLength: this.getCanonicalChain().length,
      numberOfLeaves: this.leaves.size,
      numberOfForks: this.leaves.size - 1 // Forks = leaves - 1
    };
  }
  
  /**
   * Simple tree visualization for debugging
   * Returns a string representation of the tree structure
   * @param ghostHeadHash - Hash of the GHOST-HEAD for canonical chain marking
   */
  visualize(ghostHeadHash?: string | null): string {
    const lines: string[] = [];
    
    if (!this.root) {
      return '[Empty tree - no genesis block]';
    }
    
    // Build set of canonical node hashes by walking from GHOST-HEAD to genesis
    const canonicalHashes = new Set<string>();
    if (ghostHeadHash) {
      let current: BlockTreeNode | null | undefined = this.nodesByHash.get(ghostHeadHash);
      while (current) {
        canonicalHashes.add(current.hash);
        current = current.parent;
      }
    }
    
    const traverse = (node: BlockTreeNode, prefix: string, isLast: boolean) => {
      const marker = isLast ? '└── ' : '├── ';
      const canonical = canonicalHashes.has(node.hash) ? ' [CANONICAL]' : '';
      const isGenesis = node.block.header.height === 0 ? ' [GENESIS]' : '';
      
      const height = node.block.header.height;
      const shortHash = node.hash.substring(0, 8);
      lines.push(`${prefix}${marker}Block ${height} (${shortHash})${canonical}${isGenesis}`);
      
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      node.children.forEach((child, index) => {
        const isLastChild = index === node.children.length - 1;
        traverse(child, childPrefix, isLastChild);
      });
    };
    
    // Start from root (genesis)
    traverse(this.root, '', true);
    
    return lines.join('\n');
  }
  
  /**
   * Get all blocks in the tree
   * Used for collecting all attestations from the blockchain
   */
  getAllBlocks(): Block[] {
    const blocks: Block[] = [];
    
    if (!this.root) {
      return blocks;
    }
    
    const traverse = (node: BlockTreeNode) => {
      blocks.push(node.block);
      node.children.forEach(child => traverse(child));
    };
    
    traverse(this.root);
    return blocks;
  }
  
  
  /**
   * Get GHOST-HEAD (fork choice)
   * Returns the block node that should be considered the canonical chain head
   * 
   * GHOST-HEAD Movement:
   * - Moves when blocks are added (if new block extends heaviest chain)
   * - Moves when attestations update (if attestations shift weight to different fork)
   * 
   * Algorithm (via LmdGhost.computeGhostHead):
   * 1. Start at finalized checkpoint (or genesis if no finalized checkpoint)
   * 2. At each fork, choose child with highest attestedEth
   * 3. Continue until reaching a leaf (chain tip)
   * 
   * @param beaconState - Optional BeaconState for finalized checkpoint
   */
  getGhostHead(beaconState?: any): BlockTreeNode | null {
    const ghostHeadHash = LmdGhost.computeGhostHead(this, beaconState);
    return ghostHeadHash ? this.getNode(ghostHeadHash) || null : null;
  }
}


================================================================================
// FILE: core/blockchain/index.ts
================================================================================

/**
 * Blockchain module index file
 * Exports all blockchain-related functionality
 */

export * from './transaction';
export * from './blockchain';


================================================================================
// FILE: core/blockchain/transaction.ts
================================================================================

import { EthereumTransaction, PeerInfoMap } from '../../types/types';
import { SimulatorConfig } from '../../config/config';
import { generateSignature as cryptoGenerateSignature } from '../../utils/cryptoUtils';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Helper function to calculate transaction hash (txid)
 * NOTE: Does NOT include signature - txid is calculated before signing
 */
function calculateTxid(tx: Partial<EthereumTransaction>): string {
  const txString = JSON.stringify({ 
    from: tx.from, 
    to: tx.to, 
    value: tx.value, 
    nonce: tx.nonce, 
    timestamp: tx.timestamp 
  });
  return bytesToHex(sha256(new TextEncoder().encode(txString)));
}

/**
 * Creates the signature input data for an Ethereum transaction
 * 
 * CRYPTOGRAPHIC COMMITMENT PATTERN:
 * We sign JUST the txid because:
 * 1. txid = hash(from, to, value, nonce, timestamp) - cryptographically commits to all transaction data
 * 2. Signing the txid proves you authorized this specific transaction
 * 3. During validation, we verify:
 *    a) hash(transaction_data) === txid (data hasn't been tampered with)
 *    b) signature is valid for txid (proves authorization with private key)
 * 
 * This is simpler and more efficient than signing all the transaction data separately.
 */
export function createSignatureInput(tx: { txid: string }) {
  // Return just the txid - it cryptographically represents the entire transaction
  return tx.txid;
}

/**
 * Creates a coinbase transaction for the miner
 * This is the reward for mining a block
 * Note: Coinbase transactions don't need real signatures
 */
export const createCoinbaseTransaction = (
  minerAddress: string
): EthereumTransaction => {
  const timestamp = Date.now();
  
  // Calculate txid first (before signature)
  const txid = calculateTxid({
    from: SimulatorConfig.PROTOCOL_NODE_ID,
    to: minerAddress,
    value: SimulatorConfig.BLOCK_REWARD,
    nonce: 0,
    timestamp
  });
  
  return {
    from: SimulatorConfig.PROTOCOL_NODE_ID,
    to: minerAddress,
    value: SimulatorConfig.BLOCK_REWARD,
    nonce: 0,
    publicKey: '',
    signature: `coinbase-${timestamp}`,  // Placeholder signature for coinbase
    timestamp,
    txid
  };
};

/**
 * Creates peer payment transactions - one transaction per peer
 * In Ethereum account model, we send separate transactions instead of one with multiple outputs
 */
export const createPeerPaymentTransactions = async (
  minerAddress: string,
  minerNonce: number,
  minerPrivateKey: string,
  minerPublicKey: string,
  peers: PeerInfoMap
): Promise<EthereumTransaction[]> => {
  const peerNodeIds = Object.keys(peers);
  
  // Calculate redistribution amounts
  const redistributionAmount = SimulatorConfig.BLOCK_REWARD * SimulatorConfig.REDISTRIBUTION_RATIO;
  const amountPerPeer = redistributionAmount / peerNodeIds.length;
  
  const transactions: EthereumTransaction[] = [];
  
  // Create one transaction per peer
  for (let i = 0; i < peerNodeIds.length; i++) {
    const peerId = peerNodeIds[i];
    const peerAddress = peers[peerId].address;
    const timestamp = Date.now();
    
    // Step 1: Calculate txid FIRST (before signature)
    const txid = calculateTxid({
      from: minerAddress,
      to: peerAddress,
      value: amountPerPeer,
      nonce: minerNonce + i,
      timestamp
    });
    
    // Step 2: Create signature input (just the txid)
    // The txid already cryptographically commits to all transaction data
    const signatureInput = createSignatureInput({ txid });
    
    // Step 3: Generate signature (signing the txid proves authorization)
    let signature;
    try {
      signature = await cryptoGenerateSignature(signatureInput, minerPrivateKey);
    } catch (error) {
      console.error('Error generating signature:', error);
      signature = `error-${timestamp}`;
    }
    
    // Step 4: Build complete transaction
    transactions.push({
      from: minerAddress,
      to: peerAddress,
      value: amountPerPeer,
      nonce: minerNonce + i,
      publicKey: minerPublicKey,
      signature,
      timestamp,
      txid
    });
  }
  
  return transactions;
};

/**
 * Creates a signed transaction for a user-initiated transfer
 * @param from Sender address
 * @param to Recipient address
 * @param value Amount to send in ETH
 * @param nonce Sender's current nonce
 * @param privateKey Sender's private key for signing
 * @param publicKey Sender's public key
 * @returns Signed Ethereum transaction
 */
export async function createSignedTransaction(
  from: string,
  to: string,
  value: number,
  nonce: number,
  privateKey: string,
  publicKey: string
): Promise<EthereumTransaction> {
  const timestamp = Date.now();
  
  // Calculate txid first (before signature)
  const txid = calculateTxid({ from, to, value, nonce, timestamp });
  
  // Create signature input and sign
  const signatureInput = createSignatureInput({ txid });
  const signature = await cryptoGenerateSignature(signatureInput, privateKey);
  
  return {
    from,
    to,
    value,
    nonce,
    publicKey,
    signature,
    timestamp,
    txid
  };
}


================================================================================
// FILE: core/blockchain/worldState.ts
================================================================================

import { SimulatorConfig } from '../../config/config';
import { Block, EthereumTransaction, Account } from '../../types/types';
import { createEPMContract } from '../epm/epmInit';
import { EPM } from '../epm/EPM';
import { ReceiptsDatabase, TransactionReceipt } from '../../types/receipt';

/**
 * WorldState class for Ethereum account model
 * This will eventually become a simplified EVM
 */
export class WorldState {
  public accounts: Record<string, Account>;
  public receipts: ReceiptsDatabase;  // Chaindata: transaction receipts

  constructor(initialAccounts: Record<string, Account> = {}) {
    // Deep copy the accounts to avoid reference issues
    // When validating blocks, we create a temp world state that should not modify the original
    this.accounts = structuredClone(initialAccounts);
    this.receipts = {};  // Initialize empty receipts database
  }

  /**
   * Gets an account by address
   */
  getAccount(address: string): Account | undefined {
    return this.accounts[address];
  }

  /**
   * Creates a transaction receipt and stores it in the receipts database
   */
  private createReceipt(
    transaction: EthereumTransaction,
    blockHash: string,
    blockNumber: number,
    txIndex: number,
    status: 0 | 1,
    gasUsed: number,
    cumulativeGasUsed: number,
    contractAddress: string | null = null,
    revertReason?: string
  ): void {
    const receipt: TransactionReceipt = {
      transactionHash: transaction.txid,
      transactionIndex: txIndex,
      blockHash: blockHash,
      blockNumber: blockNumber,
      from: transaction.from,
      to: transaction.to === '0x0' ? null : transaction.to,
      status: status,
      gasUsed: gasUsed,
      cumulativeGasUsed: cumulativeGasUsed,
      contractAddress: contractAddress,
      logs: [], // Empty for now
      revertReason: revertReason
    };

    // Store receipt in receipts database
    if (!this.receipts[blockHash]) {
      this.receipts[blockHash] = {};
    }
    this.receipts[blockHash][transaction.txid] = receipt;
  }

  /**
   * Helper function to process a transaction for WorldState updates
   * Updates sender and recipient account balances and nonces
   * Also handles EPM contract deployment and creates transaction receipts
   */
  private processTransaction(
    transaction: EthereumTransaction, 
    blockHash?: string, 
    blockNumber?: number, 
    txIndex?: number,
    cumulativeGasUsed?: number
  ): { gasUsed: number; status: 0 | 1; revertReason?: string } {
    const { from, to, value, data } = transaction;
    
    // Check if this is a coinbase transaction (block reward)
    const isCoinbase = from === SimulatorConfig.PROTOCOL_NODE_ID;
    
    // Check if this is a paint transaction to EPM contract
    // Paint transactions have JSON data with a color field
    let isPaintTransaction = false;
    if (to === '0xEPM_PAINT_CONTRACT' && data) {
      try {
        const parsedData = JSON.parse(data);
        isPaintTransaction = parsedData.color !== undefined;
      } catch (e) {
        // Not valid JSON, not a paint transaction
      }
    }
    
    // Handle paint transactions to EPM contract
    if (isPaintTransaction && this.accounts[to]) {
      console.log(`Processing paint transaction: ${value} ETH from ${from} to ${to}`);
      console.log(`Contract balance before: ${this.accounts[to].balance}`);
      
      // Try to execute the paint transaction
      // Use transaction ID as block hash if not provided
      const txBlockHash = blockHash || transaction.txid;
      const result = EPM.executeTransaction(this.accounts[to], transaction, txBlockHash);
      
      const gasUsed = 21000; // Simplified gas for now
      
      if (result.success) {
        // Transaction succeeded - update the contract account
        this.accounts[to] = result.account;
        console.log(`Paint transaction SUCCESS! Contract balance after: ${this.accounts[to].balance}`);
        
        // Deduct ETH from sender and increment nonce
        if (this.accounts[from]) {
          this.accounts[from] = {
            ...this.accounts[from],
            balance: this.accounts[from].balance - value,
            nonce: this.accounts[from].nonce + 1
          };
        }
        
        // If painting completed, credit winner with reward
        if (result.winnerReward) {
          const { address, amount } = result.winnerReward;
          console.log(`💰 Crediting winner ${address} with ${amount} ETH reward!`);
          
          if (this.accounts[address]) {
            this.accounts[address] = {
              ...this.accounts[address],
              balance: this.accounts[address].balance + amount
            };
          }
        }
        
        // Create success receipt (only if block context available)
        if (blockHash && blockNumber !== undefined && txIndex !== undefined && cumulativeGasUsed !== undefined) {
          this.createReceipt(
            transaction,
            blockHash,
            blockNumber,
            txIndex,
            1, // success
            gasUsed,
            cumulativeGasUsed + gasUsed,
            null
          );
        }
        
        return { gasUsed, status: 1 };
      } else {
        // Transaction rejected by contract (e.g., painting complete)
        // Don't deduct ETH from sender, but still increment nonce
        console.log(`Paint transaction REJECTED: ${result.error}`);
        if (this.accounts[from]) {
          this.accounts[from] = {
            ...this.accounts[from],
            nonce: this.accounts[from].nonce + 1
          };
        }
        
        // Create failure receipt (only if block context available)
        if (blockHash && blockNumber !== undefined && txIndex !== undefined && cumulativeGasUsed !== undefined) {
          this.createReceipt(
            transaction,
            blockHash,
            blockNumber,
            txIndex,
            0, // failure
            gasUsed,
            cumulativeGasUsed + gasUsed,
            null,
            result.error
          );
        }
        
        return { gasUsed, status: 0, revertReason: result.error };
      }
    }
    
    // Check if this is a contract creation (to address is 0x0)
    const isContractCreation = to === '0x0';
    let contractAddress = to;
    
    // If creating a contract, generate the contract address
    if (isContractCreation && data) {
      // For EPM contracts, use a static well-known address
      // This makes it easy to send paint transactions to the contract
      contractAddress = '0xEPM_PAINT_CONTRACT';
      
      // Create the EPM contract account
      const epmAccount = createEPMContract(contractAddress, data);
      
      // Add the contract account to world state
      this.accounts[contractAddress] = epmAccount;
      
      const gasUsed = 53000; // Contract creation gas
      
      // Create success receipt for contract creation (only if block context available)
      if (blockHash && blockNumber !== undefined && txIndex !== undefined && cumulativeGasUsed !== undefined) {
        this.createReceipt(
          transaction,
          blockHash,
          blockNumber,
          txIndex,
          1, // success
          gasUsed,
          cumulativeGasUsed + gasUsed,
          contractAddress // Contract address created
        );
      }
      
      return { gasUsed, status: 1 };
    }
    
    // Create recipient account if it doesn't exist (for regular transactions)
    if (!this.accounts[to]) {
      this.accounts[to] = {
        address: to,
        balance: 0,
        nonce: 0
      };
    }
    
    // For regular transactions (not coinbase):
    // Update sender: deduct balance, increment nonce
    if (!isCoinbase && this.accounts[from]) {
      this.accounts[from] = {
        ...this.accounts[from],
        balance: this.accounts[from].balance - value,
        nonce: this.accounts[from].nonce + 1
      };
    }
    
    // Update recipient: add balance (for both coinbase and regular transactions)
    this.accounts[to] = {
      ...this.accounts[to],
      balance: this.accounts[to].balance + value
    };
    
    const gasUsed = 21000; // Standard transfer gas
    
    // Create success receipt for regular transfer (only if block context available)
    if (blockHash && blockNumber !== undefined && txIndex !== undefined && cumulativeGasUsed !== undefined) {
      this.createReceipt(
        transaction,
        blockHash,
        blockNumber,
        txIndex,
        1, // success
        gasUsed,
        cumulativeGasUsed + gasUsed,
        null
      );
    }
    
    return { gasUsed, status: 1 };
  }

  /**
   * Updates the world state with a new transaction
   * Updates account balances and nonces
   * Optionally creates receipts if block context is provided
   */
  updateWithTransaction(
    transaction: EthereumTransaction,
    blockHash?: string,
    blockNumber?: number,
    txIndex?: number
  ): boolean {
    // Validate that sender account exists (unless it's a coinbase transaction)
    const isCoinbase = transaction.from === SimulatorConfig.PROTOCOL_NODE_ID;
    
    if (!isCoinbase) {
      // Check if sender account exists
      if (!this.accounts[transaction.from]) {
        console.error(`Transaction ${transaction.txid} has missing sender account: ${transaction.from}`);
        return false;
      }
      
      // Check if sender has sufficient balance
      if (this.accounts[transaction.from].balance < transaction.value) {
        console.error(`Transaction ${transaction.txid} has insufficient balance`);
        console.error(`  Sender: ${transaction.from}`);
        console.error(`  Balance: ${this.accounts[transaction.from].balance}`);
        console.error(`  Required: ${transaction.value}`);
        return false;
      }
    }
    
    // Calculate cumulative gas for this transaction
    // In a real implementation, this would track gas across all txs in the block
    const cumulativeGasUsed = (txIndex || 0) * 21000;
    
    // Process the transaction (update balances and nonces, create receipt if block context provided)
    this.processTransaction(transaction, blockHash, blockNumber, txIndex, cumulativeGasUsed);
    return true;
  }

  /**
   * Rebuilds the world state from blocks
   * This is used when switching to a new chain
   */
  static fromBlocks(blocks: Block[]): WorldState {
    const worldState = new WorldState();
    
    // Process each block's transactions with block context for receipt creation
    for (const block of blocks) {
      const transactions = block.transactions as unknown as EthereumTransaction[];
      for (let i = 0; i < transactions.length; i++) {
        worldState.updateWithTransaction(
          transactions[i],
          block.hash,
          block.header.height,
          i
        );
      }
    }
    
    return worldState;
  }

  /**
   * Rebuilds the world state from transactions
   * This is used when switching to a new chain
   */
  static fromTransactions(transactions: EthereumTransaction[]): WorldState {
    const worldState = new WorldState();
    
    // Process transactions in order - use updateWithTransaction to ensure
    // same validation logic as incremental processing
    for (const transaction of transactions) {
      worldState.updateWithTransaction(transaction);
    }
    
    return worldState;
  }
}


================================================================================
// FILE: core/consensus/Consensus.ts
================================================================================

import { Block } from '../../types/types';
import { SimulatorConfig } from '../../config/config';
import { Node } from '../node';
import { BeaconState } from './beaconState';
import { Blockchain } from '../blockchain/blockchain';
import { BlockCreator } from '../blockchain/blockCreator';
import { RANDAO } from './randao';
import { CasperFFG } from './casperFFG';
import { MessageType } from '../../network/messages';
import { Mempool } from '../mempool/mempool';

/**
 * Consensus class handles PoS consensus logic
 * Runs every slot to determine proposer and handle block proposals
 * 
 * State lives in BeaconState, this class contains logic only
 * Uses BlockCreator for block transaction creation
 */
export class Consensus {
  private beaconState: BeaconState;
  private blockchain: Blockchain;
  private node: Node;
  private nodeId: string;
  private nodeAddress: string;
  private mempool: Mempool;
  private paintingComplete: boolean = false; // Flag to stop creating paint transactions
  
  // Consensus status for UI display
  public consensusStatus: 'idle' | 'validating' | 'proposing' = 'idle';
  
  // Callback for sending messages to network
  private onSendMessage?: (message: any) => void;
  
  constructor(
    beaconState: BeaconState,
    blockchain: Blockchain,
    node: Node,
    mempool: Mempool
  ) {
    this.beaconState = beaconState;
    this.blockchain = blockchain;
    this.node = node;
    this.nodeId = node.getNodeId();
    this.nodeAddress = node.getAddress();
    this.mempool = mempool;
    
    // Proposer schedule will be computed lazily when first slot is processed
    const currentSlot = this.getCurrentSlot();
    const currentEpoch = this.getEpoch(currentSlot);
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Initializing with slot ${currentSlot}, epoch ${currentEpoch}`);
  }
  
  /**
   * Mark painting as complete - stops creating paint transactions
   */
  public markPaintingComplete(): void {
    this.paintingComplete = true;
    console.log(`${this.node.getNodeId()}: Painting complete - no more paint transactions will be created`);
  }
  
  /**
   * Check if painting is complete
   */
  public isPaintingComplete(): boolean {
    return this.paintingComplete;
  }
  
  /**
   * Sets the callback for sending messages to the network
   */
  setMessageCallback(callback: (message: any) => void): void {
    this.onSendMessage = callback;
  }
  
  /**
   * Helper: Get current slot based on genesis time
   */
  private getCurrentSlot(): number {
    return this.beaconState.getCurrentSlot();
  }
  
  /**
   * Helper: Calculate epoch from slot
   */
  private getEpoch(slot: number): number {
    return Math.floor(slot / SimulatorConfig.SLOTS_PER_EPOCH);
  }
  
  /**
   * Helper: Check if slot is first slot of epoch
   */
  private isFirstSlotOfEpoch(slot: number): boolean {
    return slot % SimulatorConfig.SLOTS_PER_EPOCH === 0;
  }
  
  /**
   * Helper: Get slots per epoch constant
   */
  private getSlotsPerEpoch(): number {
    return SimulatorConfig.SLOTS_PER_EPOCH;
  }
  
  /**
   * Ensures proposer schedule exists for the given epoch
   * Computes schedule if it doesn't exist yet
   * This is the single method for schedule computation, used by both:
   * - Constructor (initialization)
   * - processSlot (first slot of new epoch)
   */
  private ensureScheduleForEpoch(epoch: number): void {
    // Check if schedule already exists for this epoch
    const existingSchedule = this.beaconState.proposerSchedules.get(epoch);
    if (existingSchedule) {
      console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Schedule already exists for epoch ${epoch}`);
      return;
    }
    
    // Schedule doesn't exist, compute it
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Computing new schedule for epoch ${epoch}`);
    this.computeProposerSchedule(epoch);
  }
  
  /**
   * Forces recomputation of proposer schedule for a specific epoch
   * Used to update Epoch 0 schedule after validator addresses are finalized
   * Public method called from NodeWorker during initialization
   */
  public recomputeScheduleForEpoch(epoch: number): void {
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Recomputing schedule for epoch ${epoch}`);
    this.computeProposerSchedule(epoch);
  }
  
  /**
   * Main consensus logic - called every slot
   * 1. Calculate current slot and epoch
   * 2. Ensure proposer schedule exists for current epoch
   * 3. Determine current proposer for this slot
   * 4. If we are proposer, create and broadcast block
   * 5. If not proposer, wait for block from proposer
   */
  async processSlot(): Promise<void> {
    // 1. Get current slot and epoch (time-based calculation)
    const currentSlot = this.getCurrentSlot();
    const currentEpoch = this.getEpoch(currentSlot);
    
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Processing slot ${currentSlot}, epoch ${currentEpoch}`);
    
    // 2. Ensure proposer schedule exists for current epoch (lazy calculation)
    this.ensureScheduleForEpoch(currentEpoch);
    
    // 3. Determine current proposer for this slot
    const proposer = this.getCurrentProposer(currentEpoch, currentSlot);
    
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] Proposer for slot ${currentSlot}: ${proposer?.slice(0, 8) || 'null'}`);
    
    // 4. If we are the proposer, create and broadcast block
    if (proposer === this.nodeAddress) {
      console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] I am the proposer for slot ${currentSlot}!`);
      this.consensusStatus = 'proposing';
      await this.proposeBlock(currentSlot);
    } else {
      // 5. If not proposer, we are validating (waiting for block)
      this.consensusStatus = 'validating';
    }
  }
  
  /**
   * Computes the proposer schedule for an epoch using RANDAO
   * Updates BeaconState.proposerSchedules with epoch -> (slot -> validator address)
   */
  private computeProposerSchedule(epoch: number): void {
    try {
      const slotsPerEpoch = this.getSlotsPerEpoch();
      const firstSlot = epoch * slotsPerEpoch;
      
      console.log(`[Consensus] Computing proposer schedule for epoch ${epoch}, first slot: ${firstSlot}`);
      
      // Get proposer schedule for entire epoch from RANDAO
      // Returns array of 32 validator addresses (one per slot)
      const proposerArray = RANDAO.getProposerSchedule(this.beaconState, epoch);
      
      if (!proposerArray || proposerArray.length === 0) {
        console.error(`[Consensus] RANDAO returned empty proposer array for epoch ${epoch}`);
        return;
      }
      
      console.log(`[Consensus] RANDAO returned ${proposerArray.length} proposers for epoch ${epoch}`);
      
      // Create schedule map: slot -> validator address
      const schedule = new Map<number, string>();
      for (let i = 0; i < slotsPerEpoch; i++) {
        const slot = firstSlot + i;
        schedule.set(slot, proposerArray[i]);
      }
      
      // Store schedule in BeaconState
      this.beaconState.proposerSchedules.set(epoch, schedule);
      
      console.log(`[Consensus] Successfully stored proposer schedule for epoch ${epoch}, schedule size: ${schedule.size}`);
    } catch (error) {
      console.error(`[Consensus] Error computing proposer schedule for epoch ${epoch}:`, error);
    }
  }
  
  /**
   * Gets the current proposer for a slot from the proposer schedule
   */
  private getCurrentProposer(epoch: number, slot: number): string | null {
    const schedule = this.beaconState.proposerSchedules.get(epoch);
    if (!schedule) {
      console.warn(`[Consensus] No proposer schedule for epoch ${epoch}`);
      return null;
    }
    
    return schedule.get(slot) || null;
  }
  
  /**
   * Proposes a new block for the given slot
   * Called when this node is the proposer for the current slot
   * 
   * Creates complete block using BlockCreator and broadcasts to all validators
   */
  private async proposeBlock(slot: number): Promise<void> {
    console.log(`[Consensus] Node ${this.nodeAddress.slice(0, 8)} proposing block for slot ${slot}`);
    
    // Validate: Don't propose if previous block has the same slot
    const latestBlock = this.blockchain.getLatestBlock();
    if (latestBlock && latestBlock.header.slot === slot) {
      console.warn(`[Consensus] Skipping proposal - previous block already has slot ${slot}`);
      return;
    }
    
    // Calculate current epoch and generate RANDAO reveal
    const currentEpoch = this.getEpoch(slot);
    const randaoReveal = RANDAO.calculateRandaoReveal(currentEpoch, this.node);
    console.log(`[Consensus] Generated RANDAO reveal for epoch ${currentEpoch}: ${randaoReveal.slice(0, 16)}...`);
    
    // Create complete block using BlockCreator
    const block = await BlockCreator.createBlock(
      this.node,
      this.blockchain,
      this.mempool,
      this.beaconState,
      slot,
      randaoReveal,
      this.paintingComplete
    );
    
    console.log(`[Consensus] Created block with ${block.transactions.length} transactions for slot ${slot}`);
    console.log(`[Consensus] Transaction types: ${block.transactions.map(tx => {
      if (tx.from === SimulatorConfig.PROTOCOL_NODE_ID) return 'coinbase';
      if (tx.to === '0xEPM_PAINT_CONTRACT') return 'paint';
      return 'peer-payment';
    }).join(', ')}`);
    
    // Process our own block through the same flow as received blocks
    const success = await this.handleProposedBlock(block, slot, this.nodeAddress);
    
    if (!success) {
      console.error(`[Consensus] Failed to validate own proposed block for slot ${slot}`);
      return; // slot would result in being skipped
    }
    
    // Only broadcast if our own validation succeeded
    console.log(`[Consensus] Own block validated successfully, broadcasting to validators`);
    this.broadcastBlockToValidators(block, slot);
  }
  
  /**
   * Broadcasts a proposed block to all validators
   * Uses validator addresses from BeaconState, not peer list
   */
  private broadcastBlockToValidators(block: Block, slot: number): void {
    if (!this.onSendMessage) return;
    
    const message = {
      type: MessageType.PROPOSER_BLOCK_BROADCAST,
      fromNodeId: this.nodeId,
      block,
      slot
    };
    
    this.onSendMessage(message);
    console.log(`[Consensus] Broadcast block for slot ${slot} to validators`);
  }
  
  /**
   * Handles receiving a proposed block from another validator
   * 1. Validate the block
   * 2. If valid, add to blockchain
   * 3. Create and broadcast attestation
   * 4. Update own beacon pool (triggers LMD-GHOST update)
   * @returns true if block was successfully processed, false otherwise
   */
  async handleProposedBlock(block: Block, slot: number, fromAddress: string): Promise<boolean> {
    console.log(`[Consensus] Received proposed block for slot ${slot} from ${fromAddress.slice(0, 8)}`);
    
    // 1. Get current GHOST-HEAD before adding block
    const oldGhostHead = this.blockchain.getTree().getGhostHead(this.beaconState);
    
    // 2. Add block to blockchain (handles validation, state updates, and tree management)
    const added = await this.blockchain.addBlock(block);
    if (!added) {
      console.warn(`[Consensus] Failed to add block for slot ${slot} - validation failed or parent not found`);
      return false;
    }
    
    // 3. Get new GHOST-HEAD after adding block
    const newGhostHead = this.blockchain.getTree().getGhostHead(this.beaconState);
    
    // 4. Only attest if new GHOST-HEAD points to the block we just added
    if (newGhostHead?.hash === block.hash) {
      console.log(`[Consensus] New GHOST-HEAD is our block ${block.hash!.slice(0, 8)} - creating attestation`);
      
      // Compute FFG checkpoints (source and target) for this attestation
      const canonicalChain = this.blockchain.getCanonicalChain();
      const checkpoints = CasperFFG.computeCheckpoints(slot, canonicalChain, this.beaconState);
      
      const attestation = {
        validatorAddress: this.nodeAddress,
        blockHash: block.hash!,
        timestamp: Date.now(),
        ffgSource: checkpoints.source,
        ffgTarget: checkpoints.target
      };
      
      console.log(`[Consensus] FFG checkpoints - Source: epoch ${checkpoints.source.epoch} (${checkpoints.source.root.slice(0, 8)}), Target: epoch ${checkpoints.target.epoch} (${checkpoints.target.root.slice(0, 8)})`);
      
      // Update own beacon pool (triggers LMD-GHOST update)
      this.beaconState.addAttestation(attestation);
      
      // Broadcast attestation to peers
      this.broadcastAttestation(attestation);
      
      console.log(`[Consensus] Attested to block ${block.hash!.slice(0, 8)} for slot ${slot}`);
      return true;
    } else {
      // Block was added but didn't become GHOST-HEAD (on a fork or behind)
      console.log(`[Consensus] Block ${block.hash!.slice(0, 8)} added but not GHOST-HEAD (old: ${oldGhostHead?.hash.slice(0, 8)}, new: ${newGhostHead?.hash.slice(0, 8)}) - not attesting`);
      return true; // Still successful, just not attesting
    }
  }
  
  /**
   * Broadcasts an attestation to peers
   */
  private broadcastAttestation(attestation: any): void {
    if (!this.onSendMessage) return;
    
    console.log(`[Consensus ${this.nodeAddress.slice(0, 8)}] 📤 Broadcasting attestation for block ${attestation.blockHash.slice(0, 8)}`);
    
    const message = {
      type: MessageType.ATTESTATION,
      fromNodeId: this.nodeId,
      attestation
    };
    
    this.onSendMessage(message);
  }
}


================================================================================
// FILE: core/consensus/beaconState.ts
================================================================================

import { LmdGhost } from './lmdGhost';
import { SimulatorConfig } from '../../config/config';

/**
 * BeaconState - Consensus Layer (CL) state for Ethereum PoS
 * 
 * This represents the beacon chain state that will eventually be used
 * for validator scheduling, RANDAO, and consensus.
 */

export interface Validator {
  nodeAddress: string;
  stakedEth: number; // Amount of ETH staked (typically 32 ETH)
}

export interface Attestation {
  validatorAddress: string;
  blockHash: string;
  timestamp: number;
}

export class BeaconState {
  // RANDAO mixes - one per epoch, continuously updated with XOR
  public randaoMixes: Map<number, string>; // epoch -> random mix
  
  // Proposer schedules - maps epoch to (slot -> validator address)
  // Shows which validator proposes at each slot in each epoch
  public proposerSchedules: Map<number, Map<number, string>>; // epoch -> (slot -> validator address)
  
  // List of validators with their staked ETH
  public validators: Validator[];
  
  // Genesis timestamp in UTC seconds
  public genesisTime: number;
  
  // Beacon pool - accumulates attestations from validators <- part of our state machine
  public beaconPool: Attestation[];
  
  // Pending attestations queue - attestations for blocks we don't have yet
  // Maps blockHash -> array of attestations waiting for that block
  public pendingAttestations: Map<string, Attestation[]>;
  
  // Set of processed attestations (key: "blockHash-validatorAddress")
  // Tracks attestations that have been included in blocks to prevent duplicates
  public processedAttestations: Set<string>;
  
  // LMD-GHOST fork choice state
  // Latest attestations from each validator (for LMD GHOST fork choice)
  public latestAttestations: Map<string, Attestation>;
  
  // Casper FFG finality state
  public justifiedCheckpoint: { epoch: number; root: string | null };
  public previousJustifiedCheckpoint: { epoch: number; root: string | null } | null;
  public finalizedCheckpoint: { epoch: number; root: string | null } | null;
  
  // FFG vote tracking: epoch -> (targetRoot -> Set of validator addresses)
  public ffgVoteCounts: Record<number, Record<string, Set<string>>>;
  
  // Latest attestation included in a block for each validator (for FFG vote counting)
  public latestAttestationByValidator: Record<string, any>;
  
  // Reference to blockchain for triggering tree updates (set after construction)
  private blockchain?: any;
  
  constructor(genesisTime: number, validators: Validator[]) {
    this.genesisTime = genesisTime;
    this.validators = validators;
    this.randaoMixes = new Map();
    this.proposerSchedules = new Map();
    this.beaconPool = [];
    this.pendingAttestations = new Map();
    this.processedAttestations = new Set();
    
    // Initialize LMD-GHOST fork choice state
    this.latestAttestations = new Map();
    
    // Initialize Casper FFG finality state
    // Use genesis hash (0x000...) as the initial justified checkpoint root
    this.justifiedCheckpoint = { epoch: -1, root: SimulatorConfig.GENESIS_PREV_HASH };
    this.previousJustifiedCheckpoint = null;
    this.finalizedCheckpoint = null;
    this.ffgVoteCounts = {};
    this.latestAttestationByValidator = {};
    
    // Initialize RANDAO mixes for genesis and epoch 0
    // Epoch -1: Genesis block (slot -1)
    // Epoch 0: First real epoch (slots 0-3 with SLOTS_PER_EPOCH=4)
    this.randaoMixes.set(-1, SimulatorConfig.GENESIS_RANDAO_MIX);
    this.randaoMixes.set(0, SimulatorConfig.GENESIS_RANDAO_MIX);
  }
  
  /**
   * Set blockchain reference for triggering tree updates
   * Called by Blockchain after construction
   */
  setBlockchain(blockchain: any): void {
    this.blockchain = blockchain;
  }
  
  /**
   * Get current slot based on time since genesis
   * Slot = (current_time - genesis_time) / SECONDS_PER_SLOT
   */
  getCurrentSlot(): number {
    const currentTime = Math.floor(Date.now() / 1000); // Current UTC in seconds
    const timeSinceGenesis = currentTime - this.genesisTime;
    return Math.floor(timeSinceGenesis / SimulatorConfig.SECONDS_PER_SLOT);
  }
  
  /**
   * Get current epoch based on time
   * Epoch = currentSlot / SLOTS_PER_EPOCH
   */
  getCurrentEpoch(): number {
    const currentSlot = this.getCurrentSlot();
    return Math.floor(currentSlot / SimulatorConfig.SLOTS_PER_EPOCH);
  }
  
  /**
   * Update RANDAO mix for an epoch
   * new_mix = current_mix XOR next_reveal
   */
  updateRandaoMix(epoch: number, reveal: string): void {
    const currentMix = this.randaoMixes.get(epoch) || this.generateInitialRandao();
    const newMix = this.xorHexStrings(currentMix, reveal);
    this.randaoMixes.set(epoch, newMix);
  }
  
  /**
   * Get RANDAO mix for a specific epoch
   */
  getRandaoMix(epoch: number): string {
    const mix = this.randaoMixes.get(epoch);
    if (!mix) {
      // This is expected when computing schedules for future epochs
      // The mix will be created when blocks for that epoch are proposed
      return this.generateInitialRandao();
    }
    return mix;
  }
  
  /**
   * Get the current proposer for the current slot
   * Fetches from the proposer schedule based on current time
   */
  getCurrentProposer(): string | null {
    const currentSlot = this.getCurrentSlot();
    return this.getValidatorForSlot(currentSlot) || null;
  }
  
  /**
   * Get validator assigned to a specific slot
   * Looks up the proposer from the proposerSchedules map
   */
  getValidatorForSlot(slot: number): string | undefined {
    // Calculate which epoch this slot belongs to
    const epoch = Math.floor(slot / SimulatorConfig.SLOTS_PER_EPOCH);
    
    // Get the schedule for that epoch
    const epochSchedule = this.proposerSchedules.get(epoch);
    if (!epochSchedule) {
      return undefined;
    }
    
    // Return the validator for this slot
    return epochSchedule.get(slot);
  }
  
  /**
   * Add an attestation to the beacon pool
   * Called when an attestation message is received from the network
   * 
   * Delegates to blockchain.onAttestationReceived which:
   * - Updates latest attestations
   * - Validates blocks if GHOST-HEAD changes
   * - Checks for reorg (GHOST-HEAD change)
   * - Rebuilds state if needed
   */
  async addAttestation(attestation: Attestation): Promise<void> {
    // Check if this exact attestation already exists (same validator + block hash)
    const exists = this.beaconPool.some(
      att => att.validatorAddress === attestation.validatorAddress && 
             att.blockHash === attestation.blockHash
    );
    
    if (!exists) {
      this.beaconPool.push(attestation);
      
      // Delegate to blockchain to handle attestation and check for reorg
      // This is the ONLY way reorgs can happen (not via block/chain addition)
      if (this.blockchain) {
        await this.blockchain.onAttestationReceived(attestation);
      }
    }
  }
  
  /**
   * Get all attestations in the beacon pool
   */
  getBeaconPool(): Attestation[] {
    return this.beaconPool;
  }
  
  /**
   * Get attestations for a specific block hash
   */
  getAttestationsForBlock(blockHash: string): Attestation[] {
    return this.beaconPool.filter(att => att.blockHash === blockHash);
  }
  
  /**
   * Flush (remove) attestations for a specific block hash from the beacon pool
   * This is called after a block is validated and added to the chain
   * Removes attestations based on blockHash + validatorAddress combination
   */
  flushAttestationsForBlock(blockHash: string): void {
    this.beaconPool = this.beaconPool.filter(att => att.blockHash !== blockHash);
  }
  
  /**
   * Create attestation key for tracking processed attestations
   */
  private getAttestationKey(blockHash: string, validatorAddress: string): string {
    return `${blockHash}-${validatorAddress}`;
  }
  
  /**
   * Mark an attestation as processed (included in a block)
   */
  markAttestationAsProcessed(blockHash: string, validatorAddress: string): void {
    const key = this.getAttestationKey(blockHash, validatorAddress);
    this.processedAttestations.add(key);
    console.log(`[BeaconState] Marked as processed: ${key.slice(0, 20)}... (total: ${this.processedAttestations.size})`);
  }
  
  /**
   * Check if an attestation has already been processed
   */
  isAttestationProcessed(blockHash: string, validatorAddress: string): boolean {
    const key = this.getAttestationKey(blockHash, validatorAddress);
    const isProcessed = this.processedAttestations.has(key);
    if (isProcessed) {
      console.log(`[BeaconState] DUPLICATE DETECTED: ${key.slice(0, 20)}... already processed`);
    }
    return isProcessed;
  }
  
  /**
   * Clear processed attestations set (called on chain reorganization)
   */
  clearProcessedAttestations(): void {
    this.processedAttestations.clear();
  }
  
  /**
   * Clear RANDAO mixes and proposer schedules
   * Called during reorg - they will be rebuilt as blocks are reapplied
   * 
   * RANDAO mixes: Rebuilt by applyBlockToElAndClState for each block
   * Proposer schedules: Recomputed lazily by Consensus when needed
   */
  clearRandaoState(): void {
    this.randaoMixes.clear();
    this.proposerSchedules.clear();
    
    // Re-initialize genesis RANDAO mix (epoch -1)
    this.randaoMixes.set(-1, SimulatorConfig.GENESIS_RANDAO_MIX);
  }
  
  /**
   * Rebuild processed attestations set from a chain of blocks
   * Called when world state is rebuilt (e.g., during chain replacement)
   */
  rebuildProcessedAttestations(blocks: any[]): void {
    console.log(`[BeaconState] REBUILDING processedAttestations from ${blocks.length} blocks`);
    
    // Clear existing set
    const oldSize = this.processedAttestations.size;
    this.processedAttestations.clear();
    console.log(`[BeaconState] Cleared ${oldSize} old processed attestations`);
    
    // Add all attestations from all blocks in the chain
    let totalAttestations = 0;
    for (const block of blocks) {
      if (block.attestations && block.attestations.length > 0) {
        console.log(`[BeaconState] Block ${block.hash?.slice(0, 8)} has ${block.attestations.length} attestations`);
        for (const attestation of block.attestations) {
          this.markAttestationAsProcessed(attestation.blockHash, attestation.validatorAddress);
          totalAttestations++;
        }
      }
    }
    console.log(`[BeaconState] REBUILD COMPLETE: ${totalAttestations} attestations marked as processed`);
  }
  
  /**
   * Get validator's staked ETH by address
   * Returns 0 if validator not found
   */
  getValidatorStake(validatorAddress: string): number {
    const validator = this.validators.find(v => v.nodeAddress === validatorAddress);
    return validator ? validator.stakedEth : 0;
  }
  
  /**
   * Update latest attestation for a validator if the new one is more recent
   * Returns true if updated, false if existing attestation was newer
   */
  updateLatestAttestation(attestation: Attestation): boolean {
    const existing = this.latestAttestations.get(attestation.validatorAddress);
    
    // If no existing attestation or new one is more recent, update
    if (!existing || attestation.timestamp > existing.timestamp) {
      // Pass blockchain tree for incremental decoration
      if (this.blockchain) {
        LmdGhost.onLatestAttestChange(this, this.blockchain.getTree(), attestation);
      } else {
        // Fallback: just update map without tree decoration (shouldn't happen in normal flow)
        this.latestAttestations.set(attestation.validatorAddress, attestation);
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * Update tree decoration with current latest attestations
   * Called when new attestations arrive
   * 
   * Simplified: Only uses current latestAttestations map (never scans blocks)
   * - Decorates tree with attestedEth based on current latest attestations
   * - Computes GHOST-HEAD
   */
  updateLatestAttestationsAndTree(): void {
    if (!this.blockchain) return;
    
    // Get all attestations from current latest attestations map
    const allAttestations = Array.from(this.latestAttestations.values());
    
    // Use LMD-GHOST to decorate tree and compute GHOST-HEAD
    const tree = this.blockchain.getTree();
    LmdGhost.onNewAttestations(this, tree, allAttestations);
  }
  
  /**
   * Generate initial RANDAO mix (placeholder for now)
   */
  private generateInitialRandao(): string {
    // Simple initial value - in real Ethereum this would be more complex
    return '0'.repeat(64);
  }
  
  /**
   * XOR two hex strings
   */
  private xorHexStrings(hex1: string, hex2: string): string {
    // Ensure both strings are same length
    const maxLen = Math.max(hex1.length, hex2.length);
    const padded1 = hex1.padStart(maxLen, '0');
    const padded2 = hex2.padStart(maxLen, '0');
    
    let result = '';
    for (let i = 0; i < maxLen; i++) {
      const xor = parseInt(padded1[i], 16) ^ parseInt(padded2[i], 16);
      result += xor.toString(16);
    }
    return result;
  }
  
  /**
   * Serialize beacon state to JSON
   */
  toJSON() {
    return {
      genesisTime: this.genesisTime,
      currentSlot: this.getCurrentSlot(),
      currentEpoch: this.getCurrentEpoch(),
      validators: this.validators,
      randaoMixes: Array.from(this.randaoMixes.entries()),
      proposerSchedules: Array.from(this.proposerSchedules.entries()).map(([epoch, schedule]) => [
        epoch,
        Array.from(schedule.entries())
      ]),
    };
  }
}


================================================================================
// FILE: core/consensus/casperFFG.ts
================================================================================

import { Block } from '../../types/types';
import { SimulatorConfig } from '../../config/config';

/**
 * Casper FFG (Finality Gadget) Implementation
 * 
 * Handles checkpoint computation for Ethereum's finality mechanism.
 * Checkpoints are epoch boundaries where finality votes are cast.
 */
export class CasperFFG {
  
  /**
   * Compute FFG source and target checkpoints for an attestation
   * 
   * Algorithm:
   * 1. Calculate target epoch from current slot (current epoch)
   * 2. Use current justified checkpoint from BeaconState as source
   * 3. Find the checkpoint block for target epoch
   * 
   * @param currentSlot - The current slot when creating attestation
   * @param canonicalChain - Array of blocks from genesis to current head
   * @param beaconState - BeaconState with current justified checkpoint
   * @returns FFG source and target checkpoints with epoch and root (block hash)
   */
  static computeCheckpoints(
    currentSlot: number,
    canonicalChain: Block[],
    beaconState: any
  ): {
    source: { epoch: number; root: string };
    target: { epoch: number; root: string };
  } {
    // Calculate target epoch (current epoch)
    const targetEpoch = Math.floor(currentSlot / SimulatorConfig.SLOTS_PER_EPOCH);
    
    // Use current justified checkpoint from BeaconState as source
    // This is the correct Casper FFG behavior
    const source = {
      epoch: beaconState.justifiedCheckpoint.epoch,
      root: beaconState.justifiedCheckpoint.root || SimulatorConfig.GENESIS_PREV_HASH
    };
    
    // Find checkpoint block for target epoch
    const targetCheckpoint = this.findCheckpointBlock(targetEpoch, canonicalChain);
    
    console.log(`[CasperFFG] Computing checkpoints - Source: epoch ${source.epoch} (justified), Target: epoch ${targetEpoch}`);
    
    return {
      source,
      target: {
        epoch: targetEpoch,
        root: targetCheckpoint
      }
    };
  }
  
  /**
   * Find the checkpoint block for a given epoch
   * 
   * The checkpoint is the first slot of the epoch, but if that slot is empty,
   * we return the highest block at or before that slot.
   * 
   * Algorithm:
   * 1. Calculate checkpoint slot = epoch * SLOTS_PER_EPOCH
   * 2. Search canonical chain backwards from head
   * 3. Return first block with slot <= checkpoint slot
   * 4. If no block found (epoch 0 before genesis), return genesis hash
   * 
   * @param epoch - The epoch to find checkpoint for
   * @param canonicalChain - Array of blocks from genesis to current head
   * @returns Block hash of the checkpoint block
   */
  private static findCheckpointBlock(
    epoch: number,
    canonicalChain: Block[]
  ): string {
    // Calculate the checkpoint slot (first slot of epoch)
    const checkpointSlot = epoch * SimulatorConfig.SLOTS_PER_EPOCH;
    
    // Handle edge case: epoch 0 or empty chain
    if (canonicalChain.length === 0) {
      return SimulatorConfig.GENESIS_PREV_HASH; // Return zero hash if no blocks
    }
    
    // Search backwards through canonical chain to find block at or before checkpoint slot
    for (let i = canonicalChain.length - 1; i >= 0; i--) {
      const block = canonicalChain[i];
      if (block.header.slot <= checkpointSlot) {
        // Found the checkpoint block (or closest block before checkpoint)
        return block.hash || '';
      }
    }
    
    // If no block found (shouldn't happen if genesis exists), return genesis
    return canonicalChain[0]?.hash || SimulatorConfig.GENESIS_PREV_HASH;
  }
  
  /**
   * Get the checkpoint slot for a given epoch
   * Checkpoint slot is the first slot of the epoch
   * 
   * @param epoch - The epoch number
   * @returns The slot number of the checkpoint
   */
  static getCheckpointSlot(epoch: number): number {
    return epoch * SimulatorConfig.SLOTS_PER_EPOCH;
  }
  
  /**
   * Get the epoch for a given slot
   * 
   * @param slot - The slot number
   * @returns The epoch number
   */
  static getEpoch(slot: number): number {
    return Math.floor(slot / SimulatorConfig.SLOTS_PER_EPOCH);
  }
  
  /**
   * Apply attestations from a block to BeaconState for Casper FFG finality tracking
   * 
   * Algorithm:
   * 1. For each attestation, remove validator's old vote from vote buckets
   * 2. Record attestation as validator's latest included attestation
   * 3. If attestation's source matches current justified checkpoint, count the vote
   * 4. Add validator to target epoch/root vote bucket
   * 5. Check if target has reached 2/3 threshold to justify
   * 6. If justified and previous justified are consecutive epochs, finalize previous
   * 7. Garbage collect old vote buckets
   * 
   * @param beaconState - BeaconState to update
   * @param attestationsInBlock - Attestations included in the block
   */
  static applyAttestationsToBeaconState(
    beaconState: any,
    attestationsInBlock: any[]
  ): void {
    // Compute 2/3 threshold based on validator count
    const threshold = Math.ceil((2 * beaconState.validators.length) / 3);
    
    // Current justified checkpoint (attestations must have source == this to be counted)
    const currentJustified = beaconState.justifiedCheckpoint;
    
    // Process each attestation in the block
    for (const att of attestationsInBlock) {
      const validator = att.validatorAddress;
      
      // 1) Remove old vote from vote buckets if validator had a previous attestation
      const old = beaconState.latestAttestationByValidator[validator];
      if (old && old.ffgTarget) {
        this.removeVoteFromBucket(beaconState, old.ffgTarget.epoch, old.ffgTarget.root, validator);
      }
      
      // 2) Record this attestation as the validator's latest included attestation
      beaconState.latestAttestationByValidator[validator] = att;
      
      // 3) Check if attestation is countable for FFG (source must match current justified)
      if (!att.ffgSource || !att.ffgTarget) {
        console.log(`[CasperFFG] Skipping attestation from ${validator.slice(0, 8)} - missing FFG fields`);
        continue;
      }
      
      // Check if source matches current justified checkpoint
      const sourceMatches = currentJustified && 
                           att.ffgSource.epoch === currentJustified.epoch && 
                           att.ffgSource.root === currentJustified.root;
      
      if (!sourceMatches) {
        console.log(`[CasperFFG] Skipping attestation from ${validator.slice(0, 8)} - source mismatch. Att source: epoch ${att.ffgSource.epoch} (${att.ffgSource.root?.slice(-8) || 'null'}), Justified: epoch ${currentJustified?.epoch} (${currentJustified?.root?.slice(-8) || 'null'})`);
        continue; // Not countable - ignore for votes
      }
      
      console.log(`[CasperFFG] Counting vote from ${validator.slice(0, 8)} for target epoch ${att.ffgTarget.epoch} (${att.ffgTarget.root.slice(-8)})`);

      
      // 4) Add validator to the target bucket for this attestation's target epoch/root
      const targetEpoch = att.ffgTarget.epoch;
      const targetRoot = att.ffgTarget.root;
      const epochBucket = this.getOrCreateEpochBucket(beaconState, targetEpoch);
      const targetSet = this.getOrCreateTargetSet(epochBucket, targetRoot);
      targetSet.add(validator);
      
      // 5) Attempt to update justified/finalized based on the changed bucket
      this.tryUpdateJustifiedAndFinalized(beaconState, targetEpoch, targetRoot, threshold);
    }
    
    // 6) Garbage collect old vote buckets
    this.garbageCollectUpToFinalized(beaconState);
  }
  
  /**
   * Get or create epoch bucket in ffgVoteCounts
   */
  private static getOrCreateEpochBucket(state: any, epoch: number): Record<string, Set<string>> {
    if (!state.ffgVoteCounts[epoch]) {
      state.ffgVoteCounts[epoch] = {};
    }
    return state.ffgVoteCounts[epoch];
  }
  
  /**
   * Get or create Set for a target root inside an epoch bucket
   */
  private static getOrCreateTargetSet(epochBucket: Record<string, Set<string>>, root: string): Set<string> {
    if (!epochBucket[root]) {
      epochBucket[root] = new Set<string>();
    }
    return epochBucket[root];
  }
  
  /**
   * Remove a validator's vote from a given epoch/root bucket
   */
  private static removeVoteFromBucket(
    state: any,
    epoch: number,
    root: string,
    validator: string
  ): void {
    const epochBucket = state.ffgVoteCounts[epoch];
    if (!epochBucket) return;
    
    const voters = epochBucket[root];
    if (!voters) return;
    
    voters.delete(validator);
    
    // Clean up empty data structures
    if (voters.size === 0) {
      delete epochBucket[root];
    }
    if (Object.keys(epochBucket).length === 0) {
      delete state.ffgVoteCounts[epoch];
    }
  }
  
  /**
   * Try to promote a (epoch, root) to justified and possibly finalize previous
   */
  private static tryUpdateJustifiedAndFinalized(
    state: any,
    candidateEpoch: number,
    candidateRoot: string,
    threshold: number
  ): void {
    const epochBucket = state.ffgVoteCounts[candidateEpoch];
    if (!epochBucket) return;
    
    const voters = epochBucket[candidateRoot];
    if (!voters) return;
    
    // Not enough votes to justify
    if (voters.size < threshold) return;
    
    const currentJustifiedEpoch = state.justifiedCheckpoint?.epoch ?? -1;
    
    // Only move justified forward (monotonicity)
    if (candidateEpoch <= currentJustifiedEpoch) return;
    
    console.log(`[CasperFFG] Justifying epoch ${candidateEpoch} with ${voters.size}/${threshold} votes`);
    
    // Promote: previousJustified <- justified, justified <- candidate
    state.previousJustifiedCheckpoint = { ...state.justifiedCheckpoint };
    state.justifiedCheckpoint = { epoch: candidateEpoch, root: candidateRoot };
    
    // If previous and current justified are consecutive epochs, finalize the previous
    if (state.previousJustifiedCheckpoint &&
        state.previousJustifiedCheckpoint.epoch + 1 === state.justifiedCheckpoint.epoch) {
      state.finalizedCheckpoint = { ...state.previousJustifiedCheckpoint };
      console.log(`[CasperFFG] Finalized epoch ${state.finalizedCheckpoint.epoch}`);
    }
  }
  
  /**
   * Garbage collect vote buckets for epochs <= finalizedEpoch
   */
  private static garbageCollectUpToFinalized(state: any): void {
    const finalizedEpoch = state.finalizedCheckpoint?.epoch;
    if (finalizedEpoch === undefined || finalizedEpoch === null) return;
    
    for (const epochKey of Object.keys(state.ffgVoteCounts)) {
      const epochNum = Number(epochKey);
      if (!Number.isNaN(epochNum) && epochNum <= finalizedEpoch) {
        delete state.ffgVoteCounts[epochNum];
      }
    }
  }
}


================================================================================
// FILE: core/consensus/lmdGhost.ts
================================================================================

import { Block } from '../../types/types';
import { BlockchainTree, BlockTreeNode } from '../blockchain/blockchainTree';
import { BeaconState } from './beaconState';

/**
 * LMD-GHOST (Latest Message Driven Greedy Heaviest Observed SubTree)
 * 
 * Static utility class for fork choice logic in Ethereum-style blockchain:
 * - Manages latest attestations from validators (stored in BeaconState)
 * - Decorates blockchain tree with attestedEth (cumulative attested weight)
 * - Computes GHOST-HEAD for fork choice
 * 
 * All state is stored in BeaconState, methods are pure/static
 */
export class LmdGhost {
  /**
   * Record a new attestation from a validator and incrementally update tree decorations
   * This is the core method that maintains attestedEth values in the tree
   * 
   * @param beaconState - Beacon state containing latest attestations
   * @param tree - Blockchain tree to update
   * @param attestation - New attestation to record
   */
  public static onLatestAttestChange(beaconState: any, tree: BlockchainTree, oldAtt: Attestation | undefined, newAtt: Attestation): void {
    // a) Decrement attestedEth for old attestation (if it points to a node in tree)
    if (oldAtt) {
      const oldNode = tree.getNode(oldAtt.blockHash);
      if (oldNode) {
        LmdGhost.decrementAttestedEthOfParents(oldNode);
      }
    }
    
    // b) Increment attestedEth for new attestation (if it points to a node in tree)
    const newNode = tree.getNode(newAtt.blockHash);
    if (newNode) {
      LmdGhost.incrementAttestedEthOfParents(newNode);
    }
  }
  
  /**
   * Increment attestedEth from a node up to root
   * Called when a new attestation points to this node
   * todo: attestedEthToAdd should come from validator set
   */
  private static incrementAttestedEthOfParents(node: BlockTreeNode,attestedEthToAdd: number = 32): void {
    let current: BlockTreeNode | null = node;
    
    while (current && !current.metadata.isInvalid) { // dont keep updating once we hit invalid node
      if (!current.metadata) {
        current.metadata = {};
      }
      current.metadata.attestedEth = (current.metadata.attestedEth || 0) + attestedEthToAdd;
      current = current.parent;
    }
  }
  
  /**
   * Decrement attestedEth from a node up to root
   * Called when an old attestation is replaced
   * todo: attestedEthToRemove should come from validator set
   */
  private static decrementAttestedEthOfParents(node: BlockTreeNode, attestedEthToRemove: number = 32): void {
    let current: BlockTreeNode | null = node;
    
    while (current && !current.metadata.isInvalid) { // dont keep updating once we hit invalid node
      if (current.metadata) {
        current.metadata.attestedEth = Math.max(0, (current.metadata.attestedEth || 0) - attestedEthToRemove);
      }
      current = current.parent;
    }
  }
    
  /**
   * Handle attestation set changes
   * Called when new attestations arrive
   * Updates latest attestations and incrementally updates tree decorations
   */
  public static onNewAttestations(
    beaconState: any,
    tree: BlockchainTree,
    allAttestations: Attestation[]
  ): void {

    for (const newAtt of allAttestations) {
      const existingAtt = beaconState.latestAttestations.get(newAtt.validatorAddress) as Attestation;
      if (!existingAtt || newAtt.timestamp > existingAtt.timestamp) {
        // if we have a newer one, update then update tree decorations or create it if it doesn't exist
        beaconState.latestAttestations.set(newAtt.validatorAddress, newAtt); // update
        LmdGhost.onLatestAttestChange(beaconState, tree, existingAtt, newAtt);
      }
    }
  }

  public static onNewBlock(block: Block, tree: BlockchainTree, beaconState: BeaconState): void {
    const blockNode = tree.getNode(block.hash || '');
    if (!blockNode) return;
    
    for (const att of beaconState.latestAttestations.values()) {
      if (att.blockHash === block.hash) {
        LmdGhost.incrementAttestedEthOfParents(blockNode);
      }
    }
  }

  public static markNodeInvalid(node: BlockTreeNode): void {
    node.metadata.isInvalid = true;
    
    // Decrement parent's attestedEth by this node's attestedEth
    if (node.parent && node.metadata.attestedEth) {
      LmdGhost.decrementAttestedEthOfParents(node.parent, node.metadata.attestedEth);
    }
    
    node.metadata.attestedEth = 0;
    console.log(`[BlockchainTree] Marked node ${node.hash.slice(0, 8)} invalid`);
  }
  
  /**
   * Compute GHOST-HEAD (fork choice)
   * Returns the hash of the block that should be considered the chain head
   * 
   * Algorithm:
   * 1. Start at finalized checkpoint (or genesis if no finalized checkpoint)
   * 2. At each fork, choose the valid child with highest attestedEth
   * 3. If tie, choose block with smallest hash (deterministic tiebreaker)
   * 4. Continue until a leaf
   * 
   * This ensures we never reorg past the finalized checkpoint (Casper FFG safety)
   */
  public static computeGhostHead(tree: BlockchainTree, beaconState?: any): string | null {
    const root = tree.getRoot();
    if (!root) return null;
    
    // Start from finalized checkpoint if available, otherwise start from genesis
    let current = root;
    if (beaconState?.finalizedCheckpoint?.root) {
      const finalizedNode = tree.getNode(beaconState.finalizedCheckpoint.root);
      if (finalizedNode) {
        current = finalizedNode;
        console.log(`[LMD-GHOST] Starting from finalized checkpoint: epoch ${beaconState.finalizedCheckpoint.epoch}, block ${finalizedNode.hash.slice(0, 8)}`);
      } else {
        console.log(`[LMD-GHOST] Finalized checkpoint block not found in tree, starting from genesis`);
      }
    }
    
    const isValid = (n: any) => !n.metadata?.isInvalid;
    const getAttestedEth = (n: any) => Number(n.metadata?.attestedEth ?? 0);
  
    while (current.children.length > 0) {
      // consider only valid children
      const validChildren = current.children.filter(isValid);
      if (validChildren.length === 0) break; // no valid children -> current is head
  
      // find the maximum attestedEth among valid children
      let maxEth = -Infinity;
      for (const child of validChildren) {
        const v = getAttestedEth(child);
        if (v > maxEth) maxEth = v;
      }
  
      // collect children that have that maximum value
      const heaviest = validChildren.filter(c => getAttestedEth(c) === maxEth);
  
      // if there's a tie (2 or more heaviest children), choose the one with smallest hash
      heaviest.sort((a, b) => a.hash.localeCompare(b.hash));
      current = heaviest[0];
    }
  
    return current.hash;
  }
}
/**
 * Attestation type for LMD-GHOST with Casper FFG fields
 */
export interface Attestation {
  validatorAddress: string;
  blockHash: string;
  timestamp: number;
  
  // Casper FFG fields for finality
  ffgSource: {
    epoch: number;
    root: string;  // Block hash at source checkpoint
  };
  ffgTarget: {
    epoch: number;
    root: string;  // Block hash at target checkpoint
  };
}


================================================================================
// FILE: core/consensus/randao.ts
================================================================================

/**
 * RANDAO - Random beacon for validator scheduling in Ethereum PoS
 * 
 * Implements the RANDAO mechanism for generating unpredictable randomness
 * and computing proposer schedules for upcoming epochs.
 */

import { BeaconState } from './beaconState';
import { SimulatorConfig } from '../../config/config';
import { 
  hexToBytes, 
  generateBLSSignature,
  i2b8,
  concat,
  u64,
  xorHexStrings,
  hashBytes
} from '../../utils/cryptoUtils';
import { Node } from '../node';

export class RANDAO {

  /**
   * Computes the proposer schedule for a given epoch (32 slots)
   * Uses RANDAO mix which is a unpredicable but deterministic seed
   * for a psuedorandom selection of validators. The selection is
   * weighted by validator effective balance (stake). 
   * ~this algo has yet to be cross referenced with the official spec but it captures
   * the core idea of using RANDAO mix as a seed for a psuedorandom selection of validators~
   * 
   * @param state - Current beacon state with validators and RANDAO mix
   * @param targetEpoch - The epoch to compute the schedule for
   * @returns Array of 32 validator addresses (one per slot in target epoch)
   */
  static getProposerSchedule(state: BeaconState, targetEpoch: number): string[] {
    // Use previous epoch's RANDAO mix as the randomness seed for target epoch's schedule
    // This ensures unpredictability (can't predict future RANDAO reveals)
    // but determinism (all nodes compute same schedule from same state)
    const seedEpoch = targetEpoch - 1;
    const epochMix = state.getRandaoMix(seedEpoch);
    const epochSeedBytes = hexToBytes(epochMix);

    // Build list of active validators with their effective balance capped at MAX_EFFECTIVE_BALANCE
    // This prevents any single validator from dominating the selection
    const activeValidators = state.validators.map((validator, validatorIndex) => ({ 
      validatorIndex, 
      effectiveBalance: Math.min(validator.stakedEth, SimulatorConfig.MAX_EFFECTIVE_BALANCE) 
    }));

    const proposerSchedule: string[] = [];

    // Compute proposer for each of the x slots in the target epoch
    for (let slotIndexInEpoch = 0; slotIndexInEpoch < SimulatorConfig.SLOTS_PER_EPOCH; slotIndexInEpoch++) {
      const absoluteSlotNumber = targetEpoch * SimulatorConfig.SLOTS_PER_EPOCH + slotIndexInEpoch;

      // Create unique seed for this specific slot by hashing: H(epochSeed || slotNumber)
      // This ensures each slot has independent randomness
      const slotSeedBytes = hashBytes(concat(epochSeedBytes, i2b8(absoluteSlotNumber)));

      // Weighted random selection using "sample-until-accepted" algorithm
      // This is the Ethereum spec's method for stake-weighted validator selection
      let samplingAttempt = 0;
      
      while (true) {
        // Generate fresh randomness for each sampling attempt: H(slotSeed || attempt)
        const randomnessBytes = hashBytes(concat(slotSeedBytes, i2b8(samplingAttempt++)));

        // Select a candidate validator uniformly at random from active set
        // Use first 8 bytes of hash as random number, mod by validator count
        const candidateIndex = u64(randomnessBytes, 0) % activeValidators.length;
        const candidate = activeValidators[candidateIndex];

        // Weighted acceptance test: Accept with probability = effectiveBalance / MAX_EFFECTIVE_BALANCE
        // This gives validators with more stake a higher chance of being selected
        // 
        // How it works:
        // - randomByte is uniform random in [0, 255]
        // - We accept if: randomByte < (effectiveBalance / MAX_EFFECTIVE_BALANCE) * 256
        // - Rearranged: randomByte * MAX_EFFECTIVE_BALANCE < effectiveBalance * 256
        // - We use 255 instead of 256 to avoid overflow (close enough approximation)
        //
        // Example: If validator has 16 ETH (qtr of 64 ETH max):
        //   - Accept if randomByte < 64 (25% chance)
        // Example: If validator has 64 ETH (max):
        //   - Accept if randomByte < 255 (≈100% chance)
        const randomByte = randomnessBytes[8]; // Use 9th byte as random value [0-255]
        const acceptanceThreshold = (candidate.effectiveBalance * 255) / SimulatorConfig.MAX_EFFECTIVE_BALANCE;
        
        if (randomByte <= acceptanceThreshold) {
          // Candidate accepted! Add their address to the schedule
          proposerSchedule.push(state.validators[candidate.validatorIndex].nodeAddress);
          break; // Move to next slot
        }
        // Candidate rejected, try again with new randomness (samplingAttempt++)
      }
    }

    return proposerSchedule;
  }

  /**
   * Calculate RANDAO reveal for a given epoch
   * This is the BLS signature of the epoch number using the node's private key
   * 
   * @param epoch - The epoch to create reveal for
   * @param node - The node creating the reveal (to get private key)
   * @returns RANDAO reveal as hex string
   */
  static calculateRandaoReveal(epoch: number, node: Node): string {
    // Get the node's private key
    const privateKey = node.getPrivateKey();
    
    // Create message to sign: "RANDAO_REVEAL_" + epoch
    const message = `RANDAO_REVEAL_${epoch}`;
    
    // Sign the message using BLS signature
    // In real Ethereum, this would use the validator's BLS key
    const signature = generateBLSSignature(message, privateKey);
    
    return signature;
  }

  /**
   * Update RANDAO mix for an epoch with a new reveal
   * new_mix = current_mix XOR reveal
   * 
   * @param state - Beacon state to update
   * @param epoch - Epoch to update mix for
   * @param reveal - RANDAO reveal to mix in
   */
  static updateRandaoMix(state: BeaconState, epoch: number, reveal: string): void {
    const currentMix = state.getRandaoMix(epoch);
    const newMix = xorHexStrings(currentMix, reveal);
    state.updateRandaoMix(epoch, newMix);
  }
}


================================================================================
// FILE: core/consensus/sync.ts
================================================================================

import { Block } from '../../types/types';
import { Blockchain } from '../blockchain/blockchain';
import { MessageType } from '../../network/messages';
import { SimulatorConfig } from '../../config/config';

/**
 * Sync class handles LMD-GHOST head synchronization for PoS
 * Each node has its own Sync instance
 * 
 * Three-Message Sync Algorithm:
 * 1. LMD_GHOST_BROADCAST: Periodically broadcast GHOST-HEAD to all nodes
 * 2. CHAIN_REQUEST: If received head doesn't exist, request chain (direct message)
 * 3. CHAIN_RESPONSE: Respond with chain from requested head to genesis (direct message)
 */
export class Sync {
  private blockchain: Blockchain;
  private nodeId: string;
  
  // Callback for sending messages to network
  private onSendMessage?: (message: any) => void;
  
  constructor(blockchain: Blockchain, nodeId: string) {
    this.blockchain = blockchain;
    this.nodeId = nodeId;
  }
  
  /**
   * Sets the callback for sending messages to the network
   */
  setMessageCallback(callback: (message: any) => void): void {
    this.onSendMessage = callback;
  }
  
  /**
   * Gets the current LMD-GHOST head hash
   * Returns genesis hash if no GHOST-HEAD
   */
  private getGhostHeadHash(): string {
    const tree = this.blockchain.getTree();
    const ghostHeadNode = tree.getGhostHead();
    
    // If no GHOST-HEAD, return genesis
    if (!ghostHeadNode) {
      const genesisBlock = this.blockchain.getBlockByHeight(0);
      return genesisBlock?.hash || '';
    }
    
    return ghostHeadNode.hash;
  }
  
  /**
   * Broadcasts the current LMD-GHOST head to all peers
   * Called periodically (every second)
   * Message Type: LMD_GHOST_BROADCAST (broadcast to all)
   */
  broadcastGhostHead(): void {
    if (!this.onSendMessage) return;
    
    const ghostHeadHash = this.getGhostHeadHash();
    
    const message = {
      type: MessageType.LMD_GHOST_BROADCAST,
      fromNodeId: this.nodeId,
      ghostHeadHash
    };
    
    this.onSendMessage(message);
  }
  
  /**
   * Handles receiving an LMD-GHOST broadcast from another node
   * Checks if the head exists in local tree
   * If not, sends a CHAIN_REQUEST to that node
   * 
   * Message Type: LMD_GHOST_BROADCAST (received)
   * May send: CHAIN_REQUEST (direct to sender)
   */
  handleGhostBroadcast(fromNodeId: string, ghostHeadHash: string): void {
    // Check if this head exists in our tree
    const tree = this.blockchain.getTree();
    const headNode = tree.getNode(ghostHeadHash);
    
    // If we don't have this head, request the chain
    if (!headNode) {
      this.requestChain(fromNodeId, ghostHeadHash);
    }
    // If we have it, no action needed - we're in sync
  }
  
  /**
   * Sends a chain request to a specific node
   * Requests the chain for a specific head hash
   * 
   * Message Type: CHAIN_REQUEST (direct message)
   */
  private requestChain(toNodeId: string, requestedHeadHash: string): void {
    if (!this.onSendMessage) return;
    
    const message = {
      type: MessageType.CHAIN_REQUEST,
      fromNodeId: this.nodeId,
      toNodeId,
      requestedHeadHash
    };
    
    this.onSendMessage(message);
  }
  
  /**
   * Handles receiving a chain request from another node
   * Returns the chain from the requested head to genesis
   * IMPORTANT: Returns the chain for THAT specific head, not our current GHOST-HEAD
   * (Our GHOST-HEAD may have changed since the request was made)
   * 
   * Message Type: CHAIN_REQUEST (received)
   * Sends: CHAIN_RESPONSE (direct to requester)
   */
  handleChainRequest(fromNodeId: string, requestedHeadHash: string): void {
    if (!this.onSendMessage) return;
    
    // Get the chain from the requested head to genesis
    const tree = this.blockchain.getTree();
    const chain = tree.getChain(requestedHeadHash);
    
    // If we don't have this head, we can't respond
    if (chain.length === 0) {
      console.warn(`[Sync] Cannot respond to chain request for unknown head: ${requestedHeadHash.slice(0, 8)}`);
      return;
    }
    
    const message = {
      type: MessageType.CHAIN_RESPONSE,
      fromNodeId: this.nodeId,
      toNodeId: fromNodeId,
      requestedHeadHash,
      blocks: chain
    };
    
    this.onSendMessage(message);
  }
  
  /**
   * Handles receiving a chain response from another node
   * Processes the received chain and updates local blockchain
   * 
   * Message Type: CHAIN_RESPONSE (received)
   */
  async handleChainResponse(requestedHeadHash: string, blocks: Block[]): Promise<void> {
    if (blocks.length === 0) {
      if (SimulatorConfig.DEBUG_SYNC) {
        console.warn(`[Sync] Received empty chain response for head: ${requestedHeadHash.slice(0, 8)}`);
      }
      return;
    }
    
    if (SimulatorConfig.DEBUG_SYNC) {
      console.log(`[Sync] Received chain with ${blocks.length} blocks for head: ${requestedHeadHash.slice(0, 8)}`);
    }
    
    // Try to add the received chain to our blocktree
    await this.blockchain.addChain(blocks);
  }
}


================================================================================
// FILE: core/epm/EPM.ts
================================================================================

/**
 * EPM (Ethereum Painting Machine)
 * 
 * A specialized smart contract that manages a collaborative painting game.
 * Four colors (blue, green, red, yellow) compete to paint pixels on a shared image.
 * 
 * GAME RULES:
 * - Contract is deployed with an image (stored as pixel grid)
 * - Players send transactions with ETH + color choice
 * - ETH amount determines % of TOTAL pixels painted (value * 2%)
 * - Pixels are selected deterministically using block hash as entropy
 * - First color to paint the most pixels wins!
 * 
 * STORAGE FORMAT:
 * - pixels: 2D array where each cell is a color ID
 *   0 = unpainted, 1 = blue, 2 = green, 3 = red, 4 = yellow
 * - colorCounts: Track how many pixels each color has painted
 * - totalPixels: Total number of pixels in the image
 * - balance: Total ETH held by the contract
 */

import { Account, EthereumTransaction } from '../../types/types';

// Color mapping
export enum PaintColor {
  UNPAINTED = 0,
  BLUE = 1,
  GREEN = 2,
  RED = 3,
  YELLOW = 4
}

export const COLOR_NAMES: Record<string, PaintColor> = {
  'blue': PaintColor.BLUE,
  'green': PaintColor.GREEN,
  'red': PaintColor.RED,
  'yellow': PaintColor.YELLOW
};

/**
 * Storage structure for the painting contract
 * This is what gets stored in Account.storage
 */
export interface EPMStorage {
  // Pixel grid: each cell is a PaintColor enum value
  pixels: number[][];
  
  // Track how many pixels each color has painted
  colorCounts: {
    [PaintColor.BLUE]: number;
    [PaintColor.GREEN]: number;
    [PaintColor.RED]: number;
    [PaintColor.YELLOW]: number;
  };
  
  // Track which addresses painted each color and how many pixels
  // Format: { "blue": { "0xAddress1": 50, "0xAddress2": 30 }, ... }
  colorPainters: {
    [color: string]: { [address: string]: number };
  };
  
  // Total pixels in the image
  totalPixels: number;
  
  // Image dimensions
  width: number;
  height: number;
  
  // Contract balance (total ETH sent to contract)
  balance: number;
  
  // Winner information (set when painting is complete)
  winnerColor?: string;           // Winning color name
  winnerAddress?: string;          // Address that received the reward
  rewardAmount?: number;           // Amount of ETH rewarded to winner
  completedAtBlock?: string;       // Block hash when painting completed
}

/**
 * Paint transaction data
 */
export interface PaintTransactionData {
  color: string;  // "blue", "green", "red", or "yellow"
}

/**
 * Result of a paint operation
 */
export interface PaintResult {
  success: boolean;
  pixelsPainted: number;
  colorId: PaintColor;
  newBalance: number;
  error?: string;
}

/**
 * EPM - Ethereum Painting Machine
 * 
 * This class handles all the logic for the painting contract.
 * It's deterministic - same inputs always produce same outputs.
 */
export class EPM {
  /**
   * Initialize a new painting contract with an image
   * 
   * @param imageData - 2D array representing the image (1 = pixel exists, 0 = transparent)
   * @returns Initial storage state
   */
  static initialize(imageData: number[][]): EPMStorage {
    const height = imageData.length;
    const width = imageData[0]?.length || 0;
    
    // Initialize all pixels as unpainted
    const pixels: number[][] = imageData.map(row => 
      row.map(cell => cell === 1 ? PaintColor.UNPAINTED : -1) // -1 = not part of image
    );
    
    // Count total paintable pixels
    const totalPixels = pixels.flat().filter(p => p === PaintColor.UNPAINTED).length;
    
    return {
      pixels,
      colorCounts: {
        [PaintColor.BLUE]: 0,
        [PaintColor.GREEN]: 0,
        [PaintColor.RED]: 0,
        [PaintColor.YELLOW]: 0
      },
      colorPainters: {
        'blue': {},
        'green': {},
        'red': {},
        'yellow': {}
      },
      totalPixels,
      width,
      height,
      balance: 0
    };
  }
  
  /**
   * Execute a paint transaction
   * 
   * @param storage - Current contract storage
   * @param value - ETH amount sent (determines % of pixels to paint)
   * @param data - Transaction data containing color choice
   * @param blockHash - Block hash for deterministic randomness
   * @param painterAddress - Address of the painter (for tracking)
   * @returns Paint result and updated storage
   */
  static paint(
    storage: EPMStorage,
    value: number,
    data: string,
    blockHash: string,
    painterAddress: string
  ): { result: PaintResult; newStorage: EPMStorage } {
    // Parse transaction data
    let paintData: PaintTransactionData;
    try {
      paintData = JSON.parse(data);
    } catch (e) {
      return {
        result: {
          success: false,
          pixelsPainted: 0,
          colorId: PaintColor.UNPAINTED,
          newBalance: storage.balance,
          error: 'Invalid transaction data format'
        },
        newStorage: storage
      };
    }
    
    // Validate color
    const colorId = COLOR_NAMES[paintData.color.toLowerCase()];
    if (!colorId) {
      return {
        result: {
          success: false,
          pixelsPainted: 0,
          colorId: PaintColor.UNPAINTED,
          newBalance: storage.balance,
          error: `Invalid color: ${paintData.color}. Must be blue, green, red, or yellow`
        },
        newStorage: storage
      };
    }
    
    // Validate value
    if (value <= 0) {
      return {
        result: {
          success: false,
          pixelsPainted: 0,
          colorId,
          newBalance: storage.balance,
          error: 'Value must be positive'
        },
        newStorage: storage
      };
    }
    
    // Calculate how many pixels to paint (value * 2% of TOTAL pixels)
    const percentageToPaint = value * 2; // 10 ETH = 20%
    const pixelsToPaint = Math.floor((percentageToPaint / 100) * storage.totalPixels);
    
    if (pixelsToPaint === 0) {
      return {
        result: {
          success: false,
          pixelsPainted: 0,
          colorId,
          newBalance: storage.balance,
          error: 'Value too small to paint any pixels'
        },
        newStorage: storage
      };
    }
    
    // Find all unpainted pixels
    const unpaintedPixels: [number, number][] = [];
    for (let y = 0; y < storage.height; y++) {
      for (let x = 0; x < storage.width; x++) {
        if (storage.pixels[y][x] === PaintColor.UNPAINTED) {
          unpaintedPixels.push([y, x]);
        }
      }
    }
    
    if (unpaintedPixels.length === 0) {
      return {
        result: {
          success: false,
          pixelsPainted: 0,
          colorId,
          newBalance: storage.balance + value,
          error: 'No unpainted pixels remaining'
        },
        newStorage: {
          ...storage,
          balance: storage.balance + value
        }
      };
    }
    
    // Determine how many pixels we can actually paint
    const actualPixelsToPaint = Math.min(pixelsToPaint, unpaintedPixels.length);
    
    // Deep copy storage for mutation
    const newStorage: EPMStorage = {
      ...storage,
      pixels: storage.pixels.map(row => [...row]),
      colorCounts: { ...storage.colorCounts },
      colorPainters: {
        'blue': { ...storage.colorPainters['blue'] },
        'green': { ...storage.colorPainters['green'] },
        'red': { ...storage.colorPainters['red'] },
        'yellow': { ...storage.colorPainters['yellow'] }
      },
      balance: storage.balance + value
    };
    
    // Select pixels deterministically using block hash as seed
    const selectedPixels = this.selectPixelsDeterministically(
      unpaintedPixels,
      actualPixelsToPaint,
      blockHash
    );
    
    // Paint the selected pixels
    for (const [y, x] of selectedPixels) {
      newStorage.pixels[y][x] = colorId;
    }
    
    // Update color count
    newStorage.colorCounts[colorId] += actualPixelsToPaint;
    
    // Track which address painted these pixels
    const colorName = paintData.color; // 'blue', 'green', 'red', or 'yellow'
    if (!newStorage.colorPainters[colorName][painterAddress]) {
      newStorage.colorPainters[colorName][painterAddress] = 0;
    }
    newStorage.colorPainters[colorName][painterAddress] += actualPixelsToPaint;
    
    return {
      result: {
        success: true,
        pixelsPainted: actualPixelsToPaint,
        colorId,
        newBalance: newStorage.balance
      },
      newStorage
    };
  }
  
  /**
   * Deterministically select N pixels from available pixels using block hash as entropy
   * 
   * This uses the block hash to seed a deterministic shuffle algorithm.
   * All nodes will select the same pixels given the same inputs.
   * 
   * @param availablePixels - Array of [y, x] coordinates
   * @param count - How many pixels to select
   * @param blockHash - Block hash for entropy
   * @returns Array of selected pixel coordinates
   */
  private static selectPixelsDeterministically(
    availablePixels: [number, number][],
    count: number,
    blockHash: string
  ): [number, number][] {
    // Create a copy to avoid mutating input
    const pixels = [...availablePixels];
    const selected: [number, number][] = [];
    
    // Use block hash as seed for deterministic randomness
    let seed = parseInt(blockHash.slice(0, 16), 16);
    
    // Fisher-Yates shuffle with deterministic random
    for (let i = 0; i < count && pixels.length > 0; i++) {
      // Generate deterministic "random" index
      seed = (seed * 1103515245 + 12345) & 0x7fffffff; // Linear congruential generator
      const index = seed % pixels.length;
      
      // Select this pixel
      selected.push(pixels[index]);
      
      // Remove from available pixels
      pixels.splice(index, 1);
    }
    
    return selected;
  }
  
  /**
   * Execute a paint transaction on an EPM contract account
   * 
   * This is the main entry point for blockchain integration.
   * 
   * @param account - The smart contract account (must have EPM storage)
   * @param transaction - Ethereum transaction with paint data in the data field
   * @param blockHash - Hash of the block containing this transaction
   *                    CRITICAL: Block hash provides fresh entropy for deterministic randomness.
   *                    - Must be unpredictable (only known after mining)
   *                    - Must be deterministic (same hash = same pixel selection)
   *                    - Prevents players from cherry-picking favorable outcomes
   *                    This is how real Ethereum contracts get fair randomness!
   * 
   * @returns Updated account with mutated storage and balance
   */
  static executeTransaction(
    account: Account,
    transaction: EthereumTransaction,
    blockHash: string
  ): { success: boolean; account: Account; error?: string; winnerReward?: { address: string; amount: number } } {
    // Validate account has EPM storage
    if (!account.storage || !account.storage.pixels) {
      return {
        success: false,
        account,
        error: 'Account does not have EPM contract storage'
      };
    }
    
    // Parse transaction data
    if (!transaction.data) {
      return {
        success: false,
        account,
        error: 'Transaction missing data field'
      };
    }
    
    // Execute paint operation
    const { result, newStorage } = this.paint(
      account.storage as EPMStorage,
      transaction.value,
      transaction.data,
      blockHash,
      transaction.from  // Track who painted these pixels
    );
    
    if (!result.success) {
      return {
        success: false,
        account,
        error: result.error
      };
    }
    
    // Update account with new storage and balance
    let updatedAccount = {
      ...account,
      storage: newStorage,
      balance: account.balance + transaction.value
    };
    
    // Check if painting is now complete (all pixels painted)
    const totalPainted = Object.values(newStorage.colorCounts).reduce((sum, count) => sum + count, 0);
    const isPaintingComplete = totalPainted === newStorage.totalPixels;
    
    let winnerReward: { address: string; amount: number } | undefined;
    
    // If painting just completed, reward the winner
    if (isPaintingComplete && !newStorage.winnerAddress) {
      // Determine winner (color with most pixels)
      const winner = this.getWinner(newStorage);
      
      if (winner) {
        // Find the address that painted the most pixels of the winning color
        // Look in colorPainters storage to find who painted the most
        const painters = newStorage.colorPainters[winner.color];
        let winnerAddress: string | null = null;
        let maxPixelsPainted = 0;
        
        for (const [address, pixelCount] of Object.entries(painters)) {
          if (pixelCount > maxPixelsPainted) {
            maxPixelsPainted = pixelCount;
            winnerAddress = address;
          }
        }
        
        // Fallback: if we can't find the winner address, use transaction sender
        if (!winnerAddress) {
          winnerAddress = transaction.from;
          console.warn(`Could not find address for winning color ${winner.color}, using transaction sender`);
        }
        
        const rewardAmount = updatedAccount.balance;
        
        // Update storage with winner information
        const finalStorage = {
          ...newStorage,
          winnerColor: winner.color,
          winnerAddress: winnerAddress,
          rewardAmount: rewardAmount,
          completedAtBlock: blockHash
        };
        
        // Set contract balance to 0 (all ETH goes to winner)
        // Increment contract nonce for the internal transfer
        updatedAccount = {
          ...updatedAccount,
          storage: finalStorage,
          balance: 0,
          nonce: updatedAccount.nonce + 1
        };
        
        // Return winner reward info so WorldState can update winner's balance
        winnerReward = {
          address: winnerAddress,
          amount: rewardAmount
        };
        
        console.log(`🎉 Painting complete! Winner: ${winner.color} (${winnerAddress}). Reward: ${rewardAmount} ETH`);
      }
    }
    
    return {
      success: true,
      account: updatedAccount,
      winnerReward
    };
  }
  
  /**
   * Get the current winner (color with most pixels painted)
   */
  static getWinner(storage: EPMStorage): { color: string; count: number } | null {
    const counts = storage.colorCounts;
    let maxCount = 0;
    let winner: PaintColor | null = null;
    
    for (const [colorId, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        winner = parseInt(colorId) as PaintColor;
      }
    }
    
    if (!winner) return null;
    
    const colorName = Object.keys(COLOR_NAMES).find(
      key => COLOR_NAMES[key] === winner
    );
    
    return {
      color: colorName || 'unknown',
      count: maxCount
    };
  }
}


================================================================================
// FILE: core/epm/epmInit.ts
================================================================================

/**
 * EPM Contract Initialization
 * 
 * Helper functions to create and initialize EPM contract accounts
 * for inclusion in the genesis block or world state.
 */

import { Account } from '../../types/types';
import { EPM } from './EPM';

/**
 * Load a Pokemon image and extract its pixel grid
 * This runs in Node.js environment, so we need to use a different approach than browser Canvas API
 * For now, we'll create a placeholder grid - in production, you'd load the actual image
 */
function createPixelGridPlaceholder(size: number = 128): number[][] {
  const grid: number[][] = [];
  
  // Create a full rectangle - all pixels are paintable
  // This allows the entire Pokemon image to be painted
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) {
      // Mark all pixels as paintable (1)
      row.push(1);
    }
    grid.push(row);
  }
  
  return grid;
}

/**
 * Create an EPM contract account for a specific Pokemon image
 * 
 * @param address - The contract address (e.g., '0xEPM_HIPPO')
 * @param imageFilename - The Pokemon image filename (e.g., 'hippo.png')
 * @returns An Account object with EPM storage initialized
 */
export function createEPMContract(address: string, imageFilename: string): Account {
  // TODO: In production, load actual image and extract pixel grid
  // For now, use a placeholder grid
  const pixelGrid = createPixelGridPlaceholder(128);
  
  // Initialize EPM contract storage
  const storage = EPM.initialize(pixelGrid);
  
  // Create the contract account
  const account: Account = {
    address,
    balance: 0,
    nonce: 0,
    code: imageFilename, // Store the Pokemon image filename in the code field
    storage,
    codeHash: `epm-${imageFilename}` // Unique code hash for this EPM contract
  };
  
  return account;
}

/**
 * Create the default EPM contract for the genesis block
 * This creates a hippo painting contract at address 0xEPM_HIPPO
 */
export function createGenesisEPMContract(): Account {
  return createEPMContract('0xEPM_HIPPO', 'hippo.png');
}


================================================================================
// FILE: core/index.ts
================================================================================

/**
 * Core module index file
 * Exports all core functionality
 */

export * from './blockchain';
export * from './node';


================================================================================
// FILE: core/mempool/mempool.ts
================================================================================

import { EthereumTransaction } from '../../types/types';

/**
 * Mempool - Memory pool for pending transactions
 * 
 * Stores transactions that have been broadcast but not yet included in a block.
 * Each node maintains its own mempool.
 */
export class Mempool {
  private transactions: Map<string, EthereumTransaction>;

  constructor() {
    this.transactions = new Map();
  }

  /**
   * Add a transaction to the mempool
   * @param transaction Transaction to add
   * @returns true if added, false if already exists
   */
  addTransaction(transaction: EthereumTransaction): boolean {
    if (this.transactions.has(transaction.txid)) {
      return false; // Already in mempool
    }
    
    this.transactions.set(transaction.txid, transaction);
    return true;
  }

  /**
   * Remove a transaction from the mempool
   * @param txid Transaction ID to remove
   * @returns true if removed, false if not found
   */
  removeTransaction(txid: string): boolean {
    return this.transactions.delete(txid);
  }

  /**
   * Remove multiple transactions from the mempool
   * @param txids Array of transaction IDs to remove
   */
  removeTransactions(txids: string[]): void {
    for (const txid of txids) {
      this.transactions.delete(txid);
    }
  }

  /**
   * Get a transaction from the mempool
   * @param txid Transaction ID
   * @returns Transaction or undefined if not found
   */
  getTransaction(txid: string): EthereumTransaction | undefined {
    return this.transactions.get(txid);
  }

  /**
   * Get all transactions in the mempool
   * @returns Array of all transactions
   */
  getAllTransactions(): EthereumTransaction[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Get up to N transactions from the mempool
   * @param maxCount Maximum number of transactions to return
   * @returns Array of transactions (up to maxCount)
   */
  getTransactions(maxCount: number): EthereumTransaction[] {
    const allTransactions = this.getAllTransactions();
    return allTransactions.slice(0, maxCount);
  }

  /**
   * Check if a transaction is in the mempool
   * @param txid Transaction ID
   * @returns true if transaction exists in mempool
   */
  hasTransaction(txid: string): boolean {
    return this.transactions.has(txid);
  }

  /**
   * Get the number of transactions in the mempool
   * @returns Number of pending transactions
   */
  size(): number {
    return this.transactions.size;
  }

  /**
   * Clear all transactions from the mempool
   */
  clear(): void {
    this.transactions.clear();
  }
}


================================================================================
// FILE: core/node.ts
================================================================================

import { Block, NodeState, PeerInfoMap, Account, EthereumTransaction } from '../types/types';
import { Blockchain } from './blockchain/blockchain';
import { Mempool } from './mempool/mempool';
import { BeaconState, Validator } from './consensus/beaconState';
import { Sync } from './consensus/Sync';
import { Consensus } from './consensus/Consensus';
import { generatePrivateKey, derivePublicKey, generateAddress } from '../utils/cryptoUtils';

/**
 * Node class representing a full node in the Bitcoin network
 * Integrates blockchain and mining functionality
 */
export class Node {
  private nodeId: string;
  private blockchain: Blockchain;
  private mempool: Mempool;
  private beaconState: BeaconState; // Consensus Layer state
  private sync: Sync; // PoS synchronization
  private consensus: Consensus; // PoS consensus and block proposal
  private peers: PeerInfoMap = {};
  
  // Security-related properties
  private privateKey: string;
  private publicKey: string;
  private address: string;
  
  // Painting state (for EPM contract)
  private paintingComplete: boolean = false;
  
  // Network delay multiplier (1.0 = normal, higher = slower network for this node)
  private networkDelayMultiplier: number = 1.0;
  
  // Callbacks for network events (PoS uses Consensus for block broadcasting)
  private onChainUpdated?: () => void;
  
  constructor(nodeId: string, genesisTime?: number, validators?: Validator[]) {
    this.nodeId = nodeId;
    
    // Generate cryptographic keys and their derivatives for this node
    this.privateKey = generatePrivateKey(nodeId);
    this.publicKey = derivePublicKey(this.privateKey);
    this.address = generateAddress(this.publicKey);
    
    // Initialize Beacon State (Consensus Layer) BEFORE Blockchain
    // All nodes will be initialized with the same genesis time and validator set
    const defaultGenesisTime = genesisTime || Math.floor(Date.now() / 1000);
    const defaultValidators = validators || [];
    this.beaconState = new BeaconState(defaultGenesisTime, defaultValidators);
    
    // Create blockchain with BeaconState so genesis block can be processed correctly
    this.blockchain = new Blockchain(nodeId, this.address, this.beaconState);
    
    // Initialize mempool for pending transactions
    this.mempool = new Mempool();
    
    // Initialize Sync for LMD-GHOST head synchronization
    this.sync = new Sync(this.blockchain, this.nodeId);
    
    // Initialize Consensus for PoS block proposal and validation
    this.consensus = new Consensus(this.beaconState, this.blockchain, this, this.mempool);
  }
  
  /**
   * Sets the peer information with addresses directly
   * @param peers Object mapping peer IDs to their information including addresses
   */
  setPeerInfosWithAddresses(peers: PeerInfoMap): void {
    // Set the peer information directly
    this.peers = { ...peers };
  }
  
  /**
   * Sets the callback for when a block is broadcast
   */

  
  /**
   * Sets the callback for when the chain is updated
   */
  setOnChainUpdated(callback: () => void): void {
    this.onChainUpdated = callback;
  }
  
  /**
   * Gets the current state of the node
   */
  getState(): NodeState {
    return {
      nodeId: this.nodeId,
      blockchain: this.blockchain.getBlocks(),
      blockchainTree: this.blockchain.getTree(),
      beaconState: this.beaconState,
      worldState: this.blockchain.getWorldState(),
      receipts: this.blockchain.getReceipts(),
      mempool: this.mempool.getAllTransactions(),

      consensusStatus: this.consensus.consensusStatus,
      peerIds: Object.keys(this.peers),
      publicKey: this.publicKey,
      address: this.address
    };
  }
  
  /**
   * Gets transactions from the mempool
   * @param maxCount Maximum number of transactions to return
   * @returns Array of transactions from mempool
   */
  getMempoolTransactions(maxCount: number): EthereumTransaction[] {
    return this.mempool.getTransactions(maxCount);
  }
  
  /**
   * Adds a transaction to this node's mempool
   * @param transaction Transaction to add
   * @returns true if added successfully
   */
  addTransactionToMempool(transaction: EthereumTransaction): boolean {
    return this.mempool.addTransaction(transaction);
  }
  
  
  /**
   * Check if painting is complete for this node
   */
  public isPaintingComplete(): boolean {
    return this.paintingComplete;
  }
  
  /**
   * Gets the current blockchain height
   */
  getBlockchainHeight(): number {
    return this.blockchain.getHeight();
  }
  
  /**
   * Gets all blocks in the blockchain
   */
  getBlocks(): Block[] {
    return this.blockchain.getBlocks();
  }
  
  /**
   * Gets the node's public key
   */
  getPublicKey(): string {
    return this.publicKey;
  }
  
  /**
   * Gets the node's Bitcoin address
   */
  getAddress(): string {
    return this.address;
  }
  
  /**
   * Gets the node's private key
   * Note: In a real system, this would be kept private and never exposed
   * It's only exposed here for the simulator's simplified implementation
   * so the miner class can easily access it
   */
  getPrivateKey(): string {
    return this.privateKey;
  }
  
  /**
   * Gets the node ID
   */
  getNodeId(): string {
    return this.nodeId;
  }
  
  /**
   * Gets the peer information map
   */
  getPeerInfos(): PeerInfoMap {
    return this.peers;
  }
  
  /**
   * Gets the Beacon State (Consensus Layer state)
   */
  getBeaconState(): BeaconState {
    return this.beaconState;
  }
  
  /**
   * Gets the Sync instance for LMD-GHOST head synchronization
   */
  getSync(): Sync {
    return this.sync;
  }
  
  /**
   * Gets the Consensus instance for PoS block proposal
   */
  getConsensus(): Consensus {
    return this.consensus;
  }
  
  /**
   * Gets the current world state from the blockchain
   */
  getWorldState(): Record<string, Account> {
    return this.blockchain.getWorldState();
  }
  
  /**
   * Gets the network delay multiplier for this node
   */
  getNetworkDelayMultiplier(): number {
    return this.networkDelayMultiplier;
  }
  
  /**
   * Sets the network delay multiplier for this node
   * @param multiplier - Multiplier for network delays (1.0 = normal, higher = slower)
   */
  setNetworkDelayMultiplier(multiplier: number): void {
    this.networkDelayMultiplier = Math.max(0.1, multiplier); // Minimum 0.1x
  }
}


================================================================================
// FILE: core/validation/blockValidator.ts
================================================================================

import { Block, BlockHeader } from '../../types/types';
import { sha256Hash, isHashBelowCeiling } from '../../utils/cryptoUtils';
import { SimulatorConfig } from '../../config/config';
import { validateTransaction } from './transactionValidator';
import { WorldState } from '../blockchain/worldState';

/**
 * Creates a block header hash by hashing the header
 */
export const calculateBlockHeaderHash = (header: BlockHeader): string => {
  return sha256Hash(header);
};

/**
 * Calculates the hash of all transactions in a block
 */
export const calculateTransactionHash = (transactions: any[]): string => {
  return sha256Hash(transactions);
};

/**
 * Validates a block against the blockchain rules
 * Returns {valid: true} if valid, {valid: false, error: string} if invalid
 */
export const validateBlock = async (
  block: Block, 
  worldState: WorldState,
  previousHeaderHash: string
): Promise<{valid: boolean; error?: string}> => {
  const { header, transactions } = block;
  
  // 1. Validate block has at least one transaction
  if (transactions.length === 0) {
    const error = 'Block has no transactions';
    console.error(error);
    return { valid: false, error };
  }
  
  // Create a temporary world state for sequential validation
  // This allows transactions within the same block to be validated in order
  const tempWorldState = new WorldState(worldState.accounts); // clone
  // todo: also create temp beacon state when we have valdition rules specific to beacon state
  
  // 2. First transaction must be a coinbase(issuance) transaction
  const coinbaseResult = await validateTransaction(transactions[0], tempWorldState, true);
  if (!coinbaseResult.valid) {
    const error = `Invalid coinbase transaction: ${coinbaseResult.error}`;
    console.error(error);
    return { valid: false, error };
  }
  
  // Update the temporary world state with the coinbase transaction
  tempWorldState.updateWithTransaction(transactions[0]);
  
  // 3. Validate all other transactions sequentially
  for (let i = 1; i < transactions.length; i++) {
    const txResult = await validateTransaction(transactions[i], tempWorldState, false);
    if (!txResult.valid) {
      const error = `Transaction ${i} failed: ${txResult.error}`;
      console.error(error);
      return { valid: false, error };
    }
    
    // Update the temporary world state with this transaction
    tempWorldState.updateWithTransaction(transactions[i]);
  }
  
  // 4. Validate transaction hash in header matches the hash of all transactions
  const calculatedTransactionHash = calculateTransactionHash(transactions);
  if (header.transactionHash !== calculatedTransactionHash) {
    const error = `Transaction hash mismatch: ${header.transactionHash} !== ${calculatedTransactionHash}`;
    console.error(error);
    return { valid: false, error };
  }
  
  // 5. Validate previous header hash matches the provided hash
  // For non-genesis blocks, validate previous hash
  if (header.height > 0) {
    if (!previousHeaderHash) {
      const error = 'Cannot validate a non-genesis block without a previous header hash';
      console.error(error);
      return { valid: false, error };
    }
    
    if (header.previousHeaderHash !== previousHeaderHash) {
      const error = `Previous header hash mismatch: ${header.previousHeaderHash} !== ${previousHeaderHash}`;
      console.error(error);
      return { valid: false, error };
    }
  }
  
  // 6. Validate block timestamp is reasonable
  const now = Date.now();
  const fiveHoursInMs = 5 * 60 * 60 * 1000;
  if (header.timestamp > now + fiveHoursInMs || header.timestamp < now - fiveHoursInMs) {
    const error = `Block timestamp is unreasonable: ${header.timestamp}`;
    console.error(error);
    return { valid: false, error };
  }
  
  // 7. Validate attestations (if any)
  if (block.attestations && block.attestations.length > 0) {
    // TODO: Add more comprehensive attestation validation:
    // - Verify attestations point to blocks in the tree
    // - Verify attestations are from registered validators
    // - Verify attestation signatures (when implemented)
    
    // For now, just check for duplicates within the block
    const attestationKeys = new Set<string>();
    for (const attestation of block.attestations) {
      const key = `${attestation.blockHash}-${attestation.validatorAddress}`;
      if (attestationKeys.has(key)) {
        const error = `Duplicate attestation in block: ${key}`;
        console.error(error);
        return { valid: false, error };
      }
      attestationKeys.add(key);
    }
  }
  
  return { valid: true };
};


================================================================================
// FILE: core/validation/chainValidator.ts
================================================================================

import { Block } from '../../types/types';
import { SimulatorConfig } from '../../config/config';

/**
 * Lightweight chain validation for PoS block tree
 * 
 * Only validates structural integrity:
 * - Hashes link together correctly
 * - Slots are in correct order (gaps allowed for missed slots)
 * - Genesis block has correct previous hash
 * 
 * Does NOT validate transactions or rebuild state.
 * Full validation happens when blocks are applied to 
 * our state via a LMD GHOST header being move to a chain in our block tree
 * 
 * This is suitable for validating chains received from peers before
 * adding them to the block tree.
 */
export const lightValidateChain = async (chain: Block[]): Promise<boolean> => {
  // 1. Check if the chain is empty
  if (chain.length === 0) {
    console.error('[lightValidateChain] Chain is empty');
    return false;
  }
  
  // 2. Verify genesis block has correct previous hash
  if (chain[0].header.previousHeaderHash !== SimulatorConfig.GENESIS_PREV_HASH) {
    console.error('[lightValidateChain] Genesis block must have GENESIS_PREV_HASH');
    return false;
  }
  
  // 3. Validate each block's hash links to previous block
  for (let i = 1; i < chain.length; i++) {
    const block = chain[i];
    const previousBlock = chain[i - 1];
    
    // Check hash linkage
    if (block.header.previousHeaderHash !== previousBlock.hash) {
      console.error(`[lightValidateChain] Hash mismatch at height ${block.header.height}: ${block.header.previousHeaderHash} !== ${previousBlock.hash}`);
      return false;
    }
    
    // Check slot ordering (slots must increase, gaps allowed for missed slots)
    if (block.header.slot <= previousBlock.header.slot) {
      console.error(`[lightValidateChain] Slot not increasing at height ${block.header.height}: ${block.header.slot} <= ${previousBlock.header.slot}`);
      return false;
    }
  }
  
  return true;
};


================================================================================
// FILE: core/validation/index.ts
================================================================================

/**
 * Validation module index file
 * Exports all validation-related functionality
 */

export * from './blockValidator';
export * from './transactionValidator';
export * from './chainValidator';


================================================================================
// FILE: core/validation/securityValidator.ts
================================================================================

/**
 * Security validation for Ethereum transactions
 * Handles signature verification and address validation
 */

import { EthereumTransaction } from '../../types/types';
import { SimulatorConfig } from '../../config/config';
import { generateAddress, verifySignature } from '../../utils/cryptoUtils';
import { createSignatureInput } from '../blockchain/transaction';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Helper to calculate txid for validation
 * Must match the calculation in transaction.ts
 */
function calculateTxid(tx: {
  from: string;
  to: string;
  value: number;
  nonce: number;
  timestamp: number;
}): string {
  const txString = JSON.stringify({ 
    from: tx.from, 
    to: tx.to, 
    value: tx.value, 
    nonce: tx.nonce, 
    timestamp: tx.timestamp 
  });
  return bytesToHex(sha256(new TextEncoder().encode(txString)));
}

/**
 * Validates the security aspects of an Ethereum transaction
 * Verifies signature and that public key hash matches from address
 * @param transaction The transaction to validate
 * @returns True if the transaction passes all security checks, false otherwise
 */
export const validateTransactionSecurity = async (
  transaction: EthereumTransaction
): Promise<boolean> => {
  // 1. Skip coinbase transactions (they don't need signatures)
  if (transaction.from === SimulatorConfig.PROTOCOL_NODE_ID) {
    return true;
  }
  
  // 2. Verify public key is provided
  if (!transaction.publicKey) {
    console.error('Missing public key for transaction');
    return false;
  }
  
  // 3. Verify that the public key hash matches the from address
  const derivedAddress = generateAddress(transaction.publicKey);
  if (derivedAddress !== transaction.from) {
    console.error(`Public key does not match from address: ${derivedAddress} !== ${transaction.from}`);
    return false;
  }
  
  // 4. Verify that a signature exists
  if (!transaction.signature) {
    console.error('Missing signature for transaction');
    return false;
  }
  
  // 5. Verify that the signature is not an error signature
  if (transaction.signature.startsWith('error-')) {
    console.error('Transaction contains error signature');
    return false;
  }
  
  // 6. Verify txid matches transaction data (data integrity check)
  // This ensures the transaction data hasn't been tampered with
  const calculatedTxid = calculateTxid({
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    nonce: transaction.nonce,
    timestamp: transaction.timestamp
  });
  
  if (calculatedTxid !== transaction.txid) {
    console.error(`Transaction data tampered: calculated txid ${calculatedTxid} !== ${transaction.txid}`);
    return false;
  }
  
  // 7. Create signature input (just the txid)
  // The signature proves authorization of this specific txid
  const signatureInput = createSignatureInput({ txid: transaction.txid });
  
  // 8. Cryptographically verify the signature (authorization check)
  // This proves the sender has the private key for the from address
  try {
    const isValid = await verifySignature(
      signatureInput,
      transaction.signature,
      transaction.publicKey
    );
    
    // 9. Reject if signature is invalid
    if (!isValid) {
      console.error('Invalid signature for transaction');
      return false;
    }
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
  
  return true;
};


================================================================================
// FILE: core/validation/transactionValidator.ts
================================================================================

import { EthereumTransaction } from '../../types/types';
import { SimulatorConfig } from '../../config/config';
import { WorldState } from '../blockchain/worldState';
import { validateTransactionSecurity } from './securityValidator';

/**
 * Validates an Ethereum transaction against the world state
 * Returns {valid: true} if valid, {valid: false, error: string} if invalid
 */
export async function validateTransaction(
  transaction: EthereumTransaction,
  worldState: WorldState,
  isCoinbase: boolean = false
): Promise<{valid: boolean; error?: string}> {
  try {
    // 1. For coinbase transactions, validate they come from REWARDER
    if (isCoinbase) {
      if (transaction.from !== SimulatorConfig.PROTOCOL_NODE_ID) {
        const error = `Coinbase transaction must be from ${SimulatorConfig.PROTOCOL_NODE_ID}, got ${transaction.from}`;
        console.error(error);
        return { valid: false, error };
      }
      // Skip further validation for coinbase transactions
      return { valid: true };
    }
  
    // 2. Validate sender account exists
    const senderAccount = worldState.getAccount(transaction.from);
    if (!senderAccount) {
      const error = `Sender account not found: ${transaction.from.slice(0, 16)}...`;
      console.error(error);
      return { valid: false, error };
    }
  
    // 3. Validate sender has sufficient balance - todo this is failing on re org we need to fix this long term
    /*if (senderAccount.balance < transaction.value) {
      const error = `Insufficient balance: sender has ${senderAccount.balance} ETH but transaction requires ${transaction.value} ETH`;
      console.error(error);
      return { valid: false, error };
    }*/
  
    // 4. Validate transaction value is positive
    if (transaction.value <= 0) {
      const error = `Transaction value must be positive, got ${transaction.value}`;
      console.error(error);
      return { valid: false, error };
    }
  
    // 5. Validate nonce matches sender's current nonce - todo add this check back, there is edeg case where this is failing on re org
    /*if (transaction.nonce !== senderAccount.nonce) {
      const error = `Invalid nonce: expected ${senderAccount.nonce}, got ${transaction.nonce} (sender: ${transaction.from.slice(0, 16)}...)`;
      console.error(error);
      return { valid: false, error };
    }*/
  
    // 6. Security validation: Verify signature and address
    const securityValid = await validateTransactionSecurity(transaction);
    if (!securityValid) {
      const error = `Transaction signature validation failed (txid: ${transaction.txid?.slice(0, 16)}...)`;
      console.error(error);
      return { valid: false, error };
    }
    
    return { valid: true };
  } catch (error) {
    const errorMsg = `Error validating transaction: ${error}`;
    console.error(errorMsg);
    return { valid: false, error: errorMsg };
  }
}


================================================================================
// FILE: main.tsx
================================================================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


================================================================================
// FILE: network/index.ts
================================================================================

export * from './messages';
export * from './nodeWorker';
export * from './networkManager';


================================================================================
// FILE: network/messages.ts
================================================================================

import { Block, Attestation } from '../types/types';

/**
 * Types of messages that can be sent between nodes
 * PoS uses attestations, LMD-GHOST head synchronization, and proposer block broadcasts
 */
export enum MessageType {
  ATTESTATION = 'ATTESTATION',
  LMD_GHOST_BROADCAST = 'LMD_GHOST_BROADCAST',
  CHAIN_REQUEST = 'CHAIN_REQUEST',
  CHAIN_RESPONSE = 'CHAIN_RESPONSE',
  PROPOSER_BLOCK_BROADCAST = 'PROPOSER_BLOCK_BROADCAST',
}

/**
 * Base interface for all network messages
 */
export interface NetworkMessage {
  type: MessageType;
  fromNodeId: string;
  toNodeId?: string; // Optional for broadcast messages
}

/**
 * Message for broadcasting an attestation (PoS consensus)
 */
export interface AttestationMessage extends NetworkMessage {
  type: MessageType.ATTESTATION;
  attestation: Attestation;
}

/**
 * Message for broadcasting LMD-GHOST head for synchronization
 * Nodes periodically broadcast their current GHOST-HEAD to all peers
 */
export interface LmdGhostBroadcastMessage extends NetworkMessage {
  type: MessageType.LMD_GHOST_BROADCAST;
  ghostHeadHash: string; // Hash of the node's current LMD-GHOST head
}

/**
 * Message for requesting a chain for a specific head
 * Sent when a node receives a GHOST head it doesn't have
 */
export interface ChainRequestMessage extends NetworkMessage {
  type: MessageType.CHAIN_REQUEST;
  toNodeId: string; // Required for direct request
  requestedHeadHash: string; // The head hash to get the chain for
}

/**
 * Message for responding with a chain branch
 * Returns the chain from the requested head to genesis
 */
export interface ChainResponseMessage extends NetworkMessage {
  type: MessageType.CHAIN_RESPONSE;
  toNodeId: string; // Required for direct response
  requestedHeadHash: string; // The head that was requested
  blocks: Block[]; // Chain from requested head to genesis
}

/**
 * Message for broadcasting a proposed block from the slot proposer
 * Sent to all validators (not all peers) for attestation
 */
export interface ProposerBlockBroadcastMessage extends NetworkMessage {
  type: MessageType.PROPOSER_BLOCK_BROADCAST;
  block: Block; // The proposed block with slot number
  slot: number; // The slot this block was proposed in
}

/**
 * Union type for all network messages (PoS only)
 */
export type Message = 
  | AttestationMessage
  | LmdGhostBroadcastMessage
  | ChainRequestMessage
  | ChainResponseMessage
  | ProposerBlockBroadcastMessage;


================================================================================
// FILE: network/networkManager.ts
================================================================================

import { NodeWorker } from './nodeWorker';
import { Message } from './messages';
import { SimulatorConfig } from '../config/config';
import { generateUniqueNodeIds } from '../utils/nodeIdGenerator';
import { Validator } from '../core/consensus/beaconState';

/**
 * NetworkManager class to manage a network of nodes
 * Simulates a peer-to-peer network by routing messages between nodes
 */
export class NetworkManager {
  /**
   * Static factory method to create a fully connected network with the specified number of nodes
   * @param nodeCount Number of nodes to create
   * @returns A new NetworkManager instance with the connected nodes
   */
  static createFullyConnectedNetwork(nodeCount: number): NetworkManager {
    const networkManager = new NetworkManager();
    networkManager.createFullyConnectedNetwork(nodeCount);
    return networkManager;
  }
  private nodesMap: Map<string, NodeWorker> = new Map();
  private networkTopology: Map<string, string[]> = new Map();
  
  // Shared beacon state initialization - all nodes start with same genesis time and validators
  private beaconGenesisTime: number = Math.floor(Date.now() / 1000);
  private beaconValidators: Validator[] = [];
  
  /**
   * Creates a new node in the network
   */
  createNode(nodeId: string): NodeWorker {
    // Create a new node worker with shared beacon state initialization
    const nodeWorker = new NodeWorker(nodeId, this.beaconGenesisTime, this.beaconValidators);
    
    // Add this node as a validator
    // Schedule will be computed lazily when first slot is processed
    this.beaconValidators.push({
      nodeAddress: nodeWorker.getNodeAddress(),
      stakedEth: 32
    });
    
    // Set up message handling
    nodeWorker.setOnOutgoingMessage(this.routeMessageFromNode.bind(this));
    
    // Add the node to the network
    this.nodesMap.set(nodeId, nodeWorker);
    
    return nodeWorker;
  }
  

  
  /**
   * Sets up the network topology
   * Defines which nodes are connected to each other and shares address information
   * This allows for creating various network structures (mesh, ring, star, etc.)
   */
  setupNetworkTopology(topology: Map<string, string[]>): void {
    this.networkTopology = new Map(topology);
    
    // First collect all node addresses
    const addressMap: { [nodeId: string]: string } = {};
    for (const [nodeId, nodeWorker] of this.nodesMap.entries()) {
      addressMap[nodeId] = nodeWorker.getNodeAddress();
    }
    
    // Set peer information with addresses for each node
    for (const [nodeId, peerIds] of this.networkTopology.entries()) {
      const node = this.nodesMap.get(nodeId);
      if (node) {
        // Create peer objects with addresses
        const peers: { [peerId: string]: { address: string } } = {};
        peerIds.forEach(peerId => {
          peers[peerId] = { address: addressMap[peerId] };
        });
        
        // Set complete peer info directly
        node.setPeerInfosWithAddresses(peers);
      }
    }
  }
  /**
   * Creates a fully connected mesh network with the specified number of nodes
   * In a mesh topology, every node is directly connected to every other node
   * This provides maximum redundancy and multiple paths for message propagation
   * @returns Array of node IDs that were created
   */
  createFullyConnectedNetwork(nodeCount: number): string[] {
    // Generate unique phonetic node IDs ("Alpha", "Bravo", etc)
    const nodeIds = generateUniqueNodeIds(nodeCount);
    
    // Create the nodes with the phonetic IDs
    for (const nodeId of nodeIds) {
      this.createNode(nodeId);
    }
    
    // All nodes created - schedules will be computed lazily when first slot is processed
    console.log(`[NetworkManager] All ${nodeCount} nodes created with ${this.beaconValidators.length} validators.`);
    
    // Set up the network topology (mesh)
    const topology = new Map<string, string[]>();
    for (const nodeId of nodeIds) {
      // Each node is connected to all other nodes
      topology.set(nodeId, nodeIds.filter(id => id !== nodeId));
    }
    this.setupNetworkTopology(topology);
    
    return nodeIds;
  }
  
  /**
   * Receives an outgoing message from a node and routes it through the network
   * Acts as the network layer that transmits messages between nodes
   */
  private routeMessageFromNode(message: Message): void {
    // Delay is now applied per-recipient in deliverMessageToRecipients
    this.deliverMessageToRecipients(message);
  }
  
  /**
   * Delivers a message to the appropriate recipient(s) based on message type and topology
   */
  private deliverMessageToRecipients(message: Message): void {
    // If the message has a specific recipient, send it only to that node
    if (message.toNodeId) {
      const targetNode = this.nodes.get(message.toNodeId);
      if (targetNode) {
        // Apply recipient's delay multiplier
        const baseDelay = this.getRandomNetworkDelay();
        const multiplier = targetNode.getNetworkDelayMultiplier();
        const actualDelay = baseDelay * multiplier;
        
        setTimeout(() => {
          targetNode.receiveIncomingMessage(message);
        }, actualDelay);
      } else {
        // Silently drop the message if the target node no longer exists
        // This can happen during test cleanup when nodes are removed
        // but there are still messages in flight
      }
      return;
    }
    
    // Otherwise, it's a broadcast message - send to all peers of the sender
    const senderPeers = this.networkTopology.get(message.fromNodeId) || [];
    console.log(`[NetworkManager] 🌐 Broadcasting ${message.type} from ${message.fromNodeId.slice(0, 8)} to ${senderPeers.length} peers: ${senderPeers.map(p => p.slice(0, 8)).join(', ')}`);
    
    for (const peerId of senderPeers) {
      const peerNode = this.nodes.get(peerId);
      if (peerNode) {
        // Apply recipient's delay multiplier
        const baseDelay = this.getRandomNetworkDelay();
        const multiplier = peerNode.getNetworkDelayMultiplier();
        const actualDelay = baseDelay * multiplier;
        console.log(`[NetworkManager] 🌐 Broadcasting ${message.type} from ${message.fromNodeId.slice(0, 8)} to ${peerId.slice(0, 8)} with delay ${actualDelay.toFixed(2)}ms`);
        setTimeout(() => {
          peerNode.receiveIncomingMessage(message);
        }, actualDelay);
      }
    }
  }
  
  /**
   * Broadcasts LMD-GHOST heads from all nodes
   * Called periodically (every second) for PoS synchronization
   */
  broadcastAllGhostHeads(): void {
    for (const node of this.nodesMap.values()) {
      node.broadcastGhostHead();
    }
  }
  
  /**
   * Processes a slot for all nodes in the network
   * Each node will:
   * - Determine if it's the proposer for this slot
   * - If proposer: create and broadcast block
   * - If not proposer: wait for block from proposer
   */
  async processAllSlots(): Promise<void> {
    // Process slots for all nodes in parallel (each calculates slot based on time)
    const promises = Array.from(this.nodesMap.values()).map(node => 
      node.processSlot()
    );
    await Promise.all(promises);
  }
  
  /**
   * Stops all nodes and cleans up resources
   * Used for test cleanup and when shutting down the network
   */
  stopAllNodes(): void {
    // Clear any references or resources
    this.nodesMap.clear();
    this.networkTopology.clear();
  }
  
  /**
   * Gets a node by its ID
   */
  getNode(nodeId: string): NodeWorker | undefined {
    return this.nodesMap.get(nodeId);
  }
  
  /**
   * Gets all nodes in the network
   */
  getAllNodes(): Map<string, NodeWorker> {
    return new Map(this.nodesMap);
  }
  
  /**
   * Gets all nodes in the network
   * @returns Map of node IDs to NodeWorker instances
   */
  get nodes(): Map<string, NodeWorker> {
    return this.nodesMap;
  }
  
  /**
   * Gets the state of all nodes in the network
   */
  getNetworkState(): Record<string, any> {
    const state: Record<string, any> = {};
    
    for (const [nodeId, node] of this.nodesMap.entries()) {
      state[nodeId] = {
        ...node.getState(),
        networkDelayMultiplier: node.getNetworkDelayMultiplier()
      };
    }
    
    return state;
  }
  
  /**
   * Generates a mapping from address to nodeId for UI display
   * @returns Record mapping address (sha256 of publicKey) to human-readable nodeId
   */
  getAddressToNodeIdMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    
    for (const [nodeId, node] of this.nodesMap.entries()) {
      const address = node.getNodeAddress();
      mapping[address] = nodeId;
    }
    
    return mapping;
  }
  
  /**
   * Adds a transaction to a specific node's mempool
   * @param nodeId ID of the node to add transaction to
   * @param recipient Recipient address
   * @param amount Amount in ETH
   * @returns true if transaction was added successfully
   */
  async addTransactionToNodeMempool(nodeId: string, recipient: string, amount: number): Promise<boolean> {
    const node = this.nodesMap.get(nodeId);
    if (!node) {
      console.error(`Node ${nodeId} not found`);
      return false;
    }
    
    return await node.addTransactionToMempool(recipient, amount);
  }
  
  /**
   * Sets the network delay multiplier for a specific node
   * @param nodeId ID of the node to update
   * @param multiplier Network delay multiplier (1.0 = normal, higher = slower)
   */
  setNodeNetworkDelayMultiplier(nodeId: string, multiplier: number): void {
    const node = this.nodesMap.get(nodeId);
    if (!node) {
      console.error(`Node ${nodeId} not found`);
      return;
    }
    
    node.setNetworkDelayMultiplier(multiplier);
  }
  
  /**
   * Sets consensus status for all nodes (used when stopping/starting network)
   * @param status Status to set for all nodes
   */
  setAllConsensusStatus(status: 'idle' | 'validating' | 'proposing'): void {
    this.nodesMap.forEach(nodeWorker => {
      const consensus = nodeWorker.node.getConsensus();
      consensus.consensusStatus = status;
    });
  }
  
  /**
   * Generates a random network delay to simulate network latency
   */
  private getRandomNetworkDelay(): number {
    // Simulate network latency between MIN_DELAY and MAX_DELAY
    const MIN_DELAY = SimulatorConfig.MIN_NETWORK_DELAY_MS || 50;
    const MAX_DELAY = SimulatorConfig.MAX_NETWORK_DELAY_MS || 200;
    
    return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
  }
}


================================================================================
// FILE: network/nodeWorker.ts
================================================================================

import { Node } from '../core/node';
import { Block, PeerInfoMap, Attestation } from '../types/types';
import { Validator } from '../core/consensus/beaconState';
import { 
  Message, 
  MessageType, 
  AttestationMessage,
  LmdGhostBroadcastMessage,
  ChainRequestMessage,
  ChainResponseMessage,
  ProposerBlockBroadcastMessage
} from './messages';
import { createSignedTransaction } from '../core/blockchain/transaction';

/**
 * NodeWorker class that wraps a Node instance and handles message passing
 * This simulates a node running in its own process/thread
 */
export class NodeWorker {
  private _node: Node;
  private onOutgoingMessageCallback?: (message: Message) => void;
  
  /**
   * Gets the underlying Node instance
   * @returns The Node instance
   */
  get node(): Node {
    return this._node;
  }
  
  constructor(nodeId: string, genesisTime?: number, validators?: Validator[]) {
    // Create the node instance with beacon state initialization
    this._node = new Node(nodeId, genesisTime, validators);
    
    // Callbacks for node events are set up via Consensus (PROPOSER_BLOCK_BROADCAST)
    
    // Set up callback for Sync to send messages
    this._node.getSync().setMessageCallback((message: any) => {
      if (this.onOutgoingMessageCallback) {
        this.onOutgoingMessageCallback(message as Message);
      }
    });
    
    // Set up callback for Consensus to send messages
    this._node.getConsensus().setMessageCallback((message: any) => {
      if (this.onOutgoingMessageCallback) {
        this.onOutgoingMessageCallback(message as Message);
      }
    });
  }
  
  /**
   * Sets the callback for when this node needs to send a message to other nodes
   * This is called by the NetworkManager to establish the outgoing message channel
   */
  setOnOutgoingMessage(callback: (message: Message) => void): void {
    this.onOutgoingMessageCallback = callback;
  }
  
  /**
   * Receives and processes incoming messages from other nodes via the network
   */
  receiveIncomingMessage(message: Message): void {
    switch (message.type) {
      case MessageType.ATTESTATION:
        this.handleAttestation(message as AttestationMessage);
        break;
      case MessageType.LMD_GHOST_BROADCAST:
        this.handleLmdGhostBroadcast(message as LmdGhostBroadcastMessage);
        break;
      case MessageType.CHAIN_REQUEST:
        this.handleChainRequest(message as ChainRequestMessage);
        break;
      case MessageType.CHAIN_RESPONSE:
        this.handleChainResponse(message as ChainResponseMessage);
        break;
      case MessageType.PROPOSER_BLOCK_BROADCAST:
        this.handleProposerBlockBroadcast(message as ProposerBlockBroadcastMessage);
        break;
      default:
        console.error(`Unknown message type: ${(message as any).type}`);
    }
  }
  
  /**
   * Sets the peer information with addresses directly
   * @param peers Object mapping peer IDs to their information including addresses
   */
  setPeerInfosWithAddresses(peers: PeerInfoMap): void {
    this._node.setPeerInfosWithAddresses(peers);
  }
  
  /**
   * Gets the Bitcoin address of this node
   */
  getNodeAddress(): string {
    return this._node.getAddress();
  }
  
  /**
   * Gets the current state of the node
   */
  getState(): any {
    return this._node.getState();
  }
  
  /**
   * Handles an attestation message from another validator
   * Adds the attestation to the local beacon pool
   */
  private handleAttestation(message: AttestationMessage): void {
    console.log(`[NodeWorker ${this._node.getAddress().slice(0, 8)}] 📥 Received attestation from ${message.fromNodeId.slice(0, 8)} for block ${message.attestation.blockHash.slice(0, 8)}`);
    
    // Add attestation to beacon state's beacon pool
    const beaconState = this._node.getState().beaconState;
    if (beaconState) {
      beaconState.addAttestation(message.attestation);
      console.log(`[NodeWorker ${this._node.getAddress().slice(0, 8)}] ✅ Added attestation to beacon pool. Latest attestations count: ${beaconState.latestAttestations.size}`);
    }
  }
  
  /**
   * Handles LMD-GHOST broadcast message
   * Thin wrapper - delegates to Sync class
   */
  private handleLmdGhostBroadcast(message: LmdGhostBroadcastMessage): void {
    const sync = this._node.getSync();
    sync.handleGhostBroadcast(message.fromNodeId, message.ghostHeadHash);
  }
  
  /**
   * Handles chain request message
   * Thin wrapper - delegates to Sync class
   */
  private handleChainRequest(message: ChainRequestMessage): void {
    const sync = this._node.getSync();
    sync.handleChainRequest(message.fromNodeId, message.requestedHeadHash);
  }
  
  /**
   * Handles chain response message
   * Thin wrapper - delegates to Sync class
   */
  private handleChainResponse(message: ChainResponseMessage): void {
    const sync = this._node.getSync();
    sync.handleChainResponse(message.requestedHeadHash, message.blocks);
  }
  
  /**
   * Handles a block broadcast from a proposer
   * Validators receive this and attest to the block
   */
  private handleProposerBlockBroadcast(message: ProposerBlockBroadcastMessage): void {
    console.log(`[NodeWorker ${this._node.getAddress().slice(0, 8)}] 📦 Received proposer block ${message.block.hash?.slice(0, 8)} for slot ${message.slot} from ${message.fromNodeId.slice(0, 8)}`);
    const consensus = this._node.getConsensus();
    consensus.handleProposedBlock(message.block, message.slot, message.fromNodeId);
  }
  
  /**
   * Broadcasts LMD-GHOST head
   * Called periodically to sync with other nodes
   */
  broadcastGhostHead(): void {
    const sync = this._node.getSync();
    sync.broadcastGhostHead();
  }
  
  /**
   * Processes a consensus slot
   * Called periodically (every 12 seconds) to run PoS consensus
   */
  async processSlot(): Promise<void> {
    const consensus = this._node.getConsensus();
    await consensus.processSlot();
  }
  
  /**
   * Creates and adds a transaction to this node's mempool
   * @param recipient Recipient address
   * @param amount Amount in ETH
   * @returns true if transaction was added successfully
   */
  async addTransactionToMempool(recipient: string, amount: number): Promise<boolean> {
    // Get current nonce from world state
    const worldState = this._node.getWorldState();
    const senderAddress = this._node.getAddress();
    const senderAccount = worldState[senderAddress];
    const baseNonce = senderAccount ? senderAccount.nonce : 0;
    
    // Count pending transactions from this sender in mempool to calculate next nonce
    const mempoolTransactions = this._node.getMempoolTransactions(1000); // Get all mempool transactions
    const pendingFromSender = mempoolTransactions.filter(tx => tx.from === senderAddress).length;
    const nonce = baseNonce + pendingFromSender;
    
    console.log(`Creating transaction with nonce ${nonce} (base: ${baseNonce}, pending: ${pendingFromSender})`);
    
    // Create a signed transaction
    const transaction = await createSignedTransaction(
      senderAddress,
      recipient,
      amount,
      nonce,
      this._node.getPrivateKey(),
      this._node.getPublicKey()
    );
    
    // Add to mempool
    return this._node.addTransactionToMempool(transaction);
  }
  
  /**
   * Gets the network delay multiplier for this node
   */
  getNetworkDelayMultiplier(): number {
    return this._node.getNetworkDelayMultiplier();
  }
  
  /**
   * Sets the network delay multiplier for this node
   */
  setNetworkDelayMultiplier(multiplier: number): void {
    this._node.setNetworkDelayMultiplier(multiplier);
  }
}


================================================================================
// FILE: types/receipt.ts
================================================================================

/**
 * Transaction Receipt - Ethereum-style
 * 
 * Minimal structure matching Ethereum's receipt format.
 * Stores the result of transaction execution.
 */

export interface TransactionReceipt {
  // Transaction identification
  transactionHash: string;        // Hash of the transaction
  transactionIndex: number;        // Index in the block
  blockHash: string;               // Hash of the block containing this tx
  blockNumber: number;             // Block number
  
  // Transaction parties
  from: string;                    // Sender address
  to: string | null;               // Recipient address (null for contract creation)
  
  // Execution result
  status: 0 | 1;                   // 0 = failure/reverted, 1 = success
  
  // Gas (simplified for now, can expand later for PoS)
  gasUsed: number;                 // Gas consumed by this transaction
  cumulativeGasUsed: number;       // Total gas used in block up to this tx
  
  // Contract creation
  contractAddress: string | null;  // Address of created contract (if any)
  
  // Logs/Events (empty array for now, can add later)
  logs: any[];                     // Event logs emitted (empty for now)
  
  // Revert reason (if failed)
  revertReason?: string;           // Why the transaction failed
}

/**
 * Receipts Database - Part of chaindata
 * 
 * Organized by block hash, then transaction hash.
 * In real Ethereum, this would be a Merkle Patricia Trie.
 */
export interface ReceiptsDatabase {
  [blockHash: string]: {
    [txHash: string]: TransactionReceipt;
  };
}


================================================================================
// FILE: types/types.ts
================================================================================

/**
 * Core type definitions for the Ethereum simulator
 */

// ============================================================================
// Ethereum Account Model Types
// ============================================================================

/**
 * Ethereum-style transaction with single from/to addresses
 */
export interface EthereumTransaction {
  from: string;           // Sender address (sha256 of publicKey)
  to: string;             // Recipient address (sha256 of publicKey or contract address)
  value: number;          // Amount to transfer (decimal ETH)
  nonce: number;          // Sender's transaction count (prevents replay attacks)
  data?: string;          // Contract call data
  publicKey: string;      // Sender's public key (proves from address)
  signature: string;      // Signature of transaction data (proves authorization)
  timestamp: number;      // When transaction was created
  txid: string;           // Transaction hash (required)
}

/**
 * Account in the world state
 * Can be either an Externally Owned Account (EOA) or a Contract Account
 */
export interface Account {
  address: string;        // Account address (sha256 of publicKey or contract address)
  balance: number;        // Account balance (decimal ETH)
  nonce: number;          // Transaction count (for replay protection)
  
  // Smart contract fields (undefined for EOAs)
  code?: string;          // Contract bytecode/code (if this is a contract account)
  storage?: any;          // Contract storage (arbitrary data structure)
  codeHash?: string;      // Hash of the contract code (for verification)
}

// ============================================================================
// Blockchain Types
// ============================================================================

export interface BlockHeader { // note: we dont have a field for headers hash, we compute that runtime upon validation to keep process robust
  transactionHash: string;  // SHA256 hash of all transactions
  timestamp: number;        // Local machine time
  previousHeaderHash: string; // Previous block's header hash
  ceiling?: number;         // Target threshold value (PoW only, not used in PoS)
  nonce?: number;           // Value miners adjust to find valid hash (PoW only, not used in PoS)
  height: number;           // Block height in the chain
  slot: number;             // PoS slot number when block was proposed
}

export interface Block {
  header: BlockHeader;
  transactions: EthereumTransaction[];
  attestations: Attestation[]; // Attestations for the previous block (PoS consensus)
  randaoReveal?: string; // BLS signature revealing proposer's RANDAO contribution for this epoch
  hash?: string;      // Calculated hash of the block header
}

export interface NodeState {
  nodeId: string;
  blockchain: Block[];
  blockchainTree?: any; // Optional blockchain tree for visualization
  beaconState?: any; // Optional beacon state (Consensus Layer)
  worldState: Record<string, Account>;
  receipts?: any; // Optional receipts database
  mempool?: EthereumTransaction[]; // Optional mempool for pending transactions
  consensusStatus?: 'idle' | 'validating' | 'proposing'; // PoS consensus activity status
  networkDelayMultiplier?: number; // Network delay multiplier for this node (1.0 = normal)
  peerIds: string[];
  publicKey: string;
  address: string;
}

/**
 * Attestation for Proof of Stake consensus
 * Validators attest to blocks they believe are valid
 */
export interface Attestation {
  validatorAddress: string;  // Address of the validator making the attestation
  blockHash: string;         // Hash of the block being attested to
  timestamp: number;         // When the attestation was created
}

/**
 * Information about a peer node
 */
export interface PeerInfo {
  address: string;
}

/**
 * Map of node IDs to peer information
 */
export interface PeerInfoMap {
  [nodeId: string]: PeerInfo; // Maps nodeId to peer information
}


================================================================================
// FILE: utils/cryptoUtils.ts
================================================================================

/**
 * Cryptographic utilities for the Bitcoin simulator
 * Implements all cryptographic operations including hashing, key generation, and signatures
 * Uses noble-secp256k1 for ECDSA operations and @noble/hashes for SHA-256
 */

import * as secp from 'noble-secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils';

// Re-export bytesToHex as-is
export { bytesToHex };

/**
 * Convert hex string to bytes, handling optional 0x prefix
 * Standardized to accept Ethereum-style hex strings with 0x prefix
 * @param hex Hex string with or without 0x prefix (e.g., '0x1234' or '1234')
 * @returns Uint8Array of bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  // Strip 0x prefix if present (Ethereum standard format)
  const cleanHex = hex.startsWith('0x') || hex.startsWith('0X') 
    ? hex.slice(2) 
    : hex;
  
  // Validate even length
  if (cleanHex.length % 2 !== 0) {
    throw new Error(`hex-string must have an even number of characters (got ${cleanHex.length})`);
  }
  
  return nobleHexToBytes(cleanHex);
}

/**
 * Signature input data for Ethereum transactions
 * 
 * We sign just the txid (transaction ID) because:
 * - txid = hash(from, to, value, nonce, timestamp)
 * - The txid cryptographically commits to all transaction data
 * - Signing the txid proves authorization of the complete transaction
 * - During validation, we verify both:
 *   1. hash(transaction_data) === txid (data integrity)
 *   2. signature is valid for txid (authorization)
 */
export type SignatureInput = string;  // Just the txid

/**
 * Hashes data with SHA-256
 * @param data The data to hash
 * @returns The hash as a hex string
 */
export const sha256Hash = (data: any): string => {
  // Convert the data to a JSON string for consistent hashing
  const stringData = typeof data === 'string' ? data : JSON.stringify(data);
  // Use noble-hashes for SHA-256 hashing
  const hashBytes = sha256(new TextEncoder().encode(stringData));
  return bytesToHex(hashBytes);
};

/**
 * Checks if a hash is below the ceiling (difficulty target)
 * @param hash The hash to check
 * @param ceiling The ceiling value (difficulty target)
 * @returns True if the hash is below the ceiling
 */
export const isHashBelowCeiling = (hash: string, ceiling: string): boolean => {
  // Ensure both strings are in the same format (remove 0x prefix if present)
  const normalizedHash = hash.replace('0x', '');
  const normalizedCeiling = ceiling.replace('0x', '');
  
  // Compare digit by digit from left to right
  for (let i = 0; i < normalizedHash.length && i < normalizedCeiling.length; i++) {
    const hashDigit = parseInt(normalizedHash[i], 16);
    const ceilingDigit = parseInt(normalizedCeiling[i], 16);
    
    if (hashDigit < ceilingDigit) return true;
    if (hashDigit > ceilingDigit) return false;
  }
  
  // If all digits match, consider them equal (not below)
  return false;
};

/**
 * Generates a private key from a node ID
 * @param nodeId The node ID to generate a private key for
 * @returns The private key as a hex string
 */
export function generatePrivateKey(nodeId: string): string {
  // Create a deterministic but seemingly random private key from the nodeId
  // In a real system, private keys would be randomly generated and securely stored
  const nodeIdBuffer = new TextEncoder().encode(nodeId + 'PRIVATE_KEY_SALT');
  const privateKeyBytes = sha256(nodeIdBuffer);
  return bytesToHex(privateKeyBytes);
}

/**
 * Derives a public key from a private key
 * @param privateKey The private key as a hex string
 * @returns The public key as a hex string
 */
export function derivePublicKey(privateKey: string): string {
  // Convert hex private key to bytes
  const privateKeyBytes = hexToBytes(privateKey);
  // Derive the public key from the private key using secp256k1
  const publicKeyBytes = secp.getPublicKey(privateKeyBytes, true); // true for compressed format
  return bytesToHex(publicKeyBytes);
}

/**
 * Generates an address from a public key
 * @param publicKey The public key as a hex string
 * @returns The address as a hex string
 */
export function generateAddress(publicKey: string): string {
  // In real Bitcoin, this would be: RIPEMD160(SHA256(publicKey))
  // For simplicity, we just use SHA256
  const publicKeyBytes = hexToBytes(publicKey);
  const addressBytes = sha256(publicKeyBytes);
  return bytesToHex(addressBytes);
}

/**
 * Generates a signature for transaction data
 * @param data The data to sign
 * @param privateKey The private key to sign with
 * @returns The signature as a hex string
 */
export async function generateSignature(data: SignatureInput, privateKey: string): Promise<string> {
  try {
    // Create a message hash from the transaction data
    const messageString = JSON.stringify(data);
    const messageHash = sha256(new TextEncoder().encode(messageString));
    
    // Sign the message hash with the private key
    const signatureBytes = await secp.sign(messageHash, privateKey);
    
    // Convert signature to hex string
    return bytesToHex(signatureBytes);
  } catch (error) {
    console.error('Error generating signature:', error);
    // Use a fallback signature in case of error
    return `error-${Date.now()}`;
  }
}

/**
 * Verifies a signature for transaction data
 * @param data The data that was signed
 * @param signature The signature to verify
 * @param publicKey The public key to verify against
 * @returns True if the signature is valid, false otherwise
 */
export async function verifySignature(
  data: SignatureInput, 
  signature: string, 
  publicKey: string
): Promise<boolean> {
  try {
    // If the signature starts with 'error-', it's an invalid signature
    if (signature.startsWith('error-')) {
      return false;
    }
    
    // Create message hash from the transaction data
    const messageString = JSON.stringify(data);
    const messageHash = sha256(new TextEncoder().encode(messageString));
    
    // Convert hex signature and public key to bytes
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey);
    
    // Verify the signature
    return await secp.verify(signatureBytes, messageHash, publicKeyBytes);
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

/**
 * Utility function to convert hex string to bytes
 * @param hex The hex string to convert
 * @returns The bytes as a Uint8Array
 */
export function hexToBuffer(hex: string): Buffer {
  const bytes = hexToBytes(hex);
  return Buffer.from(bytes);
}

/**
 * Utility function to convert bytes to hex string
 * @param buffer The buffer to convert
 * @returns The hex string
 */
export function bufferToHex(buffer: Buffer): string {
  return bytesToHex(new Uint8Array(buffer));
}

// ============================================================================
// BLS Signature Functions (BLS12-381)
// Used for Ethereum Proof of Stake consensus layer
// ============================================================================

// @ts-ignore - Library has type definitions but package.json exports issue
import { AugSchemeMPL, PrivateKey, JacobianPoint } from '@rigidity/bls-signatures';

/**
 * Generates a BLS key pair (private key and public key)
 * @returns Object containing privateKey and publicKey as hex strings
 * 
 * @example
 * const keyPair = generateBLSKeyPair();
 * console.log(keyPair.privateKey); // "a1b2c3..."
 * console.log(keyPair.publicKey);  // "d4e5f6..."
 */
export function generateBLSKeyPair(): { privateKey: string; publicKey: string } {
  // Generate random 32-byte seed
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  
  // Generate private key from seed
  const privateKey = PrivateKey.fromSeed(seed);
  
  // Derive public key
  const publicKey = privateKey.getG1();
  
  return {
    privateKey: privateKey.toHex(),
    publicKey: publicKey.toHex()
  };
}

/**
 * Generates a BLS signature for the given message
 * Uses AugSchemeMPL (Augmented Scheme) - more secure, used by Ethereum
 * 
 * @param message The message to sign (as string or Uint8Array)
 * @param privateKeyHex The BLS private key (hex string)
 * @returns The BLS signature as a hex string
 * 
 * @example
 * const keyPair = generateBLSKeyPair();
 * const message = "Hello, Ethereum!";
 * const signature = generateBLSSignature(message, keyPair.privateKey);
 */
export function generateBLSSignature(
  message: string | Uint8Array,
  privateKeyHex: string
): string {
  // Convert message to bytes if it's a string
  const messageBytes = typeof message === 'string' 
    ? new TextEncoder().encode(message)
    : message;
  
  // Convert private key from hex
  const privateKey = PrivateKey.fromHex(privateKeyHex);
  
  // Sign the message using AugSchemeMPL
  const signature = AugSchemeMPL.sign(privateKey, messageBytes);
  
  // Return signature as hex string
  return signature.toHex();
}

/**
 * Verifies a BLS signature (supports both single and aggregated signatures)
 * 
 * @param message The message that was signed (as string or Uint8Array)
 * @param signatureHex The BLS signature to verify (hex string)
 * @param publicKeyHex The BLS public key (hex string) or array of public keys for aggregated signatures
 * @returns True if the signature is valid, false otherwise
 * 
 * @example Single signature verification:
 * const keyPair = generateBLSKeyPair();
 * const message = "Hello!";
 * const signature = generateBLSSignature(message, keyPair.privateKey);
 * const isValid = verifyBLSSignature(message, signature, keyPair.publicKey);
 * // isValid = true
 * 
 * @example Aggregated signature verification:
 * // Multiple validators sign the same message
 * const validator1 = generateBLSKeyPair();
 * const validator2 = generateBLSKeyPair();
 * const validator3 = generateBLSKeyPair();
 * const message = "Block attestation";
 * 
 * const sig1 = generateBLSSignature(message, validator1.privateKey);
 * const sig2 = generateBLSSignature(message, validator2.privateKey);
 * const sig3 = generateBLSSignature(message, validator3.privateKey);
 * 
 * // Aggregate the signatures
 * const aggregatedSig = aggregateBLSSignatures([sig1, sig2, sig3]);
 * 
 * // Verify with all public keys
 * const publicKeys = [validator1.publicKey, validator2.publicKey, validator3.publicKey];
 * const isValid = verifyBLSSignature(message, aggregatedSig, publicKeys);
 * // isValid = true
 */
export function verifyBLSSignature(
  message: string | Uint8Array,
  signatureHex: string,
  publicKeyHex: string | string[]
): boolean {
  try {
    // Convert message to bytes if it's a string
    const messageBytes = typeof message === 'string'
      ? new TextEncoder().encode(message)
      : message;
    
    // Convert signature from hex
    const signature = JacobianPoint.fromHexG2(signatureHex);
    
    // Handle single or aggregated public keys
    if (Array.isArray(publicKeyHex)) {
      // Aggregated verification: multiple signers on the same message
      const publicKeys = publicKeyHex.map(pk => JacobianPoint.fromHexG1(pk));
      
      // Aggregate public keys by summing points
      let aggregatedPublicKey = publicKeys[0];
      for (let i = 1; i < publicKeys.length; i++) {
        aggregatedPublicKey = aggregatedPublicKey.add(publicKeys[i]);
      }
      
      // Verify with aggregated public key
      return AugSchemeMPL.verify(aggregatedPublicKey, messageBytes, signature);
    } else {
      // Single signature verification
      const publicKey = JacobianPoint.fromHexG1(publicKeyHex);
      return AugSchemeMPL.verify(publicKey, messageBytes, signature);
    }
  } catch (error) {
    console.error('Error verifying BLS signature:', error);
    return false;
  }
}

/**
 * Aggregates multiple BLS signatures into a single signature
 * This is the key feature of BLS - constant-size aggregated signatures
 * 
 * @param signatureHexArray Array of BLS signatures (hex strings)
 * @returns The aggregated signature as a hex string
 * 
 * @example
 * // 100 validators sign the same message
 * const validators = Array.from({ length: 100 }, () => generateBLSKeyPair());
 * const message = "Epoch 42 attestation";
 * const signatures = validators.map(v => generateBLSSignature(message, v.privateKey));
 * 
 * // Aggregate all 100 signatures into one
 * const aggregatedSig = aggregateBLSSignatures(signatures);
 * 
 * // Verify with all 100 public keys
 * const publicKeys = validators.map(v => v.publicKey);
 * const isValid = verifyBLSSignature(message, aggregatedSig, publicKeys);
 * // isValid = true
 * 
 * // Space savings: 100 signatures → 1 signature (constant size!)
 */
export function aggregateBLSSignatures(signatureHexArray: string[]): string {
  if (signatureHexArray.length === 0) {
    throw new Error('Cannot aggregate empty signature array');
  }
  
  if (signatureHexArray.length === 1) {
    return signatureHexArray[0];
  }
  
  // Convert all signatures from hex
  const signatures = signatureHexArray.map(sig => JacobianPoint.fromHexG2(sig));
  
  // Aggregate signatures using the library's aggregate function
  const aggregated = AugSchemeMPL.aggregate(signatures);
  
  return aggregated.toHex();
}

// ============================================================================
// RANDAO Helper Functions
// Used for validator scheduling and randomness
// ============================================================================

/**
 * Convert number to 8-byte big-endian representation
 * @param n The number to convert
 * @returns 8-byte Uint8Array in big-endian format
 */
export function i2b8(n: number): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    b[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return b;
}

/**
 * Concatenate multiple byte arrays
 * @param parts Variable number of Uint8Array to concatenate
 * @returns Single concatenated Uint8Array
 */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Parse 8 bytes as big-endian unsigned 64-bit integer
 * Returns as JS number (safe for modulo operations)
 * @param b The byte array to parse
 * @param offset Starting offset in the array
 * @returns Parsed number
 */
export function u64(b: Uint8Array, offset = 0): number {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    n = (n * 256 + (b[offset + i] ?? 0)) >>> 0;
  }
  return n >>> 0;
}

/**
 * XOR two hex strings byte-by-byte
 * @param hex1 First hex string
 * @param hex2 Second hex string
 * @returns XOR result as hex string
 */
export function xorHexStrings(hex1: string, hex2: string): string {
  // Remove 0x prefix if present
  const h1 = hex1.startsWith('0x') ? hex1.slice(2) : hex1;
  const h2 = hex2.startsWith('0x') ? hex2.slice(2) : hex2;
  
  // Ensure both strings are same length
  const maxLen = Math.max(h1.length, h2.length);
  const padded1 = h1.padStart(maxLen, '0');
  const padded2 = h2.padStart(maxLen, '0');
  
  let result = '';
  for (let i = 0; i < maxLen; i++) {
    const xor = parseInt(padded1[i], 16) ^ parseInt(padded2[i], 16);
    result += xor.toString(16);
  }
  return result;
}

/**
 * Hash bytes using SHA-256
 * @param bytes - Bytes to hash
 * @returns Hash as Uint8Array
 */
export function hashBytes(bytes: Uint8Array): Uint8Array {
  // Convert bytes to hex string for sha256Hash function
  const hexString = bytesToHex(bytes);
  
  // Use SHA-256
  const hashHex = sha256Hash(hexString);
  
  // Convert back to bytes
  return hexToBytes(hashHex);
}


================================================================================
// FILE: utils/nodeColorUtils.ts
================================================================================

/**
 * Utility functions for determining node paint colors
 */

export const PAINT_COLORS = ['blue', 'green', 'red', 'yellow'] as const;
export type PaintColorName = typeof PAINT_COLORS[number];

/**
 * Color emojis for visual display
 */
export const COLOR_EMOJIS: Record<PaintColorName, string> = {
  blue: '🔵',
  green: '🟢',
  red: '🔴',
  yellow: '🟡'
};

/**
 * CSS color values for styling
 */
export const COLOR_CSS: Record<PaintColorName, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308'
};

/**
 * Static map of node IDs to paint colors
 */
const NODE_COLOR_MAP: Record<string, PaintColorName> = {
  'Blue': 'blue',
  'Green': 'green',
  'Red': 'red',
  'Yellow': 'yellow'
};

/**
 * Get the deterministic paint color for a node based on its ID
 */
export function getNodePaintColor(nodeId: string): PaintColorName {
  // Use static map if available, otherwise default to blue
  return NODE_COLOR_MAP[nodeId] || 'blue';
}

/**
 * Get the color emoji for a node
 */
export function getNodeColorEmoji(nodeId: string): string {
  const color = getNodePaintColor(nodeId);
  return COLOR_EMOJIS[color];
}

/**
 * Get the CSS color value for a node
 */
export function getNodeColorCSS(nodeId: string): string {
  const color = getNodePaintColor(nodeId);
  return COLOR_CSS[color];
}

/**
 * Get a subtle background tint color for a node panel
 * Uses a base gray with a transparent color overlay for easy tuning
 */
export function getNodeBackgroundTint(nodeId: string): string {
  const color = getNodePaintColor(nodeId);
  
  // Base light gray background color (lighter than the dark app background)
  const BASE_GRAY = 'rgb(49, 49, 49)';
  
  // Opacity for color overlay (tune this single value to adjust all tints)
  const COLOR_OPACITY = 0.01;
  
  // Color overlays with tunable opacity
  const COLOR_OVERLAYS: Record<PaintColorName, string> = {
    blue: `rgba(59, 130, 246, ${COLOR_OPACITY})`,
    green: `rgba(34, 197, 94, ${COLOR_OPACITY})`,
    red: `rgba(239, 68, 68, ${COLOR_OPACITY})`,
    yellow: `rgba(234, 179, 8, ${COLOR_OPACITY})`
  };
  
  // Create a linear-gradient that overlays the color on top of gray
  // This allows easy tuning via the COLOR_OPACITY constant
  return `linear-gradient(${COLOR_OVERLAYS[color]}, ${COLOR_OVERLAYS[color]}), ${BASE_GRAY}`;
}


================================================================================
// FILE: utils/nodeIdGenerator.ts
================================================================================

/**
 * Utility for generating memorable node IDs using color names
 */

// Color names for node IDs (matches paint colors)
const NODE_NAMES = [
  'Blue', 'Green', 'Red', 'Yellow'
];

/**
 * Generates a random node ID using a color name
 */
export function generateNodeId(): string {
  // Pick a random color name
  const randomIndex = Math.floor(Math.random() * NODE_NAMES.length);
  return NODE_NAMES[randomIndex];
}

/**
 * Generates an array of unique node IDs
 * @throws Error if count exceeds the number of available node names
 */
export function generateUniqueNodeIds(count: number): string[] {
  if (count > NODE_NAMES.length) {
    throw new Error(`Cannot generate more than ${NODE_NAMES.length} unique node IDs without duplicates`);
  }
  
  // Simply take the first N color names
  // This ensures deterministic naming: first node is Blue, second is Green, etc.
  return NODE_NAMES.slice(0, count);
}


================================================================================
// FILE: vite-env.d.ts
================================================================================

/// <reference types="vite/client" />

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

