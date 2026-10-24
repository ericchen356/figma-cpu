import { describe, expect, it } from "vitest";
import { Action, GRID_H, GRID_W, MAX_LAYERS, MAX_PAINT, State, TEXT_MAX, WORLD, contentBounds, descendants, exportDoc, exportRegion, getSelected, initialState, parentOf, presentFrames, reduce, topFrameOf, update } from "../src/model";

const run = (s: State, ...as: Action[]) => as.reduce(update, s);
const key = (k: string): Action => ({ t: "key", key: k });
const drag = (s: State, x0: number, y0: number, x1: number, y1: number) =>
  run(s, { t: "down", x: x0, y: y0 }, { t: "move", x: x1, y: y1 }, { t: "up" });

describe("create", () => {
  it("drags out a rectangle covering both corner cells and returns to the move tool", () => {
    const s = drag(run(initialState(), key("r")), 2, 1, 5, 3);
    expect(s.layers).toHaveLength(1);
    expect(getSelected(s)).toMatchObject({ kind: "rect", x: 2, y: 1, w: 4, h: 3 });
    expect(s.tool).toBe("move");
  });
  it("works dragging up and left, and past the old canvas edges: the canvas has none", () => {
    const s = drag(run(initialState(), key("r")), 5, 3, -4, 99);
    expect(getSelected(s)).toMatchObject({ x: -4, y: 3, w: 10, h: 97 });
  });
  it("only stops at the far edge of the world", () => {
    const s = drag(run(initialState(), key("r")), 0, 0, 5000, -5000);
    expect(getSelected(s)).toMatchObject({ x: 0, y: -WORLD, w: WORLD + 1, h: WORLD + 1 });
  });
  it("stops at the layer limit", () => {
    let s = initialState();
    for (let i = 0; i < MAX_LAYERS + 2; i++) s = drag(run(s, key("r")), 0, 0, 2, 2);
    expect(s.layers).toHaveLength(MAX_LAYERS);
  });
});

describe("edit", () => {
  const withRect = () => drag(run(initialState(), key("r")), 2, 2, 4, 3); // x2 y2 w3 h2
  it("moves a layer by dragging it, anywhere on the canvas", () => {
    const s = run(withRect(), { t: "down", x: 3, y: 2 }, { t: "move", x: 99, y: 5 }, { t: "up" });
    expect(getSelected(s)).toMatchObject({ x: 98, y: 5, w: 3, h: 2 });
    const back = run(s, { t: "down", x: 99, y: 5 }, { t: "move", x: -20, y: -9 }, { t: "up" });
    expect(getSelected(back)).toMatchObject({ x: -21, y: -9 });
  });
  it("resizes from a corner while the opposite corner stays fixed", () => {
    const s = run(withRect(), { t: "down", x: 0, y: 0, handle: "se" }, { t: "move", x: 8, y: 6 }, { t: "up" });
    expect(getSelected(s)).toMatchObject({ x: 2, y: 2, w: 7, h: 5 });
    const n = run(withRect(), { t: "down", x: 0, y: 0, handle: "nw" }, { t: "move", x: 0, y: 0 }, { t: "up" });
    expect(getSelected(n)).toMatchObject({ x: 0, y: 0, w: 5, h: 4 });
  });
  it("recolors, reorders, duplicates and deletes", () => {
    let s = drag(run(withRect(), key("o")), 6, 6, 8, 8);
    const [first, second] = s.layers;
    s = run(s, key("["));
    expect(s.layers.map((l) => l.id)).toEqual([second.id, first.id]);
    s = run(s, { t: "fill", color: "#ff004d" });
    expect(getSelected(s)!.fill).toBe("#ff004d");
    s = run(s, { t: "key", key: "d", meta: true });
    expect(s.layers).toHaveLength(3);
    s = run(s, key("Delete"));
    expect(s.layers).toHaveLength(2);
    expect(s.selected).toBeNull();
  });
  it("selects the topmost layer under the pointer and deselects on empty canvas", () => {
    let s = drag(run(withRect(), key("r")), 3, 2, 6, 5);
    const top = s.layers[1].id;
    s = run(s, { t: "down", x: 3, y: 2 }, { t: "up" });
    expect(s.selected).toBe(top);
    s = run(s, { t: "down", x: 12, y: 9 }, { t: "up" });
    expect(s.selected).toBeNull();
  });
  it("edits properties through the panel, including negative positions, and stops at the world's edge", () => {
    expect(getSelected(run(withRect(), { t: "prop", prop: "x", value: "-40" }))!.x).toBe(-40);
    expect(getSelected(run(withRect(), { t: "prop", prop: "x", value: "99999" }))!.x).toBe(WORLD);
    expect(getSelected(run(withRect(), { t: "prop", prop: "w", value: "90" }))!.w).toBe(90);
  });
  it("hidden layers cannot be hit", () => {
    let s = withRect();
    s = run(s, { t: "visible", id: s.layers[0].id }, { t: "down", x: 3, y: 2 }, { t: "up" });
    expect(s.selected).toBeNull();
  });
});

