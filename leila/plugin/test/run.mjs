// Node tests for the Leila CPU plugin: programs, T-state engine ≡ interpreter, bus rule, and the
// binder + renderer against the real Leila drawing in an in-memory fake of the Figma API.
// Usage (from plugin/): node build.mjs && node test/run.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(here, p), "utf8");
const json = (p) => JSON.parse(read(p));
const opcodes = json("../spec/opcodes.json");
const SPEC = {
  registers: opcodes.registers, formats: opcodes.formats, opcodes: opcodes.opcodes,
  palette: json("../spec/palette.json"), memory: json("../spec/memory-map.json"), signals: json("../spec/signals.json"),
};
const CORE_FILES = ["spec", "micro", "cpu", "rtl", "asm", "index"].map((f) => read(`src/core/${f}.js`)).join("\n");
const CORE = new Function("SPEC", `${CORE_FILES}\nreturn CORE;`)(SPEC);
const programs = {};
for (const f of readdirSync(join(here, "programs"))) programs[f.replace(".asm", "")] = read(`programs/${f}`);

let passed = 0;
const failures = [];
const pending = [];
function test(name, fn) {
  const ok = () => {
    passed++;
    console.log(`  ok  ${name}`);
  };
  const fail = (e) => {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.message}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") pending.push(r.then(ok, fail));
    else ok();
  } catch (e) {
    fail(e);
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

const { table, errors } = CORE.buildTable(SPEC.opcodes);
const VRAM = CORE.MEMORY.vramStart;
const W = CORE.MEMORY.width;

function boot(name) {
  const res = CORE.assemble(programs[name], table);
  if (!res.ok) throw new Error(`${name} does not assemble: ${JSON.stringify(res.errors)}`);
  const cpu = new CORE.Cpu();
  for (const c of res.chunks) cpu.load(c.addr, c.bytes);
  cpu.pc = res.entry;
  return cpu;
}
const vramCount = (cpu, color) => {
  let n = 0;
  for (let a = VRAM; a <= CORE.MEMORY.vramEnd; a++) if ((cpu.mem[a] & 15) === color) n++;
  return n;
};

console.log("table and assembler");
test("opcode table from spec has 29 rows and no errors", () => {
  eq(table.rows.length, 29, "rows");
  eq(errors, [], "errors");
});
for (const name of Object.keys(programs)) test(`${name}.asm assembles`, () => boot(name));
test("a bad table row is reported, not fatal", () => {
  const rows = SPEC.opcodes.map((o) => (o.mnem === "ADD" ? Object.assign({}, o, { micro: "REG; ALU FOO rd rs" }) : o));
  const b = CORE.buildTable(rows);
  eq(b.table.rows.length, 28, "rows");
  eq(b.errors.length, 1, "errors");
});

console.log("programs");
test("count: A reaches 10 and halts", () => {
  const cpu = boot("count");
  CORE.runInstructions(cpu, table, 1000);
  eq(cpu.halted, true, "halted");
  eq(cpu.fault, null, "fault");
  eq(cpu.r[0], 10, "A");
});
test("fib: Fibonacci bytes at 4000", () => {
  const cpu = boot("fib");
  CORE.runInstructions(cpu, table, 10000);
  eq(cpu.halted, true, "halted");
  eq(Array.from(cpu.mem.slice(0x4000, 0x400e)), [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233], "fib");
});
test("rect: a 40×32 red rectangle at (20, 16)", () => {
  const cpu = boot("rect");
  CORE.runInstructions(cpu, table, 100000);
  eq(cpu.halted, true, "halted");
  eq(vramCount(cpu, 8), 40 * 32, "red pixels");
  eq(cpu.mem[VRAM + 16 * W + 20], 8, "top-left");
  eq(cpu.mem[VRAM + 47 * W + 59], 8, "bottom-right");
  eq(cpu.mem[VRAM + 48 * W + 60], 0, "outside");
});
test("bounce: square moves for 140 frames without a fault", () => {
  const cpu = boot("bounce");
  const xs = new Set();
  for (let f = 0; f < 140; f++) {
    CORE.runInstructions(cpu, table, 3000);
    cpu.frame();
    xs.add(cpu.mem[CORE.MEMORY.ramStart]);
  }
  eq(cpu.fault, null, "fault");
  if (xs.size < 50) throw new Error(`x only took ${xs.size} values`);
  const blue = vramCount(cpu, 12);
  if (blue !== 0 && blue !== 64) throw new Error(`expected 0 or 64 blue pixels, got ${blue}`);
});
test("paint: a mouse stroke paints white 3×3 dabs", () => {
  const cpu = boot("paint");
  CORE.runInstructions(cpu, table, 200);
  for (let x = 10; x < 30; x++) cpu.pushMouse(x, 20, 1);
  cpu.pushMouse(30, 20, 0);
  CORE.runInstructions(cpu, table, 20000);
  eq(cpu.fault, null, "fault");
  eq(cpu.mem[VRAM + 20 * W + 10], 7, "start");
  eq(cpu.mem[VRAM + 22 * W + 31], 7, "end of brush");
  eq(cpu.mem[VRAM + 20 * W + 40], 0, "untouched");
});

console.log("T-state engine");
const fields = (c) => JSON.stringify(Object.assign(c.snapshot(), { mem: Array.from(c.mem.slice(0, 0x100)).join(), vram: vramCount(c, 8) + vramCount(c, 12) + vramCount(c, 7) }));
for (const name of ["count", "fib", "rect", "bounce", "paint"]) {
  test(`${name}: T-states match the interpreter at every instruction, one driver per bus`, () => {
    const a = boot(name);
    const b = boot(name);
    if (name === "paint") for (const c of [a, b]) for (let x = 0; x < 8; x++) c.pushMouse(40 + x, 50, 1);
    const rtl = new CORE.Rtl(b, () => table);
    for (let i = 0; i < 4000 && !a.halted; i++) {
      if (i % 300 === 299) { a.frame(); b.frame(); }
      CORE.stepInstruction(a, table);
      do {
        if (!rtl.step()) break;
      } while (rtl.midInstruction);
      if (b.fault) throw new Error(`T-state fault at instruction ${i}: ${b.fault}`);
      if (fields(a) !== fields(b)) throw new Error(`state differs after instruction ${i} (IR ${CORE.hex(a.ir, 2)})`);
    }
  });
}
test("every T-state of every opcode drives each bus at most once", () => {
  // Expand each row with rd = A, rs = B and check the drivers per T-state.
  const cpu = new CORE.Cpu();
  cpu.opr = 0x01;
  const addr = new Set(CORE.SIGNALS.filter((s) => s.drives === "addr").map((s) => s.name));
  const data = new Set(CORE.SIGNALS.filter((s) => s.drives === "data").map((s) => s.name));
  for (const row of table.rows)
    for (const m of row.micro)
      for (const st of CORE.expand(m, cpu)) {
        const a = st.sigs.filter((s) => addr.has(s.s)).length;
        const d = st.sigs.filter((s) => data.has(s.s)).length;
        if (a > 1 || d > 1) throw new Error(`${row.mnem} ${m.k}: ${st.sigs.map((s) => s.s).join(" ")}`);
      }
});

console.log("binder and renderer on the Leila drawing");
// The drawing script lives on the leila/draw-machine branch; without it this test is skipped.
const DRAW_SCRIPT = join(here, "..", "tools", "draw-leila", "use-figma.js");
if (!existsSync(DRAW_SCRIPT)) console.log("  skip binds the Leila drawing (needs ../tools/draw-leila/use-figma.js from leila/draw-machine)");
else test("binds every contract name and renders Watch and Turbo frames", () => {
  let made = 0;
  function node(type, props) {
    made++;
    const n = Object.assign({
      type, name: "", id: `n${made}`, children: [], parent: null, removed: false, fills: [], strokes: [], strokeWeight: 1, x: 0, y: 0, width: 100, height: 20,
      appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((k) => k !== c); this.children.push(c); c.parent = this; },
      remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((k) => k !== this); },
      resize(w, h) { this.width = w; this.height = h; },
      findAll(fn) { const out = []; const walk = (x) => { for (const c of x.children) { if (fn(c)) out.push(c); walk(c); } }; walk(this); return out; },
      findOne(fn) { return this.findAll(fn)[0] || null; },
      findAllWithCriteria(q) { return this.findAll((x) => q.types.includes(x.type)); },
      setPluginData() {}, getPluginData() { return ""; },
    }, props || {});
    return n;
  }
  const textNode = () => node("TEXT", {
    _c: "", fontName: { family: "Inter", style: "Regular" }, writes: 0,
    set characters(v) { this._c = v; this.writes++; }, get characters() { return this._c; },
    setRangeFills() {}, getRangeAllFontNames() { return [this.fontName]; },
  });
  const clone = (src) => {
    const c = src.type === "TEXT" ? textNode() : node(src.type === "COMPONENT" ? "INSTANCE" : src.type);
    c.name = src.name;
    if (src.type === "TEXT") c._c = src._c;
    for (const k of src.children) c.appendChild(clone(k));
    return c;
  };
  const leila = node("PAGE", { name: "Leila", async loadAsync() {} });
  globalThis.figma = {
    root: { children: [leila] }, mixed: Symbol("mixed"),
    setCurrentPageAsync: async () => {}, loadFontAsync: async () => {},
    createFrame: () => node("FRAME"), createRectangle: () => node("RECTANGLE"), createText: textNode,
    createComponent: () => node("COMPONENT", { createInstance() { const i = clone(this); i.type = "INSTANCE"; return i; } }),
    combineAsVariants: (vs, parent) => { const s = node("COMPONENT_SET"); for (const v of vs) s.appendChild(v); parent.appendChild(s); return s; },
    viewport: { scrollAndZoomIntoView() {} },
  };
  const drawBody = readFileSync(DRAW_SCRIPT, "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(drawBody)().then(async () => {
    const api = new Function("SPEC", "CORE", `${read("src/figma/bind.js")}\n${read("src/figma/render.js")}\nreturn { findMachine, bindMachine, readRows, Renderer };`)(SPEC, CORE);
    const root = api.findMachine(leila);
    if (!root) throw new Error("no Machine v2 frame drawn");
    const bound = await api.bindMachine(root);
    eq(bound.missing, [], "missing contract names");
    const rows = api.readRows(bound);
    eq(rows.length, 29, "rows read off the canvas");
    const t = CORE.buildTable(rows);
    eq(t.errors, [], "canvas table errors");
    const r = new api.Renderer(bound);
    if (!r.perSignalTaps) throw new Error("Leila connectors were not recognized");
    const cpu = boot("fib");
    const rtl = new CORE.Rtl(cpu, () => t.table);
    for (let i = 0; i < 40; i++) r.render({ cpu, table: t.table, mode: "watch", tres: rtl.step(), pinBase: 0x4000 });
    CORE.runInstructions(cpu, t.table, 500);
    r.render({ cpu, table: t.table, mode: "instr", tres: null, pinBase: 0x4000 });
    const val = (n) => bound.byName.get(n).findOne((x) => x.name === "value").characters;
    eq(val("cpu/reg/A"), CORE.hex(cpu.r[0], 2), "A on canvas");
    eq(bound.byName.get("mem/pin/cell/03").findOne((x) => x.name === "v").characters, "02", "pinned fib byte");
    const lit = [...r.taps.keys()].filter((k) => r.fills.get(r.taps.get(k).id) === "#F59E0B");
    eq(lit, [], "no connectors lit outside Watch");
  });
});

await Promise.all(pending);
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join(", ")}` : ""}`);
process.exitCode = failures.length ? 1 : 0;
