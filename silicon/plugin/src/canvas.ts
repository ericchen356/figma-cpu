// Canvas helpers of the plugin: finding the drawn circuit, moving main components in and out
// of frames, and the presentable "CPU · Step" frame that holds the cell/CPU main component
// itself (never an instance: the CPU is ~37k layers) with the front panel and the buttons.
import { CELL_PREFIX } from "../../src/figma/names";
import { COLORS, box, loadFonts, put, text } from "../../src/prototype/draw";

export const STEP_FRAME = "CPU · Step";
const PAD = 48;

/** The `cell/<name>` main component on `page`, wherever it sits (top level or in a frame). */
export function findCell(page: PageNode, name: string): ComponentNode | null {
  const full = `${CELL_PREFIX}${name}`;
  const top = page.children.find((n): n is ComponentNode => n.type === "COMPONENT" && n.name === full);
  if (top) return top;
  return (page.findAllWithCriteria({ types: ["COMPONENT"] }).find((n) => n.name === full) as ComponentNode | undefined) ?? null;
}

/** Position of `node` in page coordinates. */
export function absolutePosition(node: SceneNode): { x: number; y: number } {
  const t = (node as Partial<LayoutMixin>).absoluteTransform;
  if (t && Array.isArray(t)) return { x: t[0][2], y: t[1][2] };
  let x = node.x;
  let y = node.y;
  for (let p = node.parent; p && p.type !== "PAGE"; p = p.parent) {
    if ("x" in p && p.type !== "GROUP") {
      x += p.x;
      y += p.y;
    }
  }
  return { x, y };
}

export interface Lifted {
  node: SceneNode;
  parent: BaseNode & ChildrenMixin;
  index: number;
  x: number;
  y: number;
}

/** Moves every `cell/*` main component that sits inside a frame up to its page's top level,
 * keeping it where it is on screen (drawLibrary only reuses top-level components). Returns
 * what `restore` needs to put them back. */
export function liftCells(pages: PageNode[]): Lifted[] {
  const out: Lifted[] = [];
  for (const page of pages)
    for (const c of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
      if (!c.name.startsWith(CELL_PREFIX) || !c.parent || c.parent.type === "PAGE") continue;
      const parent = c.parent as BaseNode & ChildrenMixin;
      const at = absolutePosition(c);
      out.push({ node: c, parent, index: parent.children.indexOf(c), x: c.x, y: c.y });
      page.appendChild(c);
      c.x = at.x;
      c.y = at.y;
    }
  return out;
}

/** Puts lifted components back (those that still exist). Returns the ones that were removed. */
export function restore(lifted: Lifted[]): Lifted[] {
  const gone: Lifted[] = [];
  for (const l of lifted) {
    if (l.node.removed || l.parent.removed) {
      gone.push(l);
      continue;
    }
    if (typeof l.parent.insertChild === "function") l.parent.insertChild(Math.min(Math.max(l.index, 0), l.parent.children.length), l.node);
    else l.parent.appendChild(l.node);
    l.node.x = l.x;
    l.node.y = l.y;
  }
  return gone;
}

/** Takes cell/CPU out of the Step frame (if it is in one) and removes the frame. */
export function dismantleStepFrame(page: PageNode, cpu: ComponentNode | null): void {
  for (const f of [...page.children].filter((n) => n.name === STEP_FRAME)) {
    if (cpu && isInside(cpu, f)) {
      const at = absolutePosition(cpu);
      page.appendChild(cpu);
      cpu.x = at.x;
      cpu.y = at.y;
    }
    f.remove();
  }
}

function isInside(node: BaseNode, ancestor: BaseNode): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

export interface StepFrameOptions {
  title: string;
  subtitle: string;
  log?: (msg: string) => void;
}

export interface StepFrame {
  frame: FrameNode;
  header: FrameNode;
  /** Layers whose reactions were copied from the Control frame (incl. the frame itself). */
  reactionsCopied: number;
}

/** Height of the title band above the copied controls. */
const TOP_BAND = 92;

/** Builds the "CPU · Step" frame around the CPU main component. Its header is a copy of the
 * controls `apply()` built in the Control frame (Step / Run / Reset, counters, the front panel
 * instance) with their reactions and variable bindings, plus the Control frame's own
 * frame-level triggers (e.g. a key-held clock) on the Step frame. Navigation back to the
 * Control frame is redirected to the Step frame. So whatever reaction scheme apply() uses
 * (one big Step, chunked ticks, key clocking), the Step frame runs the same one, and no
 * reaction is hand-built here. The CPU drawing sits below the header. */
