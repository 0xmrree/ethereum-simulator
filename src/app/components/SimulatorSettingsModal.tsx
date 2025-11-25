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
