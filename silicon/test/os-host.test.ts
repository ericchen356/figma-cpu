// The OS card's main side (plugin/src/os-host.ts): Load OS → loadImage + the Load program path,
// RAM → layer writes after each plugin-clock frame (diff only, by layer name), keymap events →
// RAM[IN] only when it reads 0. Everything runs the REAL gate-level CPU (FastSim over the
// compiled netlist) through PluginClock, first with a fake layer port, then end to end through
// SiliconApp on the fake Figma API (Build hardware → Compile → Load OS → Build OS demo → events).
import { describe, expect, it } from "vitest";
import helloSrc from "../os/hello-os.asm";
import helloBindings from "../os/hello-os.bindings.json";
import helloManifest from "../os/hello-os.json";
import { SiliconApp } from "../plugin/src/app";
import { type ClockSession, PluginClock, type VarRef } from "../plugin/src/clock";
import { DeviceBus, IN_ADDR } from "../plugin/src/devices";
import type { LogLevel, OsReport, ToUi } from "../plugin/src/messages";
import { type LayerLike, type LayerPort, OS_DEMO_FRAME, OsHost } from "../plugin/src/os-host";
import { assembleOrThrow, powerOnWith } from "../plugin/src/program";
import { compile } from "../src/compile";
import { cpuNetlist, PROBES, ramBit } from "../src/cpu";
import { OUT_ADDR, PROGRAMS, RAM_BYTES } from "../src/isa";
import { NET1 } from "../src/netlist/types";
import { plan } from "../src/prototype";
import { resetFonts } from "../src/figma/style";
import { FakeFigma, type FakeNode } from "./fake-figma";

const net = cpuNetlist();
const schedule = compile(net, { inputs: [] });
const MODE = "m";
/** The three files as the panel sends them: text. */
const FILES = {
  manifest: JSON.stringify(helloManifest, null, 2),
  source: helloSrc,
  bindings: JSON.stringify(helloBindings, null, 2),
};

class FakeVar {
  valuesByMode: Record<string, boolean | number | string>;
  constructor(
    value: boolean | number | string,
    readonly resolvedType: "BOOLEAN" | "FLOAT" | "STRING",
  ) {
    this.valuesByMode = { [MODE]: value };
  }
  setValueForMode(mode: string, value: boolean | number | string) {
    this.valuesByMode[mode] = value;
  }
}

/** Fake Figma variables for a RAM image, as SiliconApp.clockSession() builds them. */
function fakeSession(bytes: number[]) {
  const p = plan(net, schedule, { initial: powerOnWith(net, bytes), name: "Silicon", halt: PROBES.HALTED.name });
  const base = new Uint8Array(net.netNames.length);
  base[NET1] = 1;
  const vars = new Map<number, VarRef>();
  for (const v of p.variables) {
    base[v.net] = v.init ? 1 : 0;
    vars.set(v.net, { v: new FakeVar(!!v.init, "BOOLEAN") as unknown as Variable, mode: MODE });
  }
  const ticks: VarRef[] = [{ v: new FakeVar(0, "FLOAT") as unknown as Variable, mode: MODE }];
  const session: ClockSession = { net, schedule, base, vars, ticks, halt: p.halt ?? -1 };
  /** RAM byte as the variables show it. */
  const ram = (addr: number) => {
    let v = 0;
    for (let bit = 0; bit < 8; bit++) if (vars.get(net.aliases.get(ramBit(addr, bit))!)!.v.valuesByMode[MODE] === true) v |= 1 << bit;
    return v;
  };
  return { session, ram };
}

type Write = [string, string, unknown];

