// Leila CPU plugin main thread: reads the opcode table off the canvas, steps the CPU, and writes
// the new state back. The CPU's behavior is the table on the canvas; this file is only the clock.

const cpu = new CORE.Cpu();
let table = CORE.buildTable([]).table;
let tableErrors = [];
let tableKey = "";
const rtl = new CORE.Rtl(cpu, () => table);

let bound = null;
let renderer = null;
let running = null; // "watch" | "turbo" | null
let hz = 4;
let pinBase = CORE.MEMORY.ramStart;
let viewMode = "instr"; // "watch" shows T-state detail, "instr" shows whole instructions
let tres = null;
let source = "";
let lineAddr = {};
let timer = null;
let screenBusy = false;
let lastScreen = 0;
let lastTick = Date.now();
let ips = 0;
let lastInstrPc = 0;
let screens = 0;

figma.showUI(__html__, { width: 480, height: 900, title: "Leila CPU" });
const post = (msg) => figma.ui.postMessage(msg);

// ---------- opcode table ----------

/** Re-reads the opcode table from the canvas; rebuilds the decoder only when its text changed. */
function refreshTable() {
  if (!bound) return;
  const rows = readRows(bound);
  const key = JSON.stringify(rows);
  if (key === tableKey) return;
  tableKey = key;
  const built = CORE.buildTable(rows);
  table = built.table;
  tableErrors = built.errors;
  post({ type: "table", rows: table.rows.length, errors: tableErrors });
}

// ---------- persistence: state lives in the document ----------

function stateNode() {
  return bound.byName.get("mem/ram") || bound.root;
}

function saveState() {
  if (!bound) return;
  const pages = {};
  for (let p = 0; p < 256; p++) {
    const page = cpu.mem.subarray(p * 256, p * 256 + 256);
    if (page.some((b) => b !== 0)) pages[p] = figma.base64Encode(page);
  }
  stateNode().setPluginData("leila-cpu", JSON.stringify({ snap: cpu.snapshot(), tstates: cpu.tstates, pinBase, pages }));
  stateNode().setPluginData("leila-source", source);
}

