/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Delaunay } from 'd3-delaunay';
import { Map as MapIcon, Flag, Shield, Activity, Share2, Layers, Compass, Info, Target } from 'lucide-react';

// Types
interface Point {
  x: number;
  y: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
}

interface Edge {
  u: number;
  v: number;
  weight: number;
}

// Grid constants
const GRID_SIZE = 17;
const CELL_SIZE = 34; // Adjusted to fit nicely in the 600px canvas container roughly (17 * 34 = 578)
const WIDTH = GRID_SIZE * CELL_SIZE;
const HEIGHT = GRID_SIZE * CELL_SIZE;

// Original user data
const START: Point = { x: 2, y: 14 };
const START2: Point = { x: 2, y: 3 };
const GOAL: Point = { x: 13, y: 2 };

const OBSTACLES: Obstacle[] = [
  { x: 5, y: 17, w: 2, h: 2, name: "Alpha 区域" },
  { x: 3, y: 12, w: 6, h: 2, name: "屏障 B" },
  { x: 4, y: 9, w: 1, h: 1, name: "塔 04" },
  { x: 6, y: 9, w: 1, h: 1, name: "塔 06" },
  { x: 4, y: 7, w: 1, h: 1, name: "塔 07" },
  { x: 6, y: 7, w: 1, h: 1, name: "塔 09" },
  { x: 4, y: 5, w: 2, h: 5, name: "西侧区块" },
  { x: 13, y: 17, w: 1, h: 7, name: "东侧柱体" },
  { x: 11, y: 6, w: 6, h: 2, name: "矮墙" },
  { x: 16, y: 15, w: 1, h: 2, name: "边界卫兵" },
];

// Utility Functions
const isSafe = (p: Point) => {
    const margin = 0.05; 
    return !OBSTACLES.some(obs => 
      p.x >= obs.x - margin && p.x <= obs.x + obs.w + margin &&
      p.y >= obs.y - obs.h - margin && p.y <= obs.y + margin
    );
};

const isSafeLine = (p1: Point, p2: Point) => {
    const dist = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
    const steps = Math.max(10, Math.ceil(dist * 6)); 
    for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const p = {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t
        };
        if (!isSafe(p)) return false;
    }
    return true;
};

const dijkstra = (nodes: Point[], edges: Edge[], startIdx: number, goalIdx: number) => {
    const dists = Array(nodes.length).fill(Infinity);
    const prev = Array(nodes.length).fill(null);
    dists[startIdx] = 0;
    const unvisited = new Set(nodes.keys());

    while (unvisited.size > 0) {
        let u: number | null = null;
        for (const i of unvisited) { if (u === null || dists[i] < dists[u]) u = i; }
        if (u === null || dists[u] === Infinity) break;
        unvisited.delete(u);
        if (u === goalIdx) break;

        edges.forEach(e => {
            if (e.u === u && unvisited.has(e.v)) {
                const alt = dists[u!] + e.weight;
                if (alt < dists[e.v]) { dists[e.v] = alt; prev[e.v] = u; }
            } else if (e.v === u && unvisited.has(e.u)) {
                const alt = dists[u!] + e.weight;
                if (alt < dists[e.u]) { dists[e.u] = alt; prev[e.u] = u; }
            }
        });
    }

    const path: Point[] = [];
    let curr = goalIdx;
    while (curr !== null) { path.push(nodes[curr]); curr = prev[curr]; }
    path.reverse();
    return path.length > 1 ? path : [];
};

