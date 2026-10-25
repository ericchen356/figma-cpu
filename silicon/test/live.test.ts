// Lane L1: the FigmaCPU Live dashboard on the fake Figma API. Build hardware + Compile (as a user
// would, on a one-page Starter file), then buildDashboard / bindDashboard: every lit layer is bound
// to an existing variable, the magnifiers' gates to the right CPU nets, no text to a non-STRING
// variable, nothing outside `Live · *` is touched, a rebuild is idempotent; then the CPU is clocked
// with the plugin clock (FastSim writing the changed variables) and the right lights come on.
// Last, the plugin's "Live view" card end to end, with lane L2's wireLive.
import { beforeAll, describe, expect, it } from "vitest";
import { NAME, SiliconApp } from "../plugin/src/app";
import type { ToUi } from "../plugin/src/messages";
import { cpuNetlist, PROBES, ramBit } from "../src/cpu";
import { resetFonts } from "../src/figma/style";
import { OPCODES, OUT_ADDR, PROGRAMS, RAM_BYTES, SIGNALS } from "../src/isa";
import {
  bindDashboard,
  buildDashboard,
  CTL_PAD,
  DASHBOARD_NAME,
  datapathNets,
  DEFAULT_MAGNIFIERS,
  gridNets,
  listingText,
  microcodeTable,
  PAD_CELL_NAME,
  parseBound,
  programBlurb,
  readSelect,
  transfers,
} from "../src/live";
import type { PrototypePlan } from "../src/prototype";
import { runFigmaActions } from "../src/prototype";
import { FakeFigma, type FakeNode, type FakeVariable } from "./fake-figma";

const STARTER = "in createPage: The Starter plan only comes with 3 pages. Upgrade to Professional for unlimited pages.";

function starterFigma(pages = ["Page 1"]): FakeFigma {
  const fig = new FakeFigma(pages);
  fig.createPage = () => {
    throw new Error(STARTER);
  };
  return fig;
}

function install(fig: FakeFigma) {
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
}

const asApi = (f: FakeFigma) => f as unknown as PluginAPI;
const fk = (n: unknown) => n as FakeNode;
const NET = cpuNetlist();
const idOf = (name: string) => {
  const id = NET.aliases.get(name);
  if (id === undefined) throw new Error(`no net ${name}`);
  return id;
};

/** Every node under (and including) `root`, ignoring page loading. */
function subtree(root: FakeNode): FakeNode[] {
  const out: FakeNode[] = [root];
  root.walkRaw((n) => out.push(n));
  return out;
}

/** A layer's state as Figma would store it: everything a rebuild must leave alone. */
function snapshot(nodes: FakeNode[]): Map<string, string> {
  return new Map(
    nodes.map((n) => [
      n.id,
      JSON.stringify([n.name, n.type, n.parent?.id, n.x, n.y, n.width, n.height, n.visible, n.boundVariables, n.reactions, n.characters, [...n.overrides]]),
    ]),
  );
}

