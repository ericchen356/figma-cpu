// The OS card's main-side host (docs/OS-CPU-CONTRACT.md §4, §7): it connects the OS toolchain
// (src/os: loadImage, parseBindingsFile, applyBindings, inputFromEvent) to the plugin.
//
//   Load OS      manifest + source → loadImage; bindings JSON → parseBindingsFile. Any error:
//                nothing is loaded, every message goes to the panel verbatim. Otherwise the
//                bytes go through the existing "Load program" path (SiliconApp.loadProgram).
//   RAM → canvas after every plugin-clock frame / Step, the 16 RAM bytes are read from the
//                simulator and applyBindings(ram, bindings, previous) gives the property CHANGES;
//                only those are written, to layers found by NAME on the current page through a
//                LayerPort. A missing layer is logged once per name, never thrown.
//   canvas → RAM a keymap event (UI button, key, or selecting a named layer) becomes an input
//                byte, held here and handed to the DeviceBus only when RAM[IN] reads 0 at a tick
//                boundary. At most one byte is held; while one is held, new events are dropped.
//
// Lost-key race (inherent to the contract, see os/hello-os.asm): the byte is poked at a frame /
// Step boundary, which can fall anywhere inside an instruction. If the OS has already executed
// `LD R0,[IN]` (it read 0) but not yet its consume `ST R3,[IN]`, the consume overwrites the poked
// byte with 0 and the key is lost. Waiting for RAM[IN] = 0 avoids overwriting an unconsumed key;
// it cannot close that window. A lost key shows up as "nothing changed": send it again.
//
// No `figma` global here: the Figma side is the injected LayerPort (figmaLayerPort for real
// Figma), so this runs in Node against a fake port.
import { readRam, type SimLike } from "../../src/cpu/probes";
import {
  applyBindings,
  type BindValue,
  type Binding,
  type CanvasWrite,
  type ImageIssue,
  type InputEvent,
  inputFromEvent,
  type Keymap,
  loadImage,
  type OsImage,
  parseBindingsFile,
  type Region,
} from "../../src/os";
import { FONT, rgb, solid, text } from "../../src/prototype/draw";
import { STEP_FRAME } from "./canvas";
import { type DeviceBus, type DeviceHook, IN_ADDR, readFramebuffer } from "./devices";
import type { LogLevel, OsBindingRow, OsReport, ToUi } from "./messages";

/** The layer properties a binding can write (a subset of a Figma SceneNode). */
export interface LayerLike {
  name?: string;
  type?: string;
  visible: boolean;
  x: number;
  y: number;
  opacity: number;
  /** Text layers only. */
  characters?: string;
  fills?: unknown;
}

/** How the host reaches the canvas. */
export interface LayerPort {
  /** The layer called `name` on the current page, or null. */
  findByName(name: string): LayerLike | null;
  /** Loads the font(s) of a text layer before its characters are set. */
  loadFont?(layer: LayerLike): Promise<void>;
}

export interface OsHostDeps {
  bus: DeviceBus;
  port: LayerPort;
  log: (level: LogLevel, text: string) => void;
  post: (m: ToUi) => void;
  /** The existing "Load program" path (SiliconApp.loadProgram). */
  loadProgram: (source: string) => Promise<unknown>;
}

export type SendResult = "held" | "dropped" | "unmapped";

/** Name of the frame "Build OS demo" creates. */
export const OS_DEMO_FRAME = "OS demo";
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const issueLine = (kind: "error" | "warning", i: ImageIssue) => `${kind} [${i.code}] ${i.msg}`;

