// OS ↔ CPU contract (docs/OS-CPU-CONTRACT.md): the image loader/validator (src/os/image.ts),
// the binding engine (src/os/bindings.ts) and hello-os (os/) run end to end on the REAL
// gate-level CPU (FastSim over the compiled netlist), cross-checked against the ISA model.
import { describe, expect, it } from "vitest";
import helloSrc from "../os/hello-os.asm";
import helloBindingsJson from "../os/hello-os.bindings.json";
import helloManifest from "../os/hello-os.json";
import { DeviceBus, IN_ADDR, readFramebuffer } from "../plugin/src/devices";
import { powerOnWith } from "../plugin/src/program";
import { compile, FastSim } from "../src/compile";
import { cpuNetlist, readProbes } from "../src/cpu";
import { IsaModel, OUT_ADDR, RAM_BYTES } from "../src/isa";
import {
  applyBindings,
  type Binding,
  BindingError,
  type CanvasWrite,
  INPUT_ADDR,
  inputFromEvent,
  type IssueCode,
  loadImage,
  parseBindingsFile,
  validateBindings,
} from "../src/os";

const manifest = () => JSON.parse(JSON.stringify(helloManifest));
const codes = (img: { errors: { code: IssueCode }[] }) => img.errors.map((e) => e.code);
const ram = (pairs: Record<number, number>) => {
  const r = new Array<number>(RAM_BYTES).fill(0);
  for (const [a, v] of Object.entries(pairs)) r[Number(a)] = v;
  return r;
};
const SIMPLE = { name: "t", entry: "start", ram: RAM_BYTES, source: "t.asm" };
const [IN, OUT] = [IN_ADDR, OUT_ADDR];
const REGIONS = [
  { name: "code", start: 0, end: 9, kind: "code" },
  { name: "data", start: 10, end: IN - 1, kind: "data" },
  { name: "in", start: IN, end: IN, kind: "input" },
  { name: "out", start: OUT, end: OUT, kind: "output" },
];

