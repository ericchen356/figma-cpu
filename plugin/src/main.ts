// Plugin main thread: binds to the drawn machine, keeps the decoder table in sync with
// the canvas, and drives the clock — Watch mode animates FETCH/DECODE/EXEC for every
// instruction, Turbo mode runs flat out and syncs the canvas once per frame.
import { assemble } from "./assembler";
import { bind, readTableRows, type Bound } from "./binder";
import { CPU, SCREEN_H, SCREEN_W, Trace } from "./cpu";
import { loadState, saveState } from "./persist";
import { LIBRARIES, PROGRAMS } from "./programs";
import { Renderer } from "./render";
import { ScreenSync } from "./screen";
import { parseTable } from "./table";

type Mode = "watch" | "turbo";
type UiMessage =
  | { type: "assemble"; source: string; name?: string }
  | { type: "step" | "run" | "pause" | "reset" | "reloadTable" | "focus" }
  | { type: "mode"; mode: Mode }
  | { type: "hz"; hz: number }
  | { type: "mouse"; x: number; y: number; btn: number }
  | { type: "key"; code: number }
  | { type: "pin"; addr: number }
  | { type: "png"; bytes: Uint8Array };

figma.showUI(__html__, { width: 460, height: 900, title: "FigmaCPU v2" });

let b: Bound;
let r: Renderer;
let screen: ScreenSync;
let cpu: CPU;
let tableErrors: string[] = [];
let tableIds = new Set<string>();
let mode: Mode = "watch";
let hz = 4;
let running = false;
let runToken = 0;
let busy = false;
let ips = 0;
const tickStart = Date.now();

const post = (msg: unknown) => figma.ui.postMessage(msg);
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function postState() {
  post({
    type: "state",
    regs: [...cpu.regs],
    pc: cpu.pc,
    sp: cpu.sp,
    ir: cpu.ir,
    mnem: cpu.table.entries[cpu.ir]?.mnem ?? "???",
    flags: { Z: cpu.Z, C: cpu.C, N: cpu.N },
    cycles: cpu.cycles,
    halted: cpu.halted,
    error: cpu.error,
    running,
    mode,
    ips: running && mode === "turbo" ? ips : null,
  });
}

/** Re-reads the opcode table from the canvas. This is what makes the canvas the CPU's logic. */
function loadTable() {
  const { rows, errors } = readTableRows(b);
  const parsed = parseTable(rows);
  cpu.table = parsed.table;
  tableErrors = [...errors, ...parsed.errors];
  tableIds = new Set([b.table.id]);
  const frameById = new Map(rows.map((row) => [row.where, row.frame]));
  for (const row of rows) {
    tableIds.add(row.frame.id);
    for (const t of row.texts) tableIds.add(t.id);
  }
  r.rows.clear();
  for (const e of parsed.table.entries)
    if (e) r.rows.set(e.op, frameById.get(e.where)!);
  post({ type: "table", count: parsed.table.byMnem.size, errors: tableErrors });
}

function watchTable() {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const inTable = (node: SceneNode | RemovedNode) => {
    if (node.removed) return tableIds.has(node.id);
    for (let n: BaseNode | null = node; n; n = n.parent)
      if (n.id === b.table.id) return true;
    return false;
  };
  b.page.on("nodechange", (e) => {
    const touched = e.nodeChanges.some((c) =>
      c.type === "PROPERTY_CHANGE"
        ? (c.properties.includes("characters") ||
            c.properties.includes("name")) &&
          tableIds.has(c.id)
        : inTable(c.node),
    );
    if (!touched) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      loadTable();
      if (!running) r.renderExec(cpu, null);
    }, 250);
  });
}

function updateTick() {
  cpu.io.tick = Math.floor((Date.now() - tickStart) / 33) & 0xff;
}

/** One instruction, animated as three phases. Bails out quietly if the run is cancelled. */
async function stepWatch(phaseMs: number, token: number) {
  const tr = new Trace();
  cpu.step(tr);
  r.renderFetch(cpu, tr);
  await sleep(phaseMs);
  if (token !== runToken) return r.renderExec(cpu, null);
  r.renderDecode(cpu, tr);
  await sleep(phaseMs);
  if (token !== runToken) return r.renderExec(cpu, null);
  r.renderExec(cpu, tr);
  screen.sync(cpu, 0);
  postState();
  await sleep(phaseMs);
}

