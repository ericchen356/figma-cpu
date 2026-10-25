// The CPU tab: the chip of cpu.ts drawn as a floorplan on a canvas, one block per module and one
// dot per gate: dark at 0, lit in its module's colour at 1, and a bright flash fading over a
// second where it switched on the last event. Below it: that event in words, how many gates
// switched, the busiest modules and whether the chip is in step with the editor.
// view.ts keeps the panel in place while it shows, so its canvas survives every render; an event
// then costs one frame per flash step, and nothing at all while the tab is closed.
import { cpu, type Cpu, type CpuStep, type Role, type StatusKind } from "./cpu";
import { I } from "./icons";
import { GRID_H, GRID_W, type State } from "./model";

/** Module colours by role: the first three dark-mode categorical slots, validated together
 * against the map's #1e1e1e surface (every pair, for colours that can sit side by side). */
export const ROLE_COLOR: Record<Role, string> = {
  unit: "#3987e5",
  register: "#d95926",
  control: "#199e70",
};
const ROLE_LABEL: Record<Role, string> = {
  unit: "operations",
  register: "registers",
  control: "control",
};
const ROLES: Role[] = ["unit", "register", "control"];

const SURFACE = "#1e1e1e";
const LABEL_FONT = (dpr: number) =>
  `550 ${9 * dpr}px Inter, -apple-system, sans-serif`;
const BLOCK_BG = "#262626";
const FLASH_MS = 1000;
/** Fade steps from the flash to a dot's settled colour. */
const STEPS = 32;

const fmt = (n: number) => n.toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- The floorplan: blocks as a treemap, each holding a grid of dots

export interface Plot {
  /** The block's background, in device pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height of the label strip at its top (0: too small for a label). */
  label: number;
  /** The first dot's corner and the grid's columns. */
  gx: number;
  gy: number;
  cols: number;
}

/** A squarified treemap of `areas` (largest first) in a box `width` wide, as tall as they need. */
function squarify(areas: number[], width: number) {
  const total = areas.reduce((a, b) => a + b, 0);
  let box = { x: 0, y: 0, w: width, h: total / width };
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const worst = (max: number, min: number, sum: number, side: number) =>
    Math.max(
      (side * side * max) / (sum * sum),
      (sum * sum) / (side * side * min),
    );
  for (let i = 0; i < areas.length;) {
    const side = Math.min(box.w, box.h);
    let j = i + 1;
    let sum = areas[i];
    let ratio = worst(areas[i], areas[i], sum, side);
    while (j < areas.length) {
      const next = worst(areas[i], areas[j], sum + areas[j], side);
      if (next > ratio) break;
      sum += areas[j++];
      ratio = next;
    }
    // A strip along the shorter side holds areas[i … j).
    if (box.w >= box.h) {
      const w = sum / box.h;
      let y = box.y;
      for (let k = i; k < j; k++)
        (out.push({ x: box.x, y, w, h: areas[k] / w }), (y += areas[k] / w));
      box = { ...box, x: box.x + w, w: box.w - w };
    } else {
      const h = sum / box.w;
      let x = box.x;
      for (let k = i; k < j; k++)
        (out.push({ x, y: box.y, w: areas[k] / h, h }), (x += areas[k] / h));
      box = { ...box, y: box.y + h, h: box.h - h };
    }
    i = j;
  }
  return out;
}

/**
 * Where the blocks go, in device pixels on a canvas `width` wide: a treemap whose areas follow the
 * gate counts, a dot every `pitch` pixels, a 2px surface gap between blocks, and a label strip on
 * each block wide enough for its name (`names`: each one's width in pixels). A block that cannot
 * fit its dots grows until it does, so every gate gets its own dot. `dpr` is the pixel ratio.
 */