describe("image loader (src/os/image.ts)", () => {
  it("accepts hello-os: 12 code bytes, 1 data byte, entry 0, no errors or warnings", () => {
    const img = loadImage(helloManifest, helloSrc);
    expect(img.errors).toEqual([]);
    expect(img.warnings).toEqual([]);
    expect(img.ok).toBe(true);
    expect(INPUT_ADDR).toBe(IN_ADDR);
    expect(img.entry).toBe(0);
    expect(img.labels).toEqual({ loop: 0, winx: 12 }); // IN and OUT are predefined
    expect(img.use.filter((u) => u === "code").length).toBe(12);
    expect(img.use.filter((u) => u === "data").length).toBe(1);
    expect(img.use.slice(13)).toEqual(new Array(RAM_BYTES - 13).fill(null));
    expect(img.bytes.length).toBe(RAM_BYTES);
  });

  it("rejects overlapping regions, naming both", () => {
    const m = { ...SIMPLE, regions: [{ name: "code", start: 0, end: 9, kind: "code" }, { name: "vars", start: 8, end: 12, kind: "data" }] };
    const img = loadImage(m, "start: JMP start");
    expect(img.ok).toBe(false);
    const e = img.errors.find((x) => x.code === "overlap")!;
    expect(e.msg).toBe('regions "code" (0–9) and "vars" (8–12) overlap at 8–9');
  });

  it("rejects code reaching OUT and INPUT, with the line", () => {
    const toOut = loadImage({ ...SIMPLE, regions: REGIONS }, `start: JMP ${IN}\n.org ${IN}\nJMP start`);
    expect(codes(toOut)).toContain("code-range");
    const e = toOut.errors.find((x) => x.code === "code-range" && x.addr === OUT)!;
    expect(e.line).toBe(3);
    expect(e.msg).toBe(`line 3: "JMP 0" reaches address ${OUT}, the OUT port; code must end below ${IN}`);
    expect(toOut.errors.find((x) => x.code === "code-range" && x.addr === IN)!.msg).toMatch(new RegExp(`address ${IN}, the INPUT byte`));

    const region = loadImage({ ...SIMPLE, regions: [{ name: "code", start: 0, end: OUT, kind: "code" }] }, "start: JMP start");
    expect(region.errors[0]).toMatchObject({ code: "region-range", region: "code" });
    expect(region.errors[0].msg).toBe(`code region "code" ends at ${OUT} (OUT); code and data must end below ${IN} (${IN} is INPUT, ${OUT} is OUT)`);
  });

  it("rejects an oversize program (assembler: needs more than RAM_BYTES) and a manifest for more RAM", () => {
    const n = RAM_BYTES / 2 + 1; // LDI is 2 bytes
    const big = Array.from({ length: n }, () => "LDI R0, 1").join("\n");
    const img = loadImage({ ...SIMPLE, regions: REGIONS }, `start: ${big}`);
    const e = img.errors.find((x) => x.code === "oversize")!;
    expect(e.msg).toBe(`line ${n}: program needs ${RAM_BYTES + 2} bytes but RAM has ${RAM_BYTES} (0..${RAM_BYTES - 1}); this is the first line that does not fit`);
    expect(img.ok).toBe(false);

    const wide = loadImage({ ...SIMPLE, ram: 2 * RAM_BYTES, regions: REGIONS }, "start: JMP start");
    expect(wide.errors.map((x) => [x.code, x.msg])).toEqual([
      ["ram-size", `manifest is for ${2 * RAM_BYTES} bytes of RAM; this machine has ${RAM_BYTES} (docs/CPU-V2.md prices larger RAM)`],
    ]);
  });

  it("rejects a missing entry label, suggesting the near miss and listing the labels", () => {
    const img = loadImage({ ...SIMPLE, entry: "Loop", regions: REGIONS }, "loop: JMP loop");
    expect(img.errors.map((x) => [x.code, x.msg])).toEqual([["entry-missing", 'entry "Loop" is not a label in the source (did you mean "loop"?); labels: loop']]);
    expect(img.entry).toBeNull();
  });

  it("rejects an entry that is not where the CPU starts, unless address 0 jumps to it", () => {
    const src = "NOP\nstart: JMP start";
    expect(loadImage({ ...SIMPLE, regions: REGIONS }, src).errors.map((x) => x.code)).toEqual(["entry-not-reset"]);
    const ok = loadImage({ ...SIMPLE, regions: REGIONS }, "JMP start\nstart: JMP start");
    expect(ok.errors).toEqual([]);
    expect(ok.entry).toBe(2);
    const inData = loadImage({ ...SIMPLE, regions: REGIONS }, "JMP 0\n.org 10\nstart: .db 1");
    expect(codes(inData)).toEqual(["entry-outside-code"]);
  });

  it("rejects .db bytes outside a data region and instructions outside a code region", () => {
    const dbInCode = loadImage({ ...SIMPLE, regions: REGIONS }, "start: JMP start\nk: .db 7, 8");
    expect(dbInCode.errors.map((x) => [x.code, x.msg])).toEqual([
      ["data-outside-region", 'line 2: .db byte at 2 is in code region "code"; .db bytes must be in a data region'],
      ["data-outside-region", 'line 2: .db byte at 3 is in code region "code"; .db bytes must be in a data region'],
    ]);
    const dbNowhere = loadImage({ ...SIMPLE, regions: [REGIONS[0]] }, "start: JMP start\n.org 11\n.db ';'");
    expect(dbNowhere.errors[0].msg).toBe("line 3: .db byte at 11 is outside every region; .db bytes must be in a data region");
    const codeInData = loadImage({ ...SIMPLE, regions: REGIONS }, "start: JMP 10\n.org 10\nMOV R1, R2");
    expect(codeInData.errors.map((x) => x.msg)).toEqual([
      'line 3: instruction byte at 10 ("MOV R1, R2") is in data region "data"; it must be in a code region',
    ]);
  });

  it("checks I/O placement and manifest shape without throwing", () => {
    const io = loadImage(
      { ...SIMPLE, regions: [REGIONS[0], { name: "kbd", start: IN - 1, end: IN - 1, kind: "input" }, { name: "o", start: IN, end: OUT, kind: "output" }] },
      "start: JMP start",
    );
    expect(io.errors.map((x) => x.msg)).toEqual([
      `input region "kbd" is ${IN - 1}; the INPUT byte is exactly ${IN}`,
      `output region "o" is ${IN}–${OUT}; the OUT byte is exactly ${OUT}`,
    ]);
    const warn = loadImage({ ...SIMPLE, regions: [REGIONS[0]] }, "start: JMP start");
    expect(warn.ok).toBe(true);
    expect(warn.warnings.map((w) => w.code)).toEqual(["no-input", "no-output"]);
    for (const junk of [null, 42, "x", [], { regions: "no" }, { name: "a", entry: {}, ram: -1, regions: [{ name: "c", start: 3, end: 1, kind: "code" }, { kind: "rom" }] }]) {
      const img = loadImage(junk, "start: JMP start");
      expect(img.ok, JSON.stringify(junk)).toBe(false);
      expect(img.errors.length).toBeGreaterThan(0);
      for (const e of img.errors) expect(e.msg.length).toBeGreaterThan(10);
    }
    const asmErr = loadImage({ ...SIMPLE, regions: REGIONS }, "start: FOO R1\nJMP start");
    expect(asmErr.errors).toEqual([{ code: "asm", line: 1, msg: 'line 1: unknown instruction "FOO"' }]);
    expect(loadImage({ ...SIMPLE, regions: REGIONS }, undefined as unknown as string).errors[0].code).toBe("asm");
  });
});