describe("Live dashboard (lane L1)", () => {
  const fig = starterFigma();
  const msgs: ToUi[] = [];
  let app: SiliconApp;
  let page: FakeNode;
  let plan: PrototypePlan;
  let varByNet: Map<number, Variable>;
  let ctl: Map<string, Variable>;
  let comp: FakeNode;
  let dash: Awaited<ReturnType<typeof buildDashboard>>;

  /** The value a bound layer shows now (its variable's default-mode value). */
  const lit = (n: FakeNode | undefined | null): boolean => {
    if (!n) throw new Error("no such layer");
    const id = n.boundVariables.visible?.id;
    if (!id) return n.visible;
    const v = fig.variableById.get(id)!;
    return v.valuesByMode[v.collection.defaultModeId] === true;
  };
  /** The `lit` child of the first container named `name` in the dashboard. */
  const litOf = (name: string) => {
    const c = comp.findOne((n) => n.name === name);
    if (!c) throw new Error(`no layer ${name}`);
    return c.children.find((x) => x.name === "lit")!;
  };
  const isLit = (name: string) => lit(litOf(name));
  const probes = () => app.clock.status().probes;

  beforeAll(async () => {
    install(fig);
    app = new SiliconApp(asApi(fig), (m) => msgs.push(m), { yield: async () => {}, clockFrameMs: 0 });
    page = fig.root.children[0];
    const mine = fig.createFrame();
    mine.name = "My design";
    mine.resize(1200, 800);
    await app.build({ gateLabels: true });
    const r = await app.compile(PROGRAMS.mul);
    plan = r.plan;
    // The CPU's variables span the collections CPU, CPU · 2, … (4,000 a collection).
    const byName = new Map([...fig.variableById.values()].filter((v) => v.collection.name.startsWith(NAME)).map((v) => [v.name, v]));
    varByNet = new Map(plan.variables.map((v) => [v.net, byName.get(v.name) as unknown as Variable]));
    ctl = new Map([...fig.variableById.values()].filter((v) => v.collection.name.startsWith(NAME) && v.name.startsWith("ctl/")).map((v) => [v.name, v as unknown as Variable]));
  });

  it("the microcode grid is the spec: 16 opcodes × T0–T7, FETCH shared, conditional jumps labelled", () => {
    const t = microcodeTable();
    expect(t.rows.map((r) => r.mnem)).toEqual([...OPCODES].sort((a, b) => a.code - b.code).map((o) => o.mnem));
    expect([...t.shared.keys()]).toEqual([0, 1, 2]);
    expect(t.shared.get(0)!.text).toBe("PC→bus  bus→MAR");
    const add = t.rows.find((r) => r.mnem === "ADD")!;
    expect(add.cells[4]).toMatchObject({ text: "Rs→bus  ALU→Y  →ZCN", end: false });
    expect(add.cells[5]!.end).toBe(true);
    expect(add.cells[6]).toBeNull();
    const jz = t.rows.find((r) => r.mnem === "JZ")!;
    expect(jz.cells[5]).toMatchObject({ text: "Z? MDR→bus bus→PC", end: true, when: { flag: "Z", net: "ctrl/op_JZifZ" } });
    expect(t.rows.find((r) => r.mnem === "HLT")!.cells[3]).toMatchObject({ halt: true, end: true });
    // Every instruction's last step ends it.
    for (const r of t.rows) {
      const steps = r.cells.filter((c) => c);
      expect(steps[steps.length - 1]!.end, r.mnem).toBe(true);
    }
    // Every signal of every step appears in its cell (as shorthand or as the end marker).
    for (const r of t.rows) for (const c of r.cells) if (c) expect(c.signals.length).toBeGreaterThan(0);
  });

  it("every net the dashboard names exists in the CPU and has a variable", () => {
    const nets = new Set([...datapathNets(), ...gridNets()]);
    for (const n of nets) {
      const id = NET.aliases.get(n);
      expect(id, n).toBeDefined();
      expect(id! > 1 && varByNet.has(id!), `${n} has a variable`).toBe(true);
    }
    // Transfer arrows cover every control signal that moves data.
    const arrowNets = new Set(transfers().map((t) => t.net));
    for (const s of SIGNALS) if (!["T_RESET", "HALT", "PC_INC"].includes(s)) expect(arrowNets.has(s), s).toBe(true);
  });

  it("listing and disk blurbs come from the programs", () => {
    const l = listingText(PROGRAMS.mul).split("\n");
    expect(l[0]).toBe("00  10 00  LDI R0, 0");
    expect(l.find((x) => x.includes("loop:"))).toBe("08  51     loop: ADD R0, R1");
    expect(l.find((x) => x.includes("JC"))).toBe("0A  D0 08  JC loop");
    expect(programBlurb(PROGRAMS.mul)).toBe("6 × 7 = 42 by repeated addition");
    expect(listingText("LDI R9, 300")).toBe("LDI R9, 300");
  });

  it("buildDashboard: one 1920 × 1200 component right of everything, named controls, nothing else touched", async () => {
    await fig.loadAllPagesAsync();
    const before = snapshot(subtree(page).filter((n) => n !== page));
    const right = Math.max(...page.children.map((n) => n.x + n.width));
    const t0 = performance.now();
    dash = await buildDashboard(asApi(fig), page as unknown as PageNode, NET, { source: PROGRAMS.mul });
    const ms = Math.round(performance.now() - t0);
    comp = fk(dash.component);
    expect(comp.type).toBe("COMPONENT");
    expect(comp.parent).toBe(page);
    expect([comp.name, comp.width, comp.height]).toEqual([DASHBOARD_NAME, 1920, 1200]);
    expect(comp.x).toBeGreaterThan(right);
    // The controls lane L2 wires: direct layers of the component (not inside nested instances).
    for (const n of ["ctl/step", "ctl/run", "ctl/stop", "ctl/reset", CTL_PAD]) expect(comp.findAll((x) => x.name === n).length, n).toBe(1);
    for (const n of [dash.nodes.step, dash.nodes.run, dash.nodes.stop, dash.nodes.reset, ...dash.nodes.disks.values()]) {
      expect(fk(n).type).toBe("FRAME");
      expect(subtree(comp).includes(fk(n))).toBe(true);
    }
    expect([...dash.nodes.disks.keys()]).toEqual([...Object.keys(PROGRAMS), "custom"]);
    // The pad: 6 × 3 instances of one component, named ctl/pad/<i>.
    const cells = dash.nodes.padCells.map(fk);
    expect(cells.length).toBe(18);
    expect(cells.map((c) => c.name)).toEqual(cells.map((_, i) => `ctl/pad/${i}`));
    const padCell = fk(dash.nodes.padCell);
    expect([padCell.name, padCell.parent]).toEqual([PAD_CELL_NAME, page]);
    for (const c of cells) expect([c.type, c._main]).toEqual(["INSTANCE", padCell]);
    // Magnifiers: instances of the real cell components of the CPU page.
    for (const [i, m] of dash.nodes.magnifiers.entries()) {
      const inst = fk(m.instance);
      expect(inst.type).toBe("INSTANCE");
      expect(inst._main).toBe(page.children.find((n) => n.name === `cell/${DEFAULT_MAGNIFIERS[i].cell}`));
    }
    expect(dash.stats.missingCells).toEqual([]);
    // Layers: everything outside Live · * is exactly as it was.
    const after = snapshot(subtree(page).filter((n) => n !== page && !subtree(comp).includes(n) && n !== padCell && !subtree(padCell).includes(n)));
    expect(after).toEqual(before);
    expect(page.children.filter((n) => !before.has(n.id)).map((n) => n.name).sort()).toEqual([DASHBOARD_NAME, PAD_CELL_NAME].sort());
    const s = dash.stats;
    expect(s.layers).toBe(comp.findAll().length);
    expect(s.containers.arrow).toBe(transfers().length + 2); // + the pointer path: MAR_LOAD › reg_out
    expect(s.containers.row).toBe(16 + RAM_BYTES); // 16 opcode rows + a row per RAM byte
    expect(s.containers.col).toBe(8);
    expect(s.containers.seg).toBe(14);
    console.log(
      `[live] dashboard: ${s.layers} layers (magnifiers ${s.magnifiers.map((m) => `${m.cell} ${m.layers}`).join(", ")}), containers ${JSON.stringify(s.containers)}, ${s.padCells} pad cells, ${s.disks} disks, ${ms} ms in the fake`,
    );
  }, 120_000); // ~20 s alone: it snapshots every layer of the page (the 64-byte CPU's drawing) twice

  it("bindDashboard: every lamp, arrow, highlight and magnifier gate is bound to an existing variable", () => {
    const r = bindDashboard(comp as unknown as ComponentNode, NET, varByNet, { ctl });
    expect(r.unbound).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.constant).toBe(0);
    // Every `lit` of a net container is bound to a live variable of the CPU collection.
    const containers = comp.findAll((n) => !!parseBound(n.name) && n.children.some((c) => c.name === "lit"));
    expect(containers.length).toBe(Object.values(dash.stats.containers).reduce((a, b) => a + b, 0));
    for (const c of containers) {
      const l = c.children.find((x) => x.name === "lit")!;
      const v = fig.variableById.get(l.boundVariables.visible?.id) as FakeVariable | undefined;
      expect(v?.collection.name, c.name).toMatch(new RegExp(`^${NAME}( · \\d+)?$`));
      expect(v!.id, c.name).toBe((varByNet.get(idOf(parseBound(c.name)!.net)) as unknown as FakeVariable).id);
    }
    expect(r.bound).toBe(containers.length + r.byKind.gate + r.byKind.wire + 1); // + ctl/running
    // Magnifiers: every gate lit and wire lit inside each instance is bound, to <prefix><path>.
    expect(r.magnifiers.map((m) => m.prefix)).toEqual(DEFAULT_MAGNIFIERS.map((m) => `${m.prefix}/`));
    for (const [i, m] of dash.nodes.magnifiers.entries()) {
      const inst = fk(m.instance);
      const lits = inst.findAll((n) => n.name === "lit" || /^wire\/.+\/lit$/.test(n.name));
      expect(lits.length).toBeGreaterThan(0);
      for (const l of lits) expect(l.boundVariables.visible?.id, `${DEFAULT_MAGNIFIERS[i].prefix}: ${l.pathNames.join(" › ")}`).toBeDefined();
      const gates = NET.gates.filter((g) => g.path.startsWith(`${DEFAULT_MAGNIFIERS[i].prefix}/`)).length;
      expect(r.magnifiers[i]).toMatchObject({ gates, missing: [], stray: [] });
    }
    const gateVar = (mag: number, path: string[]) => {
      let n: FakeNode | undefined = fk(dash.nodes.magnifiers[mag].instance);
      for (const p of path) n = n?.children.find((c) => c.name === p);
      return n?.children.find((c) => c.name === "lit")?.boundVariables.visible?.id;
    };
    const varId = (net: string) => (varByNet.get(idOf(net)) as unknown as FakeVariable).id;
    expect(gateVar(0, ["p"])).toBe(varId("alu/add/fa3/p"));
    expect(gateVar(0, ["sum"])).toBe(varId("alu/sum[3]"));
    expect(gateVar(0, ["carry"])).toBe(varId("alu/add/c4"));
    expect(gateVar(1, ["men"])).toBe(varId("regs/r0/b0/men"));
    expect(gateVar(1, ["slave", "merge"])).toBe(varId("r0[0]"));
    expect(gateVar(1, ["master", "take"])).toBe(varId("regs/r0/b0/master/take"));
    expect(gateVar(2, ["merge"])).toBe(varId(ramBit(OUT_ADDR, 1)));
    // The FULL_ADDER instance's port labels show the CPU's nets (A = a[3]).
    const fa = fk(dash.nodes.magnifiers[0].instance);
    const props = Object.fromEntries(Object.entries(fa.componentProperties).map(([k, v]) => [k.split("#")[0], v.value]));
    expect(props).toMatchObject({ A: "a[3]", S: "alu/sum[3]", CO: "alu/add/c4" });
    // Texts: only STRING variables (tick and phase now; program and listing after wireLive).
    expect(r.texts).toBe(2);
    for (const t of comp.findAll((n) => n.type === "TEXT" && !!n.boundVariables.characters))
      expect(fig.variableById.get(t.boundVariables.characters.id)?.resolvedType, t.name).toBe("STRING");
    expect(fk(dash.nodes.tickText).boundVariables.characters.id).toBe(fig.variableNamed(NAME, "ctl/tickText").id);
    expect(fk(dash.nodes.phaseText).boundVariables.characters.id).toBe(fig.variableNamed(NAME, "ctl/phaseText").id);
    expect(r.missingVars.sort()).toEqual(["ctl/listing", "ctl/loading", "ctl/program"]);
    console.log(`[live] bound ${r.bound} lit layers: ${JSON.stringify(r.byKind)}, ${r.texts} texts`);
  });

  it("the lights follow the CPU, tick by tick (plugin clock writing the changed variables)", async () => {
    // Power-on: T0 of the first instruction; IR = 0 (LDRI's line); PC → bus → MAR.
    expect(probes().T ?? 0).toBe(0);
    await app.clock.step(0);
    expect(isLit("col/ctrl/T0")).toBe(true);
    expect(isLit("arrow/PC_OUT")).toBe(true);
    expect(isLit("arrow/MAR_LOAD")).toBe(true);
    expect(isLit("row/ctrl/op_LDRI")).toBe(true);
    expect(isLit("tag/PC_OUT")).toBe(true);
    for (const s of ["arrow/MDR_OUT", "arrow/Y_LOAD", "arrow/MEM_READ", "col/ctrl/T1", "row/ctrl/op_ADD"]) expect(isLit(s), s).toBe(false);
    // The RAM matrix shows mul, the addressed row is RAM[MAR] = 0.
    const bytes = [0x10, 0x00, 0x14, 0x06];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 8; b++) expect(isLit(`lamp/${ramBit(a, b)}`), `RAM ${a}.${b}`).toBe(((bytes[a] >> b) & 1) === 1);
    expect(isLit("row/ram/sel[0]")).toBe(true);
    // T1: RAM → MDR and PC + 1.
    await app.clock.step(1);
    for (const s of ["col/ctrl/T1", "arrow/MEM_READ", "tag/PC_INC"]) expect(isLit(s), s).toBe(true);
    expect(isLit("col/ctrl/T0")).toBe(false);
    // Clock on to an ADD's T4: the ADD row, the T4 column, Rs → bus, ALU → Y, flags.
    for (let i = 0; i < 100 && !(probes().T === 4 && probes().IR >> 4 === 5); i++) await app.clock.step(1);
    expect([probes().T, probes().IR >> 4]).toEqual([4, 5]);
    for (const s of ["row/ctrl/op_ADD", "col/ctrl/T4", "arrow/Y_LOAD", "arrow/REG_OUT_S", "arrow/FLAGS_LOAD", "tag/alu/sel[0]"]) expect(isLit(s), s).toBe(true);
    for (const s of ["row/ctrl/op_LDI", "col/ctrl/T3", "arrow/PC_OUT", "arrow/REG_LOAD_D", "tag/alu_sub"]) expect(isLit(s), s).toBe(false);
    // Bus wires and register lamps show the values (R1 = 6 drives the bus at ADD T4).
    const bus = probes().BUS;
    for (let b = 0; b < 8; b++) expect(isLit(`lamp/bus[${b}]`), `bus ${b}`).toBe(((bus >> b) & 1) === 1);
    expect(bus).toBe(6);
    const r1 = probes().R1;
    for (let b = 0; b < 8; b++) expect(isLit(`lamp/r1[${b}]`)).toBe(((r1 >> b) & 1) === 1);
    // The adder magnifier glows with the adder: its sum gate shows alu/sum[3] (A + B at bit 3).
    const sumLit = fk(dash.nodes.magnifiers[0].instance).children.find((c) => c.name === "sum")!.children.find((c) => c.name === "lit")!;
    const alu = probes().A + bus;
    expect(lit(sumLit)).toBe(((alu >> 3) & 1) === 1);
    // Run to the end: OUT = 42 on the lamps and the 7-segment digits ("2A"), HALTED lit.
    await app.clock.run(0);
    expect(probes()).toMatchObject({ OUT: 42, HALTED: 1 });
    for (let b = 0; b < 8; b++) expect(isLit(`lamp/OUT[${b}]`)).toBe(((42 >> b) & 1) === 1);
    const SEG2 = [1, 1, 0, 1, 1, 0, 1]; // a b c d e f g of "2"
    const SEGA = [1, 1, 1, 0, 1, 1, 1]; // "A"
    for (let k = 0; k < 7; k++) {
      expect(isLit(`seg/SEG_HI[${k}]`), `HI ${k}`).toBe(SEG2[k] === 1);
      expect(isLit(`seg/SEG_LO[${k}]`), `LO ${k}`).toBe(SEGA[k] === 1);
    }
    expect(isLit("lamp/halted")).toBe(true);
    expect(isLit(`lamp/${PROBES.HALTED.name}`)).toBe(true);
    // The RAM magnifier's latch now holds bit 1 of 42 (the ST to [OUT] wrote RAM[15]).
    const latch = fk(dash.nodes.magnifiers[2].instance).children.find((c) => c.name === "merge")!.children.find((c) => c.name === "lit")!;
    expect(lit(latch)).toBe(true);
    await app.loadProgram(PROGRAMS.mul); // back to power-on for the next tests
  });

  it("pointer visuals follow LDRI on the gates: pointer → MAR with PTR on Rs, the +1, the read flash, one PC ▸", async () => {
    await app.handle({ type: "load", source: PROGRAMS.perceptron });
    /** Shown on the canvas: the layer and every `lit` around it (nested containers are an AND). */
    const shown = (n: FakeNode): boolean => {
      for (let at: FakeNode | null = n; at && at !== comp; at = at.parent) if (at.name === "lit" && !lit(at)) return false;
      return true;
    };
    const inside = (outer: string, inner: string) =>
      comp.findAll((n) => n.name === outer).map((c) => c.children.find((x) => x.name === "lit")!).flatMap((l) => l.findAll((n) => n.name === inner));
    const pointer = inside("arrow/MAR_LOAD", "arrow/reg_out")[0];
    expect(pointer).toBeDefined();
    const ptrOn = (k: number) => shown(pointer.findOne((n) => n.name === `tag/${readSelect(k)}`)!.children.find((c) => c.name === "lit")!);
    /** The address the PC ▸ that shows stands for, read off its tree path (pc[i] = 1, pc_n[i] = 0). */
    const markerAt = (): number[] =>
      comp
        .findAll((n) => n.name === "pc" && n.type === "TEXT")
        .filter(shown)
        .map((m) => m.pathNames.filter((p) => /^tag\/pc(_n)?\[\d\]$/.test(p)).reduce((a, p) => (a << 1) | (p.startsWith("tag/pc[") ? 1 : 0), 0));
    const flash = (net: "MEM_READ" | "MEM_WRITE") =>
      comp.findAll((n) => n.name === `tag/${net}` && n.parent?.parent?.name === `row/ram/sel[${probes().MAR}]`).some((t) => shown(t.children.find((c) => c.name === "lit")!));
    // Fetch and decode of the first LDRI R3, [R1+]: PC ▸ walks with the PC, nothing points yet.
    for (let i = 0; i < 40 && !(probes().IR >> 4 === 0 && probes().T === 3); i++) {
      await app.clock.step(1);
      expect(markerAt(), `tick ${i}`).toEqual([probes().PC]);
    }
    expect([probes().IR >> 4, probes().T]).toEqual([0, 3]); // LDRI's T3: REG_OUT_S MAR_LOAD A_LOAD
    expect(probes().IR & 3).toBe(1); // Rs = R1
    expect(shown(pointer.children.find((c) => c.name === "lit")!)).toBe(true);
    expect([0, 1, 2, 3].map(ptrOn)).toEqual([false, true, false, false]);
    await app.clock.step(1); // T4: MEM_READ ONE_OUT Y_LOAD: the 1 on the bus, and RAM[MAR] read
    expect(shown(pointer.children.find((c) => c.name === "lit")!)).toBe(false);
    expect(isLit("arrow/ONE_OUT")).toBe(true);
    expect(probes().BUS).toBe(1);
    expect(flash("MEM_READ")).toBe(true);
    expect(flash("MEM_WRITE")).toBe(false);
    await app.clock.step(1); // T5: Y_OUT REG_LOAD_S: R1 ← R1 + 1
    expect(isLit("arrow/REG_LOAD_S")).toBe(true);
    expect(isLit("tag/regs/load[1]")).toBe(true);
    expect(markerAt()).toEqual([probes().PC]);
  });

  it("rebuild is idempotent: one dashboard, same spot, same layers, nothing else touched", async () => {
    const at = { x: comp.x, y: comp.y };
    const layers = dash.stats.layers;
    const before = snapshot(subtree(page).filter((n) => n !== page && !n.name.startsWith("Live · ") && !n.pathNames.some((p) => p.startsWith("Live · "))));
    const again = await buildDashboard(asApi(fig), page as unknown as PageNode, NET, { source: PROGRAMS.mul });
    expect(page.children.filter((n) => n.name === DASHBOARD_NAME).length).toBe(1);
    expect(page.children.filter((n) => n.name === PAD_CELL_NAME).length).toBe(1);
    expect(comp.removed).toBe(true);
    comp = fk(again.component);
    dash = again;
    expect({ x: comp.x, y: comp.y }).toEqual(at);
    expect(again.stats.layers).toBe(layers);
    const after = snapshot(subtree(page).filter((n) => n !== page && !n.name.startsWith("Live · ") && !n.pathNames.some((p) => p.startsWith("Live · "))));
    expect(after).toEqual(before);
    const r = bindDashboard(comp as unknown as ComponentNode, NET, varByNet, { ctl });
    expect([r.unbound, r.unknown]).toEqual([[], []]);
  });

  it("plugin card: Build Live view = dashboard + lane L2's frames and reactions + bindings, after Compile", async () => {
    msgs.length = 0;
    await app.handle({ type: "live" });
    const errors = msgs.filter((m) => m.type === "log" && m.level === "error");
    expect(errors).toEqual([]);
    const done = msgs.find((m): m is Extract<ToUi, { type: "live" }> => m.type === "live");
    expect(done).toBeDefined();
    const st = done!.stats;
    expect(st).toMatchObject({ wired: true, unbound: 0, unknown: 0, magnifiers: 3, texts: 4 });
    expect(st.frames).toEqual(["Live · Main", "Live · Run A", "Live · Run B", "Live · Load A", "Live · Load B"]);
    const progress = msgs.filter((m) => m.type === "progress" && m.task === "live");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    // One dashboard (the card replaced the test's own), the frames below it, no overlaps with the rest.
    const d = page.children.filter((n) => n.name === DASHBOARD_NAME);
    expect(d.length).toBe(1);
    comp = d[0];
    const main = page.children.find((n) => n.name === "Live · Main")!;
    expect(main.y).toBeGreaterThan(comp.y + comp.height);
    const rest = page.children.filter((n) => !n.name.startsWith("Live · "));
    const live = page.children.filter((n) => n.name.startsWith("Live · "));
    for (const a of live) for (const b of rest) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, `${a.name} × ${b.name}`).toBe(false);
    // The program name and listing texts are bound to lane L2's STRING variables.
    expect(comp.findOne((n) => n.name === "var/ctl/listing")!.boundVariables.characters.id).toBe(fig.variableNamed(NAME, "ctl/listing").id);
    expect(comp.findOne((n) => n.name === "var/ctl/program")!.boundVariables.characters.id).toBe(fig.variableNamed(NAME, "ctl/program").id);
    expect(litOf("var/ctl/loading").boundVariables.visible.id).toBe(fig.variableNamed(NAME, "ctl/loading").id);
    // The pad's reaction lives once, on the pad cell component; the cells inherit it.
    const padCell = page.children.find((n) => n.name === PAD_CELL_NAME)!;
    expect(padCell.reactions.map((r) => r.trigger?.type)).toEqual(["MOUSE_ENTER"]);
    const cell0 = comp.findOne((n) => n.name === "ctl/pad/0")!;
    expect(cell0.reactions).toEqual(padCell.reactions);
    // Sweeping the pad clocks the CPU: one tick = `eventsPerTick` pad entries.
    const vals = fig.variableValues();
    const ticks = fig.variableNamed(NAME, "ctl/ticks").id;
    const t0 = vals.get(ticks) as number;
    for (let e = 0; e < st.eventsPerTick!; e++) runFigmaActions(cell0.reactions[0].actions!, vals);
    expect(vals.get(ticks)).toBe(t0 + 1);
    // A Live · Main instance shows the same bound lights as the component.
    const inst = main.children.find((n) => n.type === "INSTANCE")!;
    const a = inst.findOne((n) => n.name === "arrow/PC_OUT")!.children.find((c) => c.name === "lit")!;
    expect(a.boundVariables.visible.id).toBe(fig.variableNamed(NAME, "net/PC_OUT").id);
    console.log(`[live] card: ${JSON.stringify(st)}`);

    // Building it again replaces the Live · * layers only: one of each, same spot, the rest untouched.
    const outside = () => snapshot(subtree(page).filter((n) => n !== page && !n.pathNames.some((p) => p.startsWith("Live · "))));
    const before = outside();
    const names = page.children.filter((n) => n.name.startsWith("Live · ")).map((n) => n.name).sort();
    const spot = { x: comp.x, y: comp.y };
    msgs.length = 0;
    await app.handle({ type: "live" });
    expect(msgs.filter((m) => m.type === "log" && m.level === "error")).toEqual([]);
    expect(page.children.filter((n) => n.name.startsWith("Live · ")).map((n) => n.name).sort()).toEqual(names);
    const again = page.children.find((n) => n.name === DASHBOARD_NAME)!;
    expect({ x: again.x, y: again.y }).toEqual(spot);
    expect(outside()).toEqual(before);
    // Compile still reads only the circuit (Live · * components are not cells) and the CPU verifies.
    expect((await app.verify(PROGRAMS.mul)).ok).toBe(true);
  });

  it("a session that did not compile builds and binds the dashboard but says why the controls are not wired", async () => {
    const msgs2: ToUi[] = [];
    const app2 = new SiliconApp(asApi(fig), (m) => msgs2.push(m), { yield: async () => {}, clockFrameMs: 0 });
    const r = await app2.liveView();
    expect(r.stats).toMatchObject({ wired: false, unbound: 0, unknown: 0 });
    expect(r.stats.note).toMatch(/press Compile, then Build Live view again/);
    expect(page.children.filter((n) => n.name === DASHBOARD_NAME).length).toBe(1);
    expect(page.children.filter((n) => n.name === "Live · Main").length).toBe(0);
  });
});