export function floorplan(
  counts: readonly number[],
  names: readonly number[],
  width: number,
  pitch: number,
  dpr: number,
): { plots: Plot[]; height: number } {
  const inset = Math.max(1, Math.round(dpr)); // half the gap between two blocks
  const pad = Math.max(1, Math.round(2 * dpr)); // background edge to dots
  const strip = Math.round(13 * dpr);
  const slack = counts.map(() => 1.12);
  for (let round = 0; ; round++) {
    // At least 10 x 10 CSS px, so even the one-gate block shows as a block.
    const areas = counts.map(
      (n, i) => Math.max(n * pitch * pitch, (10 * dpr) ** 2) * slack[i],
    );
    const order = areas
      .map((_, i) => i)
      .sort((a, b) => areas[b] - areas[a] || a - b);
    const rects = squarify(
      order.map((i) => areas[i]),
      width,
    );
    const plots: Plot[] = new Array(counts.length);
    let height = 0;
    let fits = true;
    order.forEach((i, k) => {
      const r = rects[k];
      const [x0, y0] = [Math.round(r.x), Math.round(r.y)];
      const [x1, y1] = [Math.round(r.x + r.w), Math.round(r.y + r.h)];
      const p = {
        x: x0 + inset,
        y: y0 + inset,
        w: x1 - x0 - 2 * inset,
        h: y1 - y0 - 2 * inset,
      };
      const label = p.w >= names[i] + 4 * pad && p.h >= 26 * dpr ? strip : 0;
      const innerW = p.w - 2 * pad;
      const innerH = p.h - 2 * pad - label;
      const cols = Math.max(0, Math.floor((innerW + 1) / pitch));
      const rows = Math.max(0, Math.floor((innerH + 1) / pitch));
      if (cols * rows < counts[i]) {
        fits = false;
        slack[i] *= 1.08;
      }
      const used = Math.min(counts[i], cols);
      const tall = Math.ceil(counts[i] / Math.max(1, cols));
      plots[i] = {
        ...p,
        label,
        gx: p.x + pad + Math.floor((innerW - (used * pitch - 1)) / 2),
        gy: p.y + pad + label + Math.floor((innerH - (tall * pitch - 1)) / 2),
        cols,
      };
      height = Math.max(height, y1);
    });
    if (fits) return { plots, height };
    if (round > 400) throw new Error("internal: the gate map does not fit");
  }
}

// ---- Colours as canvas pixels

const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t));
const pack = ([r, g, b]: number[]) =>
  LITTLE
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;

/** Each role's dot colours: for a dot at 0 and at 1, the fade from the flash (step 0) to its
 * settled colour (step STEPS). The flash fades fast at first, with a short tail. */
function dotColours(): Uint32Array {
  const out = new Uint32Array(ROLES.length * 2 * (STEPS + 1));
  ROLES.forEach((role, r) => {
    const on = rgb(ROLE_COLOR[role]);
    const off = mix(on, rgb(BLOCK_BG), 0.74);
    const flash = mix(on, [255, 255, 255], 0.7);
    [off, on].forEach((settled, bit) => {
      for (let k = 0; k <= STEPS; k++)
        out[(r * 2 + bit) * (STEPS + 1) + k] = pack(
          mix(settled, flash, (1 - k / STEPS) ** 2),
        );
    });
  });
  return out;
}

