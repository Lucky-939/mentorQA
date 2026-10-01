/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const, react-hooks/exhaustive-deps */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  name: string;
  type: string;
  file: string;
  layer?: string;
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

interface DependencyGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: any[]; // Architectural findings to cross-reference
}

export default function DependencyGraph({ nodes, edges, findings }: DependencyGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Cross-reference findings to nodes
  const nodeFindings = (nodeFile: string) => {
    return findings.filter(f => f.file === nodeFile && f.category === 'architecture');
  };

  useEffect(() => {
    if (!svgRef.current || !wrapperRef.current) return;
    if (nodes.length === 0) return;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const width = wrapperRef.current.clientWidth || 800;
    const height = 600;

    // Cap node rendering
    const maxNodes = 300;
    let renderNodes = nodes;
    let renderEdges = edges;
    
    if (nodes.length > maxNodes) {
      // Basic approach: sort by degree to keep most connected
      const degrees: Record<string, number> = {};
      nodes.forEach(n => degrees[n.id] = 0);
      edges.forEach(e => {
        if (degrees[e.source] !== undefined) degrees[e.source]++;
        if (degrees[e.target] !== undefined) degrees[e.target]++;
      });
      renderNodes = [...nodes].sort((a, b) => degrees[b.id] - degrees[a.id]).slice(0, maxNodes);
      const renderNodeIds = new Set(renderNodes.map(n => n.id));
      renderEdges = edges.filter(e => renderNodeIds.has(e.source) && renderNodeIds.has(e.target));
    }

    // deep copy for D3 simulation
    const simNodes = renderNodes.map(d => Object.create(d));
    const simEdges = renderEdges.map(d => Object.create(d));

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);
    const g = svg.append('g');

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(simEdges).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(30));

    // Links
    const link = g.append('g')
      .attr('stroke', '#4b5563')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke-width', 2);

    // Nodes
    const nodeGroup = g.append('g')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .selectAll('g')
      .data(simNodes)
      .join('g')
      .call(drag(simulation) as any)
      .on('click', (event, d) => {
        setSelectedNode(d as GraphNode);
      });

    nodeGroup.append('circle')
      .attr('r', 10)
      .attr('fill', '#0a0a0a') // brutal-bg equivalent
      .attr('stroke', (d: any) => {
        const flawFindings = nodeFindings(d.file);
        if (flawFindings.length > 0) {
          // find highest severity
          const hasHigh = flawFindings.some(f => f.severity === 'high');
          const hasCritical = flawFindings.some(f => f.severity === 'critical');
          if (hasCritical) return '#dc2626'; // red-600
          if (hasHigh) return '#ef4444'; // red-500
          return '#f97316'; // orange-500 for medium
        }
        return '#4b5563'; // brutal-border
      })
      .attr('stroke-width', (d: any) => nodeFindings(d.file).length > 0 ? 3 : 2)
      .attr('stroke-dasharray', (d: any) => {
        if (d.layer === 'controller') return 'none'; // Solid
        if (d.layer === 'service') return '4,4'; // Dashed
        if (d.layer === 'repository') return '1,3'; // Dotted
        return 'none';
      });

    nodeGroup.append('text')
      .text((d: any) => d.name)
      .attr('x', 14)
      .attr('y', 4)
      .attr('fill', '#d1d5db')
      .attr('stroke', 'none')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace');

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      nodeGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, findings]);

  function drag(simulation: any) {
    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }

  return (
    <div className="flex flex-col gap-4">
      {nodes.length > 300 && (
        <div className="bg-yellow-900/50 text-yellow-200 p-2 border border-yellow-700 text-xs font-mono">
          Graph too large ({nodes.length} nodes). Showing top 300 by connectivity.
        </div>
      )}
      <div className="flex gap-4">
        {/* Graph Container */}
        <div ref={wrapperRef} className="flex-1 border border-brutal-border bg-black min-h-[600px]">
          <svg ref={svgRef}></svg>
        </div>

        {/* Side Panel */}
        {selectedNode && (
          <div className="w-80 border border-brutal-border bg-brutal-panel p-4 flex flex-col gap-4 font-mono text-sm h-[600px] overflow-y-auto">
            <h3 className="font-bold text-brutal-primary uppercase border-b border-brutal-border pb-2">
              Node Details
            </h3>
            <div>
              <span className="text-gray-400">Name: </span>
              <span className="text-white">{selectedNode.name}</span>
            </div>
            <div>
              <span className="text-gray-400">Type: </span>
              <span className="text-white">{selectedNode.type}</span>
            </div>
            <div>
              <span className="text-gray-400">Layer: </span>
              <span className="text-white">{selectedNode.layer || 'unknown'}</span>
            </div>
            <div>
              <span className="text-gray-400">File: </span>
              <span className="text-white break-all">{selectedNode.file}</span>
            </div>
            
            {nodeFindings(selectedNode.file).length > 0 && (
              <div className="mt-4">
                <h4 className="font-bold text-red-500 uppercase mb-2">Architectural Findings</h4>
                <div className="flex flex-col gap-2">
                  {nodeFindings(selectedNode.file).map(f => (
                    <div key={f.id} className="border border-red-500 bg-red-900/20 p-2 text-xs">
                      <div className="text-red-400 font-bold">{f.ruleId}</div>
                      <div className="text-white mt-1">{f.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-6 mt-4 text-xs font-mono text-gray-400 border border-brutal-border p-3 bg-brutal-panel">
        <div className="font-bold text-white uppercase mr-2">Legend:</div>
        <div className="flex items-center gap-2">
          <div className="w-6 border-t-2 border-gray-400 border-solid"></div>
          <span>Controller (Solid)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 border-t-2 border-gray-400 border-dashed"></div>
          <span>Service (Dashed)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 border-t-2 border-gray-400 border-dotted"></div>
          <span>Repository (Dotted)</span>
        </div>
      </div>
    </div>
  );
}