function restoreState() {
  if (!bound) return false;
  source = stateNode().getPluginData("leila-source");
  const raw = stateNode().getPluginData("leila-cpu");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    cpu.mem.fill(0);
    for (const p of Object.keys(s.pages)) cpu.mem.set(figma.base64Decode(s.pages[p]), Number(p) * 256);
    cpu.restore(s.snap);
    cpu.tstates = s.tstates;
    pinBase = s.pinBase;
    cpu.vramDirty = true;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- drawing ----------

function render() {
  if (!renderer) return;
  renderer.render({ cpu, table, mode: viewMode, tres, pinBase });
  const at = viewMode === "watch" && rtl.midInstruction ? lastInstrPc : cpu.pc;
  const line = Object.keys(lineAddr).find((k) => lineAddr[k] === at);
  const row = table.byOp[cpu.ir];
  post({
    type: "status",
    running,
    halted: cpu.halted,
    fault: cpu.fault,
    pc: cpu.pc,
    sp: cpu.sp,
    ir: cpu.ir,
    mnem: row ? row.mnem : "???",
    regs: Array.from(cpu.r),
    flags: { z: cpu.z, c: cpu.c, n: cpu.n },
    instructions: cpu.instructions,
    tstates: cpu.tstates,
    t: viewMode === "watch" && tres ? tres.t : null,
    sigs: viewMode === "watch" && tres ? tres.sigs.map((s) => (s.r !== undefined ? `${s.s}(${CORE.REGISTERS[s.r]})` : s.op ? `${s.s}:${s.op}` : s.s)) : [],
    ips,
    line: line ? Number(line) : null,
    pinBase,
    mouse: [cpu.mem[CORE.IO.MOUSE_X], cpu.mem[CORE.IO.MOUSE_Y], cpu.mem[CORE.IO.MOUSE_BTN]],
    screens,
  });
}

/** Sends VRAM to the panel, which encodes a crisp PNG and sends it back for the screen fill. */
function maybeScreen(force) {
  const now = Date.now();
  if (screenBusy && now - lastScreen > 1000) {
    screenBusy = false; // a lost round trip must not freeze the screen
    cpu.vramDirty = true;
  }
  if (!cpu.vramDirty || screenBusy) return;
  if (!force && running === "turbo" && now - lastScreen < 66) return;
  cpu.vramDirty = false;
  screenBusy = true;
  lastScreen = now;
  post({ type: "vram", vram: cpu.mem.slice(CORE.MEMORY.vramStart, CORE.MEMORY.vramEnd + 1) });
}

// ---------- clock ----------

function frameClock() {
  const now = Date.now();
  if (now - lastTick >= 33) {
    cpu.frame();
    lastTick = now;
  }
}

function stop() {
  running = null;
  if (timer) clearTimeout(timer);
  timer = null;
  ips = 0;
  saveState();
  render();
  maybeScreen(true);
}

function watchTick() {
  if (running !== "watch") return;
  refreshTable();
  frameClock();
  if (!rtl.midInstruction) lastInstrPc = cpu.pc;
  tres = rtl.step();
  viewMode = "watch";
  render();
  maybeScreen(false);
  if (cpu.halted) return stop();
  timer = setTimeout(watchTick, 1000 / hz);
}

function turboTick() {
  if (running !== "turbo") return;
  refreshTable();
  rtl.finishInstruction();
  const start = Date.now();
  const before = cpu.instructions;
  while (Date.now() - start < 20 && !cpu.halted) CORE.runInstructions(cpu, table, 2000);
  ips = Math.round(((cpu.instructions - before) * 1000) / Math.max(1, Date.now() - start));
  cpu.frame();
  lastTick = Date.now();
  viewMode = "instr";
  tres = null;
  render();
  maybeScreen(false);
  if (cpu.halted) return stop();
  timer = setTimeout(turboTick, 12);
}

function start(mode) {
  if (cpu.halted) return render();
  if (timer) clearTimeout(timer);
  running = mode;
  if (mode === "watch") watchTick();
  else turboTick();
}

// ---------- programs ----------

function loadProgram(src) {
  refreshTable();
  const res = CORE.assemble(src, table);
  post({ type: "asm", ok: res.ok, errors: res.errors, size: res.size, entry: res.entry });
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

// ---------- panel messages ----------

figma.ui.onmessage = (msg) => {
  switch (msg.type) {
    case "load":
      loadProgram(String(msg.source));
      if (msg.run && !cpu.halted && source === String(msg.source)) start(msg.run === "turbo" ? "turbo" : "watch");
      return;
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
      else CORE.stepInstruction(cpu, table);
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
    case "mouse":
      for (const s of msg.samples)
        cpu.pushMouse(
          Math.max(0, Math.min(CORE.MEMORY.width - 1, Math.floor(s[0]))),
          Math.max(0, Math.min(CORE.MEMORY.height - 1, Math.floor(s[1]))),
          s[2] ? 1 : 0,
        );
      if (running !== "turbo") render();
      return;
    case "key":
      cpu.mem[CORE.IO.KEY] = Number(msg.code) & 0xff;
      if (!running) render();
      return;
    case "pin":
      pinBase = Number(msg.base) & 0xffff;
      return render();
    case "png":
      screenBusy = false;
      try {
        renderer.setScreen(figma.createImage(msg.bytes).hash);
        screens++;
      } catch (e) {
        post({ type: "warn", msg: `screen image failed: ${String(e)}` });
      }
      if (!running) {
        render();
        maybeScreen(true);
      }
      return;
    case "png-failed":
      screenBusy = false;
      post({ type: "warn", msg: `screen encode failed: ${String(msg.msg || "")}` });
      return;
  }
};

// Keep the CPU on its own page: if someone switches pages while it runs, pause it.
figma.on("currentpagechange", () => {
  if (bound && figma.currentPage !== bound.root.parent && running) {
    stop();
    post({ type: "warn", msg: `Paused: Leila CPU only runs on the ${HOME_PAGE} page. Switch back and press Watch or Turbo.` });
  }
});

figma.on("close", () => {
  if (timer) clearTimeout(timer);
  saveState();
});

const HOME_PAGE = "Leila";

/** Always drives the machine on the Leila page, whichever page the plugin was launched from,
 * so it never writes over the Eric or Machine v2 drawings (their own plugin runs those). */
async function locateMachine() {
  const home = figma.root.children.find((p) => p.name === HOME_PAGE);
  if (!home) return null;
  if (figma.currentPage !== home) await figma.setCurrentPageAsync(home);
  return findMachine(home);
}

async function init() {
  const root = await locateMachine();
  if (!root) {
    post({ type: "fatal", msg: `No "${MACHINE_FRAME}" frame on the ${HOME_PAGE} page. Draw it first with the "FigmaCPU — draw Leila page" plugin.` });
    return;
  }
  bound = await bindMachine(root);
  renderer = new Renderer(bound);
  refreshTable();
  const restored = restoreState();
  post({ type: "ready", source, restored, missing: bound.missing, page: figma.currentPage.name, perSignalTaps: renderer.perSignalTaps });
  if (source) lineAddr = CORE.assemble(source, table).lineAddr;
  render();
  maybeScreen(true);
}

init().catch((e) => post({ type: "fatal", msg: String((e && e.stack) || e) }));