function parseJson(label: string, text: unknown): { value?: unknown; error?: string } {
  if (typeof text !== "string") return { value: text }; // already an object (tests, embedded files)
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${label}: not valid JSON (${errText(e)})` };
  }
}

const describeRam = (b: Binding) =>
  b.ram.bit !== undefined ? `RAM[${b.ram.addr}].${b.ram.bit}` : b.ram.bits ? `RAM[${b.ram.addr}].${b.ram.bits[0]}–${b.ram.bits[1]}` : `RAM[${b.ram.addr}]`;
const describeMap = (b: Binding) =>
  !b.map ? "" : "table" in b.map ? `table ${JSON.stringify(b.map.table)}` : `×${b.map.scale}${b.map.offset ? ` + ${b.map.offset}` : ""}`;

export class OsHost implements DeviceHook {
  /** The OS currently driving the canvas (null: none; the plugin clock runs plain programs). */
  private active: { name: string; source: string; bindings: Binding[]; keymap: Keymap } | null = null;
  private loading: string | null = null;
  private sim: SimLike | null = null;
  /** RAM as of the last canvas sync (null: next sync writes every bound property). */
  private prev: number[] | null = null;
  private held: { value: number; label: string } | null = null;
  /** Problems already logged (missing layer per name, wrong layer kind per node.prop). */
  private reported = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  /** Layer writes actually performed (tests / log). */
  writes = 0;

  constructor(private readonly d: OsHostDeps) {}

  get isActive(): boolean {
    return !!this.active;
  }
  get name(): string | null {
    return this.active?.name ?? null;
  }
  /** The input byte waiting for RAM[IN] to read 0, if any. */
  get pending(): number | null {
    return this.held?.value ?? null;
  }
  get keymap(): Keymap {
    return this.active?.keymap ?? {};
  }
  get bindings(): readonly Binding[] {
    return this.active?.bindings ?? [];
  }

  // ---------- load ----------

  /** Validates and loads an OS. Nothing is loaded when anything is wrong; the report (posted
   * to the panel as {type:"os"}) carries every loader message verbatim. */
  async load(manifestJson: unknown, source: string, bindingsJson: unknown): Promise<OsReport> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const m = parseJson("manifest", manifestJson);
    const b = parseJson("bindings", bindingsJson);
    let img: OsImage | null = null;
    if (m.error) errors.push(`error [manifest] ${m.error}`);
    else {
      img = loadImage(m.value, source);
      errors.push(...img.errors.map((i) => issueLine("error", i)));
      warnings.push(...img.warnings.map((i) => issueLine("warning", i)));
    }
    let parsed: ReturnType<typeof parseBindingsFile> | null = null;
    if (b.error) errors.push(`error [bindings] ${b.error}`);
    else {
      parsed = parseBindingsFile(b.value);
      errors.push(...parsed.errors.map((e) => `error [bindings] ${e}`));
      warnings.push(...parsed.warnings.map((w) => `warning [bindings] ${w}`));
    }
    const report: OsReport = {
      ok: false,
      loaded: false,
      name: img?.name ?? "?",
      errors,
      warnings,
      regions: img?.regions.map((r: Region) => ({ ...r })) ?? [],
      bytes: img?.bytes ?? [],
      bindings: (parsed?.bindings ?? []).map((x): OsBindingRow => ({ node: x.node, prop: x.prop, ram: describeRam(x), map: describeMap(x) })),
      keymap: { click: { ...(parsed?.keymap.click ?? {}) }, key: { ...(parsed?.keymap.key ?? {}) } },
    };
    if (errors.length || !img || !parsed) {
      this.d.post({ type: "os", report });
      this.d.log("error", `Load OS: ${errors.length} error(s), nothing loaded`);
      return report;
    }
    this.loading = source;
    try {
      await this.d.loadProgram(source);
    } catch (e) {
      report.errors.push(`error [load] ${errText(e)}`);
      this.d.post({ type: "os", report });
      throw e;
    } finally {
      this.loading = null;
    }
    this.active = { name: img.name, source, bindings: parsed.bindings, keymap: parsed.keymap };
    this.reset();
    report.ok = report.loaded = true;
    this.d.post({ type: "os", report });
    const keys = Object.keys(parsed.keymap.click ?? {}).length + Object.keys(parsed.keymap.key ?? {}).length;
    this.d.log("ok", `OS "${img.name}" loaded: ${img.use.filter((u) => u).length} bytes, ${parsed.bindings.length} binding(s), ${keys} keymap entr${keys === 1 ? "y" : "ies"}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
    return report;
  }

  /** SiliconApp.loadProgram calls this: another program replaces the OS; the OS itself
   * (re)loaded means a fresh power-on (new simulator, full canvas sync, no held key). */
  programLoaded(source: string): void {
    if (this.active && source !== this.active.source && source !== this.loading) {
      this.active = null;
      this.d.log("info", "OS card: another program was loaded; the OS bindings are off until Load OS");
    }
    this.reset();
  }

  private reset() {
    this.sim = null;
    this.prev = null;
    this.held = null;
  }

  /** Forget what was synced (layers were created): the next frame writes every property. */
  resync(): void {
    this.prev = null;
    this.reported.clear();
  }

  // ---------- canvas → RAM ----------

  /** A keymap event (UI button, key, selected layer). Held until RAM[IN] reads 0. */
  send(event: InputEvent): SendResult {
    const label = event.type === "click" ? `click "${event.node}"` : `key "${event.key}"`;
    if (!this.active) {
      this.d.log("error", `OS ${label}: no OS loaded (Load OS first)`);
      return "unmapped";
    }
    const v = inputFromEvent(event, this.active.keymap);
    if (v === null) {
      this.d.log("info", `OS ${label}: not in the keymap`);
      return "unmapped";
    }
    if (this.held) {
      this.d.log("info", `OS ${label} dropped: ${this.held.label} (${hex2(this.held.value)}) is still waiting for RAM[${IN_ADDR}] = 0`);
      return "dropped";
    }
    this.held = { value: v, label };
    this.d.log("info", `OS ${label} → ${hex2(v)}, delivered when RAM[${IN_ADDR}] reads 0 at the next frame / Step`);
    return "held";
  }

  /** DeviceHook, called by PluginClock at the tick boundary before each frame / step: the
   * DeviceBus first (raw "input" bytes), then the held key if RAM[IN] reads 0. */
  apply(sim: SimLike): number {
    this.sim = sim;
    let forced = this.d.bus.apply(sim);
    if (this.held && readRam(sim, IN_ADDR) === 0) {
      this.d.bus.input(this.held.value);
      this.held = null;
      forced += this.d.bus.apply(sim);
    }
    return forced;
  }

  // ---------- RAM → canvas ----------

  /** After a clock frame / Step: diff RAM against the last sync and queue the layer writes. */
  frame(): void {
    if (!this.active || !this.sim) return;
    const ram = readFramebuffer(this.sim);
    let changes: CanvasWrite[];
    try {
      changes = applyBindings(ram, this.active.bindings, this.prev ?? undefined);
    } catch (e) {
      this.once("bindings", `OS bindings: ${errText(e)}`);
      return;
    }
    this.prev = ram;
    if (changes.length) this.chain = this.chain.then(() => this.write(changes));
  }

  /** Resolves when every queued layer write is done. */
  flush(): Promise<void> {
    return this.chain;
  }

  private once(key: string, text: string) {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.d.log("error", text);
  }

  private async write(changes: CanvasWrite[]): Promise<void> {
    for (const w of changes) {
      try {
        const layer = this.d.port.findByName(w.node);
        if (!layer) {
          this.once(`missing:${w.node}`, `OS: no layer named "${w.node}" on this page (bound to ${w.prop}); its writes are skipped (Build OS demo creates it)`);
          continue;
        }
        if (await this.set(layer, w.prop, w.value)) this.writes++;
      } catch (e) {
        this.once(`fail:${w.node}.${w.prop}`, `OS: could not set ${w.node}.${w.prop} = ${JSON.stringify(w.value)}: ${errText(e)}`);
      }
    }
  }

  /** Sets one property; false (logged once) when the layer cannot take it. */
  private async set(layer: LayerLike, prop: CanvasWrite["prop"], value: BindValue): Promise<boolean> {
    const name = layer.name ?? "?";
    switch (prop) {
      case "visible":
        layer.visible = value === true;
        return true;
      case "x":
      case "y":
      case "opacity":
        layer[prop] = Number(value);
        return true;
      case "text":
        if (layer.type !== "TEXT" || typeof layer.characters !== "string") {
          this.once(`kind:${name}.text`, `OS: layer "${name}" is not a text layer; its text binding is skipped`);
          return false;
        }
        await this.d.port.loadFont?.(layer);
        layer.characters = String(value);
        return true;
      case "fill":
        if (!("fills" in layer)) {
          this.once(`kind:${name}.fill`, `OS: layer "${name}" has no fills; its fill binding is skipped`);
          return false;
        }
        layer.fills = [{ type: "SOLID", color: rgb(String(value)) }];
        return true;
    }
  }

  // ---------- the demo layers ----------

  /** Layer names the loaded OS needs, with the kind to create: TEXT when bound to text. */
  neededLayers(): Array<{ name: string; kind: "TEXT" | "FRAME"; moves: boolean; clickable: boolean }> {
    const a = this.active;
    if (!a) return [];
    const out = new Map<string, { name: string; kind: "TEXT" | "FRAME"; moves: boolean; clickable: boolean }>();
    const get = (name: string) => out.get(name) ?? out.set(name, { name, kind: "FRAME", moves: false, clickable: false }).get(name)!;
    for (const b of a.bindings) {
      const e = get(b.node);
      if (b.prop === "text") e.kind = "TEXT";
      if (b.prop === "x" || b.prop === "y") e.moves = true;
    }
    for (const n of Object.keys(a.keymap.click ?? {})) get(n).clickable = true;
    return [...out.values()];
  }
}