describe("binding engine (src/os/bindings.ts)", () => {
  const b = (x: Partial<Binding> & Pick<Binding, "ram">): Binding => ({ node: "n", prop: "x", ...x });

  it("initial sync writes every bound property; no write when RAM is unchanged", () => {
    const { bindings } = parseBindingsFile(helloBindingsJson);
    const r = ram({});
    expect(applyBindings(r, bindings)).toEqual([
      { node: "window", prop: "visible", value: false },
      { node: "window", prop: "x", value: 40 },
      { node: "taskbar-button", prop: "fill", value: "#3a3a3a" },
      { node: "status", prop: "text", value: "closed" },
      { node: "window-x-label", prop: "text", value: "0" },
    ]);
    expect(applyBindings(r, bindings, r)).toEqual([]);
    // Bits nobody reads change: still no write (RAM[15] bit 0, RAM[12] bit 7, unbound byte 13).
    expect(applyBindings(ram({ 15: 0x01, 12: 0x80, 13: 0xff }), bindings, r)).toEqual([]);
  });

  it("scale/offset, table, bit slices and text", () => {
    const binds: Binding[] = [
      b({ ram: { addr: 3, bits: [4, 7] }, node: "a", prop: "y", map: { scale: 10, offset: -5 } }),
      b({ ram: { addr: 3, bits: [0, 1] }, node: "b", prop: "text", map: { table: ["zero", "one", "two"] } }),
      b({ ram: { addr: 3, bit: 2 }, node: "c", prop: "visible" }),
      b({ ram: { addr: 4 }, node: "d", prop: "text" }),
      b({ ram: { addr: 4 }, node: "e", prop: "opacity" }),
      b({ ram: { addr: 4, bits: [0, 1] }, node: "f", prop: "fill" }),
      b({ ram: { addr: 4 }, node: "g", prop: "text", map: { scale: 2, offset: 1 } }),
    ];
    const r = ram({ 3: 0b1010_0111, 4: 255 });
    expect(applyBindings(r, binds)).toEqual([
      { node: "a", prop: "y", value: 95 },
      { node: "b", prop: "text", value: "two" }, // field 3 is past the table: last entry
      { node: "c", prop: "visible", value: true },
      { node: "d", prop: "text", value: "255" },
      { node: "e", prop: "opacity", value: 1 },
      { node: "f", prop: "fill", value: "#ffffff" },
      { node: "g", prop: "text", value: "511" },
    ]);
    const r2 = ram({ 3: 0b1010_0001, 4: 255 });
    expect(applyBindings(r2, binds, r)).toEqual([
      { node: "b", prop: "text", value: "one" },
      { node: "c", prop: "visible", value: false },
    ]);
    expect(applyBindings(ram({ 4: 0b01 }), [binds[5]])).toEqual([{ node: "f", prop: "fill", value: "#555555" }]);
  });

  it("two bindings on one node.prop: one write, the last binding wins; output is deterministic", () => {
    const binds: Binding[] = [b({ ram: { addr: 0 }, node: "w", prop: "x" }), b({ ram: { addr: 1 }, node: "w", prop: "x", map: { scale: 2 } })];
    const r = ram({ 0: 1, 1: 3 });
    expect(applyBindings(r, binds)).toEqual([{ node: "w", prop: "x", value: 6 }]);
    expect(applyBindings(ram({ 0: 9, 1: 3 }), binds, r)).toEqual([]);
    expect(JSON.stringify(applyBindings(r, binds))).toBe(JSON.stringify(applyBindings([...r], [...binds])));
  });

  it("validation reports precise problems; applyBindings refuses an invalid table", () => {
    const bad = [
      { ram: { addr: RAM_BYTES }, node: "a", prop: "x" },
      { ram: { addr: 1, bits: [5, 2] }, node: "b", prop: "y" },
      { ram: { addr: 1 }, node: "c", prop: "visible", map: { scale: 2 } },
      { ram: { addr: 1 }, node: "d", prop: "fill", map: { table: ["red"] } },
      { ram: { addr: 1 }, node: "e", prop: "size" },
    ];
    expect(validateBindings(bad).errors).toEqual([
      `binding 0 (a.x): ram.addr ${RAM_BYTES} is outside RAM (0–${RAM_BYTES - 1})`,
      "binding 1 (b.y): ram.bits must be [lo, hi] with 0 ≤ lo ≤ hi ≤ 7",
      "binding 2 (c.visible): visible takes a {table}, not a scale",
      'binding 3 (d.fill): map.table for fill must hold colors "#rrggbb"',
      "binding 4 (e.size): \"prop\" must be one of visible, x, y, text, fill, opacity",
    ]);
    expect(validateBindings([{ ram: { addr: 0, bits: [0, 2] }, node: "t", prop: "text", map: { table: ["a", "b"] } }]).warnings[0]).toMatch(
      /table has 2 entries for a 3-bit field \(8 values\)/,
    );
    expect(() => applyBindings(ram({}), bad as Binding[])).toThrow(BindingError);
  });

  it("inputFromEvent maps clicks and keys through the keymap; unknown events give null", () => {
    const { keymap, errors } = parseBindingsFile(helloBindingsJson);
    expect(errors).toEqual([]);
    expect(inputFromEvent({ type: "click", node: "taskbar-button" }, keymap)).toBe(0x80);
    expect(inputFromEvent({ type: "key", key: "ArrowRight" }, keymap)).toBe(0x01);
    expect(inputFromEvent({ type: "key", key: "o" }, keymap)).toBe(0x80);
    expect(inputFromEvent({ type: "key", key: "O" }, keymap)).toBeNull();
    expect(inputFromEvent({ type: "click", node: "toString" }, keymap)).toBeNull();
    expect(inputFromEvent({ type: "click", node: "x" }, {})).toBeNull();
    expect(parseBindingsFile({ bindings: [], keymap: { key: { a: 0, b: 300 } } }).errors).toEqual([
      'keymap.key["a"] = 0: input bytes are 1–255 (0 means "no input")',
      'keymap.key["b"] = 300: input bytes are 1–255 (0 means "no input")',
    ]);
  });
});