export async function buildStepFrame(api: PluginAPI, page: PageNode, cpu: ComponentNode, control: FrameNode, o: StepFrameOptions): Promise<StepFrame> {
  await loadFonts(api);
  const log = o.log ?? (() => {});
  const at = absolutePosition(cpu);
  const headerW = Math.max(control.width + 720, 1100);
  const headerH = TOP_BAND + control.height;
  const frame = box(api, STEP_FRAME, Math.max(cpu.width + 2 * PAD, headerW), headerH + cpu.height + 2 * PAD, COLORS.bg);
  frame.clipsContent = true;
  put(page, frame, at.x - PAD, at.y - headerH - PAD);
  const header = box(api, "header", headerW, headerH, COLORS.bg);
  put(frame, header, 0, 0);
  put(header, text(api, o.title, { size: 22, bold: true, name: "title" }), 24, 18);
  put(header, text(api, o.subtitle, { size: 12, color: COLORS.dim, name: "subtitle" }), 24, 52);
  put(
    header,
    text(
      api,
      "Same controls as the “CPU” flow. Every gate and wire of the CPU below\nlights while it carries a 1. Run ▸ runs the front-panel view until HLT.\nFor the full CPU at speed, use the plugin clock (the panel's Run).",
      { size: 12, color: COLORS.dim, name: "hint" },
    ),
    control.width + 48,
    TOP_BAND + 84,
  );
  put(frame, cpu, PAD, headerH + PAD);

  const pairs: Array<[SceneNode, SceneNode]> = [];
  for (const c of [...control.children]) {
    const k = c.clone();
    header.appendChild(k);
    k.x = c.x;
    k.y = c.y + TOP_BAND;
    pairUp(c, k, pairs);
  }
  let reactionsCopied = 0;
  for (const [orig, copy] of pairs) {
    const rs = (orig as Partial<ReactionMixin>).reactions;
    if (rs && rs.length) {
      await (copy as SceneNode & ReactionMixin).setReactionsAsync(redirect(rs, control.id, frame.id));
      reactionsCopied++;
    }
    await copyBindings(api, orig, copy, log);
  }
  if (control.reactions.length) {
    try {
      await frame.setReactionsAsync(redirect(control.reactions, control.id, frame.id));
      reactionsCopied++;
    } catch (e) {
      log(`could not copy the Control frame's own triggers to the Step frame: ${e}`);
    }
  }
  return { frame, header, reactionsCopied };
}

/** Pairs each layer with its clone (same tree shape), not descending into instances. */
function pairUp(a: SceneNode, b: SceneNode, out: Array<[SceneNode, SceneNode]>): void {
  out.push([a, b]);
  if (a.type === "INSTANCE" || !("children" in a) || !("children" in b)) return;
  a.children.forEach((c, i) => {
    const d = b.children[i];
    if (d) pairUp(c, d, out);
  });
}

/** Re-binds the clone's variable bindings (scalar fields) where clone() did not keep them. */
async function copyBindings(api: PluginAPI, a: SceneNode, b: SceneNode, log: (msg: string) => void): Promise<void> {
  const src = (a as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};
  const dst = (b as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};
  for (const [field, alias] of Object.entries(src)) {
    if (!alias || Array.isArray(alias) || typeof alias !== "object" || !("id" in alias)) continue;
    const id = (alias as VariableAlias).id;
    if ((dst[field] as VariableAlias | undefined)?.id === id) continue;
    const v = await api.variables.getVariableByIdAsync(id);
    if (!v) continue;
    try {
      b.setBoundVariable(field as VariableBindableNodeField, v);
    } catch (e) {
      log(`could not bind ${b.name}.${field}: ${e}`);
    }
  }
}

/** A copy of `reactions` with NODE destinations `from` → `to` (in nested conditionals too). */
export function redirect(reactions: readonly Reaction[], from: string, to: string): Reaction[] {
  const copy = JSON.parse(JSON.stringify(reactions)) as Array<Reaction & { action?: Action }>;
  const fix = (acts: Action[]) => {
    for (const a of acts) {
      if (a.type === "NODE" && a.destinationId === from) (a as { destinationId: string | null }).destinationId = to;
      if (a.type === "CONDITIONAL") for (const blk of a.conditionalBlocks) fix(blk.actions as Action[]);
    }
  };
  for (const r of copy) {
    if (r.actions) {
      delete r.action; // the deprecated single-action field; setReactionsAsync wants one of them
      fix(r.actions as Action[]);
    } else if (r.action) fix([r.action]);
  }
  return copy;
}

/** A direct child of `parent` by name. */
export function child(parent: (BaseNode & ChildrenMixin) | null | undefined, name: string): SceneNode | null {
  return parent?.children.find((c) => c.name === name) ?? null;
}

/** Sets a page's flow starting point `name` → `node`, keeping the other flows. Figma rejects
 * duplicates, so other flows with the same name or node, or on removed nodes, are dropped. */
export function setFlow(page: PageNode, name: string, node: SceneNode): void {
  const top = new Set(page.children.map((c) => c.id));
  const seen = new Set<string>([node.id]);
  const keep = page.flowStartingPoints.filter((f) => {
    if (f.name === name || !top.has(f.nodeId) || seen.has(f.nodeId)) return false;
    seen.add(f.nodeId);
    return true;
  });
  page.flowStartingPoints = [...keep, { nodeId: node.id, name }];
}
