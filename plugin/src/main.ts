// FigmaCPU plugin main thread — the "physics" (PRD §4).
// Reads the opcode table off the canvas, steps the CPU, and writes the new state back.
import {
  assemble,
  buildTable,
  Cpu,
  type CpuSnapshot,
  IO,
  MEMORY,
  type OpTable,
  run,
  Rtl,
  stepInstruction,
  type TableError,
  type TResult,
} from "./core";
import { bindMachine, type Bound, findMachine, MACHINE_FRAME, readRows } from "./figma/bind";
import { Renderer, type ViewMode } from "./figma/render";

type RunMode = "watch" | "turbo";

const cpu = new Cpu();
let table: OpTable = buildTable([]).table;
let tableErrors: TableError[] = [];
let tableKey = "";
const rtl = new Rtl(cpu, () => table);

let bound: Bound | null = null;
let renderer: Renderer | null = null;
let running: RunMode | null = null;
let hz = 4;
let pinBase = MEMORY.ramStart;
let viewMode: ViewMode = "instr";
let tres: TResult | null = null;
let source = "";
let lineAddr: Record<number, number> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let screenBusy = false;
let lastScreen = 0;
let lastTick = Date.now();
let ips = 0;
/** PC of the instruction currently executing in Watch mode (for the editor line marker). */
let lastInstrPc = 0;
/** Screen images applied to the canvas so far (shown in the panel for debugging). */
let screens = 0;


figma.showUI(__html__, { width: 480, height: 880, title: "FigmaCPU" });
const post = (msg: unknown) => figma.ui.postMessage(msg);

// ---------- table ----------

/** Re-reads the opcode table from the canvas; rebuilds the decoder only if the text changed. */
function refreshTable(): void {
  if (!bound) return;
  const rows = readRows(bound);
  const key = JSON.stringify(rows);
  if (key === tableKey) return;
  tableKey = key;
  const built = buildTable(rows);
  table = built.table;
  tableErrors = built.errors;
  post({ type: "table", rows: table.rows.length, errors: tableErrors });
}

// ---------- persistence (canonical state lives in the document) ----------

function saveState(): void {
  if (!bound) return;
  const pages: Record<number, string> = {};
  for (let p = 0; p < 256; p++) {
    const page = cpu.mem.subarray(p * 256, p * 256 + 256);
    if (page.some((b) => b !== 0)) pages[p] = figma.base64Encode(page);
  }
  const ram = bound.byName.get("mem/ram") ?? bound.root;
  ram.setPluginData("cpu", JSON.stringify({ snap: cpu.snapshot(), tstates: cpu.tstates, pinBase, pages }));
  ram.setPluginData("source", source);
}

function restoreState(): boolean {
  if (!bound) return false;
  const ram = bound.byName.get("mem/ram") ?? bound.root;
  source = ram.getPluginData("source");
  const raw = ram.getPluginData("cpu");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as { snap: CpuSnapshot; tstates: number; pinBase: number; pages: Record<string, string> };
    cpu.mem.fill(0);
    for (const [p, b64] of Object.entries(s.pages)) cpu.mem.set(figma.base64Decode(b64), Number(p) * 256);
    cpu.restore(s.snap);
    cpu.tstates = s.tstates;
    pinBase = s.pinBase;
    cpu.vramDirty = true;
    return true;
  } catch {
    return false;
  }
}

// ---------- drawing ----------

function render(): void {
  if (!renderer) return;
  renderer.render({ cpu, table, mode: viewMode, tres, pinBase });
  const line = Object.entries(lineAddr).find(([, a]) => a === (viewMode === "watch" && rtl.midInstruction ? lastInstrPc : cpu.pc));
  post({
    type: "status",
    running,
    halted: cpu.halted,
    fault: cpu.fault,
    pc: cpu.pc,
    sp: cpu.sp,
    ir: cpu.ir,
    mnem: table.byOp[cpu.ir]?.mnem ?? "???",
    regs: Array.from(cpu.r),
    flags: { z: cpu.z, c: cpu.c, n: cpu.n },
    instructions: cpu.instructions,
    tstates: cpu.tstates,
    t: viewMode === "watch" && tres ? tres.t : null,
    sigs: viewMode === "watch" && tres ? tres.sigs.map((s) => (s.r !== undefined ? `${s.s}(${s.r})` : s.op ? `${s.s}:${s.op}` : s.s)) : [],
    ips,
    line: line ? Number(line[0]) : null,
    pinBase,
    mouse: [cpu.mem[IO.MOUSE_X], cpu.mem[IO.MOUSE_Y], cpu.mem[IO.MOUSE_BTN]],
    queue: cpu.mouseQueue.length,
    screens,
  });
}

/** Sends VRAM to the UI, which encodes a crisp PNG and sends it back (PRD §8). */
function maybeScreen(force = false): void {
  const now = Date.now();
  // A lost or failed round trip must not freeze the screen forever: give up after 1 s.
  if (screenBusy && now - lastScreen > 1000) {
    screenBusy = false;
    cpu.vramDirty = true;
  }
  if (!cpu.vramDirty || screenBusy) return;
  if (!force && running === "turbo" && now - lastScreen < 66) return;
  cpu.vramDirty = false;
  screenBusy = true;
  lastScreen = now;
  post({ type: "vram", vram: cpu.mem.slice(MEMORY.vramStart, MEMORY.vramEnd + 1) });
}

