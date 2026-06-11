// Left-to-right "Flow" layout for knowledge graphs.
//
// Karpathy-pattern wikis are authored in supply-chain order: the tour steps
// (one per index.md section) walk the chain start to finish. We turn that
// authoring order into horizontal ranks — tour step 1's nodes get rank 0,
// step 2 rank 1, etc. — and let ELK's layered algorithm with partitioning
// order nodes within each rank to minimize crossings.

import type { KnowledgeGraph } from "@understand-anything/core/types";
import { ELK_DEFAULT_LAYOUT_OPTIONS } from "./layout";
import type { ElkInput } from "./elk-layout";

/**
 * Derive a rank (0-based, left to right) for every node in the graph.
 *
 * - Nodes listed in a tour step get that step's index (earliest step wins
 *   when a node appears in several steps).
 * - Nodes not in any tour step (entities, claims, sources) attach to the
 *   rank of their strongest-connected ranked neighbor — strongest meaning
 *   the highest summed edge weight between the two nodes. Passes repeat so
 *   chains of unranked nodes resolve through already-attached neighbors.
 * - Nodes with no path to a ranked node default to rank 0.
 */
export function deriveTourRanks(graph: KnowledgeGraph): Map<string, number> {
  const ranks = new Map<string, number>();
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const sortedTour = [...(graph.tour ?? [])].sort((a, b) => a.order - b.order);
  sortedTour.forEach((step, index) => {
    for (const id of step.nodeIds) {
      if (nodeIds.has(id) && !ranks.has(id)) ranks.set(id, index);
    }
  });

  // Adjacency with summed weights per neighbor pair.
  const adjacency = new Map<string, Map<string, number>>();
  const addEdge = (from: string, to: string, weight: number) => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    let neighbors = adjacency.get(from);
    if (!neighbors) {
      neighbors = new Map<string, number>();
      adjacency.set(from, neighbors);
    }
    neighbors.set(to, (neighbors.get(to) ?? 0) + weight);
  };
  for (const edge of graph.edges) {
    const weight = edge.weight ?? 0;
    addEdge(edge.source, edge.target, weight);
    addEdge(edge.target, edge.source, weight);
  }

  // Attach unranked nodes to their strongest-connected ranked neighbor.
  // Each pass can only consume ranks assigned in earlier passes, so the
  // loop terminates after at most |nodes| passes.
  let assignedInPass = true;
  while (assignedInPass) {
    assignedInPass = false;
    const passAssignments = new Map<string, number>();
    for (const node of graph.nodes) {
      if (ranks.has(node.id)) continue;
      let bestWeight = -Infinity;
      let bestRank: number | undefined;
      for (const [neighborId, weight] of adjacency.get(node.id) ?? []) {
        const neighborRank = ranks.get(neighborId);
        if (neighborRank === undefined) continue;
        if (
          weight > bestWeight ||
          (weight === bestWeight && bestRank !== undefined && neighborRank < bestRank)
        ) {
          bestWeight = weight;
          bestRank = neighborRank;
        }
      }
      if (bestRank !== undefined) passAssignments.set(node.id, bestRank);
    }
    for (const [id, rank] of passAssignments) {
      ranks.set(id, rank);
      assignedInPass = true;
    }
  }

  for (const node of graph.nodes) {
    if (!ranks.has(node.id)) ranks.set(node.id, 0);
  }

  return ranks;
}

/**
 * Build the ELK input for Flow mode: layered left→right, with each node
 * pinned to its tour-derived rank via ELK partitioning. ELK's layer sweep
 * orders nodes within a rank to minimize crossings.
 */
export function buildFlowElkInput(
  graph: KnowledgeGraph,
  dims: Map<string, { width: number; height: number }>,
  ranks: Map<string, number>,
): ElkInput {
  return {
    id: "root",
    layoutOptions: {
      ...ELK_DEFAULT_LAYOUT_OPTIONS,
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.nodeNode": "48",
    },
    children: graph.nodes.map((node) => {
      const d = dims.get(node.id);
      return {
        id: node.id,
        width: d?.width,
        height: d?.height,
        layoutOptions: {
          "elk.partitioning.partition": String(ranks.get(node.id) ?? 0),
        },
      };
    }),
    edges: graph.edges.map((e, i) => ({
      id: `kfe-${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  };
}

const LAYOUT_STORAGE_PREFIX = "ua-knowledge-layout:";

export type KnowledgeLayoutMode = "force" | "flow";

/** Read the persisted layout mode for a graph. Defaults to force-directed. */
export function loadLayoutMode(projectName: string): KnowledgeLayoutMode {
  if (typeof window === "undefined") return "force";
  try {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_PREFIX + projectName);
    return stored === "flow" ? "flow" : "force";
  } catch {
    return "force";
  }
}

/** Persist the chosen layout mode for a graph. */
export function saveLayoutMode(projectName: string, mode: KnowledgeLayoutMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_PREFIX + projectName, mode);
  } catch {
    // localStorage unavailable (private mode, file://) — keep in-memory only.
  }
}