describe("alignment and appearance", () => {
  // A 12 x 8 frame at (3,4) holding a 2 x 2 rectangle at (5,6).
  const inFrame = () => {
    let s = drag(run(initialState(), key("f")), 3, 4, 14, 11);
    s = drag(run(s, key("r")), 5, 6, 6, 7);
    return s;
  };
  const rect = () => drag(run(initialState(), key("r")), 2, 2, 3, 3); // 2x2 at (2,2), on the bare canvas
  it("aligns a layer to the frame it sits in", () => {
    const s = inFrame();
    const at = (to: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter") => getSelected(reduce(s, { t: "align", to }))!;
    expect(at("left").x).toBe(3);
    expect(at("right").x).toBe(3 + 12 - 2);
    expect(at("top").y).toBe(4);
    expect(at("bottom").y).toBe(4 + 8 - 2);
    expect(at("hcenter").x).toBe(3 + 5);
    expect(at("vcenter").y).toBe(4 + 3);
  });
  it("has nothing to align a layer on the bare canvas to", () => {
    const s = rect();
    expect(reduce(s, { t: "align", to: "left" })).toBe(s);
  });
  it("opacity and radius are clamped", () => {
    const s = rect();
    expect(getSelected(reduce(s, { t: "prop", prop: "opacity", value: "50" }))!.opacity).toBe(5);
    expect(getSelected(reduce(s, { t: "prop", prop: "opacity", value: "900" }))!.opacity).toBe(10);
    expect(getSelected(reduce(s, { t: "prop", prop: "radius", value: "9" }))!.radius).toBe(4);
  });
});

describe("opacity field", () => {
  it("accepts a value typed with a percent sign, as the field displays it", () => {
    let s = drag(run(initialState(), key("r")), 2, 1, 5, 3);
    s = run(s, { t: "prop", prop: "opacity", value: "50%" });
    expect(getSelected(s)?.opacity).toBe(5);
  });
});

describe("copy, cut and paste", () => {
  const meta = (k: string): Action => ({ t: "key", key: k, meta: true });
  const withRect = () => drag(run(initialState(), key("r")), 2, 1, 5, 3);

  it("copies the selection without changing the document", () => {
    const s = withRect();
    const after = run(s, meta("c"));
    expect(after.clipboard).toMatchObject({ kind: "rect", x: 2, y: 1, w: 4, h: 3 });
    expect(after.layers).toBe(s.layers);
  });

  it("pastes a new top layer in the copied position and selects it", () => {
    const s = run(withRect(), meta("c"), meta("v"));
    expect(s.layers).toHaveLength(2);
    const pasted = getSelected(s)!;
    expect(pasted).toMatchObject({ kind: "rect", x: 2, y: 1, w: 4, h: 3 });
    expect(pasted.id).not.toBe(s.layers[0].id);
    expect(s.layers[1]).toBe(pasted);
    expect(pasted.name).toBe(`Rectangle ${pasted.id}`);
  });

  it("cut removes the layer and one paste brings it back", () => {
    const cutOnly = run(withRect(), meta("x"));
    expect(cutOnly.layers).toHaveLength(0);
    expect(cutOnly.selected).toBeNull();
    expect(run(cutOnly, meta("v")).layers).toHaveLength(1);
  });

  it("does nothing with no selection, an empty clipboard or a full layer list", () => {
    expect(run(initialState(), meta("c")).clipboard).toBeNull();
    expect(run(withRect(), meta("v")).layers).toHaveLength(1);
    let s = run(withRect(), meta("c"));
    for (let i = 0; i < MAX_LAYERS; i++) s = run(s, meta("v"));
    expect(s.layers).toHaveLength(MAX_LAYERS);
  });

  it("keeps the clipboard when the selection goes away, so it can be pasted later", () => {
    const s = run(withRect(), meta("c"), key("Escape"), meta("v"));
    expect(s.layers).toHaveLength(2);
  });
});

describe("frames, sections and presenting", () => {
  const frame = (s: State, x0: number, y0: number, x1: number, y1: number) => drag(run(s, key("f")), x0, y0, x1, y1);

  it("starts as an empty canvas: no pages, no frame", () => {
    const s = initialState();
    expect(s.layers).toHaveLength(0);
    expect(presentFrames(s)).toEqual([]);
    expect("pages" in s).toBe(false);
  });

  it("presents each top-level frame as a slide, top to bottom then left to right", () => {
    let s = frame(initialState(), 8, 5, 12, 8);
    s = frame(s, 0, 0, 4, 3);
    s = frame(s, 6, 0, 10, 3);
    expect(presentFrames(s).map((f) => [f.x, f.y])).toEqual([[0, 0], [6, 0], [8, 5]]);
  });

  it("does not present a frame nested inside another, and finds the slide a layer is in", () => {
    let s = frame(initialState(), 0, 0, 9, 7);
    s = frame(s, 1, 1, 4, 4); // nested frame
    s = drag(run(s, key("r")), 2, 2, 3, 3); // rect inside the nested frame
    const [outer, inner, rect] = s.layers;
    expect(presentFrames(s)).toEqual([outer]);
    expect(parentOf(s, rect)).toBe(inner);
    expect(topFrameOf(s, rect)).toBe(outer);
    expect(descendants(s, outer).map((l) => l.id)).toEqual([inner.id, rect.id]);
  });

  it("a section holds frames without being a slide itself", () => {
    let s = drag(run(initialState(), { t: "key", key: "s", shift: true }), 0, 0, 12, 8);
    s = frame(s, 1, 1, 5, 5);
    const [section, f] = s.layers;
    expect(section.kind).toBe("section");
    expect(parentOf(s, f)).toBe(section);
    expect(presentFrames(s)).toEqual([f]);
  });

  it("exports the selected frame, section or slice, else the whole canvas", () => {
    let s = frame(initialState(), 2, 2, 6, 5);
    expect(exportRegion(s)?.kind).toBe("frame");
    s = drag(run(s, key("r")), 3, 3, 4, 4);
    expect(exportRegion(s)).toBeUndefined();
    expect(exportRegion(run(s, key("Escape")))).toBeUndefined();
  });

  it("a shared file round-trips: frames, text, strokes and painted cells survive", () => {
    let s = drag(run(initialState(), key("f")), 0, 0, 5, 4);
    s = run(drag(run(s, key("t")), 1, 1, 1, 1), { t: "key", key: "Escape" });
    s = run(s, key("t"), { t: "down", x: 1, y: 1 }, { t: "up" });
    s = run(s, { t: "text", id: s.selected!, value: "hi" }, { t: "stroke", color: "#ff004d" }, key("p"), { t: "down", x: 7, y: 7 }, { t: "up" });
    const back = run(initialState(), { t: "load", doc: JSON.parse(JSON.stringify(exportDoc(s))) });
    expect(back.layers).toEqual(s.layers);
    expect(back.paint).toEqual(s.paint);
    expect(back.nextId).toBe(s.nextId);
  });

  it("loads share links made while the editor still had pages", () => {
    const layer = getSelected(drag(run(initialState(), key("r")), 1, 1, 3, 3))!;
    const { stroke, shadow, rotation, flip, text, ...old } = layer;
    void [stroke, shadow, rotation, flip, text];
    const s = run(initialState(), {
      t: "load",
      doc: { title: "Old", pages: [{ id: 1, name: "Page 1", layers: [] }, { id: 2, name: "Page 2", layers: [old] }], page: 2, nextId: 5 },
    });
    expect(s.title).toBe("Old");
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0]).toMatchObject({ stroke: "", shadow: false, rotation: 0, flip: false, text: "" });
    expect(Object.keys(exportDoc(s))).toEqual(["title", "layers", "paint", "nextId"]);
  });
});