// ---------- real Figma ----------

/** Where name lookups must not descend: the CPU drawing (~37k layers), instances, prototype frames. */
function skipInside(n: SceneNode): boolean {
  return n.type === "INSTANCE" || n.type === "COMPONENT" || n.name === STEP_FRAME || n.name.startsWith("CPU · ") || n.name.startsWith("Silicon · ");
}

/** Breadth-first search by exact name on `page`: the "OS demo" frame first, then the page,
 * never inside the CPU drawing, component instances or the prototype frames. */
export function findNamed(page: PageNode, name: string): SceneNode | null {
  const demo = page.children.find((n) => n.name === OS_DEMO_FRAME);
  const queue: SceneNode[] = demo && "children" in demo ? [...demo.children] : [];
  queue.push(...page.children);
  const seen = new Set<SceneNode>();
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (seen.has(n)) continue;
    seen.add(n);
    if (n.name === name) return n;
    if (!skipInside(n) && "children" in n) queue.push(...(n.children as readonly SceneNode[]));
  }
  return null;
}

/** LayerPort on the current page of a real (or fake) Figma, with a name → node cache. */
export function figmaLayerPort(api: PluginAPI): LayerPort {
  const cache = new Map<string, SceneNode>();
  return {
    findByName(name) {
      const hit = cache.get(name);
      if (hit && !hit.removed && hit.name === name && pageOf(hit) === api.currentPage) return hit as unknown as LayerLike;
      cache.delete(name);
      const found = findNamed(api.currentPage, name);
      if (found) cache.set(name, found);
      return found as unknown as LayerLike | null;
    },
    async loadFont(layer) {
      const t = layer as unknown as TextNode;
      const f = t.fontName;
      if (f && typeof f === "object" && "family" in f) await api.loadFontAsync(f);
      else for (const g of t.getRangeAllFontNames(0, t.characters.length)) await api.loadFontAsync(g);
    },
  };
}