/** `text` cut to `max` pixels wide, with an ellipsis when cut. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n).trimEnd()}…`;
    if (g.measureText(cut).width <= max) return cut;
  }
  return "";
}

const mapScale = () => Math.max(2, window.devicePixelRatio || 1);

/** The live gate map on one canvas. */
class GateMap {
  /** Canvas pixels per CSS pixel: the screen's, and at least 2, so a 1x screen shows the same
   * compact map, scaled down, instead of one twice as tall. */
  readonly dpr = mapScale();
  readonly cssWidth: number;
  private readonly pitch: number;
  private readonly dot: number;
  private readonly W: number;
  private readonly plots: Plot[];
  private readonly g: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly px: Uint32Array;
  private readonly colours = dotColours();
  /** Per gate: the pixel of its dot's corner, its output net, its role. */
  private readonly at: Int32Array;
  private readonly out: Int32Array;
  private readonly role: Uint8Array;
  /** Gates whose flash is still fading, and when each one's started. */
  private active: number[] = [];
  private readonly fading: Uint8Array;
  private readonly flashAt: Float64Array;
  private dirty = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly tip: HTMLElement,
    private readonly c: Cpu,
  ) {
    const chip = c.chip!;
    const gates = chip.net.gates;
    this.cssWidth = canvas.parentElement?.clientWidth || 224;
    this.W = Math.round(this.cssWidth * this.dpr);
    this.pitch = Math.max(2, Math.round(1.5 * this.dpr));
    this.dot = this.pitch - 1;
    this.g = canvas.getContext("2d", { alpha: false })!;
    this.g.font = LABEL_FONT(this.dpr);
    const plan = floorplan(
      c.blocks.map((b) => b.gates.length),
      c.blocks.map((b) => this.g.measureText(b.name).width),
      this.W,
      this.pitch,
      this.dpr,
    );
    this.plots = plan.plots;
    canvas.width = this.W;
    canvas.height = plan.height;
    canvas.style.width = `${this.W / this.dpr}px`;
    canvas.style.height = `${plan.height / this.dpr}px`;
    this.drawBlocks();
    this.img = this.g.getImageData(0, 0, this.W, plan.height);
    this.px = new Uint32Array(this.img.data.buffer);
    this.at = new Int32Array(gates.length);
    this.out = Int32Array.from(gates, (g) => g.out);
    this.role = new Uint8Array(gates.length);
    this.fading = new Uint8Array(gates.length);
    this.flashAt = new Float64Array(gates.length);
    c.blocks.forEach((b, k) => {
      const p = this.plots[k];
      const role = ROLES.indexOf(b.role);
      b.gates.forEach((g, i) => {
        const x = p.gx + (i % p.cols) * this.pitch;
        const y = p.gy + Math.floor(i / p.cols) * this.pitch;
        this.at[g] = y * this.W + x;
        this.role[g] = role;
      });
    });
    const v = chip.sim.v;
    for (let g = 0; g < gates.length; g++)
      this.put(this.at[g], this.colour(g, v[this.out[g]], STEPS));
    // Assigned, not added: a map drawn again on the same canvas takes its pointer over.
    canvas.onpointermove = (e) => this.hover(e);
    canvas.onpointerleave = () => (this.tip.hidden = true);
  }

  /** The panel was resized or moved to a screen of another density: lay it out again. */
  stale(): boolean {
    return (
      mapScale() !== this.dpr ||
      (this.canvas.parentElement?.clientWidth || 224) !== this.cssWidth
    );
  }

  /** Flashes the gates that drive `nets`, from time `at`. */
  flash(nets: Int32Array, at: number): void {
    const driver = this.c.chip!.net.driver;
    for (const n of nets) {
      const g = driver[n];
      if (g < 0) continue;
      this.flashAt[g] = at;
      if (!this.fading[g]) ((this.fading[g] = 1), this.active.push(g));
    }
  }

  /** Redraws the gates that drive `nets` at their new values, without a flash (a load). */
  update(nets: Int32Array): void {
    const driver = this.c.chip!.net.driver;
    const v = this.c.chip!.sim.v;
    for (const n of nets) {
      const g = driver[n];
      if (g >= 0 && !this.fading[g])
        this.put(this.at[g], this.colour(g, v[n], STEPS));
    }
    this.dirty = true;
  }

  /** Outlines block `k` on the map (null: none), for a row of the busiest modules under the pointer. */
  focus(k: number | null, box: HTMLElement): void {
    const p = k === null ? undefined : this.plots[k];
    box.hidden = !p;
    if (!p) return;
    const d = this.dpr;
    Object.assign(box.style, {
      left: `${p.x / d}px`,
      top: `${p.y / d}px`,
      width: `${p.w / d}px`,
      height: `${p.h / d}px`,
    });
  }

  /** One animation frame at time `t`: the flashes a step further. True while any is fading. */
  draw(t: number): boolean {
    const v = this.c.chip!.sim.v;
    let keep = 0;
    for (let i = 0; i < this.active.length; i++) {
      const g = this.active[i];
      const k = Math.min(
        STEPS,
        Math.floor((Math.max(0, t - this.flashAt[g]) / FLASH_MS) * STEPS),
      );
      this.put(this.at[g], this.colour(g, v[this.out[g]], k));
      if (k < STEPS) this.active[keep++] = g;
      else this.fading[g] = 0;
    }
    if (this.active.length) this.dirty = true;
    this.active.length = keep;
    if (this.dirty) this.g.putImageData(this.img, 0, 0);
    this.dirty = false;
    return keep > 0;
  }

  private colour(g: number, bit: number, step: number): number {
    return this.colours[(this.role[g] * 2 + bit) * (STEPS + 1) + step];
  }

  private put(at: number, colour: number): void {
    for (let y = 0; y < this.dot; y++)
      this.px.fill(colour, at + y * this.W, at + y * this.W + this.dot);
  }

  /** The surface, each block's background and the labels that fit: the layer under the dots. */
  private drawBlocks(): void {
    const { g, dpr } = this;
    const pad = Math.max(1, Math.round(2 * dpr));
    g.fillStyle = SURFACE;
    g.fillRect(0, 0, this.W, this.canvas.height);
    g.textBaseline = "middle";
    g.font = LABEL_FONT(dpr); // again: sizing the canvas reset it
    this.c.blocks.forEach((b, k) => {
      const p = this.plots[k];
      g.fillStyle = BLOCK_BG;
      g.beginPath();
      // Square corners where the canvas has no roundRect (before Safari 16 and Firefox 112).
      if (typeof g.roundRect === "function")
        g.roundRect(p.x, p.y, p.w, p.h, Math.round(2 * dpr));
      else g.rect(p.x, p.y, p.w, p.h);
      g.fill();
      if (!p.label) return;
      const y = p.y + pad + p.label / 2;
      const room = p.w - 4 * pad;
      const name = fit(g, b.name, room);
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.textAlign = "left";
      g.fillText(name, p.x + 2 * pad, y);
      const count = fmt(b.gates.length);
      if (name === b.name && g.measureText(`${name}  ${count}`).width <= room) {
        g.fillStyle = "rgba(255,255,255,0.4)";
        g.textAlign = "right";
        g.fillText(count, p.x + p.w - 2 * pad, y);
      }
    });
  }

  /** The block (and gate) under the pointer, in the tooltip. */
  private hover(e: PointerEvent): void {
    const x = e.offsetX * this.dpr;
    const y = e.offsetY * this.dpr;
    const k = this.plots.findIndex(
      (p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h,
    );
    if (k < 0) return void (this.tip.hidden = true);
    const block = this.c.blocks[k];
    const p = this.plots[k];
    const chip = this.c.chip!;
    const v = chip.sim.v;
    let lit = 0;
    for (const g of block.gates) lit += v[this.out[g]];
    const col = Math.floor((x - p.gx) / this.pitch);
    const row = Math.floor((y - p.gy) / this.pitch);
    const i = row * p.cols + col;
    const gate =
      col >= 0 && col < p.cols && row >= 0 && i < block.gates.length
        ? chip.net.gates[block.gates[i]]
        : null;
    this.tip.innerHTML =
      `<b>${esc(block.name)}</b> · ${fmt(block.gates.length)} gates, ${fmt(lit)} at 1` +
      (gate
        ? `<div class="dim">${gate.type} ${esc(gate.path)} = ${v[gate.out]}</div>`
        : "");
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(0, Math.min(e.offsetX - w / 2, this.canvas.clientWidth - w))}px`;
    this.tip.style.top = `${e.offsetY - h - 10 >= 0 ? e.offsetY - h - 10 : e.offsetY + 16}px`;
  }
}

// ---- The panel

const STATUS_ICON: Record<StatusKind, string> = {
  wait: I.loader,
  step: I.circleCheck,
  resync: I.refresh,
  off: I.circleAlert,
  bug: I.triangleAlert,
};

const swatch = (role: Role) =>
  `<i class="cpu-sw" style="background:${ROLE_COLOR[role]}"></i>`;

/** The last event in words, how many gates switched, the busiest modules, the status line. */
function infoHtml(c: Cpu): string {
  const out: string[] = [];
  const s = c.last;
  if (c.chip) {
    out.push(`<div class="cpu-h">Last event</div>`);
    if (!s)
      out.push(
        `<div class="cpu-line dim">None yet. Pick a tool and draw on the canvas.</div>`,
      );
    else {
      const ids = s.fired.map((f) => `<code>${esc(f.id)}</code>`).join(", ");
      out.push(
        `<div class="cpu-line">${esc(s.words)} <span class="dim">→</span> ${s.loaded ? "loaded from the editor" : ids}</div>`,
      );
      const how = s.loaded
        ? ["no chip event"]
        : s.fired.flatMap((f) => [
            `EVT ${f.code}`,
            ...Object.entries(f.inputs).map(
              ([k, v]) => `${k.replace(/^in\//, "")} ${v}`,
            ),
          ]);
      const n = `${fmt(s.gates)} gate${s.gates === 1 ? "" : "s"} ${s.loaded ? "changed" : "switched"}`;
      out.push(`<div class="cpu-line dim">${[...how, n].join(" · ")}</div>`);
      const busy = c.busiest(s.nets).slice(0, 3);
      if (busy.length) {
        out.push(`<div class="cpu-h">Busiest modules</div>`);
        for (const b of busy)
          out.push(
            `<div class="cpu-row" data-cpu-block="${c.blocks.indexOf(b.block)}">${swatch(b.block.role)}<span class="grow">${esc(b.block.name)}</span><span class="dim">${fmt(b.switched)}</span></div>`,
          );
      }
    }
  }
  out.push(
    `<div class="cpu-status ${c.status.kind}">${STATUS_ICON[c.status.kind]}<span>${esc(c.status.text)}</span></div>`,
  );
  return out.join("");
}