describe("drawing tools", () => {
  it("every drag-to-create tool makes the layer kind of the same name", () => {
    for (const [k, kind] of [["f", "frame"], ["s", "slice"], ["r", "rect"], ["l", "line"], ["o", "ellipse"]] as const)
      expect(getSelected(drag(run(initialState(), key(k)), 1, 1, 3, 2))?.kind).toBe(kind);
    for (const [k, kind] of [["S", "section"], ["L", "arrow"]] as const)
      expect(getSelected(drag(run(initialState(), { t: "key", key: k.toLowerCase(), shift: true }), 1, 1, 3, 2))?.kind).toBe(kind);
    for (const kind of ["polygon", "star"] as const) {
      const s = drag(run(initialState(), { t: "tool", tool: kind }), 1, 1, 3, 2);
      expect(getSelected(s)).toMatchObject({ kind, w: 3, h: 2 });
    }
  });

  it("a line dragged against the diagonal runs bottom-left to top-right", () => {
    const down = getSelected(drag(run(initialState(), key("l")), 1, 1, 5, 4))!;
    const up = getSelected(drag(run(initialState(), key("l")), 1, 4, 5, 1))!;
    expect([down.flip, up.flip]).toEqual([false, true]);
    expect(up).toMatchObject({ x: 1, y: 1, w: 5, h: 4 });
  });

  it("the Pen draws a straight line of cells from the previous click, and Enter ends the line", () => {
    let s = run(initialState(), key("p"), { t: "down", x: 1, y: 1 }, { t: "up" }, { t: "down", x: 4, y: 1 }, { t: "up" });
    const painted = () => Object.keys(s.paint).sort();
    expect(painted()).toEqual(["1,1", "2,1", "3,1", "4,1"]);
    s = run(s, key("Enter"), { t: "down", x: 8, y: 5 }, { t: "up" });
    expect(painted()).toHaveLength(5); // a new line starts with one cell, not a line from (4,1)
    expect(s.layers).toHaveLength(0);
  });

  it("the Pen draws freehand where you press and drag, and a dragged stroke does not join the next one", () => {
    let s = run(initialState(), key("p"), { t: "down", x: 2, y: 2 }, { t: "move", x: 3, y: 2 }, { t: "move", x: 6, y: 5 }, { t: "up" });
    expect(Object.keys(s.paint).sort()).toEqual(["2,2", "3,2", "4,3", "5,4", "6,5"].sort());
    expect(s.penFrom).toBeNull();
    s = run(s, { t: "down", x: 10, y: 9 }, { t: "up" });
    expect(Object.keys(s.paint)).toHaveLength(6); // one new cell, no line from (6,5)
  });

  it("clicks after a click keep drawing straight lines, and a drag in the middle ends that line", () => {
    let s = run(initialState(), key("p"), { t: "down", x: 0, y: 0 }, { t: "up" }, { t: "down", x: 3, y: 0 }, { t: "up" }, { t: "down", x: 3, y: 3 }, { t: "up" });
    expect(Object.keys(s.paint).sort()).toEqual(["0,0", "1,0", "2,0", "3,0", "3,1", "3,2", "3,3"].sort());
    s = run(s, { t: "down", x: 8, y: 8 }, { t: "move", x: 9, y: 8 }, { t: "up" }, { t: "down", x: 0, y: 9 }, { t: "up" });
    expect(s.paint["0,9"]).toBeDefined();
    expect(s.paint["4,8"]).toBeUndefined(); // nothing joins (9,8) to (0,9)
  });

  it("Shift+P is the pencil and paints as you drag", () => {
    const s = run(initialState(), { t: "key", key: "p", shift: true }, { t: "down", x: 2, y: 2 }, { t: "move", x: 5, y: 2 }, { t: "up" });
    expect(s.tool).toBe("paint");
    expect(Object.keys(s.paint)).toHaveLength(4);
  });

  it("the Hand tool never changes the document", () => {
    const before = drag(run(initialState(), key("r")), 1, 1, 3, 3);
    const after = run(before, key("h"), { t: "down", x: 2, y: 2 }, { t: "move", x: 9, y: 9 }, { t: "up" });
    expect(after.tool).toBe("hand");
    expect(after.layers).toBe(before.layers);
    expect(after.selected).toBe(before.selected);
  });

  it("the Scale tool resizes from a corner and keeps the proportions", () => {
    const s0 = run(drag(run(initialState(), key("r")), 2, 2, 5, 4), key("k")); // 4 x 3
    const s = run(s0, { t: "down", x: 0, y: 0, handle: "se" }, { t: "move", x: 9, y: 4 }, { t: "up" });
    const l = getSelected(s)!;
    expect(l).toMatchObject({ x: 2, y: 2, w: 8 });
    expect(l.h).toBe(Math.round(8 / (4 / 3)));
  });
});