function pageOf(n: BaseNode): BaseNode | null {
  let p: BaseNode | null = n;
  while (p && p.type !== "PAGE") p = p.parent;
  return p;
}

// ---------- "Build OS demo" ----------

export interface DemoResult {
  frame: FrameNode;
  created: string[];
  skipped: string[];
}

/** Creates, once, the layers the OS needs (by name), in a frame "OS demo" right of the CPU
 * (right of the "CPU · Step" frame when the CPU sits in it). Existing names are skipped. */
export async function buildOsDemo(
  api: PluginAPI,
  page: PageNode,
  needed: ReturnType<OsHost["neededLayers"]>,
  anchor: SceneNode | null,
): Promise<DemoResult> {
  await api.loadFontAsync(FONT);
  const created: string[] = [];
  const skipped: string[] = [];
  let frame = page.children.find((n): n is FrameNode => n.type === "FRAME" && n.name === OS_DEMO_FRAME) ?? null;
  const W = 720;
  const H = 420;
  if (!frame) {
    frame = api.createFrame();
    page.appendChild(frame);
    frame.name = OS_DEMO_FRAME;
    frame.resize(W, H);
    frame.fills = solid("#101418");
    frame.clipsContent = false;
    const right = anchor ? anchor.x + anchor.width + 400 : Math.max(0, ...page.children.filter((n) => n !== frame).map((n) => n.x + n.width)) + 400;
    frame.x = Math.round(right);
    frame.y = Math.round(anchor ? anchor.y : 0);
    created.push(OS_DEMO_FRAME);
  } else skipped.push(OS_DEMO_FRAME);

  let movers = 0;
  let row = 0;
  for (const n of needed) {
    if (findNamed(page, n.name)) {
      skipped.push(n.name);
      continue;
    }
    if (n.kind === "TEXT") {
      const t = text(api, n.name === "status" ? "closed" : "0", { size: 16, name: n.name, color: "#e6e6e6" });
      frame.appendChild(t);
      t.x = 40 + 200 * (row % 3);
      t.y = H - 40;
      row++;
    } else if (n.moves) {
      const f = api.createFrame();
      frame.appendChild(f);
      f.name = n.name;
      f.resize(200, 140);
      f.fills = solid("#e6e6e6");
      f.cornerRadius = 8;
      f.x = 40;
      f.y = 40 + 160 * movers++;
      const title = text(api, n.name, { size: 12, name: `${n.name}/title`, color: "#16181d" });
      f.appendChild(title);
      title.x = 10;
      title.y = 8;
    } else {
      const f = api.createFrame();
      frame.appendChild(f);
      f.name = n.name;
      f.resize(160, 36);
      f.fills = solid(n.name.includes("taskbar") ? "#3a3a3a" : "#555b66");
      f.cornerRadius = 6;
      f.x = 40 + 180 * (row % 3);
      f.y = H - 100;
      row++;
      const label = text(api, n.clickable ? `click: ${n.name}` : n.name, { size: 12, name: `${n.name}/label`, color: "#ffffff" });
      f.appendChild(label);
      label.x = 10;
      label.y = 10;
    }
    created.push(n.name);
  }
  return { frame, created, skipped };
}

/** Names of the selected layers (and their ancestors up to the page), innermost first: a
 * click on a label inside a "taskbar-button" frame selects the label, which still counts. */
export function selectedNames(api: PluginAPI): string[] {
  const out: string[] = [];
  for (const s of api.currentPage.selection) for (let p: BaseNode | null = s; p && p.type !== "PAGE"; p = p.parent) out.push(p.name);
  return out;
}
