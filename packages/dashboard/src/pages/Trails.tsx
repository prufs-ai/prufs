import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'
import * as d3 from 'd3'

// --- Types ---

interface TrailNode {
  id: string
  type: 'Directive' | 'Interpretation' | 'Decision' | 'Constraint' | 'Implementation' | 'Verification'
  text: string
  signer_id?: string
  timestamp: string
}

interface TrailEdge {
  source: string
  target: string
  type: string
}

interface Trail {
  trail_id: string
  root_directive: string
  sensitivity: string
  created_at: string
  integrity: 'verified' | 'tampered' | 'broken'
  nodes: TrailNode[]
  edges: TrailEdge[]
}

interface TrailSummary {
  trail_id: string
  root_directive: string
  sensitivity: string
  created_at: string
  integrity: 'verified' | 'tampered' | 'broken'
}

// --- Constants ---

const NODE_COLORS: Record<string, string> = {
  Directive: '#3B82F6',
  Interpretation: '#8B5CF6',
  Decision: '#F59E0B',
  Constraint: '#EF4444',
  Implementation: '#10B981',
  Verification: '#06B6D4',
}

const SENSITIVITY_OPTIONS = ['all', 'low', 'medium', 'high', 'critical']
const NODE_TYPE_OPTIONS = ['all', 'Directive', 'Interpretation', 'Decision', 'Constraint', 'Implementation', 'Verification']

// --- Components ---

function IntegrityBadge({ integrity }: { integrity: string }) {
  const styles: Record<string, string> = {
    verified: 'bg-success/20 text-green-400',
    tampered: 'bg-danger/20 text-red-400',
    broken: 'bg-warning/20 text-yellow-400',
  }
  return (
    <span className={"inline-block px-2 py-0.5 text-xs font-medium rounded-full " + (styles[integrity] || 'bg-gray-700 text-gray-400')}>
      {integrity}
    </span>
  )
}

function SensitivityBadge({ sensitivity }: { sensitivity: string }) {
  const styles: Record<string, string> = {
    low: 'bg-green-900/30 text-green-400',
    medium: 'bg-yellow-900/30 text-yellow-400',
    high: 'bg-orange-900/30 text-orange-400',
    critical: 'bg-red-900/30 text-red-400',
  }
  return (
    <span className={"inline-block px-2 py-0.5 text-xs font-medium rounded-full " + (styles[sensitivity] || 'bg-gray-700 text-gray-400')}>
      {sensitivity}
    </span>
  )
}

// --- D3 Force Graph ---

interface GraphProps {
  trail: Trail
  onNodeSelect: (node: TrailNode | null) => void
}

function ForceGraph({ trail, onNodeSelect }: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !trail.nodes.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    const g = svg.append('g')

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svg.call(zoom)

    // Build simulation data
    const nodes = trail.nodes.map((n) => ({ ...n })) as (TrailNode & d3.SimulationNodeDatum)[]
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const links = trail.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }))

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(30))

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#374151')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6)

    // Edge labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('font-size', '9px')
      .attr('fill', '#6B7280')
      .attr('text-anchor', 'middle')
      .text((d: any) => d.type)

    // Nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', 14)
      .attr('fill', (d: any) => NODE_COLORS[d.type] || '#6B7280')
      .attr('stroke', '#1B2A4A')
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .on('click', (_event: any, d: any) => {
        const original = trail.nodes.find((n) => n.id === d.id)
        onNodeSelect(original || null)
      })
      .call(d3.drag<SVGCircleElement, any>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null
          d.fy = null
        }) as any
      )

    // Node labels
    const nodeLabel = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('font-size', '10px')
      .attr('fill', '#D1D5DB')
      .attr('text-anchor', 'middle')
      .attr('dy', 28)
      .text((d: any) => d.type.slice(0, 4))

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2)

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y)

      nodeLabel
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y)
    })

    return () => { simulation.stop() }
  }, [trail, onNodeSelect])

  return (
    <svg ref={svgRef} className="w-full h-full" />
  )
}

// --- Main Trails Page ---