async function loop(token: number) {
  let t0 = Date.now();
  let c0 = cpu.cycles;
  while (running && token === runToken && !cpu.halted) {
    updateTick();
    if (mode === "watch") {
      await stepWatch(1000 / hz / 3, token);
    } else {
      const start = Date.now();
      while (!cpu.halted && Date.now() - start < 25) {
        for (let i = 0; i < 2000 && !cpu.halted; i++) cpu.step();
        updateTick();
      }
      r.renderExec(cpu, null);
      screen.sync(cpu, 150);
      postState();
      await sleep(4);
    }
    const now = Date.now();
    if (now - t0 >= 1000) {
      ips = Math.round(((cpu.cycles - c0) * 1000) / (now - t0));
      t0 = now;
      c0 = cpu.cycles;
    }
  }
  if (token === runToken) stop();
}

function start() {
  if (running || cpu.halted) return;
  running = true;
  void loop(++runToken);
  postState();
}

function stop() {
  running = false;
  runToken++;
  r.renderExec(cpu, null);
  screen.sync(cpu, 0);
  postState();
  saveState(b.root, cpu, r.pinBase);
}

async function handle(msg: UiMessage) {
  switch (msg.type) {
    case "assemble": {
      if (running) stop();
      loadTable();
      const res = assemble(msg.source, cpu.table, {
        includes: LIBRARIES,
        file: msg.name ?? "main.asm",
      });
      if (!res.ok) return post({ type: "asm", ok: false, errors: res.errors });
      cpu.load(res.segments);
      r.ramBase = 0;
      screen.invalidate();
      r.renderExec(cpu, null);
      screen.sync(cpu, 0);
      saveState(b.root, cpu, r.pinBase);
      postState();
      return post({
        type: "asm",
        ok: true,
        size: res.size,
        segments: res.segments.map((s) => [s.start, s.bytes.length]),
      });
    }
    case "step":
      if (running || busy || cpu.halted) return;
      busy = true;
      updateTick();
      if (mode === "watch") await stepWatch(180, runToken);
      else {
        cpu.step();
        r.renderExec(cpu, null);
        screen.sync(cpu, 0);
      }
      busy = false;
      return postState();
    case "run":
      return start();
    case "pause":
      return running ? stop() : undefined;
    case "reset":
      if (running) stop();
      cpu.reset();
      r.renderExec(cpu, null);
      screen.sync(cpu, 0);
      return postState();
    case "mode":
      mode = msg.mode;
      return postState();
    case "hz":
      hz = Math.max(0.5, Math.min(30, msg.hz));
      return;
    case "mouse":
      cpu.io.mouseX = Math.max(0, Math.min(SCREEN_W - 1, msg.x | 0));
      cpu.io.mouseY = Math.max(0, Math.min(SCREEN_H - 1, msg.y | 0));
      cpu.io.mouseBtn = msg.btn & 1;
      if (!running) r.renderExec(cpu, null);
      return;
    case "key":
      cpu.io.key = msg.code & 0xff;
      if (!running) r.renderExec(cpu, null);
      return;
    case "pin":
      r.pinBase = msg.addr & 0xffff;
      return r.renderExec(cpu, null);
    case "png":
      return screen.onPng(msg.bytes);
    case "reloadTable":
      loadTable();
      return r.renderExec(cpu, null);
    case "focus":
      await figma.setCurrentPageAsync(b.page);
      return figma.viewport.scrollAndZoomIntoView([b.root]);
  }
}

async function init() {
  const { bound, missing } = await bind();
  if (!bound) return post({ type: "fatal", missing });
  b = bound;
  r = new Renderer(b);
  cpu = new CPU(parseTable([]).table);
  screen = new ScreenSync(b.screen, post);
  loadTable();
  const pin = loadState(b.root, cpu);
  if (pin !== null) r.pinBase = pin;
  if (figma.currentPage !== b.page) await figma.setCurrentPageAsync(b.page);
  r.renderExec(cpu, null);
  screen.sync(cpu, 0);
  post({
    type: "init",
    programs: PROGRAMS,
    restored: pin !== null,
    pin: r.pinBase,
  });
  postState();
  watchTable();
}

figma.ui.onmessage = (msg: UiMessage) => {
  handle(msg).catch((e: Error) => post({ type: "error", message: e.message }));
};
figma.on("close", () => {
  if (b && cpu) saveState(b.root, cpu, r.pinBase);
});
init().catch((e: Error) =>
  post({ type: "fatal", missing: [], message: e.message }),
);