describe("text and comments", () => {
  it("one click places a text layer and opens it for typing; Enter-ing words sizes it to the text", () => {
    let s = run(initialState(), key("t"), { t: "down", x: 3, y: 2 }, { t: "up" });
    const id = s.selected!;
    expect(s.editing).toBe(id);
    expect(s.tool).toBe("move");
    s = run(s, { t: "text", id, value: "  hello   world " });
    expect(getSelected(s)).toMatchObject({ kind: "text", text: "hello world", name: "hello world", w: 11, h: 1, x: 3 });
    expect(s.editing).toBeNull();
  });

  it("cuts a long line at TEXT_MAX characters", () => {
    let s = run(initialState(), key("t"), { t: "down", x: 10, y: 0 }, { t: "up" });
    s = run(s, { t: "text", id: s.selected!, value: "x".repeat(40) });
    const l = getSelected(s)!;
    expect(l.text).toHaveLength(TEXT_MAX);
    expect(l).toMatchObject({ x: 10, w: TEXT_MAX, h: 1 }); // the line grows to the right; nothing pushes it back
  });

  it("empty text removes the layer, so a cancelled click leaves nothing behind", () => {
    let s = run(initialState(), key("t"), { t: "down", x: 3, y: 2 }, { t: "up" });
    s = run(s, { t: "text", id: s.selected!, value: "   " });
    expect(s.layers).toHaveLength(0);
    expect(s.editing).toBeNull();
  });

  it("double-clicking text edits it again, and a comment keeps its note", () => {
    let s = run(initialState(), key("t"), { t: "down", x: 1, y: 1 }, { t: "up" });
    s = run(s, { t: "text", id: s.selected!, value: "hi" }, key("Escape"), { t: "edit", id: 1 });
    expect(s.editing).toBe(1);
    let c = run(initialState(), key("c"), { t: "down", x: 6, y: 6 }, { t: "up" });
    c = run(c, { t: "text", id: c.selected!, value: "check this" });
    expect(getSelected(c)).toMatchObject({ kind: "comment", text: "check this", w: 1, h: 1, name: "Comment 1" });
  });

  it("copies keep their words", () => {
    let s = run(initialState(), key("t"), { t: "down", x: 1, y: 1 }, { t: "up" });
    s = run(s, { t: "text", id: s.selected!, value: "hi" }, { t: "key", key: "d", meta: true });
    expect(s.layers.map((l) => [l.text, l.name])).toEqual([["hi", "hi"], ["hi", "hi"]]);
  });
});

