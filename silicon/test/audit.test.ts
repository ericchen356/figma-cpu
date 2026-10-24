import { describe, expect, it } from "vitest";
import { audit, expandGates, levelOf, parseRest, worstCase, type RestAction, type RestNode } from "../src/audit/audit";

const set = (n = 1): RestAction[] => Array.from({ length: n }, () => ({ type: "SET_VARIABLE" }));
let id = 0;
const node = (name: string, type: string, o: Partial<RestNode> = {}): RestNode => ({ id: `n${id++}`, name, type, ...o });
const inst = (name: string, comp: string, comps: Record<string, { name: string }>): RestNode => {
  const cid = `c:${comp}`;
  comps[cid] = { name: comp };
  return node(name, "INSTANCE", { componentId: cid });
};

/** cell/TOP = 2 × cell/HALF (each: 1 AND + 1 XOR) + 1 NOT. */
function sample() {
  const comps: Record<string, { name: string }> = {};
  const half = node("cell/HALF", "COMPONENT", { children: [inst("a", "gate/AND", comps), node("wires", "FRAME", { children: [inst("x", "gate/XOR", comps)] })] });
  const top = node("cell/TOP", "COMPONENT", { children: [inst("h0", "cell/HALF", comps), inst("h1", "cell/HALF", comps), inst("n", "gate/NOT", comps)] });
  return { comps, nodes: [half, top] };
}

describe("worstCase / levelOf", () => {
  it("counts a conditional as 1 plus its costliest block", () => {
    const cond: RestAction = { type: "CONDITIONAL", conditionalBlocks: [{ actions: set(3) }, { actions: set(5) }] };
    expect(worstCase([...set(2), cond])).toBe(2 + 1 + 5);
    expect(worstCase(undefined)).toBe(0);
  });
  it("levels: ≤ cap ok, below 2001 risky, 2001+ crash", () => {
    expect([levelOf(400, 400), levelOf(401, 400), levelOf(2000, 400), levelOf(2001, 400)]).toEqual(["ok", "risky", "risky", "crash"]);
  });
});

describe("expandGates", () => {
  it("expands through nested components and frames, per type", () => {
    const { comps, nodes } = sample();
    const r = expandGates({ roots: nodes, components: comps }, "cell/TOP");
    expect(r.byType).toEqual({ AND: 2, XOR: 2, NOT: 1 });
    expect(r.total).toBe(5);
    expect(r.missing).toEqual([]);
  });
  it("reports a missing component instead of silently counting 0", () => {
    const { comps, nodes } = sample();
    const r = expandGates({ roots: [nodes[1]], components: comps }, "cell/TOP"); // cell/HALF not drawn
    expect(r.missing).toContain("cell/HALF");
  });
});

describe("audit", () => {
  const mk = (stepActions: number) => {
    const { comps, nodes } = sample();
    const step = node("button/Step", "FRAME", { interactions: [{ trigger: { type: "ON_CLICK" }, actions: set(stepActions) }] });
    return { roots: [...nodes, step], components: comps };
  };
  const expected = { AND: 2, XOR: 2, NOT: 1 };

  it("a file that matches the code and has small events is fine", () => {
    const a = audit(mk(300), expected, 400, "cell/TOP");
    expect(a.gates.matches).toBe(true);
    expect(a.rebuildNeeded).toBe(false);
    expect(a.text).toContain("✓ every event within the cap");
  });
  it("flags an unchunked Step as a crash and asks for a rebuild", () => {
    const a = audit(mk(3861), expected, 400, "cell/TOP");
    expect(a.rebuildNeeded).toBe(true);
    expect(a.worst?.worst).toBe(3861);
    expect(a.text).toContain("✗ CRASH: button/Step ON_CLICK runs 3861 actions");
  });
  it("flags a file whose gates differ from the code", () => {
    const a = audit(mk(10), { AND: 2, XOR: 1, NOT: 1 }, 400, "cell/TOP");
    expect(a.gates.matches).toBe(false);
    expect(a.gates.diffs).toEqual(["XOR: drawn 2, code 1"]);
  });
  it("an empty page is not 'matching'", () => {
    expect(audit({ roots: [], components: {} }, expected, 400, "cell/TOP").gates.matches).toBe(false);
  });
});

describe("parseRest", () => {
  it("reads both the nodes and the file shapes, and rejects anything else", () => {
    const doc = node("p", "CANVAS");
    expect(parseRest({ nodes: { "1:2": { document: doc, components: { a: { name: "x" } } } } })).toEqual({ roots: [doc], components: { a: { name: "x" } } });
    expect(parseRest({ document: doc, components: {} }).roots).toEqual([doc]);
    expect(() => parseRest({ err: "Forbidden" })).toThrow("not a Figma REST payload");
  });
});