/** A fake layer: records every property write; text needs its font loaded first. */
class FakeLayer implements LayerLike {
  private v: Record<string, unknown> = { visible: true, x: 0, y: 0, opacity: 1, fills: [] };
  fontLoaded = false;
  constructor(
    readonly name: string,
    readonly type: "TEXT" | "FRAME",
    private readonly log: Write[],
  ) {
    if (type === "TEXT") this.v.characters = "";
  }
  private set_(k: string, val: unknown) {
    this.v[k] = val;
    this.log.push([this.name, k, k === "fills" ? (val as Array<{ color: unknown }>)[0].color : val]);
  }
  get visible() {
    return this.v.visible as boolean;
  }
  set visible(b) {
    this.set_("visible", b);
  }
  get x() {
    return this.v.x as number;
  }
  set x(n) {
    this.set_("x", n);
  }
  get y() {
    return this.v.y as number;
  }
  set y(n) {
    this.set_("y", n);
  }
  get opacity() {
    return this.v.opacity as number;
  }
  set opacity(n) {
    this.set_("opacity", n);
  }
  get fills() {
    return this.v.fills;
  }
  set fills(f) {
    this.set_("fills", f);
  }
  get characters() {
    return this.v.characters as string | undefined;
  }
  set characters(s) {
    if (this.type !== "TEXT") throw new Error("not text");
    if (!this.fontLoaded) throw new Error(`Cannot write to node with unloaded font`);
    this.set_("characters", s);
  }
}

/** The hello-os layers except `status` (to test the missing-layer report). */
function fakePort() {
  const writes: Write[] = [];
  const layers = new Map<string, FakeLayer>();
  for (const [name, type] of [
    ["window", "FRAME"],
    ["taskbar-button", "FRAME"],
    ["window-x-label", "TEXT"],
    ["window-move", "FRAME"],
  ] as const)
    layers.set(name, new FakeLayer(name, type, writes));
  const lookups: string[] = [];
  const port: LayerPort = {
    findByName(name) {
      lookups.push(name);
      return layers.get(name) ?? null;
    },
    async loadFont(layer) {
      (layer as FakeLayer).fontLoaded = true;
    },
  };
  return { port, writes, layers, lookups };
}

/** OsHost wired to a PluginClock exactly like SiliconApp wires them. */
function harness() {
  const bus = new DeviceBus();
  const logs: Array<[LogLevel, string]> = [];
  const posts: ToUi[] = [];
  const p = fakePort();
  let cur: ReturnType<typeof fakeSession> | null = null;
  let loads = 0;
  let clock: PluginClock;
  const host: OsHost = new OsHost({
    bus,
    port: p.port,
    log: (level, text) => logs.push([level, text]),
    post: (m) => posts.push(m),
    loadProgram: async (source) => {
      const bytes = assembleOrThrow(source); // what SiliconApp.loadProgram does first
      clock.invalidate();
      host.programLoaded(source);
      cur = fakeSession(bytes);
      loads++;
    },
  });
  clock = new PluginClock(async () => cur!.session, () => host.frame(), { frameMs: 0, devices: host });
  const step = async (n: number) => {
    await clock.step(n);
    await host.flush();
  };
  const reports = () => posts.filter((m): m is Extract<ToUi, { type: "os" }> => m.type === "os").map((m) => m.report);
  return { host, clock, bus, logs, posts, reports, step, ...p, ram: (a: number) => cur!.ram(a), loads: () => loads };
}

