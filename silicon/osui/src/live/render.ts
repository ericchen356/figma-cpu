// Makes a LiveNode tree (screen.ts) in Figma: captured looks through layers.ts, the synthetic
// layers (spacers, shapes, digits) directly; then the bindings (visibility, opacity) and the
// reactions. Takes the Plugin API as a parameter, so it runs against the fake Figma in tests.
import type { Line } from "../cpu/disp";
import { type Fonts, make, solid } from "../layers";
import type { Act, LiveNode } from "./screen";

export interface LiveRenderContext {
  api: PluginAPI;
  fonts: Fonts;
  problems: string[];
  /** The variable a line binds to, or its constant value. */
  line(l: Line): Variable | boolean;
  /** A display variable by name (rom.ts): a glyph, colour, radius or opacity. */
  variable(name: string): Variable | undefined;
  /** What a layer's acts become: its reactions. */
  reactions(acts: Act[], node: SceneNode): Reaction[];
  /** Hands the main thread back to Figma now and then (a long run drops its server connection). */
  breathe?: () => Promise<void>;
}

export interface LiveRenderResult {
  root: SceneNode;
  created: number;
  bound: number;
  reactions: number;
}

const BREATHE_EVERY = 150;

/** Makes `spec` under `parent`, with everything below it. */
export async function renderLive(
  ctx: LiveRenderContext,
  parent: BaseNode & ChildrenMixin,
  spec: LiveNode,
): Promise<LiveRenderResult> {
  const out: LiveRenderResult = {
    root: undefined as unknown as SceneNode,
    created: 0,
    bound: 0,
    reactions: 0,
  };
  const pending: Array<[SceneNode & ReactionMixin, Act[]]> = [];
  const { api, problems } = ctx;
  const step = (node: { name: string }, what: string, f: () => void) => {
    try {
      f();
    } catch (e) {
      problems.push(
        `${node.name} — ${what}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const create = async (s: LiveNode): Promise<SceneNode | null> => {
    if (s.layer) return make(api, s.layer, ctx.fonts, problems);
    switch (s.type ?? "frame") {
      case "frame": {
        const f = api.createFrame();
        f.fills = [];
        f.clipsContent = !!s.clip;
        return f;
      }
      case "rect":
        return api.createRectangle();
      case "ellipse":
        return api.createEllipse();
      case "star": {
        const n = api.createStar();
        step(s, "star", () => {
          n.pointCount = s.star?.points ?? 5;
          n.innerRadius = s.star?.inner ?? 0.382;
        });
        return n;
      }
      case "vector": {
        const v = api.createVector();
        step(s, "path", () => {
          v.vectorPaths = [{ windingRule: "NONZERO", data: s.path ?? "" }];
        });
        return v;
      }
      case "text": {
        const t = api.createText();
        const T = s.text!;
        step(s, "font", () => (t.fontName = ctx.fonts.name("Inter", T.weight)));
        step(s, "font size", () => (t.fontSize = T.size));
        if (T.lineHeight)
          step(
            s,
            "line height",
            () => (t.lineHeight = { value: T.lineHeight!, unit: "PIXELS" }),
          );
        if (T.letterSpacing)
          step(
            s,
            "letter spacing",
            () =>
              (t.letterSpacing = { value: T.letterSpacing!, unit: "PIXELS" }),
          );
        step(s, "colour", () => (t.fills = [solid(T.color)]));
        step(s, "characters", () => (t.characters = T.chars));
        step(s, "size", () => {
          if (T.width != null) {
            t.textAutoResize = "HEIGHT";
            t.resize(T.width, t.height);
          } else t.textAutoResize = "WIDTH_AND_HEIGHT";
        });
        if (T.align) step(s, "align", () => (t.textAlignHorizontal = T.align!));
        return t;
      }
    }
  };

  const build = async (
    s: LiveNode,
    into: BaseNode & ChildrenMixin,
    parentSpec: LiveNode | null,
  ): Promise<SceneNode | null> => {
    let node: SceneNode | null = null;
    try {
      node = await create(s);
    } catch (e) {
      problems.push(
        `${s.name} — create: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!node) return null;
    node.name = s.name;
    out.created++;
    if (ctx.breathe && out.created % BREATHE_EVERY === 0) await ctx.breathe();

    // a synthetic layer's look (a captured one has it already)
    const shape = node as SceneNode & GeometryMixin & MinimalStrokesMixin;
    if (!s.layer) {
      if (s.fills && "fills" in shape)
        step(s, "fills", () => (shape.fills = s.fills!.map((c) => solid(c))));
      else if (
        node.type !== "TEXT" &&
        node.type !== "FRAME" &&
        "fills" in shape
      )
        step(s, "fills", () => (shape.fills = []));
      if (s.stroke) {
        const st = s.stroke;
        step(s, "stroke", () => {
          shape.strokes = [solid(st.color)];
          shape.strokeWeight = st.weight;
          shape.strokeAlign = st.align ?? "INSIDE";
          if (st.dash) shape.dashPattern = st.dash;
          if (st.cap && "strokeCap" in shape)
            (shape as VectorNode).strokeCap = st.cap;
          if (st.join) (shape as VectorNode).strokeJoin = st.join;
        });
      }
      if (s.radius && "cornerRadius" in node)
        step(
          s,
          "radius",
          () => ((node as RectangleNode).cornerRadius = s.radius!),
        );
    }
    if (s.opacity != null)
      step(
        s,
        "opacity",
        () => ((node as BlendMixin & SceneNode).opacity = s.opacity!),
      );
    if (node.type === "FRAME" && s.clip != null)
      step(s, "clip", () => ((node as FrameNode).clipsContent = s.clip!));

    // into the tree
    try {
      into.appendChild(node);
    } catch (e) {
      node.remove();
      problems.push(
        `${s.name} — place: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
    const autoParent = !!parentSpec?.layout && !s.absolute;
    const frameNode = node as FrameNode;
    if (s.layout && node.type === "FRAME")
      step(s, "auto layout", () => {
        frameNode.layoutMode =
          s.layout!.dir === "H" ? "HORIZONTAL" : "VERTICAL";
        frameNode.itemSpacing = s.layout!.gap ?? 0;
        frameNode.paddingLeft =
          frameNode.paddingRight =
          frameNode.paddingTop =
          frameNode.paddingBottom =
            0;
        frameNode.primaryAxisAlignItems = s.layout!.main ?? "MIN";
        frameNode.counterAxisAlignItems = s.layout!.cross ?? "MIN";
      });
    const parentSize = into as unknown as { width: number; height: number };
    // size first, then position (a pinned side needs the size)
    if (
      !s.layer &&
      (s.w !== undefined || s.h !== undefined) &&
      "resize" in node
    )
      step(s, "size", () =>
        (node as FrameNode).resize(
          Math.max(s.w ?? (node as FrameNode).width, 0.01),
          Math.max(s.h ?? (node as FrameNode).height, 0.01),
        ),
      );
    if (autoParent) {
      // a text grows with its bound characters unless it has a set width (FIXED would wrap it)
      const hug = node.type === "TEXT" && !s.layer ? "HUG" : "FIXED";
      step(s, "sizing", () => {
        frameNode.layoutSizingHorizontal =
          s.sizeH ?? (s.text?.width != null ? "FIXED" : hug);
        frameNode.layoutSizingVertical = s.sizeV ?? hug;
      });
    } else {
      if (s.absolute && parentSpec?.layout)
        step(s, "absolute", () => (frameNode.layoutPositioning = "ABSOLUTE"));
      if (s.layout && node.type === "FRAME")
        step(s, "hug", () => {
          frameNode.layoutSizingHorizontal =
            s.sizeH === "HUG" ? "HUG" : "FIXED";
          frameNode.layoutSizingVertical = s.sizeV === "HUG" ? "HUG" : "FIXED";
        });
      if (s.edges) placeByEdges(s, node, parentSize);
      else if (s.rotation) {
        // as buildLayers: CSS turns about the box centre, Figma about the node's corner
        const th = (-s.rotation * Math.PI) / 180;
        const [w, h] = [s.layer?.w ?? node.width, s.layer?.h ?? node.height];
        const cx = (s.x ?? 0) + w / 2;
        const cy = (s.y ?? 0) + h / 2;
        step(s, "rotation", () => {
          (node as LayoutMixin).rotation = -s.rotation!;
          node!.x = cx - (Math.cos(th) * w) / 2 - (Math.sin(th) * h) / 2;
          node!.y = cy + (Math.sin(th) * w) / 2 - (Math.cos(th) * h) / 2;
        });
      } else {
        node.x = s.x ?? 0;
        node.y = s.y ?? 0;
      }
    }

    // the live parts
    if (s.visible) {
      const v = ctx.line(s.visible);
      if (typeof v === "boolean") node.visible = v;
      else
        step(s, "bind visible", () => {
          node!.setBoundVariable("visible", v);
          out.bound++;
        });
    }
    const named = (name: string) => {
      const v = ctx.variable(name);
      if (!v) problems.push(`${s.name} — no variable ${name}`);
      return v;
    };
    const bindField = (field: string, name: string) => {
      const v = named(name);
      if (v)
        step(s, `bind ${field}`, () => {
          node!.setBoundVariable(field as VariableBindableNodeField, v);
          out.bound++;
        });
    };
    if (s.opacityVar) bindField("opacity", s.opacityVar);
    if (s.chars) bindField("characters", s.chars);
    if (s.radiusVar)
      for (const corner of [
        "topLeftRadius",
        "topRightRadius",
        "bottomLeftRadius",
        "bottomRightRadius",
      ])
        bindField(corner, s.radiusVar);
    // a colour variable on the first fill / stroke paint
    const paintBound = (
      key: "fills" | "strokes",
      name: string,
      alpha?: number,
    ) => {
      const v = named(name);
      if (!v) return;
      step(s, `bind ${key}`, () => {
        const base = { ...solid({ hex: "#000000" }), opacity: alpha ?? 1 };
        const p = api.variables.setBoundVariableForPaint(base, "color", v);
        (node as unknown as GeometryMixin)[key] = [p];
        out.bound++;
      });
    };
    if (s.fillVar) paintBound("fills", s.fillVar, s.fillAlpha);
    if (s.strokeVar) paintBound("strokes", s.strokeVar);
    for (const c of s.children ?? [])
      await build(c, node as unknown as BaseNode & ChildrenMixin, s);
    if (s.acts?.length)
      pending.push([node as SceneNode & ReactionMixin, s.acts]);
    return node;
  };

  const placeByEdges = (
    s: LiveNode,
    node: SceneNode,
    parent: { width: number; height: number },
  ) => {
    const e = s.edges!;
    const n = node as FrameNode;
    const across = (
      lo: number | undefined,
      hi: number | undefined,
      size: number,
      own: number,
    ) =>
      lo !== undefined && hi !== undefined
        ? {
            pos: lo,
            len: Math.max(size - lo - hi, 0.01),
            c: "STRETCH" as const,
          }
        : hi !== undefined
          ? { pos: size - own - hi, len: own, c: "MAX" as const }
          : { pos: lo ?? 0, len: own, c: "MIN" as const };
    const h = across(e.left, e.right, parent.width, s.w ?? n.width);
    const v = across(e.top, e.bottom, parent.height, s.h ?? n.height);
    step(s, "size", () =>
      n.resize(Math.max(h.len, 0.01), Math.max(v.len, 0.01)),
    );
    n.x = h.pos;
    n.y = v.pos;
    step(
      s,
      "constraints",
      () => (n.constraints = { horizontal: h.c, vertical: v.c }),
    );
  };

  out.root = (await build(spec, parent, null))!;
  // reactions last, a few at a time
  for (let i = 0; i < pending.length; i++) {
    const [node, acts] = pending[i];
    try {
      await node.setReactionsAsync(ctx.reactions(acts, node));
      out.reactions++;
    } catch (e) {
      problems.push(
        `${node.name} — reactions: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (ctx.breathe && i % 25 === 24) await ctx.breathe();
  }
  return out;
}
