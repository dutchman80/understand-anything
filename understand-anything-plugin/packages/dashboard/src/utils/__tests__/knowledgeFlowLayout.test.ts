import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deriveTourRanks, buildFlowElkInput, loadLayoutMode, saveLayoutMode } from "../knowledgeFlowLayout";
import type { KnowledgeGraph, GraphNode, GraphEdge, TourStep } from "@understand-anything/core/types";

function makeNode(id: string): GraphNode {
  return {
    id,
    type: "article",
    name: id,
    summary: `${id} summary`,
    tags: [],
    complexity: "simple",
  };
}

function makeEdge(source: string, target: string, weight = 0.5): GraphEdge {
  return { source, target, type: "related", direction: "forward", weight };
}

function makeGraph(
  nodeIds: string[],
  edges: GraphEdge[],
  tour: TourStep[],
): KnowledgeGraph {
  return {
    version: "1.0.0",
    kind: "knowledge",
    project: {
      name: "test-wiki",
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "2026-01-01T00:00:00Z",
      gitCommitHash: "abc",
    },
    nodes: nodeIds.map(makeNode),
    edges,
    layers: [],
    tour,
  };
}

function step(order: number, nodeIds: string[]): TourStep {
  return { order, title: `Step ${order}`, description: "", nodeIds };
}

describe("deriveTourRanks", () => {
  it("assigns rank by tour step index", () => {
    const graph = makeGraph(
      ["a", "b", "c"],
      [],
      [step(1, ["a"]), step(2, ["b"]), step(3, ["c"])],
    );
    const ranks = deriveTourRanks(graph);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("sorts tour steps by order, not array position", () => {
    const graph = makeGraph(
      ["a", "b"],
      [],
      [step(2, ["b"]), step(1, ["a"])],
    );
    const ranks = deriveTourRanks(graph);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
  });

  it("keeps the earliest rank when a node appears in multiple steps", () => {
    const graph = makeGraph(
      ["a", "b"],
      [],
      [step(1, ["a", "b"]), step(2, ["b"])],
    );
    expect(deriveTourRanks(graph).get("b")).toBe(0);
  });

  it("attaches unranked nodes to their strongest-connected ranked neighbor", () => {
    // entity connects weakly to step-0 node "a" and strongly to step-2 node "c"
    const graph = makeGraph(
      ["a", "b", "c", "entity"],
      [makeEdge("entity", "a", 0.2), makeEdge("entity", "c", 0.9)],
      [step(1, ["a"]), step(2, ["b"]), step(3, ["c"])],
    );
    expect(deriveTourRanks(graph).get("entity")).toBe(2);
  });

  it("sums parallel edge weights to the same neighbor", () => {
    const graph = makeGraph(
      ["a", "b", "entity"],
      [
        makeEdge("entity", "a", 0.3),
        makeEdge("a", "entity", 0.3), // combined a-weight 0.6
        makeEdge("entity", "b", 0.5),
      ],
      [step(1, ["a"]), step(2, ["b"])],
    );
    expect(deriveTourRanks(graph).get("entity")).toBe(0);
  });

  it("resolves chains of unranked nodes through attached neighbors", () => {
    // claim -> entity -> b(ranked 1)
    const graph = makeGraph(
      ["a", "b", "entity", "claim"],
      [makeEdge("entity", "b", 0.8), makeEdge("claim", "entity", 0.8)],
      [step(1, ["a"]), step(2, ["b"])],
    );
    const ranks = deriveTourRanks(graph);
    expect(ranks.get("entity")).toBe(1);
    expect(ranks.get("claim")).toBe(1);
  });

  it("defaults isolated nodes to rank 0", () => {
    const graph = makeGraph(["a", "orphan"], [], [step(1, ["a"])]);
    expect(deriveTourRanks(graph).get("orphan")).toBe(0);
  });

  it("ranks every node 0 when the graph has no tour", () => {
    const graph = makeGraph(["a", "b"], [makeEdge("a", "b")], []);
    const ranks = deriveTourRanks(graph);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(0);
  });

  it("ignores tour nodeIds that are not in the graph", () => {
    const graph = makeGraph(["a"], [], [step(1, ["ghost", "a"])]);
    const ranks = deriveTourRanks(graph);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.has("ghost")).toBe(false);
  });
});

describe("buildFlowElkInput", () => {
  it("pins each node to its rank partition and lays out left to right", () => {
    const graph = makeGraph(
      ["a", "b"],
      [makeEdge("a", "b")],
      [step(1, ["a"]), step(2, ["b"])],
    );
    const dims = new Map([
      ["a", { width: 100, height: 50 }],
      ["b", { width: 120, height: 60 }],
    ]);
    const input = buildFlowElkInput(graph, dims, deriveTourRanks(graph));

    expect(input.layoutOptions?.["elk.direction"]).toBe("RIGHT");
    expect(input.layoutOptions?.["elk.partitioning.activate"]).toBe("true");
    const a = input.children.find((c) => c.id === "a");
    const b = input.children.find((c) => c.id === "b");
    expect(a?.layoutOptions?.["elk.partitioning.partition"]).toBe("0");
    expect(b?.layoutOptions?.["elk.partitioning.partition"]).toBe("1");
    expect(a?.width).toBe(100);
    expect(input.edges).toHaveLength(1);
  });
});

describe("layout mode persistence", () => {
  // Tests run in a node environment — stub window.localStorage.
  const store = new Map<string, string>();
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    store.clear();
  });

  it("defaults to force when nothing is stored", () => {
    expect(loadLayoutMode("never-seen-project")).toBe("force");
  });

  it("round-trips the chosen mode per project", () => {
    saveLayoutMode("proj-x", "flow");
    saveLayoutMode("proj-y", "force");
    expect(loadLayoutMode("proj-x")).toBe("flow");
    expect(loadLayoutMode("proj-y")).toBe("force");
  });
});