describe("OS host on the gate-level CPU (PluginClock + fake layer port)", () => {
  it("loader and bindings errors reach the UI verbatim and nothing is loaded", async () => {
    const h = harness();
    const badManifest = { ...helloManifest, ram: 2 * RAM_BYTES, regions: [...helloManifest.regions.slice(0, 1).map((r) => ({ ...r, end: OUT_ADDR })), ...helloManifest.regions.slice(1)] };
    const r = await h.host.load(JSON.stringify(badManifest), "loop: LD R9, [IN]\n", FILES.bindings);
    expect(r.ok).toBe(false);
    expect(r.loaded).toBe(false);
    expect(r.errors).toContain(`error [ram-size] manifest is for ${2 * RAM_BYTES} bytes of RAM; this machine has ${RAM_BYTES} (docs/CPU-V2.md prices larger RAM)`);
    expect(r.errors).toContain(`error [region-range] code region "code" ends at ${OUT_ADDR} (OUT); code and data must end below ${IN_ADDR} (${IN_ADDR} is INPUT, ${OUT_ADDR} is OUT)`);
    expect(r.errors.some((e) => /^error \[asm\] line 1: /.test(e))).toBe(true);
    // Invalid JSON and an invalid binding: their own precise messages.
    const j = await h.host.load("{ name: hello", FILES.source, JSON.stringify({ bindings: [{ ram: { addr: 15, bit: 9 }, node: "window", prop: "color" }] }));
    expect(j.errors[0]).toMatch(/^error \[manifest\] manifest: not valid JSON \(/);
    expect(j.errors).toContain('error [bindings] binding 0 (window.color): "prop" must be one of visible, x, y, text, fill, opacity');
    expect(j.errors).toContain("error [bindings] binding 0 (window.color): ram.bit must be 0–7");
    // Nothing went through Load program, the host is idle, and the panel got both reports.
    expect(h.loads()).toBe(0);
    expect(h.host.isActive).toBe(false);
    expect(h.reports().map((x) => x.loaded)).toEqual([false, false]);
    expect(h.logs.filter(([l]) => l === "error").map(([, t]) => t)).toEqual(["Load OS: 4 error(s), nothing loaded", "Load OS: 3 error(s), nothing loaded"]);
    expect(h.host.send({ type: "key", key: "o" })).toBe("unmapped");
  });

  it("hello-os: keymap events move and toggle the window; only changed properties are written; a missing layer is reported once", async () => {
    const h = harness();
    const r = await h.host.load(FILES.manifest, FILES.source, FILES.bindings);
    expect(r).toMatchObject({ ok: true, loaded: true, name: "hello-os", errors: [], warnings: [] });
    expect(r.regions.map((g) => `${g.name}:${g.kind}:${g.start}-${g.end}`)).toEqual(["code:code:0-11", `state:data:12-${IN_ADDR - 1}`, `input:input:${IN_ADDR}-${IN_ADDR}`, `flag:output:${OUT_ADDR}-${OUT_ADDR}`]);
    expect(r.bindings[1]).toEqual({ node: "window", prop: "x", ram: "RAM[12].0–6", map: "×24 + 40" });
    expect(r.keymap).toEqual({ click: { "taskbar-button": 128, "window-move": 1 }, key: { o: 128, ArrowRight: 1 } });
    expect(h.loads()).toBe(1);

    // First frame (power-on, PC 0): every bound property once.
    await h.step(0);
    expect(h.writes).toEqual([
      ["window", "visible", false],
      ["window", "x", 40],
      ["taskbar-button", "fills", { r: 0x3a / 255, g: 0x3a / 255, b: 0x3a / 255 }],
      ["window-x-label", "characters", "0"],
    ]);
    const missing = () => h.logs.filter(([, t]) => t.startsWith('OS: no layer named "status"'));
    expect(missing().length).toBe(1);

    // One hello-os loop is exactly 50 ticks, so 50-tick steps keep every poke at the loop top.
    const press = async (ev: Parameters<OsHost["send"]>[0]) => {
      h.writes.length = 0;
      expect(h.host.send(ev)).toBe("held");
      await h.step(50);
      expect(h.host.pending).toBeNull();
      expect(h.ram(IN_ADDR), "consumed").toBe(0);
      return [...h.writes];
    };
    expect(await press({ type: "click", node: "taskbar-button" })).toEqual([
      ["window", "visible", true],
      ["taskbar-button", "fills", { r: 0x2f / 255, g: 0x80 / 255, b: 0xed / 255 }],
    ]);
    expect(h.clock.status().probes.OUT).toBe(0x80);
    expect(await press({ type: "key", key: "ArrowRight" })).toEqual([
      ["window", "x", 64],
      ["window-x-label", "characters", "1"],
    ]);
    expect(await press({ type: "click", node: "window-move" })).toEqual([
      ["window", "x", 88],
      ["window-x-label", "characters", "2"],
    ]);
    expect(await press({ type: "key", key: "o" })).toEqual([
      ["window", "visible", false],
      ["taskbar-button", "fills", { r: 0x3a / 255, g: 0x3a / 255, b: 0x3a / 255 }],
    ]);
    expect(h.layers.get("window")!.x).toBe(88);
    // Idle loops: RAM moves (R regs, PC) but nothing bound changes, so nothing is written.
    h.writes.length = 0;
    await h.step(173);
    expect(h.writes).toEqual([]);
    // status changed 3 times but was reported once.
    expect(missing().length).toBe(1);
    expect(h.logs.filter(([l]) => l === "error").length).toBe(1);
    // Unmapped events are refused without touching RAM.
    expect(h.host.send({ type: "key", key: "q" })).toBe("unmapped");
    expect(h.host.pending).toBeNull();
  });

  it("a held key waits until RAM[IN] reads 0; at most one is held", async () => {
    const h = harness();
    await h.host.load(FILES.manifest, FILES.source, FILES.bindings);
    await h.step(0);
    // A raw input byte (the existing "input" message path) is sitting unconsumed in RAM[IN].
    h.bus.input(0x01);
    await h.step(0);
    expect(h.ram(IN_ADDR)).toBe(0x01);
    expect(h.host.send({ type: "click", node: "taskbar-button" })).toBe("held");
    expect(h.host.send({ type: "key", key: "ArrowRight" })).toBe("dropped");
    expect(h.logs.some(([, t]) => t.includes(`dropped: click "taskbar-button" (80) is still waiting for RAM[${IN_ADDR}] = 0`))).toBe(true);
    await h.step(0); // boundary with RAM[IN] = 1: not delivered
    expect(h.host.pending).toBe(0x80);
    expect(h.ram(IN_ADDR)).toBe(0x01);
    h.writes.length = 0;
    await h.step(50); // the OS consumes the 0x01 (x moves); the 0x80 is still held
    expect(h.ram(IN_ADDR)).toBe(0);
    expect(h.host.pending).toBe(0x80);
    expect(h.writes).toEqual([
      ["window", "x", 64],
      ["window-x-label", "characters", "1"],
    ]);
    h.writes.length = 0;
    await h.step(50); // RAM[IN] read 0 at this boundary: delivered, and the window opens
    expect(h.host.pending).toBeNull();
    expect(h.writes[0]).toEqual(["window", "visible", true]);
    expect(h.clock.status().probes.OUT & 0x80).toBe(0x80);
  });

  it("documents the lost-key race: a poke between LD [IN] and the consume ST is overwritten", async () => {
    const h = harness();
    await h.host.load(FILES.manifest, FILES.source, FILES.bindings);
    await h.step(0);
    await h.step(10); // inside "ST R3,[IN]": LD already read 0
    h.writes.length = 0;
    expect(h.host.send({ type: "click", node: "taskbar-button" })).toBe("held");
    await h.step(50);
    expect(h.host.pending).toBeNull(); // it was delivered (RAM[IN] read 0)…
    expect(h.ram(IN_ADDR)).toBe(0);
    expect(h.writes).toEqual([]); // …and lost: the window did not open
    expect(h.clock.status().probes.OUT).toBe(0);
  });

  it("loading another program turns the OS bindings off", async () => {
    const h = harness();
    await h.host.load(FILES.manifest, FILES.source, FILES.bindings);
    await h.step(0);
    h.host.programLoaded(PROGRAMS.count);
    expect(h.host.isActive).toBe(false);
    h.writes.length = 0;
    h.host.frame();
    await h.host.flush();
    expect(h.writes).toEqual([]);
  });
});

describe("OS card end to end through SiliconApp on the fake Figma API", () => {
  it("Load OS → Build OS demo → events write the real layers; errors load nothing", async () => {
    const fig = new FakeFigma(["Page 1"]);
    (globalThis as unknown as { figma: FakeFigma }).figma = fig;
    resetFonts();
    const msgs: ToUi[] = [];
    const app = new SiliconApp(fig as unknown as PluginAPI, (m) => msgs.push(m), { yield: async () => {}, clockFrameMs: 0 });
    await app.build({ gateLabels: false });
    await app.compile(PROGRAMS.mul);
    const page = fig.currentPage;
    const errors = () => msgs.filter((m): m is Extract<ToUi, { type: "log" }> => m.type === "log" && m.level === "error").map((m) => m.text);
    const lastReport = () => (msgs.filter((m) => m.type === "os").pop() as { report: OsReport } | undefined)?.report;

    // A broken OS: the report carries the loader's messages; the CPU keeps mul.
    await app.handle({ type: "os-load", manifest: FILES.manifest, source: "loop: LD R0, [IN]\n ST R0, [nowhere]\n JMP loop", bindings: FILES.bindings });
    expect(lastReport()).toMatchObject({ ok: false, loaded: false });
    expect(lastReport()!.errors.some((e) => e.startsWith("error [asm] line 2:"))).toBe(true);
    expect(app.os.isActive).toBe(false);
    expect((await app.status()).program).toBe("mul");

    // hello-os loads through Load program; the first sync finds no layers yet (one report per name).
    await app.handle({ type: "os-load", ...FILES });
    expect(lastReport()).toMatchObject({ ok: true, loaded: true, name: "hello-os" });
    expect((await app.status()).program).toBe("custom");
    const noLayer = errors().filter((t) => t.startsWith("OS: no layer named"));
    expect(noLayer.map((t) => /"([^"]+)"/.exec(t)![1]).sort()).toEqual(["status", "taskbar-button", "window", "window-x-label"]);

    // Build OS demo: the named layers in a frame "OS demo" right of the CPU · Step frame, synced at once.
    await app.handle({ type: "os-demo" });
    const demo = page.children.filter((n) => n.name === OS_DEMO_FRAME);
    expect(demo.length).toBe(1);
    const step = page.children.find((n) => n.name === "CPU · Step")!;
    expect(demo[0].x).toBeGreaterThan(step.x + step.width);
    const L = (name: string) => demo[0].findOne((n) => n.name === name) as FakeNode;
    for (const n of ["window", "taskbar-button", "status", "window-x-label", "window-move"]) expect(L(n), n).toBeTruthy();
    expect(L("status").type).toBe("TEXT");
    expect(L("window").visible).toBe(false);
    expect(L("window").x).toBe(40);
    expect(L("status").characters).toBe("closed");
    expect(L("window-x-label").characters).toBe("0");

    const send = async (event: { type: "click"; node: string } | { type: "key"; key: string }) => {
      await app.handle({ type: "os-event", event });
      await app.clock.step(50);
      await app.os.flush();
    };
    await send({ type: "click", node: "taskbar-button" });
    expect(L("window").visible).toBe(true);
    expect(L("status").characters).toBe("open");
    expect((L("taskbar-button").fills as Array<{ color: { b: number } }>)[0].color.b).toBeCloseTo(0xed / 255);
    await send({ type: "key", key: "ArrowRight" });
    await send({ type: "click", node: "window-move" });
    expect(L("window").x).toBe(88);
    expect(L("window-x-label").characters).toBe("2");

    // Idempotent: a second Build OS demo creates nothing.
    await app.handle({ type: "os-demo" });
    expect(page.children.filter((n) => n.name === OS_DEMO_FRAME).length).toBe(1);
    expect(page.findAll((n) => n.name === "window").length).toBe(1);
    const lastOk = msgs.filter((m) => m.type === "log" && m.level === "ok").pop() as { text: string };
    expect(lastOk.text).toMatch(/^OS demo: nothing to create; already there: OS demo, window/);
    expect(errors().filter((t) => !t.startsWith("OS: no layer named"))).toEqual(["Load OS: 1 error(s), nothing loaded"]); // the broken OS above

    // Loading a plain program turns the OS off; Run OS then refuses.
    await app.handle({ type: "load", source: PROGRAMS.count });
    expect(app.os.isActive).toBe(false);
    await app.handle({ type: "os-run" });
    expect(errors().pop()).toBe("Run OS: no OS loaded (Load OS first)");
  });
});