/** The header's numbers, from the synthesis: what the chip is made of, and how long it took. */
const sizeText = (c: Cpu) =>
  c.chip
    ? `${fmt(c.chip.syn.stats.gates)} gates · ${fmt(c.chip.syn.stats.registers)} register bits`
    : c.status.kind === "wait"
      ? "building…"
      : "not built";
/** What the map's place says until the chip is built, or once its build has failed. */
const waitText = (c: Cpu) =>
  c.status.kind === "wait" ? "Building the chip…" : "No chip to show.";
const timingText = (c: Cpu) =>
  `Synthesized in ${Math.round(c.timing.synth)} ms, booted in ${Math.round(c.timing.boot)} ms`;

/** The CPU tab's panel. Its map is drawn by showCpu() once the panel is on the page. */
export function cpuPanel(c: Cpu = cpu): string {
  return `<div class="cpu-panel">
    <div class="section-title"><span>CPU</span><span class="count" data-cpu-count${c.chip ? ` title="${timingText(c)}"` : ""}>${sizeText(c)}</span></div>
    <p class="cpu-lede">Your edits run on this chip, one clock tick each: every dot is a gate, lit at 1 and flashing when it switches.</p>
    <div class="cpu-map"><canvas aria-label="Gate map, one dot per gate"></canvas><div class="cpu-wait">${waitText(c)}</div><div class="cpu-focus" hidden></div><div class="cpu-tip" hidden></div></div>
    <div class="cpu-legend">${ROLES.map((r) => `<span>${swatch(r)}${ROLE_LABEL[r]}</span>`).join("")}</div>
    <div class="cpu-info">${infoHtml(c)}</div>
  </div>`;
}