export default function App() {
  const [showVoronoi, setShowVoronoi] = useState(true);
  const [animatePath, setAnimatePath] = useState(true);
  const [hoveredObstacles, setHoveredObstacles] = useState<number[]>([]);
  const [prmSeed, setPrmSeed] = useState(0); // For re-sampling

  // --- Logic ---

  // Generate Voronoi Roadmap
  const voronoiData = useMemo(() => {
    const generators: [number, number][] = [];
    const generatorOwner: number[] = []; 

    OBSTACLES.forEach((obs, obsIdx) => {
      const steps = 6; 
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        generators.push([obs.x + t * obs.w, obs.y]); generatorOwner.push(obsIdx);
        generators.push([obs.x + t * obs.w, obs.y - obs.h]); generatorOwner.push(obsIdx);
        generators.push([obs.x, obs.y - t * obs.h]); generatorOwner.push(obsIdx);
        generators.push([obs.x + obs.w, obs.y - t * obs.h]); generatorOwner.push(obsIdx);
      }
    });

    const boundarySteps = 10;
    for (let i = 0; i <= boundarySteps; i++) {
      const t = i / boundarySteps;
      generators.push([ 0, t * GRID_SIZE]); generatorOwner.push(-1);
      generators.push([ GRID_SIZE, t * GRID_SIZE]); generatorOwner.push(-1);
      generators.push([ t * GRID_SIZE, 0]); generatorOwner.push(-1);
      generators.push([ t * GRID_SIZE, GRID_SIZE]); generatorOwner.push(-1);
    }

    const delaunay = Delaunay.from(generators);
    const voronoi = delaunay.voronoi([-2, -2, GRID_SIZE + 2, GRID_SIZE + 2]);

    const nodes: Point[] = [];
    const edges: Edge[] = [];
    const vertexMap = new Map<string, number>();
    const vEdgesList: { p1: Point; p2: Point; owners: number[] }[] = [];

    const circumcenters = voronoi.circumcenters; 
    
    for (let i = 0; i < delaunay.halfedges.length; i++) {
        const j = delaunay.halfedges[i];
        if (j < i || j < 0) continue; 
        const ti = Math.floor(i / 3);
        const tj = Math.floor(j / 3);
        
        const p1 = { x: circumcenters[ti * 2], y: circumcenters[ti * 2 + 1] };
        const p2 = { x: circumcenters[tj * 2], y: circumcenters[tj * 2 + 1] };

        const inBounds = (p: Point) => p.x >= -1 && p.x <= GRID_SIZE + 1 && p.y >= -1 && p.y <= GRID_SIZE + 1;
        if (!inBounds(p1) && !inBounds(p2)) continue;

        if (isSafe(p1) && isSafe(p2) && isSafeLine(p1, p2)) {
            const siteA = delaunay.triangles[i];
            const siteB = delaunay.triangles[j];
            const owners = [generatorOwner[siteA], generatorOwner[siteB]].filter(o => o !== -1);
            
            vEdgesList.push({ p1, p2, owners: Array.from(new Set(owners)) });
            const s1 = `${p1.x.toFixed(3)},${p1.y.toFixed(3)}`;
            const s2 = `${p2.x.toFixed(3)},${p2.y.toFixed(3)}`;
            if (!vertexMap.has(s1)) { vertexMap.set(s1, nodes.length); nodes.push(p1); }
            if (!vertexMap.has(s2)) { vertexMap.set(s2, nodes.length); nodes.push(p2); }
            const u = vertexMap.get(s1)!;
            const v = vertexMap.get(s2)!;
            const dist = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
            edges.push({ u, v, weight: dist });
        }
    }

    const startIdx = nodes.length;
    nodes.push(START);
    const goalIdx = nodes.length;
    nodes.push(GOAL);

    [startIdx, goalIdx].forEach(idx => {
        const p = nodes[idx];
        nodes.forEach((target, tidx) => {
            if (tidx >= startIdx) return;
            const dist = Math.sqrt((p.x - target.x)**2 + (p.y - target.y)**2);
            if (dist > 12) return; 
            if (isSafeLine(p, target)) edges.push({ u: idx, v: tidx, weight: dist });
        });
    });

    const path = dijkstra(nodes, edges, startIdx, goalIdx);

    return { 
        voronoiEdges: vEdgesList, 
        shortestPath: path, 
        vertices: nodes.slice(0, startIdx),
        totalDist: path.reduce((acc, p, i) => i === 0 ? 0 : acc + Math.sqrt((p.x - path[i-1].x)**2 + (p.y - path[i-1].y)**2), 0)
    };
  }, []);

  // PRM Roadmap Logic
  const prmData = useMemo(() => {
    const NUM_SAMPLES = 250;
    const K_NEIGHBORS = 8;
    const nodes: Point[] = [];
    const edges: Edge[] = [];

    // 1. Sampling - stable "random" pseudo-sampling for consistent UI
    const rand = (i: number) => {
        const x = Math.sin(i * 12.9898 + prmSeed) * 43758.5453;
        return x - Math.floor(x);
    };

    for (let i = 0; i < NUM_SAMPLES; i++) {
        const p = { x: rand(i * 2) * GRID_SIZE, y: rand(i * 2 + 1) * GRID_SIZE };
        if (isSafe(p)) nodes.push(p);
    }

    // 2. Connectivity
    nodes.forEach((node, i) => {
        const distances = nodes.map((target, j) => ({
            index: j,
            dist: Math.sqrt((node.x - target.x)**2 + (node.y - target.y)**2)
        })).filter(d => d.index !== i).sort((a, b) => a.dist - b.dist);

        for (let k = 0; k < Math.min(K_NEIGHBORS, distances.length); k++) {
            const neighborIdx = distances[k].index;
            const neighbor = nodes[neighborIdx];
            if (isSafeLine(node, neighbor)) {
                edges.push({ u: i, v: neighborIdx, weight: distances[k].dist });
            }
        }
    });

    const startIdx = nodes.length;
    nodes.push(START2);
    const goalIdx = nodes.length;
    nodes.push(GOAL);

    [startIdx, goalIdx].forEach(idx => {
        const p = nodes[idx];
        const distances = nodes.map((target, j) => ({
            index: j,
            dist: Math.sqrt((p.x - target.x)**2 + (p.y - target.y)**2)
        })).filter((d, j) => j < startIdx).sort((a, b) => a.dist - b.dist);

        for (let k = 0; k < Math.min(15, distances.length); k++) {
            const neighborIdx = distances[k].index;
            if (isSafeLine(p, nodes[neighborIdx])) {
                edges.push({ u: idx, v: neighborIdx, weight: distances[k].dist });
            }
        }
    });

    const path = dijkstra(nodes, edges, startIdx, goalIdx);

    return {
        nodes,
        edges,
        path,
        samples: nodes.slice(0, startIdx),
        totalDist: path.reduce((acc, p, i) => i === 0 ? 0 : acc + Math.sqrt((p.x - path[i-1].x)**2 + (p.y - path[i-1].y)**2), 0)
    };
  }, [prmSeed]);

  // Map coordinates
  const mapX = (x: number) => x * CELL_SIZE;
  const mapY = (y: number) => (GRID_SIZE - y) * CELL_SIZE;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] text-[#334155] font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-indigo-200">
            <Compass className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Pathfinder Spatial Analyzer</h1>
        </div>
        <div className="flex items-center space-x-4 text-sm font-medium">
          <span className="flex items-center px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-100">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
            系统就绪
          </span>
          <span className="px-3 py-1 bg-slate-100 rounded-full text-slate-500 border border-slate-200 font-mono">
            栅格: 17 &times; 17
          </span>
          
          <div className="h-6 w-px bg-slate-200 mx-2" />
          
          <button 
            onClick={() => setShowVoronoi(!showVoronoi)}
            className={`p-2 rounded-lg transition-colors border ${showVoronoi ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
            title="切换维诺图"
          >
            <Layers size={18} />
          </button>
          <button 
            onClick={() => setAnimatePath(!animatePath)}
            className={`p-2 rounded-lg transition-colors border ${animatePath ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
            title="切换路径动画"
          >
            <Activity size={18} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden p-6 gap-6">
        {/* Scrollable Canvas Scroll Area */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
          
          {/* Section 1: Final Pathfinding */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center">
            <div className="w-full flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-800">阶段 1：维诺图路径规划 (Voronoi)</h2>
                <p className="text-sm text-slate-400">从起点 1 (2, 14) 出发，结合维诺图网络搜索出的最短安全路径</p>
              </div>
              <div className="flex gap-2">
                 <span className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded uppercase">Start 1 View</span>
              </div>
            </div>

            <div className="relative border-l-2 border-b-2 border-slate-200">
              <div className="absolute -left-10 top-1/2 -rotate-90 text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] whitespace-nowrap">Y-轴 (0-17)</div>
              <div className="absolute -bottom-8 left-1/2 flex -translate-x-1/2 text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">X-轴 (0-17)</div>
              
              <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="bg-white block">
                <defs>
                  <pattern id="grid-pattern-1" width={CELL_SIZE} height={CELL_SIZE} patternUnits="userSpaceOnUse">
                    <path d={`M ${CELL_SIZE} 0 L 0 0 0 ${CELL_SIZE}`} fill="none" stroke="#f1f5f9" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width={WIDTH} height={HEIGHT} fill="url(#grid-pattern-1)" />

                {/* Obstacles */}
                {OBSTACLES.map((obs, i) => (
                  <motion.rect 
                    key={`obs1-${i}`}
                    animate={{ 
                      fill: hoveredObstacles.includes(i) ? "#4f46e5" : "#64748b",
                      opacity: hoveredObstacles.length > 0 && !hoveredObstacles.includes(i) ? 0.3 : 1
                    }}
                    x={mapX(obs.x)} y={mapY(obs.y)} width={obs.w * CELL_SIZE} height={obs.h * CELL_SIZE} 
                    className="shadow-sm origin-center" rx="4"
                  />
                ))}

                {/* Voronoi Edges */}
                {showVoronoi && voronoiData.voronoiEdges.map((edge, i) => (
                  <line 
                    key={`v1-edge-${i}`}
                    x1={mapX(edge.p1.x)} y1={mapY(edge.p1.y)} x2={mapX(edge.p2.x)} y2={mapY(edge.p2.y)}
                    stroke="#4f46e5" strokeWidth="1.5" opacity="0.1"
                  />
                ))}

                {/* Path */}
                {voronoiData.shortestPath.length > 0 && (
                  <g className="pointer-events-none">
                    <motion.path 
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5 }}
                      d={`M ${voronoiData.shortestPath.map(p => `${mapX(p.x)},${mapY(p.y)}`).join(" L ")}`}
                      fill="none" stroke="#4f46e5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </g>
                )}

                <circle cx={mapX(START.x)} cy={mapY(START.y)} r="8" className="fill-indigo-600 shadow-lg" />
                <text x={mapX(START.x)} y={mapY(START.y) - 15} textAnchor="middle" className="text-[10px] font-bold fill-indigo-600 uppercase">Start 1</text>
                <circle cx={mapX(GOAL.x)} cy={mapY(GOAL.y)} r="8" className="fill-amber-500 shadow-lg" />
                <text x={mapX(GOAL.x)} y={mapY(GOAL.y) - 15} textAnchor="middle" className="text-[10px] font-bold fill-amber-500 uppercase">Goal</text>
              </svg>
            </div>
          </section>

          {/* Section 2: Pure Voronoi Geometry */}
          <section id="step-voronoi" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center">
             <div className="w-full flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-800">阶段 2：维诺图拓扑结构 (Voronoi Topology)</h2>
                <p className="text-sm text-slate-400">展示障碍物之间的等距轨迹线及其交点（顶点）</p>
              </div>
              <div className="flex gap-2">
                 <span className="px-2 py-1 bg-amber-50 text-amber-600 text-[10px] font-bold rounded uppercase">Topology Map</span>
              </div>
            </div>

            <div className="relative border-l-2 border-b-2 border-slate-200">
               <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="bg-white block">
                <defs>
                  <pattern id="grid-pattern-2" width={CELL_SIZE} height={CELL_SIZE} patternUnits="userSpaceOnUse">
                    <path d={`M ${CELL_SIZE} 0 L 0 0 0 ${CELL_SIZE}`} fill="none" stroke="#f1f5f9" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width={WIDTH} height={HEIGHT} fill="url(#grid-pattern-2)" />

                {/* Obstacles in Step 2 */}
                {OBSTACLES.map((obs, i) => (
                  <motion.rect 
                    key={`obs2-${i}`}
                    animate={{ 
                      fill: hoveredObstacles.includes(i) ? "#4f46e5" : "#94a3b8",
                      scale: hoveredObstacles.includes(i) ? 1.02 : 1
                    }}
                    x={mapX(obs.x)} y={mapY(obs.y)} width={obs.w * CELL_SIZE} height={obs.h * CELL_SIZE} 
                    className="origin-center" rx="4"
                  />
                ))}

                {/* Pure Voronoi Edges - Highlighted */}
                {voronoiData.voronoiEdges.map((edge, i) => (
                  <line 
                    key={`v2-edge-${i}`}
                    x1={mapX(edge.p1.x)} y1={mapY(edge.p1.y)} x2={mapX(edge.p2.x)} y2={mapY(edge.p2.y)}
                    stroke={edge.owners.length > 0 ? "#4f46e5" : "#cbd5e1"}
                    strokeWidth={edge.owners.length > 0 ? "2.5" : "1.5"}
                    onMouseEnter={() => setHoveredObstacles(edge.owners)}
                    onMouseLeave={() => setHoveredObstacles([])}
                    className="cursor-help transition-opacity"
                    opacity={hoveredObstacles.length > 0 && edge.owners.some(o => hoveredObstacles.includes(o)) ? 1 : 0.4}
                  />
                ))}

                {voronoiData.vertices.map((v, i) => (
                  <circle key={`v2-node-${i}`} cx={mapX(v.x)} cy={mapY(v.y)} r="2" className="fill-indigo-300" />
                ))}
              </svg>
            </div>
          </section>

          {/* Section 3: PRM Pathfinding */}
          <section id="step-prm" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center">
             <div className="w-full flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-800">阶段 3：概率路线图算法 (Probabilistic Roadmap - PRM)</h2>
                <p className="text-sm text-slate-400">从起点 2 (2, 3) 出发，通随机采样点构建的路线图搜索出的路径</p>
              </div>
              <div className="flex gap-3 items-center">
                 <button 
                   onClick={() => setPrmSeed(s => s + 1)}
                   className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded uppercase transition-colors"
                 >
                   重新采样
                 </button>
                 <span className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded uppercase">Start 2 View</span>
              </div>
            </div>

            <div className="relative border-l-2 border-b-2 border-slate-200">
               <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="bg-white block">
                <defs>
                  <pattern id="grid-pattern-3" width={CELL_SIZE} height={CELL_SIZE} patternUnits="userSpaceOnUse">
                    <path d={`M ${CELL_SIZE} 0 L 0 0 0 ${CELL_SIZE}`} fill="none" stroke="#f1f5f9" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width={WIDTH} height={HEIGHT} fill="url(#grid-pattern-3)" />

                {/* Obstacles in PRM */}
                {OBSTACLES.map((obs, i) => (
                  <rect 
                    key={`obs3-${i}`}
                    x={mapX(obs.x)} y={mapY(obs.y)} width={obs.w * CELL_SIZE} height={obs.h * CELL_SIZE} 
                    fill="#94a3b8" rx="4"
                  />
                ))}

                {/* PRM Road Map Edges */}
                {prmData.edges.map((edge, i) => (
                    <line 
                      key={`prm-edge-${i}`}
                      x1={mapX(prmData.nodes[edge.u].x)} y1={mapY(prmData.nodes[edge.u].y)} 
                      x2={mapX(prmData.nodes[edge.v].x)} y2={mapY(prmData.nodes[edge.v].y)}
                      stroke="#4f46e5" strokeWidth="0.5" opacity="0.15"
                    />
                ))}

                {/* PRM Samples */}
                {prmData.samples.map((v, i) => (
                  <circle key={`prm-node-${i}`} cx={mapX(v.x)} cy={mapY(v.y)} r="1.5" className="fill-indigo-300 opacity-50" />
                ))}

                {/* PRM Path */}
                {prmData.path.length > 0 && (
                  <g className="pointer-events-none">
                    <motion.path 
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5 }}
                      d={`M ${prmData.path.map(p => `${mapX(p.x)},${mapY(p.y)}`).join(" L ")}`}
                      fill="none" stroke="#6366f1" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </g>
                )}

                <circle cx={mapX(START2.x)} cy={mapY(START2.y)} r="8" className="fill-indigo-600 shadow-lg" />
                <text x={mapX(START2.x)} y={mapY(START2.y) - 15} textAnchor="middle" className="text-[10px] font-bold fill-indigo-600 uppercase">Start 2</text>
                <circle cx={mapX(GOAL.x)} cy={mapY(GOAL.y)} r="8" className="fill-amber-500 shadow-lg" />
                <text x={mapX(GOAL.x)} y={mapY(GOAL.y) - 15} textAnchor="middle" className="text-[10px] font-bold fill-amber-500 uppercase">Goal</text>
              </svg>
            </div>
          </section>


        </div>

        {/* Sidebar */}
        <aside className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Info size={14} /> 算法对比看板
            </h2>
            
            <div className="space-y-3">
              <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                <div className="flex items-center justify-between mb-2">
                   <div className="text-[10px] text-indigo-400 font-bold uppercase">Voronoi (Start 1)</div>
                   <div className="text-[10px] font-mono font-bold text-indigo-700">{voronoiData.totalDist.toFixed(2)}u</div>
                </div>
                <div className="w-full bg-indigo-100 h-1.5 rounded-full overflow-hidden">
                   <div className="bg-indigo-500 h-full" style={{ width: '100%' }} />
                </div>
              </div>

              <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                <div className="flex items-center justify-between mb-2">
                   <div className="text-[10px] text-amber-600 font-bold uppercase">PRM (Start 2)</div>
                   <div className="text-[10px] font-mono font-bold text-amber-700">{prmData.totalDist.toFixed(2)}u</div>
                </div>
                <div className="w-full bg-amber-100 h-1.5 rounded-full overflow-hidden">
                   <div className="bg-amber-500 h-full" style={{ width: `${(prmData.totalDist / voronoiData.totalDist) * 100}%` }} />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-4">
               <div className="space-y-1">
                 <h3 className="text-[10px] font-bold text-slate-400 uppercase">PRM 节点与边</h3>
                 <p className="text-[11px] text-slate-500 leading-normal">
                    PRM 通过在自由空间内 **随机采样 (Nodes)** 并尝试连接近邻。如果连线不穿过障碍，则建立 **边 (Edges)**。这种方法在处理高维空间时非常高效。
                 </p>
               </div>
               <div className="space-y-1">
                 <h3 className="text-[10px] font-bold text-slate-400 uppercase">维诺图 VS PRM</h3>
                 <p className="text-[11px] text-slate-500 leading-normal">
                    维诺图提供 **最大安全性**（始终在中线上），而 PRM 则提供了 **更灵活的连通性**，尤其在狭窄通道中表现更好。
                 </p>
               </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex-1 overflow-hidden flex flex-col">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
              <Target size={14} /> 障碍物数据清单
            </h2>
            <div className="space-y-1.5 overflow-y-auto pr-2 custom-scrollbar">
              {OBSTACLES.map((obs, i) => (
                <div 
                  key={i} 
                  className={`flex items-center justify-between p-2.5 text-xs border rounded transition-all ${
                    hoveredObstacles.includes(i) ? 'bg-indigo-50 border-indigo-200 scale-[1.02]' : 'bg-white border-slate-50 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-slate-300 font-mono group-hover:text-slate-500">#{i+1}</span>
                    <span className={`font-medium ${hoveredObstacles.includes(i) ? 'text-indigo-700' : 'text-slate-600'}`}>{obs.name}</span>
                  </div>
                  <span className="text-slate-400 font-mono">({obs.x}, {obs.y})</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        @keyframes dash {
          to {
            stroke-dashoffset: -1000;
          }
        }
      `}</style>
    </div>
  );
}