describe("hello-os on the gate-level CPU (FastSim) with bindings, cross-checked against IsaModel", () => {
  const net = cpuNetlist();
  const schedule = compile(net, { inputs: [] });

  it("toggle and move inputs drive the canvas writes; every tick matches the ISA model", () => {
    const img = loadImage(manifest(), helloSrc);
    expect(img.ok).toBe(true);
    const { bindings, keymap } = parseBindingsFile(helloBindingsJson);
    const sim = new FastSim(net, schedule, powerOnWith(net, img.bytes));
    const model = new IsaModel(img.bytes);
    const bus = new DeviceBus();
    let ticks = 0;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        sim.tick();
        model.tick();
        ticks++;
        expect(readProbes(sim), `tick ${ticks}`).toEqual({ ...model.probes(), BUS: model.nextBus() });
        expect(readFramebuffer(sim), `RAM tick ${ticks}`).toEqual(model.state.RAM);
      }
    };
    /** Runs to the top of the loop (PC 0, T0: about to fetch LD), so a poke cannot land in the
     * LD → consume window. */
    const toLoopTop = () => {
      let n = 0;
      do {
        tick(1);
        n++;
      } while (!(model.state.PC === 0 && model.state.T === 0) && n < 60);
      expect(n).toBeLessThan(60);
    };
    const press = (ev: Parameters<typeof inputFromEvent>[0]) => {
      toLoopTop();
      const v = inputFromEvent(ev, keymap)!;
      bus.input(v);
      expect(bus.apply(sim)).toBe(8);
      model.state.RAM[IN_ADDR] = v;
      tick(50); // one full loop: LD 8 + ST 8 + XOR 6 + ADD 6 + ST 8 + ST 8 + JMP 6
      expect(readFramebuffer(sim, IN_ADDR, 1), "input consumed").toEqual([0]);
    };

    tick(5);
    let prev = readFramebuffer(sim);
    const initial = applyBindings(prev, bindings);
    expect(initial).toContainEqual({ node: "window", prop: "visible", value: false });
    const step = (ev: Parameters<typeof inputFromEvent>[0]): CanvasWrite[] => {
      press(ev);
      const now = readFramebuffer(sim);
      const w = applyBindings(now, bindings, prev);
      prev = now;
      return w;
    };

    expect(step({ type: "click", node: "taskbar-button" })).toEqual([
      { node: "window", prop: "visible", value: true },
      { node: "taskbar-button", prop: "fill", value: "#2f80ed" },
      { node: "status", prop: "text", value: "open" },
    ]);
    expect(model.state.OUT & 0x80).toBe(0x80);
    expect(readProbes(sim).OUT).toBe(0x80); // the flag on the 7-segment display

    expect(step({ type: "key", key: "ArrowRight" })).toEqual([
      { node: "window", prop: "x", value: 64 },
      { node: "window-x-label", prop: "text", value: "1" },
    ]);
    expect(step({ type: "click", node: "window-move" })).toEqual([
      { node: "window", prop: "x", value: 88 },
      { node: "window-x-label", prop: "text", value: "2" },
    ]);
    // Same key twice: delivered twice, because the OS consumed the first one.
    expect(step({ type: "click", node: "window-move" })).toEqual([
      { node: "window", prop: "x", value: 112 },
      { node: "window-x-label", prop: "text", value: "3" },
    ]);
    expect(step({ type: "key", key: "o" })).toEqual([
      { node: "window", prop: "visible", value: false },
      { node: "taskbar-button", prop: "fill", value: "#3a3a3a" },
      { node: "status", prop: "text", value: "closed" },
    ]);
    // Idle loops: RAM still changes nothing the canvas sees.
    tick(120);
    expect(applyBindings(readFramebuffer(sim), bindings, prev)).toEqual([]);
    expect(readFramebuffer(sim, 12, 1)).toEqual([3]);
    expect(readProbes(sim).OUT).toBe(0x01); // flag 0; bit 0 = parity of the 3 moves
    expect(model.outputs.slice(-1)).toEqual([0x01]);
    expect(model.state.RAM[OUT_ADDR]).toBe(0x01);
  });
});