export default function Trails() {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const [selectedTrailId, setSelectedTrailId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<TrailNode | null>(null)
  const [sensitivity, setSensitivity] = useState('all')
  const [nodeType, setNodeType] = useState('all')
  const [search, setSearch] = useState('')

  const { data: trails, isLoading: trailsLoading } = useQuery({
    queryKey: ['trails', orgSlug, sensitivity],
    queryFn: () => {
      const params = sensitivity !== 'all' ? '?sensitivity=' + sensitivity : ''
      return apiFetch<TrailSummary[]>('/v1/trails' + params)
    },
  })

  const { data: activeTrail } = useQuery({
    queryKey: ['trail', selectedTrailId],
    queryFn: () => apiFetch<Trail>('/v1/trails/' + selectedTrailId),
    enabled: !!selectedTrailId,
  })

  const handleNodeSelect = useCallback((node: TrailNode | null) => {
    setSelectedNode(node)
  }, [])

  const filteredTrails = trails?.filter((t) => {
    if (search && !t.root_directive.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Trail list */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-3">
        <h1 className="text-xl font-bold text-white">Trails</h1>

        {/* Filter bar */}
        <input
          type="text"
          placeholder="Search trails..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-navy-light"
        />
        <div className="flex gap-2">
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value)}
            className="flex-1 bg-navy-light/40 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none"
          >
            {SENSITIVITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All sensitivity' : s}</option>
            ))}
          </select>
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
            className="flex-1 bg-navy-light/40 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none"
          >
            {NODE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
            ))}
          </select>
        </div>

        {/* Trail list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {trailsLoading ? (
            <p className="text-gray-500 text-sm">Loading trails...</p>
          ) : filteredTrails && filteredTrails.length > 0 ? (
            filteredTrails.map((t) => (
              <button
                key={t.trail_id}
                onClick={() => { setSelectedTrailId(t.trail_id); setSelectedNode(null) }}
                className={"w-full text-left px-3 py-2 rounded-lg border transition-colors " + (
                  selectedTrailId === t.trail_id
                    ? 'border-navy-light bg-navy-light/30'
                    : 'border-transparent hover:bg-navy-light/20'
                )}
              >
                <p className="text-sm text-white truncate">{t.root_directive}</p>
                <div className="flex items-center gap-2 mt-1">
                  <SensitivityBadge sensitivity={t.sensitivity} />
                  <IntegrityBadge integrity={t.integrity} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{new Date(t.created_at).toLocaleDateString()}</p>
              </button>
            ))
          ) : (
            <p className="text-gray-500 text-sm">No trails found.</p>
          )}
        </div>
      </div>

      {/* Center: D3 graph */}
      <div className="flex-1 flex flex-col bg-navy-light/20 border border-gray-700 rounded-xl overflow-hidden">
        {activeTrail ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white truncate max-w-md">{activeTrail.root_directive}</span>
                <IntegrityBadge integrity={activeTrail.integrity} />
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 text-xs bg-navy-light/40 border border-gray-700 rounded text-gray-400 hover:text-white">JSON</button>
                <button className="px-2 py-1 text-xs bg-navy-light/40 border border-gray-700 rounded text-gray-400 hover:text-white">SVG</button>
                <button className="px-2 py-1 text-xs bg-navy-light/40 border border-gray-700 rounded text-gray-400 hover:text-white">PDF</button>
              </div>
            </div>
            <div className="flex-1">
              <ForceGraph trail={activeTrail} onNodeSelect={handleNodeSelect} />
            </div>
            {/* Node type legend */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-700">
              {Object.entries(NODE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-500">{type}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-500 text-sm">Select a trail to visualize its causal graph.</p>
          </div>
        )}
      </div>

      {/* Right: Node detail drawer */}
      {selectedNode && (
        <div className="w-80 flex-shrink-0 bg-navy-light/30 border border-gray-700 rounded-xl p-4 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Node detail</h2>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-white text-sm"
            >
              Close
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Type</p>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS[selectedNode.type] }} />
                <span className="text-gray-300">{selectedNode.type}</span>
              </div>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ID</p>
              <p className="font-mono text-gray-300 text-xs">{selectedNode.id}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Content</p>
              <p className="text-gray-300">{selectedNode.text}</p>
            </div>
            {selectedNode.signer_id && (
              <div>
                <p className="text-gray-500 text-xs">Signer</p>
                <p className="font-mono text-gray-300 text-xs">{selectedNode.signer_id}</p>
              </div>
            )}
            <div>
              <p className="text-gray-500 text-xs">Timestamp</p>
              <p className="text-gray-300">{new Date(selectedNode.timestamp).toLocaleString()}</p>
            </div>

            {/* Connected edges */}
            {activeTrail && (
              <div>
                <p className="text-gray-500 text-xs mb-1">Edges</p>
                <div className="space-y-1">
                  {activeTrail.edges
                    .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                    .map((e, i) => (
                      <div key={i} className="text-xs text-gray-400 font-mono">
                        {e.source === selectedNode.id ? 'out' : 'in'}: {e.type} {e.source === selectedNode.id ? '-> ' + e.target.slice(0, 8) : '<- ' + e.source.slice(0, 8)}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