/** The chip's window on the editor canvas while the CPU tab shows: the 14 x 10 cells its pointer
 * events can name, at `cell` px per cell. */
export function chipWindow(cell: number): string {
  return `<div class="chip-window" style="width:${GRID_W * cell}px;height:${GRID_H * cell}px"><span>CPU window · ${GRID_W} × ${GRID_H} cells</span></div>`;
}

// ---- Keeping the panel live: a frame only while the tab shows and something changed

let shown: HTMLElement | null = null;
let map: GateMap | null = null;
/** The panel whose map could not be drawn, so it is not tried again on every event. */
let broken: HTMLElement | null = null;
let listening = false;
let asked = false;
let infoDirty = false;

function ask(): void {
  if (asked) return;
  asked = true;
  requestAnimationFrame(frame);
}

function frame(t: number): void {
  asked = false;
  if (!shown?.isConnected) return;
  if (map?.stale()) mount(shown);
  if (infoDirty) {
    const info = shown.querySelector(".cpu-info");
    if (info) info.innerHTML = infoHtml(cpu);
    // Until there is a chip, the header and the map's place say whether one is being built.
    if (!cpu.chip) {
      const size = shown.querySelector("[data-cpu-count]");
      const wait = shown.querySelector(".cpu-wait");
      if (size) size.textContent = sizeText(cpu);
      if (wait) wait.textContent = waitText(cpu);
    }
    infoDirty = false;
  }
  if (map?.draw(t)) ask();
}