describe("stroke, effects and rotation", () => {
  const rect = () => drag(run(initialState(), key("r")), 2, 2, 5, 3); // 4 x 2

  it("adds, recolors and removes a stroke and a drop shadow", () => {
    let s = run(rect(), { t: "stroke", color: "#000000" }, { t: "shadow", on: true });
    expect(getSelected(s)).toMatchObject({ stroke: "#000000", shadow: true });
    s = run(s, { t: "stroke", color: "" }, { t: "shadow", on: false });
    expect(getSelected(s)).toMatchObject({ stroke: "", shadow: false });
  });

  it("rotates in quarter turns, swapping the box about its centre", () => {
    const s = run(rect(), { t: "prop", prop: "rotation", value: "90°" });
    expect(getSelected(s)).toMatchObject({ rotation: 90, w: 2, h: 4, x: 3, y: 1 });
    expect(getSelected(run(s, { t: "prop", prop: "rotation", value: "180" }))).toMatchObject({ rotation: 180, w: 4, h: 2 });
  });

  it("snaps any angle to the nearest quarter turn and wraps around", () => {
    expect(getSelected(run(rect(), { t: "prop", prop: "rotation", value: "100" }))!.rotation).toBe(90);
    expect(getSelected(run(rect(), { t: "prop", prop: "rotation", value: "-90" }))!.rotation).toBe(270);
    expect(getSelected(run(rect(), { t: "prop", prop: "rotation", value: "360" }))!.rotation).toBe(0);
  });
});

