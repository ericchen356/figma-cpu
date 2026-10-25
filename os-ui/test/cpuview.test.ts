// The CPU tab's gate map (src/cpuview.ts) on a stand-in canvas: the gates an event switched
// flash and fade to their new values, a load redraws without a flash, an event from just before
// the tab opened still flashes, the tooltip names the gate under the pointer, and a canvas the
// browser can't draw on leaves the panel, the editor's render and the chip running.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { synthesize } from "../../osflow/src/gates/synthesize";
import { buildEditor } from "../../osflow/src/editor";
import { cpu, type CpuStep } from "../src/cpu";
import { floorplan, showCpu } from "../src/cpuview";
import { initialState, reduce, type Action, type State } from "../src/model";

/** The map draws at 2 canvas pixels per CSS pixel at least, in a panel 224 px wide. */
const DPR = 2;
const WIDTH = 224;
const W = WIDTH * DPR;
const FLASH_MS = 1000;

/** As much of a 2D context as the map draws with; `img` holds the pixels it puts on the canvas. */
class Context {
  font = "";
  fillStyle = "";
  textBaseline = "";
  textAlign = "";
  img: { data: Uint8ClampedArray } | null = null;
  rects = 0;
  roundRect?: () => void = () => {};
  measureText = (text: string) => ({ width: text.length * 5.5 * DPR });
  fillRect() {}
  beginPath() {}
  rect() {
    this.rects++;
  }
  fill() {}
  fillText() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return (this.img = { data: new Uint8ClampedArray(w * h * 4) });
  }
  putImageData() {}
}

function element<T extends object>(extra: T = {} as T) {
  const classes = new Set<string>();
  return {
    hidden: false,
    innerHTML: "",
    textContent: "",
    title: "",
    style: {},
    offsetWidth: 80,
    offsetHeight: 20,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    ...extra,
  };
}

/** A CPU panel on the page as view.ts renders it, its canvas drawing with `context()`. */
function panel(context: () => Context | null = () => new Context()) {
  const ui = {
    tries: 0,
    drawn: [] as Context[],
    canvas: element({
      width: 0,
      height: 0,
      clientWidth: WIDTH,
      parentElement: { clientWidth: WIDTH },
      getContext: () => {
        ui.tries++;
        const g = context();
        if (g) ui.drawn.push(g);
        return g;
      },
      onpointermove: null as null | ((e: object) => void),
    }),
    parts: {} as Record<string, ReturnType<typeof element>>,
    el: element({
      isConnected: true,
      querySelector: (sel: string) => ui.parts[sel] ?? null,
    }),
    left: {
      querySelector: (sel: string) => (sel === ".cpu-panel" ? ui.el : null),
    } as unknown as HTMLElement,
  };
  ui.parts = {
    canvas: ui.canvas,
    ".cpu-tip": element({ hidden: true }),
    ".cpu-map": element(),
    "[data-cpu-count]": element(),
    ".cpu-focus": element({ hidden: true }),
    ".cpu-info": element(),
    ".cpu-wait": element({ textContent: "Building the chip…" }),
  };
  return ui;
}
type Panel = ReturnType<typeof panel>;

let frames: FrameRequestCallback[] = [];
/** Runs the animation frames asked for so far, at time `t`. */
function run(t: number): void {
  const due = frames;
  frames = [];
  for (const fn of due) fn(t);
}

/** Per gate, the canvas pixel of its dot's corner, in the floorplan the map lays out. */
let dotAt: Int32Array;
let open: Panel | null = null;
beforeAll(() => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", {});
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    frames.push(fn),
  );
  // Built here at once, not in idle time.
  vi.spyOn(cpu, "start").mockImplementation(() => {});
  cpu.build(synthesize(buildEditor({ target: "hardware" })));
  const pitch = Math.round(1.5 * DPR);
  const { plots } = floorplan(
    cpu.blocks.map((b) => b.gates.length),
    cpu.blocks.map((b) => b.name.length * 5.5 * DPR),
    W,
    pitch,
    DPR,
  );
  dotAt = new Int32Array(cpu.chip!.net.gates.length);
  cpu.blocks.forEach((b, k) => {
    const p = plots[k];
    b.gates.forEach((g, i) => {
      const x = p.gx + (i % p.cols) * pitch;
      const y = p.gy + Math.floor(i / p.cols) * pitch;
      dotAt[g] = y * W + x;
    });
  });
});
// The tab closes after every test: what the chip does next draws nothing there.
afterEach(() => {
  if (open) open.el.isConnected = false;
  open = null;
});

/** Opens the CPU tab on the editor state `s`, as view.ts's render does. */
function show(s: State, ui: Panel = panel()): Panel {
  open = ui;
  showCpu(ui.left, s);
  return ui;
}

function act(s: State, a: Action): State {
  const after = reduce(s, a);
  cpu.step(s, a, after);
  return after;
}

const pixel = (ui: Panel, g: number) =>
  [
    ...ui.drawn.at(-1)!.img!.data.subarray(dotAt[g] * 4, dotAt[g] * 4 + 4),
  ].join();
const switched = (e: CpuStep) =>
  [...e.nets].map((n) => cpu.chip!.net.driver[n]).filter((g) => g >= 0);
const valueOf = (g: number) => cpu.chip!.sim.v[cpu.chip!.net.gates[g].out];
const roleOf = (g: number) => cpu.blocks[cpu.blockOf[g]].role;

