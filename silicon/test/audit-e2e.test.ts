// The auditor against the real builder: Build hardware → Compile in the fake Figma (chunked Step and Reset at the
// default cap), the page serialized into the REST API's shape (interactions, boundVariables, componentId,
// flowStartingPoints), then auditBuild(). It must say READY; this pins the names and shapes the auditor relies on to
// what apply() / buildStepFrame() / the front panel really build.
import { beforeAll, describe, expect, it } from "vitest";
import { SiliconApp } from "../plugin/src/app";
import { cpuNetlist } from "../src/cpu";
import { parseRest, type RestNode } from "../src/audit/audit";
import { auditBuild, expectedFrom, type BuildAudit } from "../src/audit/build";
import { resetFonts } from "../src/figma/style";
import { PROGRAMS } from "../src/isa";
import { FakeFigma, type FakeNode } from "./fake-figma";

/** A FakeNode subtree as GET /v1/files/:key/nodes returns it. */
function toRest(n: FakeNode, components: Record<string, { name: string }>): RestNode {
  const out: RestNode = { id: n.id, name: n.name, type: n.type };
  if (n.type === "INSTANCE" && n._main) {
    out.componentId = n._main.id;
    components[n._main.id] = { name: n._main.name };
  }
  if (Object.keys(n.boundVariables).length) out.boundVariables = JSON.parse(JSON.stringify(n.boundVariables));
  if (n.reactions.length) out.interactions = JSON.parse(JSON.stringify(n.reactions));
  if (n.type === "PAGE") {
    out.type = "CANVAS";
    out.flowStartingPoints = n.flowStartingPoints.map((f) => ({ ...f }));
  }
  if (n.children.length) out.children = n.children.map((c) => toRest(c, components));
  return out;
}

describe("auditBuild on a file built by the plugin (fake Figma)", () => {
  const fig = new FakeFigma(["Page 1"]);
  fig.createPage = () => {
    throw new Error("Starter plan");
  };
  let a: BuildAudit;
  let json: unknown;

  beforeAll(async () => {
    (globalThis as unknown as { figma: FakeFigma }).figma = fig;
    resetFonts();
    const app = new SiliconApp(fig as unknown as PluginAPI, () => {}, { yield: async () => {}, clockFrameMs: 0 });
    await app.build({});
    await app.compile(PROGRAMS.count);
    const page = fig.root.children[0];
    const components: Record<string, { name: string }> = {};
    const document = toRest(page, components);
    json = { nodes: { [page.id]: { document, components } } };
    a = auditBuild(parseRest(json), expectedFrom(cpuNetlist()));
  }, 240_000);

  it("is READY to present", () => {
    console.log(`[audit e2e]\n${a.text}`);
    expect(a.checks.filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.message}`)).toEqual([]);
    expect(a.ready).toBe(true);
    expect(a.legacy).toBe(false);
    expect(a.text.split("\n").pop()).toBe("VERDICT: READY to present");
  });

  it("sees both Reset chains going home, the Run loop, 2,296 bound gates, 128 MEM lamps and 2,298 wires", () => {
    const [ctl, step] = a.reactions.resets;
    expect([ctl.home, ctl.chunked, ctl.hops, ctl.exits.length > 0]).toEqual(["CPU · Control", true, ["CPU · Reset A", "CPU · Reset B"], true]);
    expect([step.home, step.chunked, step.hops, step.exits.length > 0]).toEqual(["CPU · Step", true, ["CPU · Reset A (Step)", "CPU · Reset B (Step)"], true]);
    expect(Math.max(ctl.click, ctl.worstHop, step.worstHop)).toBeLessThanOrEqual(400);
    expect(Object.keys(a.reactions.run.hops).sort()).toEqual(["CPU · Run A", "CPU · Run B"]);
    expect(a.reactions.step.every((s) => s.worst <= 400)).toBe(true);
    expect(a.bindings.gates).toMatchObject({ instances: 2296, bound: 2296 });
    expect(a.bindings.mem.bound).toBe(128);
    expect(a.variables.wires).toBe(2298);
    expect(a.variables.roles.running).toHaveLength(1);
    expect(a.variables.roles.resetPhase).toHaveLength(1);
    expect(a.variables.roles.phase).toHaveLength(1);
  });

  it("turns into REBUILD when the Step header's Reset chain is pointed home to Control", () => {
    const j = JSON.parse(JSON.stringify(json));
    const doc: RestNode = (Object.values(j.nodes)[0] as { document: RestNode }).document;
    const byName = (name: string) => doc.children!.find((n) => n.name === name)!;
    const control = byName("CPU · Control");
    const step = byName("CPU · Step");
    const fix = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(fix);
      else if (x && typeof x === "object") {
        const o = x as { type?: string; destinationId?: string };
        if (o.type === "NODE" && o.destinationId === step.id) o.destinationId = control.id;
        Object.values(o).forEach(fix);
      }
    };
    fix(byName("CPU · Reset A (Step)").interactions);
    fix(byName("CPU · Reset B (Step)").interactions);
    const b = auditBuild(parseRest(j), expectedFrom(cpuNetlist()));
    expect(b.ready).toBe(false);
    expect(b.checks.filter((c) => c.status === "fail").map((c) => c.id)).toEqual(["reset:CPU · Step"]);
    expect(b.verdict).toBe("REBUILD needed: Reset on CPU · Step");
  });
});