describe("image import", () => {
  it("paints the picture's cells over the canvas and keeps painted cells where the picture is transparent", () => {
    let s = run(initialState(), key("p"), { t: "down", x: 0, y: 0 }, { t: "up" });
    s = run(s, { t: "image", cells: { "1,0": 8, "2,0": 12, "-5,-5": 3 } });
    expect(s.paint).toMatchObject({ "0,0": expect.any(Number), "1,0": 8, "2,0": 12, "-5,-5": 3 });
  });
});

describe("an unbounded canvas", () => {
  it("paints and erases cells anywhere, including negative coordinates", () => {
    let s = run(initialState(), { t: "key", key: "p", shift: true }, { t: "down", x: -3, y: -2 }, { t: "move", x: 40, y: -2 }, { t: "up" });
    expect(s.paint["-3,-2"]).toBeDefined();
    expect(s.paint["40,-2"]).toBeDefined();
    s = run(s, key("e"), { t: "down", x: 10, y: -2 }, { t: "up" });
    expect(s.paint["10,-2"]).toBeUndefined();
    expect(s.paint["11,-2"]).toBeDefined();
  });

  it("stops painting new cells at the paint limit but still repaints existing ones", () => {
    let s = run(initialState(), { t: "key", key: "p", shift: true });
    for (let y = 0; y < MAX_PAINT / 100 + 2; y++) s = run(s, { t: "down", x: 0, y }, { t: "move", x: 99, y }, { t: "up" });
    expect(Object.keys(s.paint)).toHaveLength(MAX_PAINT);
    expect(run(s, { t: "down", x: 0, y: 0 }, { t: "up" }).paint["0,0"]).toBeDefined();
  });

  it("reports the box around everything on the canvas", () => {
    expect(contentBounds(initialState())).toBeUndefined();
    let s = drag(run(initialState(), key("r")), -3, 2, 0, 4);
    s = run(s, { t: "key", key: "p", shift: true }, { t: "down", x: 10, y: -5 }, { t: "up" });
    expect(contentBounds(s)).toEqual({ x: -3, y: -5, w: 14, h: 10 });
  });

  it("loads files whose paint is the old 14 x 10 array", () => {
    const old = new Array(GRID_W * GRID_H).fill(-1);
    old[GRID_W * 2 + 3] = 8;
    const s = run(initialState(), { t: "load", doc: { title: "Old", layers: [], paint: old, nextId: 1 } });
    expect(s.paint).toEqual({ "3,2": 8 });
  });
});
