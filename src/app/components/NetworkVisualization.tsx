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