/** A fresh file on the chip with the Rectangle tool picked; drawing from cell 2,2 comes next. */
function drawing(): { s: State; a: Action } {
  const s = initialState();
  cpu.sync(s, "New");
  return { s: act(s, { t: "key", key: "r" }), a: { t: "down", x: 2, y: 2 } };
}

describe("the CPU tab's gate map", () => {
  it("starts building the chip when the tab shows, at the editor's state", () => {
    const s = initialState();
    show(s);
    expect(cpu.start).toHaveBeenCalledWith(s);
  });

  it("flashes the gates an event switched, then fades each to its new value", () => {
    const { s, a } = drawing();
    const ui = show(s);
    run(performance.now() + FLASH_MS); // the R key's flash, from just before, is over
    const settled = new Map<string, string>();
    for (let g = 0; g < dotAt.length; g++)
      settled.set(`${roleOf(g)} ${valueOf(g)}`, pixel(ui, g));
    act(s, a);
    const e = cpu.last!;
    const gates = switched(e);
    expect(gates.length).toBeGreaterThan(500);
    run(e.at);
    const flash = gates.map((g) => pixel(ui, g));
    run(e.at + FLASH_MS);
    // A second later each one shows its new value, as every gate at that value does.
    for (const g of gates)
      expect(pixel(ui, g)).toBe(settled.get(`${roleOf(g)} ${valueOf(g)}`));
    // At the event's own time each one is lit apart from that: one flash colour per kind of
    // module, whichever way the gate switched.
    let both = 0;
    for (const role of ["unit", "register", "control"]) {
      const mine = gates.flatMap((g, i) => (roleOf(g) === role ? [i] : []));
      if (new Set(mine.map((i) => valueOf(gates[i]))).size === 2) both++;
      expect(new Set(mine.map((i) => flash[i])).size, role).toBeLessThan(2);
      for (const i of mine) expect(flash[i]).not.toBe(pixel(ui, gates[i]));
    }
    expect(both).toBeGreaterThan(0);
  });

  it("draws a load at the new values at once, without a flash", () => {
    const { s, a } = drawing();
    const ui = show(s);
    run(performance.now() + FLASH_MS);
    const was = new Map<number, string>();
    for (let g = 0; g < dotAt.length; g++) was.set(g, pixel(ui, g));
    // Undo to a file with a rectangle in it: a load.
    cpu.sync(reduce(reduce(s, a), { t: "up" }), "Undo");
    const e = cpu.last!;
    expect(e).toMatchObject({ words: "Undo", loaded: true });
    run(e.at);
    const now = switched(e).map((g) => pixel(ui, g));
    expect(now.filter((p, i) => p !== was.get(switched(e)[i])).length).toBe(
      now.length,
    );
    run(e.at + FLASH_MS);
    expect(switched(e).map((g) => pixel(ui, g))).toEqual(now);
  });

  it("still flashes an event from just before the tab opened", () => {
    const { s, a } = drawing();
    act(s, a);
    const e = cpu.last!;
    const ui = show(s);
    run(e.at);
    const now = switched(e).map((g) => pixel(ui, g));
    run(e.at + FLASH_MS);
    const later = switched(e).map((g) => pixel(ui, g));
    expect(now.filter((p, i) => p !== later[i]).length).toBe(now.length);
  });

  it("names the gate under the pointer, and its block", () => {
    const ui = show(initialState());
    const block = cpu.blocks.find((b) => b.id === "U_parent")!;
    // The third dot of the second row: dots go row by row, so a transposed index lands elsewhere.
    const row = Math.floor(dotAt[block.gates[0]] / W);
    const cols = block.gates.findIndex((g) => Math.floor(dotAt[g] / W) > row);
    const g = block.gates[cols + 2];
    ui.canvas.onpointermove!({
      offsetX: ((dotAt[g] % W) + 1) / DPR,
      offsetY: (Math.floor(dotAt[g] / W) + 1) / DPR,
    });
    const gate = cpu.chip!.net.gates[g];
    const tip = ui.parts[".cpu-tip"];
    expect(tip.hidden).toBe(false);
    expect(tip.innerHTML).toContain(
      `<b>parent search</b> · ${block.gates.length.toLocaleString("en-US")} gates`,
    );
    expect(tip.innerHTML).toContain(
      `${gate.type} ${gate.path} = ${valueOf(g)}</div>`,
    );
  });

  it("draws square blocks where the canvas has no roundRect", () => {
    const ui = panel(() => {
      const g = new Context();
      g.roundRect = undefined;
      return g;
    });
    show(initialState(), ui);
    expect(ui.drawn.at(-1)!.rects).toBe(cpu.blocks.length);
    expect(ui.parts[".cpu-map"].classList.contains("ready")).toBe(true);
  });

  it("keeps the editor's render and the chip going when the canvas can't be drawn on", () => {
    const { s, a } = drawing();
    const ui = panel(() => null);
    expect(() => show(s, ui)).not.toThrow();
    expect(ui.parts[".cpu-wait"].textContent).toMatch(
      /^The gate map can't be drawn here: .+\.$/,
    );
    expect(ui.parts[".cpu-map"].classList.contains("ready")).toBe(false);
    // An event with the tab open: the map isn't tried again, and the chip isn't the one at fault.
    const after = act(s, a);
    expect(ui.tries).toBe(1);
    expect(cpu.status.kind).toBe("step");
    expect(cpu.mismatch(after)).toBeNull();
    // The rest of the panel goes on.
    run(performance.now());
    expect(ui.parts[".cpu-info"].innerHTML).toContain("Press at 2, 2");
  });
});