// ---------- clock ----------

function frameClock(): void {
  const now = Date.now();
  if (now - lastTick >= 33) {
    cpu.frame();
    lastTick = now;
  }
}

function stop(): void {
  running = null;
  if (timer) clearTimeout(timer);
  timer = null;
  ips = 0;
  saveState();
  render();
  maybeScreen(true);
}

function watchTick(): void {
  if (running !== "watch") return;
  refreshTable();
  frameClock();
  if (!rtl.midInstruction) lastInstrPc = cpu.pc;
  tres = rtl.step();
  viewMode = "watch";
  render();
  maybeScreen();
  if (cpu.halted) return stop();
  timer = setTimeout(watchTick, 1000 / hz);
}

function turboTick(): void {
  if (running !== "turbo") return;
  refreshTable();
  rtl.finishInstruction();
  const start = Date.now();
  const before = cpu.instructions;
  while (Date.now() - start < 20 && !cpu.halted) run(cpu, table, 2000);
  const elapsed = Math.max(1, Date.now() - start);
  ips = Math.round(((cpu.instructions - before) * 1000) / elapsed);
  cpu.frame();
  lastTick = Date.now();
  viewMode = "instr";
  tres = null;
  render();
  maybeScreen();
  if (cpu.halted) return stop();
  timer = setTimeout(turboTick, 12);
}

function start(mode: RunMode): void {
  if (cpu.halted) return render();
  if (timer) clearTimeout(timer);
  running = mode;
  if (mode === "watch") watchTick();
  else turboTick();
}

// ---------- program loading ----------

function loadProgram(src: string): void {
  refreshTable();
  const res = assemble(src, table);
  post({ type: "asm", ok: res.ok, errors: res.errors, size: res.size, entry: res.entry, lineAddr: res.lineAddr });
  if (!res.ok) return;
  if (timer) clearTimeout(timer);
  running = null;
  source = src;
  lineAddr = res.lineAddr;
  cpu.reset(true);
  for (const c of res.chunks) cpu.load(c.addr, c.bytes);
  cpu.pc = res.entry;
  rtl.reset();
  tres = null;
  viewMode = "instr";
  saveState();
  render();
  maybeScreen(true);
}

// ---------- UI messages ----------

figma.ui.onmessage = (msg: { type: string; [k: string]: unknown }) => {
  switch (msg.type) {
    case "load":
      return loadProgram(String(msg.source));
    case "reset":
      return loadProgram(source);
    case "step-t":
      if (running) stop();
      refreshTable();
      if (!rtl.midInstruction) lastInstrPc = cpu.pc;
      tres = rtl.step();
      viewMode = "watch";
      render();
      return maybeScreen(true);
    case "step-i":
      if (running) stop();
      refreshTable();
      if (rtl.midInstruction) rtl.finishInstruction();
      else stepInstruction(cpu, table);
      tres = null;
      viewMode = "instr";
      render();
      return maybeScreen(true);
    case "run":
      return start(msg.mode === "turbo" ? "turbo" : "watch");
    case "pause":
      return stop();
    case "hz":
      hz = Math.max(0.5, Math.min(60, Number(msg.hz) || 4));
      return;
    case "mouse": {
      // Queued, not written directly: the program consumes one sample per MOUSE_BTN read.
      for (const [x, y, b] of msg.samples as [number, number, boolean][])
        cpu.pushMouse(
          Math.max(0, Math.min(MEMORY.width - 1, Math.floor(x))),
          Math.max(0, Math.min(MEMORY.height - 1, Math.floor(y))),
          b ? 1 : 0,
        );
      if (running !== "turbo") render();
      return;
    }
    case "key":
      cpu.mem[IO.KEY] = Number(msg.code) & 0xff;
      if (!running) render();
      return;
    case "pin":
      pinBase = Number(msg.base) & 0xffff;
      return render();
    case "png": {
      screenBusy = false;
      try {
        renderer?.setScreen(figma.createImage(msg.bytes as Uint8Array).hash);
        screens++;
      } catch (e) {
        post({ type: "warn", msg: `screen image failed: ${String(e)}` });
      }
      if (!running) {
        render();
        maybeScreen(true);
      }
      return;
    }
    case "png-failed":
      screenBusy = false;
      post({ type: "warn", msg: `screen encode failed: ${String(msg.msg ?? "")}` });
      return;
  }
};

figma.on("close", () => {
  if (timer) clearTimeout(timer);
  saveState();
});

async function init(): Promise<void> {
  const root = findMachine();
  if (!root) {
    post({
      type: "fatal",
      msg: `No "${MACHINE_FRAME}" frame on this page. Open the page with the drawn machine (e.g. "Eric" or "Machine v2") and run the plugin again.`,
    });
    return;
  }
  bound = await bindMachine(root);
  renderer = new Renderer(bound);
  refreshTable();
  const restored = restoreState();
  post({ type: "ready", source, restored, missing: bound.missing, page: figma.currentPage.name });
  if (source) {
    const res = assemble(source, table);
    lineAddr = res.lineAddr;
  }
  render();
  maybeScreen(true);
}

init().catch((e) => post({ type: "fatal", msg: String(e?.stack || e) }));
