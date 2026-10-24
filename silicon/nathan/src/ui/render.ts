// Turns a NodeSpec tree into Figma nodes. Generic: it knows frames, rectangles, text, auto layout,
// "bind this layer's visibility to that net" and "run that reaction on click / hover / key"; it
// knows nothing about the editor. Takes the Plugin API object as a parameter (never the `figma`
// global) so it runs against the fake Figma in tests. Fonts must be loaded (loadFonts).
import { FONT, FONT_BOLD, solid } from "../../../src/prototype/draw";
import type { NodeSpec, ReactionRef } from "./spec";

export interface RenderContext {
  api: PluginAPI;
  /** The BOOLEAN variable of a net, by net name (undefined: the net has no variable). */
  variable(net: string): Variable | undefined;
  /** The stored reaction(s) a spec reference stands for. One click can become two (MOUSE_DOWN,
   * MOUSE_UP) when the action list is too long for one event. */
  reactionsFor(ref: ReactionRef): Reaction[];
  /** Hands the main thread back to Figma for a moment. Called every `BREATHE_EVERY` layers: a long
   * uninterrupted build starves Figma's connection to its server, which then drops ("Unable to
   * establish connection to Figma"). */
  breathe?: () => Promise<void>;
}

const BREATHE_EVERY = 150;

export interface RenderResult {
  root: SceneNode;
  /** Every created layer by its path under the root ("editor/canvas/hot/idle-move"). */
  nodes: Map<string, SceneNode>;
  created: number;
  bound: number;
  /** Net names the spec asked for that have no variable. */
  missing: string[];
  reactions: number;
}

function make(api: PluginAPI, s: NodeSpec): SceneNode {
  switch (s.type) {
    case "frame":
      return api.createFrame();
    case "rect":
      return api.createRectangle();
    case "ellipse":
      return api.createEllipse();
    case "text":
      return api.createText();
  }
}

/** Creates `spec` under `parent` (a page or a frame) and everything below it. */
export async function render(
  ctx: RenderContext,
  parent: BaseNode & ChildrenMixin,
  spec: NodeSpec,
): Promise<RenderResult> {
  const out: RenderResult = {
    root: undefined as unknown as SceneNode,
    nodes: new Map(),
    created: 0,
    bound: 0,
    missing: [],
    reactions: 0,
  };
  const pending: Array<[SceneNode & ReactionMixin, Reaction[]]> = [];

  const build = async (
    s: NodeSpec,
    into: BaseNode & ChildrenMixin,
    parentSpec: NodeSpec | null,
    path: string,
  ): Promise<SceneNode> => {
    const api = ctx.api;
    const node = make(api, s);
    node.name = s.name;
    out.created++;
    if (ctx.breathe && out.created % BREATHE_EVERY === 0) await ctx.breathe();

    // look
    if (node.type === "TEXT") {
      const t = s.text!;
      node.fontName = t.bold ? FONT_BOLD : FONT;
      node.fontSize = t.size ?? 12;
      node.characters = t.chars;
      node.fills = solid(t.color ?? "#FFFFFF");
    } else {
      const shape = node as FrameNode | RectangleNode | EllipseNode;
      // a size given in one direction only keeps Figma's default (100) in the other
      if (s.w !== undefined || s.h !== undefined)
        shape.resize(
          Math.max(s.w ?? shape.width, 0.01),
          Math.max(s.h ?? shape.height, 0.01),
        );
      shape.fills = s.fill ? solid(s.fill) : [];
      shape.strokes = s.stroke ? solid(s.stroke) : [];
      if (s.stroke) {
        shape.strokeWeight = s.strokeWeight ?? 1;
        shape.strokeAlign = "INSIDE";
      }
      if (s.radius) shape.cornerRadius = s.radius;
      if (node.type === "FRAME") {
        node.clipsContent = !!s.clip;
        if (s.layout) {
          node.layoutMode = s.layout.dir === "H" ? "HORIZONTAL" : "VERTICAL";
          node.itemSpacing = s.layout.gap ?? 0;
          const pad = s.layout.pad ?? 0;
          node.paddingLeft =
            node.paddingRight =
            node.paddingTop =
            node.paddingBottom =
              pad;
          node.primaryAxisAlignItems = s.layout.main ?? "MIN";
          node.counterAxisAlignItems = s.layout.cross ?? "MIN";
        }
      }
    }
    if (s.hidden) node.visible = false;

    // into the tree, then what needs a parent: position, sizing in an auto-layout parent
    into.appendChild(node);
    const inAutoLayout = !!parentSpec?.layout;
    if (!inAutoLayout && s.x !== undefined && s.y !== undefined) {
      node.x = s.x;
      node.y = s.y;
    }
    if (inAutoLayout) {
      if (s.absolute) {
        (node as FrameNode).layoutPositioning = "ABSOLUTE";
        node.x = s.x ?? 0;
        node.y = s.y ?? 0;
      } else {
        (node as FrameNode).layoutSizingHorizontal = s.sizeH ?? "FIXED";
        (node as FrameNode).layoutSizingVertical = s.sizeV ?? "FIXED";
      }
    } else if (node.type === "FRAME" && s.layout) {
      // an auto-layout frame outside a flow keeps the size it was given, or hugs its content
      node.layoutSizingHorizontal = s.sizeH === "HUG" ? "HUG" : "FIXED";
      node.layoutSizingVertical = s.sizeV === "HUG" ? "HUG" : "FIXED";
    }

    // the live parts
    if (s.visibleNet) {
      const v = ctx.variable(s.visibleNet);
      if (v) {
        node.setBoundVariable("visible", v);
        out.bound++;
      } else out.missing.push(s.visibleNet);
    }
    if (s.reactions?.length) {
      pending.push([
        node as SceneNode & ReactionMixin,
        s.reactions.flatMap((r: ReactionRef) => ctx.reactionsFor(r)),
      ]);
      out.reactions += s.reactions.length;
    }

    const here = `${path}/${s.name}`;
    out.nodes.set(here, node);
    for (const c of s.children ?? [])
      await build(c, node as BaseNode & ChildrenMixin, s, here);
    return node;
  };

  out.root = await build(spec, parent, null, "");
  // reactions last: they may point at variables only, but setting them in one sweep keeps the tree build fast
  for (let i = 0; i < pending.length; i++) {
    await pending[i][0].setReactionsAsync(pending[i][1]);
    if (ctx.breathe && i % 25 === 24) await ctx.breathe();
  }
  return out;
}
