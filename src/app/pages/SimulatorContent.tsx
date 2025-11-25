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
