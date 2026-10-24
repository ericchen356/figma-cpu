// Small canvas helpers for prototype controls: text, buttons, lamps, variables. They take
// the Plugin API object as a parameter (never the `figma` global) so they run against a
// fake API in tests.

export const FONT: FontName = { family: "Inter", style: "Regular" };
export const FONT_BOLD: FontName = { family: "Inter", style: "Bold" };

export const COLORS = {
  bg: "#16181d",
  panel: "#1f232b",
  text: "#e6e6e6",
  dim: "#8a8f98",
  lampOff: "#33363d",
  lampOn: "#3ddc84",
  amber: "#ffb000",
  step: "#2f6fed",
  run: "#1f9d55",
  stop: "#d64545",
  reset: "#555b66",
};

export async function loadFonts(api: PluginAPI): Promise<void> {
  await api.loadFontAsync(FONT);
  await api.loadFontAsync(FONT_BOLD);
}

export function rgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
export const solid = (hex: string): SolidPaint[] => [{ type: "SOLID", color: rgb(hex) }];

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: string;
  name?: string;
  x?: number;
  y?: number;
}

/** A text node (fonts must be loaded first, see `loadFonts`). */
export function text(api: PluginAPI, characters: string, o: TextOptions = {}): TextNode {
  const t = api.createText();
  t.fontName = o.bold ? FONT_BOLD : FONT;
  t.fontSize = o.size ?? 12;
  t.characters = characters;
  t.fills = solid(o.color ?? COLORS.text);
  t.name = o.name ?? characters.slice(0, 40);
  t.x = o.x ?? 0;
  t.y = o.y ?? 0;
  return t;
}

/** A plain frame with a fill. */
export function box(api: PluginAPI, name: string, w: number, h: number, fill = COLORS.panel, radius = 0): FrameNode {
  const f = api.createFrame();
  f.name = name;
  f.resize(w, h);
  f.fills = solid(fill);
  f.cornerRadius = radius;
  f.clipsContent = false;
  return f;
}

/** A clickable button (a frame with a centered label). Attach reactions to the frame. */
export function button(api: PluginAPI, label: string, color: string, w = 132, h = 44): FrameNode {
  const f = box(api, `button/${label}`, w, h, color, 8);
  const t = text(api, label, { size: 15, bold: true, color: "#ffffff", name: "label" });
  t.textAlignHorizontal = "CENTER";
  t.textAlignVertical = "CENTER";
  t.resize(w, h);
  f.appendChild(t);
  return f;
}

/** A round lamp: a dark disc with a bright `lit` child whose visibility gets bound. */
export function lamp(api: PluginAPI, size: number, on = COLORS.lampOn, name = "lamp"): { node: FrameNode; lit: EllipseNode } {
  const node = box(api, name, size, size, COLORS.lampOff, size / 2);
  const lit = api.createEllipse();
  lit.name = "lit";
  const inset = Math.max(1, Math.round(size / 8));
  lit.resize(size - 2 * inset, size - 2 * inset);
  lit.x = inset;
  lit.y = inset;
  lit.fills = solid(on);
  node.appendChild(lit);
  return { node, lit };
}

/** Places `child` inside `parent` at (x, y). */
export function put<T extends SceneNode>(parent: BaseNode & ChildrenMixin, child: T, x: number, y: number): T {
  parent.appendChild(child);
  child.x = x;
  child.y = y;
  return child;
}

// ---------- variables ----------

export interface VariableSpec {
  name: string;
  type: "BOOLEAN" | "FLOAT" | "STRING";
  init: boolean | number | string;
}

/** Collections created by `createVariables` are named `name`, `name · 2`, `name · 3`, … */
const chunkName = (name: string, i: number) => (i === 0 ? name : `${name} · ${i + 1}`);
const isChunkOf = (coll: string, name: string) => coll === name || new RegExp(`^${escapeRe(name)} · \\d+$`).test(coll);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes the local collections a previous `createVariables(name)` made. Returns the count. */
export async function removeCollections(api: PluginAPI, name: string): Promise<number> {
  const all = await api.variables.getLocalVariableCollectionsAsync();
  let n = 0;
  for (const c of all)
    if (isChunkOf(c.name, name)) {
      c.remove();
      n++;
    }
  return n;
}

export interface CreateVariablesOptions {
  /** Variables per collection (Figma allows 5000; default 4000 for headroom). */
  max?: number;
  log?: (msg: string) => void;
  /** Yield to the event loop every this many variables (default 500), so progress shows. */
  yieldEvery?: number;
}

/** Creates the variables in order, spilling into extra collections every `max` variables.
 * Each gets its initial value in the collection's default mode. */
export async function createVariables(
  api: PluginAPI,
  name: string,
  specs: VariableSpec[],
  o: CreateVariablesOptions = {},
): Promise<{ collections: VariableCollection[]; vars: Variable[] }> {
  const max = o.max ?? 4000;
  const yieldEvery = o.yieldEvery ?? 500;
  const collections: VariableCollection[] = [];
  const vars: Variable[] = [];
  for (let i = 0; i < specs.length; i++) {
    if (i % max === 0) collections.push(api.variables.createVariableCollection(chunkName(name, collections.length)));
    const coll = collections[collections.length - 1];
    const s = specs[i];
    let v: Variable;
    try {
      v = api.variables.createVariable(s.name, coll, s.type);
    } catch (e) {
      // Fall back to a conservative name if Figma rejects a character in this one.
      const safe = s.name.replace(/[^\w/ -]/g, "_");
      if (safe === s.name) throw new Error(`createVariable(${s.name}): ${e}`);
      v = api.variables.createVariable(safe, coll, s.type);
    }
    v.setValueForMode(coll.defaultModeId, s.init);
    vars.push(v);
    if ((i + 1) % yieldEvery === 0) {
      o.log?.(`  ${name}: ${i + 1}/${specs.length} variables`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { collections, vars };
}

/** Sets the page's prototype flows: `add` first (in order), then the existing flows whose node
 * is still a top-level child and is not in `add`. Deduplicated by node id: Figma rejects
 * duplicates ("Found duplicate input nodeIds"), and it creates a flow by itself when a
 * frame gets its first navigation, so the same frame can already be listed under another name. */
export function setFlows(page: PageNode, add: Array<{ nodeId: string; name: string }>): void {
  const top = new Set(page.children.map((c) => c.id));
  const seen = new Set<string>();
  const out: Array<{ nodeId: string; name: string }> = [];
  const names = new Set(add.map((f) => f.name));
  const push = (f: { nodeId: string; name: string }) => {
    seen.add(f.nodeId);
    out.push({ nodeId: f.nodeId, name: f.name });
  };
  for (const f of add) if (!seen.has(f.nodeId)) push(f);
  for (const f of page.flowStartingPoints) if (top.has(f.nodeId) && !seen.has(f.nodeId) && !names.has(f.name)) push(f);
  page.flowStartingPoints = out;
}

/** Binds a node's visibility to a boolean variable (or fixes it, for a constant net). */
export function bindVisible(node: SceneNode, v: Variable | boolean): void {
  if (typeof v === "boolean") node.visible = v;
  else node.setBoundVariable("visible", v);
}
