// LANE: engine. The Figma implementation of RenderPort + the screen image apply.
// SAFETY: every canvas write goes through `writable`. The plugin only sets it when bound to the plugin team's own
// page ("Machine v2 (plugin test)"); on the canvas team's "Machine v2" the port is READ-ONLY, so running the plugin
// can never change what other people see.
import { N } from "../contracts/nodes";
import type { RenderPort } from "./render";

export interface FigmaApi {
  loadFontAsync(f: FontName): Promise<void>;
  createImage(bytes: Uint8Array): { hash: string };
}

const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};
const ON = rgb("#F5C542"), OFF = rgb("#333333"), ACTIVE = rgb("#2BD67B");

type Any = any; // Figma nodes are accessed structurally; the contract names are what keep this honest

export class FigmaPort implements RenderPort {
  private byName = new Map<string, Any>();
  private childCache = new Map<string, Any>();
  private pendingText = new Map<Any, string>();
  private origStrokes = new Map<Any, { strokes: readonly Paint[]; weight: number }>();
  /** counters for telemetry / tests */
  stats = { writes: 0, blocked: 0, missing: 0 };

  constructor(private page: PageNode, private api: FigmaApi, public readonly writable: boolean) {
    this.index();
  }

  private index() {
    this.page.findAll((n: Any) => {
      if (!this.byName.has(n.name) && /^(cpu|mem|dev)\//.test(n.name)) this.byName.set(n.name, n);
      return false;
    });
    const table = this.byName.get(N.decoderTable);
    if (table) for (const r of table.children ?? []) if (r.name.startsWith("row/")) this.byName.set(`${N.decoderTable}/${r.name}`, r);
  }

  private node(name: string): Any | undefined {
    const n = this.byName.get(name);
    if (!n) this.stats.missing++;
    return n;
  }
  private child(parent: Any, field: string): Any | undefined {
    const key = `${parent.id}|${field}`;
    let c = this.childCache.get(key);
    if (!c) {
      c = parent.findChild?.((x: Any) => x.name === field);
      if (c) this.childCache.set(key, c);
    }
    return c;
  }

  text(name: string, field: string | null, value: string): void {
    if (!this.writable) return void this.stats.blocked++;
    const n = this.node(name);
    const t = n && (field === null ? n : this.child(n, field));
    if (!t || t.type !== "TEXT") return void this.stats.missing++;
    this.pendingText.set(t, value);
  }

  lamp(name: string, on: boolean): void {
    if (!this.writable) return void this.stats.blocked++;
    const n = this.node(name);
    const l = n && (n.name === N.clock || n.type === "FRAME" ? this.child(n, "lamp") : n);
    if (!l) return void this.stats.missing++;
    l.fills = [{ type: "SOLID", color: on ? ON : OFF }];
    this.stats.writes++;
  }

  mark(name: string, on: boolean): void {
    if (!this.writable) return void this.stats.blocked++;
    const n = this.node(name);
    if (!n) return;
    try {
      if (n.type === "INSTANCE" && n.componentProperties?.State) {
        n.setProperties({ State: on ? "active" : "idle" }); // register variants idle/active
      } else {
        if (!this.origStrokes.has(n)) this.origStrokes.set(n, { strokes: n.strokes, weight: n.strokeWeight });
        const o = this.origStrokes.get(n)!;
        n.strokes = on ? [{ type: "SOLID", color: ACTIVE }] : o.strokes;
        n.strokeWeight = on ? 3 : o.weight;
      }
      this.stats.writes++;
    } catch {
      this.stats.missing++;
    }
  }

  /** Apply queued text writes (fonts must be loaded first). Call once per frame. */
  async flush(): Promise<void> {
    if (!this.pendingText.size) return;
    const batch = [...this.pendingText];
    this.pendingText.clear();
    const fonts = new Map<string, FontName>();
    for (const [t] of batch) {
      const f = t.fontName;
      if (f && typeof f === "object" && f.family) fonts.set(`${f.family}|${f.style}`, f);
    }
    await Promise.all([...fonts.values()].map((f) => this.api.loadFontAsync(f)));
    for (const [t, v] of batch) {
      if (t.characters !== v) { t.characters = v; this.stats.writes++; }
    }
  }

  /** Put a PNG on the screen rectangle (image fill, no smoothing needed because the PNG is pre-upscaled). */
  applyScreen(png: Uint8Array): boolean {
    if (!this.writable) return (this.stats.blocked++, false);
    const s = this.node(N.screen);
    if (!s) return false;
    const img = this.api.createImage(png);
    s.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: "FILL" }];
    this.stats.writes++;
    return true;
  }
}