function mount(panel: HTMLElement): void {
  const canvas = panel.querySelector("canvas");
  const tip = panel.querySelector<HTMLElement>(".cpu-tip");
  if (!canvas || !tip || !cpu.chip || panel === broken) return;
  try {
    map = new GateMap(canvas, tip, cpu);
  } catch (e) {
    // A canvas this browser can't draw on: the rest of the panel, and the editor, go on without it.
    ((map = null), (broken = panel));
    panel.querySelector(".cpu-map")?.classList.remove("ready");
    const wait = panel.querySelector(".cpu-wait");
    if (wait)
      wait.textContent = `The gate map can't be drawn here: ${(e as Error).message}.`;
    return;
  }
  panel.querySelector(".cpu-map")?.classList.add("ready");
  const size = panel.querySelector<HTMLElement>("[data-cpu-count]");
  if (size)
    ((size.textContent = sizeText(cpu)), (size.title = timingText(cpu)));
  // A flash still fading from an event just before the tab opened.
  const s = cpu.last;
  if (s && !s.loaded && performance.now() - s.at < FLASH_MS)
    map.flash(s.nets, s.at);
  // Labels drawn before Inter loaded used a fallback: draw them again once it has.
  if (document.fonts && document.fonts.status !== "loaded")
    void document.fonts.ready.then(
      () => shown === panel && panel.isConnected && mount(panel),
    );
  // A busiest-module row under the pointer outlines its block (assigned: one handler per panel).
  const box = panel.querySelector<HTMLElement>(".cpu-focus");
  if (box) {
    panel.onmouseover = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-cpu-block]",
      );
      map?.focus(row ? Number(row.dataset.cpuBlock) : null, box);
    };
    panel.onmouseleave = () => map?.focus(null, box);
  }
  infoDirty = true;
  ask();
}

function changed(step: CpuStep | null): void {
  if (!shown?.isConnected) return; // the tab is closed: nothing to draw
  if (!map) mount(shown);
  else if (step)
    step.loaded ? map.update(step.nets) : map.flash(step.nets, step.at);
  infoDirty = true;
  ask();
}

/** Called by view.ts on every render while the CPU tab shows, with the left panel and the editor's
 * state. The first call starts building the chip: a page that never shows the tab (the Share
 * preview, a view-only link) never builds one. A new panel (the tab just opened) gets its map; an
 * open one is checked in the next frame, where reading its width costs no extra layout. */
export function showCpu(left: HTMLElement, s: State): void {
  const panel = left.querySelector<HTMLElement>(".cpu-panel");
  if (!panel) return;
  cpu.start(s);
  if (!listening) ((listening = true), cpu.listen(changed));
  if (panel !== shown) ((shown = panel), (map = null));
  if (cpu.chip && !map) mount(panel);
  else ask();
}
