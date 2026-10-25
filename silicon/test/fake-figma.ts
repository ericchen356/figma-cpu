// A small in-memory stand-in for the Figma Plugin API, enough to draw, extract and bind the
// silicon canvas in Node. Copied from plugin/test/fake-figma.ts and extended with components,
// TEXT component properties, instances (main component layers cloned with Figma-style
// sublayer ids, property values driving bound text layers), SVG/vector nodes and pages.
// Like real Figma (with "documentAccess": "dynamic-page") it throws on: writing text with an
// unloaded font, colors outside 0–1, non-finite coordinates, moving layers into or out of
// instances, unknown/unsuffixed property names in setProperties, sync `mainComponent`
// access, reading the children of a page that was not loaded, and figma.notify.
// Lane G added variables (collections, modes, setValueForMode), setBoundVariable,
// setReactionsAsync (validated like Figma), page flowStartingPoints and id lookups, so the
// plugin can be run end to end and its reactions replayed with src/prototype/emulate.

type Pred = (n: FakeNode) => boolean;

let ids = 0;
let propIds = 0;

interface PropDef {
  type: string;
  defaultValue: string | boolean;
}

const finite = (v: number, what: string) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Expected ${what} to be a finite number, got ${v}`);
  return v;
};

function checkPaints(paints: unknown): unknown {
  if (!Array.isArray(paints)) throw new Error("paints must be an array");
  for (const p of paints as { type: string; color?: Record<string, number>; opacity?: number }[]) {
    if (p.type === "SOLID") {
      for (const ch of ["r", "g", "b"]) {
        const v = p.color?.[ch];
        if (typeof v !== "number" || v < 0 || v > 1) throw new Error(`Invalid color channel ${ch}=${v} (must be 0–1)`);
      }
      if (p.opacity !== undefined && (p.opacity < 0 || p.opacity > 1)) throw new Error(`Invalid opacity ${p.opacity}`);
    }
  }
  return paints;
}

const ARGS: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
function checkPathData(data: string) {
  const tok = data.split(" ");
  let i = 0;
  if (!tok.length || tok[0] !== "M") throw new Error(`vector path must start with M: "${data.slice(0, 40)}"`);
  while (i < tok.length) {
    const cmd = tok[i++];
    const n = ARGS[cmd];
    if (n === undefined) throw new Error(`bad path command "${cmd}" in "${data.slice(0, 60)}"`);
    for (let k = 0; k < n; k++, i++)
      if (i >= tok.length || !/^-?\d+(\.\d+)?$/.test(tok[i])) throw new Error(`bad number "${tok[i]}" in path "${data.slice(0, 60)}"`);
  }
}

export class FakeNode {
  id = `1:${++ids}`;
  name = "";
  visible = true;
  removed = false;
  parent: FakeNode | null = null;
  private _children: FakeNode[] = [];
  private _x = 0;
  private _y = 0;
  width = 100;
  height = 100;
  private _fills: unknown = [];
  private _strokes: unknown = [];
  strokeWeight = 1;
  strokeJoin = "MITER";
  strokeCap = "NONE";
  cornerRadius = 0;
  clipsContent = true;
  dashPattern: number[] = [];
  opacity = 1;
  description = "";
  fontSize = 12;
  textAutoResize = "WIDTH_AND_HEIGHT";
  textAlignHorizontal = "LEFT";
  /** createNodeFromSvg keeps the source path here. */
  svgPath = "";
  private _vectorPaths: { windingRule: string; data: string }[] = [];
  private _chars = "";
  private _font: { family: string; style: string } = { family: "Inter", style: "Regular" };
  private pluginData = new Map<string, string>();
  private _refs: { characters?: string; visible?: string } | null = null;
  /** COMPONENT: property definitions by key ("A#3:0"). */
  propDefs = new Map<string, PropDef>();
  /** INSTANCE: main component and property values set on this instance. */
  _main: FakeNode | null = null;
  overrides = new Map<string, string | boolean>();
  /** True for layers inside an instance (not the instance itself). */
  inInstance = false;
  /** PAGE: loaded (dynamic-page access). */
  loaded = false;
  // ---- prototype (lane G): variable bindings, reactions, flows, scrolling
  /** Bound variables by field ("visible", "characters"), like Figma's `boundVariables`. */
  boundVariables: Record<string, { type: "VARIABLE_ALIAS"; id: string }> = {};
  /** Reactions as stored by setReactionsAsync (a JSON copy, like Figma's). */
  reactions: Reaction[] = [];
  /** PAGE: prototype flows. */
  flowStartingPoints: Array<{ nodeId: string; name: string }> = [];
  numberOfFixedChildren = 0;
  overflowDirection = "NONE";
  textAlignVertical = "TOP";

  constructor(
    public type: string,
    private api: FakeFigma,
  ) {}

  get children(): FakeNode[] {
    if (this.type === "PAGE" && !this.loaded && this.api.dynamicPage)
      throw new Error(`Cannot access children on a page that has not been explored. Call \`await page.loadAsync()\` first.`);
    return this._children;
  }
  get x() {
    return this._x;
  }
  set x(v: number) {
    this._x = finite(v, "x");
  }
  get y() {
    return this._y;
  }
  set y(v: number) {
    this._y = finite(v, "y");
  }
  get fills() {
    return this._fills;
  }
  set fills(p: unknown) {
    this._fills = checkPaints(p);
  }
  get strokes() {
    return this._strokes;
  }
  set strokes(p: unknown) {
    this._strokes = checkPaints(p);
  }
  get vectorPaths() {
    return this._vectorPaths;
  }
  set vectorPaths(paths: { windingRule: string; data: string }[]) {
    if (this.type !== "VECTOR") throw new Error("vectorPaths only exists on vectors");
    for (const p of paths) {
      if (!["NONE", "NONZERO", "EVENODD"].includes(p.windingRule)) throw new Error(`bad windingRule ${p.windingRule}`);
      checkPathData(p.data);
    }
    this._vectorPaths = paths.map((p) => ({ ...p }));
  }

  get fontName() {
    return this._font;
  }
  set fontName(f) {
    this.api.requireFont(f);
    this._font = f;
  }
  get characters() {
    return this._chars;
  }
  set characters(s: string) {
    this.api.requireFont(this._font);
    this.setChars(s);
    this.api.writes++;
  }
  private setChars(s: string) {
    this._chars = s;
    // like Figma's auto-width text: the width follows the content
    if (this.textAutoResize === "WIDTH_AND_HEIGHT") {
      this.width = Math.ceil(s.length * this.fontSize * 0.6);
      this.height = Math.ceil(this.fontSize * 1.25);
    }
  }
  getRangeAllFontNames() {
    return [this._font];
  }

  get componentPropertyReferences() {
    return this._refs;
  }
  set componentPropertyReferences(r: { characters?: string; visible?: string } | null) {
    let comp: FakeNode | null = this.parent;
    while (comp && comp.type !== "COMPONENT") comp = comp.parent;
    if (!comp) throw new Error("componentPropertyReferences: node is not inside a component");
    for (const key of Object.values(r ?? {}))
      if (key && !comp.propDefs.has(key)) throw new Error(`componentPropertyReferences: ${comp.name} has no property ${key}`);
    this._refs = r ? { ...r } : null;
  }

  // ---- components & instances

  addComponentProperty(name: string, type: string, defaultValue: string | boolean): string {
    if (this.type !== "COMPONENT") throw new Error("addComponentProperty: not a component");
    for (const k of this.propDefs.keys()) if (k.split("#")[0] === name) throw new Error(`property ${name} already exists`);
    const key = type === "VARIANT" ? name : `${name}#${++propIds}:0`;
    this.propDefs.set(key, { type, defaultValue });
    return key;
  }
  get componentPropertyDefinitions(): Record<string, PropDef> {
    if (this.type !== "COMPONENT") throw new Error("componentPropertyDefinitions: not a component");
    return Object.fromEntries([...this.propDefs].map(([k, d]) => [k, { ...d }]));
  }
  get mainComponent(): FakeNode | null {
    if (this.api.dynamicPage) throw new Error("in get_mainComponent: Cannot call with documentAccess: dynamic-page. Use node.getMainComponentAsync instead.");
    return this._main;
  }
  async getMainComponentAsync(): Promise<FakeNode | null> {
    if (this.type !== "INSTANCE") throw new Error("not an instance");
    return this._main;
  }
  get componentProperties(): Record<string, { type: string; value: string | boolean }> {
    if (this.type !== "INSTANCE" || !this._main) throw new Error("componentProperties: not an instance");
    const out: Record<string, { type: string; value: string | boolean }> = {};
    for (const [k, d] of this._main.propDefs) out[k] = { type: d.type, value: this.overrides.has(k) ? this.overrides.get(k)! : d.defaultValue };
    return out;
  }
  setProperties(props: Record<string, string | boolean>) {
    if (this.type !== "INSTANCE" || !this._main) throw new Error("setProperties: not an instance");
    for (const [k, v] of Object.entries(props)) {
      const def = this._main.propDefs.get(k);
      if (!def) throw new Error(`in setProperties: Could not find a component property with name: '${k}'`);
      if (def.type === "TEXT" && typeof v !== "string") throw new Error(`in setProperties: ${k} expects a string`);
      // bound text layers take the new value (their fonts must be loaded, as in Figma)
      for (const t of this.boundLayers(k)) {
        this.api.requireFont(t._font);
        t.setChars(String(v));
      }
      this.overrides.set(k, v);
    }
  }
  /** Layers of this instance (not of nested instances) whose characters show property `key`. */
  private boundLayers(key: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n._children) {
        if (c._refs?.characters === key) out.push(c);
        if (c.type !== "INSTANCE") walk(c);
      }
    };
    walk(this);
    return out;
  }
  createInstance(): FakeNode {
    if (this.type !== "COMPONENT") throw new Error("createInstance: not a component");
    const inst = new FakeNode("INSTANCE", this.api);
    inst.copyLook(this);
    inst.name = this.name;
    inst._main = this;
    for (const c of this._children) inst.adopt(c.cloneSublayer(inst.id));
    this.api.currentPage.appendChild(inst);
    return inst;
  }
  private copyLook(src: FakeNode) {
    this.width = src.width;
    this.height = src.height;
    this._fills = src._fills;
    this._strokes = src._strokes;
    this.strokeWeight = src.strokeWeight;
    this.cornerRadius = src.cornerRadius;
    this.clipsContent = src.clipsContent;
    this.visible = src.visible;
  }
  private cloneSublayer(rootId: string): FakeNode {
    const n = new FakeNode(this.type, this.api);
    n.id = `I${rootId};${this.id.replace(/^I/, "")}`;
    n.copyLook(this);
    n.name = this.name;
    n._x = this._x;
    n._y = this._y;
    n.fontSize = this.fontSize;
    n.textAutoResize = this.textAutoResize;
    n._font = this._font;
    n._chars = this._chars;
    n._vectorPaths = this._vectorPaths;
    n.svgPath = this.svgPath;
    n._refs = this._refs;
    n._main = this._main;
    n.overrides = new Map(this.overrides);
    n.boundVariables = { ...this.boundVariables }; // instances inherit the main's bindings
    n.inInstance = true;
    for (const c of this._children) n.adopt(c.cloneSublayer(rootId));
    return n;
  }
  private adopt(c: FakeNode) {
    c.parent = this;
    this._children.push(c);
  }

  // ---- tree

  resize(w: number, h: number) {
    if (finite(w, "width") < 0.01 || finite(h, "height") < 0.01) throw new Error(`resize: size must be >= 0.01 (${w}×${h})`);
    if (this.inInstance) throw new Error("Cannot resize a layer inside an instance");
    this.width = w;
    this.height = h;
  }
  appendChild(c: FakeNode) {
    // like Figma: only containers have children; on a shape or a text, appendChild does not exist
    if (!["DOCUMENT", "PAGE", "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP", "SECTION", "BOOLEAN_OPERATION"].includes(this.type))
      throw new TypeError("not a function");
    if (this.type === "INSTANCE" || this.inInstance) throw new Error("Cannot move node. New parent is an instance or is inside of an instance");
    if (c.inInstance) throw new Error("Cannot move node. Node is inside of an instance");
    if (c.type === "PAGE" && this.type !== "DOCUMENT") throw new Error("pages can only be children of the document");
    if (c.parent) c.parent._children = c.parent._children.filter((x) => x !== c);
    c.parent = this;
    this._children.push(c);
  }
  /** Like Figma: puts `c` at `index` among the children (moving it if it is already one). */
  insertChild(index: number, c: FakeNode) {
    this.appendChild(c);
    this._children.pop();
    this._children.splice(index, 0, c);
  }
  remove() {
    if (this.inInstance) throw new Error("Cannot remove a layer inside an instance");
    if (this.parent) this.parent._children = this.parent._children.filter((x) => x !== this);
    this.parent = null;
    this.removed = true;
  }
  findAll(pred: Pred = () => true): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        if (pred(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  findOne(pred: Pred): FakeNode | null {
    return this.findAll(pred)[0] ?? null;
  }
  findChildren(pred: Pred = () => true): FakeNode[] {
    return this.children.filter(pred);
  }
  findAllWithCriteria({ types }: { types: string[] }) {
    return this.findAll((n) => types.includes(n.type));
  }
  setPluginData(k: string, v: string) {
    this.pluginData.set(k, v);
  }
  getPluginData(k: string) {
    return this.pluginData.get(k) ?? "";
  }
  setSharedPluginData(ns: string, k: string, v: string) {
    this.pluginData.set(`${ns}\u0000${k}`, v);
  }
  getSharedPluginData(ns: string, k: string) {
    return this.pluginData.get(`${ns}\u0000${k}`) ?? "";
  }
  async loadAsync() {
    this.loaded = true;
  }
  /** Layer names from the page down to this node (test helper). */
  get pathNames(): string[] {
    const out: string[] = [];
    for (let n: FakeNode | null = this; n && n.type !== "PAGE"; n = n.parent) out.unshift(n.name);
    return out;
  }

  // ---- prototype (lane G)

  /** Like Figma: binds a field to a live variable (also on layers inside instances, where it
   * is an override). `visible` needs a BOOLEAN, `characters` a text node and FLOAT/STRING. */
  setBoundVariable(field: string, v: FakeVariable | null) {
    if (v === null) {
      delete this.boundVariables[field];
      return;
    }
    if (!(v instanceof FakeVariable) || v.removed || !this.api.variableById.has(v.id)) throw new Error(`setBoundVariable(${field}): not a live variable`);
    if (field === "visible" && v.resolvedType !== "BOOLEAN") throw new Error("visible needs a BOOLEAN variable");
    // Like real Figma (spike result): text characters only bind to STRING variables.
    if (field === "characters" && (this.type !== "TEXT" || v.resolvedType !== "STRING")) throw new Error("characters needs a text node and a STRING variable");
    this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: v.id };
  }

  /** Like Figma's clone(): a deep copy (look, text, bindings, reactions, instance links)
   * inserted right after the original in the same parent. */
  clone(): FakeNode {
    if (this.inInstance) throw new Error("clone of a layer inside an instance is not supported by the fake");
    const copy = (src: FakeNode, inInstance: boolean): FakeNode => {
      const n = new FakeNode(src.type, this.api);
      n.copyLook(src);
      n.name = src.name;
      n._x = src._x;
      n._y = src._y;
      n.fontSize = src.fontSize;
      n.textAutoResize = src.textAutoResize;
      n.textAlignHorizontal = src.textAlignHorizontal;
      n.textAlignVertical = src.textAlignVertical;
      n._font = src._font;
      n._chars = src._chars;
      n._vectorPaths = src._vectorPaths;
      n.svgPath = src.svgPath;
      n._refs = src._refs;
      n._main = src._main;
      n.overrides = new Map(src.overrides);
      n.boundVariables = JSON.parse(JSON.stringify(src.boundVariables));
      n.reactions = JSON.parse(JSON.stringify(src.reactions));
      n.description = src.description;
      n.inInstance = inInstance;
      for (const c of src._children) n.adopt(copy(c, inInstance || src.type === "INSTANCE"));
      return n;
    };
    const n = copy(this, false);
    if (this.parent) {
      const sibs = this.parent._children;
      n.parent = this.parent;
      sibs.splice(sibs.indexOf(this) + 1, 0, n);
    }
    return n;
  }

  /** Like Figma: validates the actions' variables and destinations, then stores a copy. */
  async setReactionsAsync(reactions: Reaction[]) {
    if (this.inInstance) throw new Error("setReactionsAsync on a layer inside an instance is not supported by the fake");
    for (const r of reactions) {
      if (r.trigger?.type === "AFTER_TIMEOUT" && this.parent?.type !== "PAGE") throw new Error("AFTER_TIMEOUT only works on top-level frames");
      const check = (acts: readonly Action[]) => {
        for (const a of acts) {
          if (a.type === "SET_VARIABLE" && !this.api.variableById.has(a.variableId!)) throw new Error(`SET_VARIABLE on unknown variable ${a.variableId}`);
          if (a.type === "NODE") {
            const dest = this.api.nodeById(a.destinationId!);
            if (!dest) throw new Error(`navigate to unknown node ${a.destinationId}`);
            // a Scroll-to targets a layer inside a scrolling frame; the other navigations a top-level frame
            if (String(a.navigation) !== "SCROLL_TO" && dest.parent?.type !== "PAGE")
              throw new Error(`navigate to ${dest.name}, which is not a top-level frame`);
            // like Figma (measured): a swap to the overlay the reaction sits in is refused
            let top: FakeNode = this;
            while (top.parent && top.parent.type !== "PAGE") top = top.parent;
            if (String(a.navigation) === "SWAP" && dest === top)
              throw new Error(`Reaction was invalid (destination ${dest.id} was rejected — the destination may not be reachable from this source)`);
          }
          if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks) check(b.actions);
        }
      };
      check(r.actions ?? []);
    }
    this.reactions = JSON.parse(JSON.stringify(reactions));
    this.api.reactionWrites++;
    // Like Figma (opt-in, `autoFlows`): a top-level frame that gets a navigation (NAVIGATE / SWAP)
    // and is not a flow yet becomes one, named "Flow n" (seen in Figma desktop on overlays that
    // swap to the next).
    const page = this.api.autoFlows ? this.parent : null;
    const navigates = (acts: readonly Action[]): boolean =>
      acts.some(
        (a) =>
          (a.type === "NODE" && ["NAVIGATE", "SWAP"].includes(String(a.navigation))) ||
          (a.type === "CONDITIONAL" && a.conditionalBlocks.some((b) => navigates(b.actions))),
      );
    if (
      page?.type === "PAGE" &&
      reactions.some((r) => navigates(r.actions ?? [])) &&
      !page.flowStartingPoints.some((f) => f.nodeId === this.id)
    )
      page.flowStartingPoints = [
        ...page.flowStartingPoints,
        { nodeId: this.id, name: `Flow ${page.flowStartingPoints.length + 1}` },
      ];
  }

  /** Depth-first walk that ignores page loading (test helper for id lookups). */
  walkRaw(fn: (n: FakeNode) => void) {
    for (const c of this._children) {
      fn(c);
      c.walkRaw(fn);
    }
  }
}

// ---------- variables (lane G) ----------

export class FakeVariable {
  readonly id: string;
  removed = false;
  description = "";
  valuesByMode: Record<string, unknown> = {};
  constructor(
    public name: string,
    readonly collection: FakeVariableCollection,
    readonly resolvedType: string,
    private api: FakeFigma,
  ) {
    this.id = `VariableID:${++ids}:0`;
  }
  get variableCollectionId() {
    return this.collection.id;
  }
  setValueForMode(modeId: string, value: unknown) {
    if (this.removed) throw new Error(`${this.name}: variable was removed`);
    if (!this.collection.modes.some((m) => m.modeId === modeId)) throw new Error(`${this.name}: unknown mode ${modeId}`);
    // like Figma: a COLOR holds {r, g, b, a} with channels in 0–1
    const isColour = (v: unknown) =>
      !!v && typeof v === "object" && ["r", "g", "b", "a"].every((k) => typeof (v as Record<string, unknown>)[k] === "number" && (v as Record<string, number>)[k] >= 0 && (v as Record<string, number>)[k] <= 1);
    const want = this.resolvedType === "BOOLEAN" ? "boolean" : this.resolvedType === "FLOAT" ? "number" : this.resolvedType === "COLOR" ? "colour" : "string";
    if (want === "colour" ? !isColour(value) : typeof value !== want) throw new Error(`${this.name}: ${this.resolvedType} variable cannot hold ${JSON.stringify(value)}`);
    this.valuesByMode[modeId] = value;
    this.api.variableWrites++;
  }
  remove() {
    this.removed = true;
    this.api.variableById.delete(this.id);
    this.collection.vars = this.collection.vars.filter((v) => v !== this);
  }
}

export class FakeVariableCollection {
  readonly id: string;
  readonly defaultModeId: string;
  readonly modes: Array<{ modeId: string; name: string }>;
  vars: FakeVariable[] = [];
  removed = false;
  constructor(
    public name: string,
    private api: FakeFigma,
  ) {
    this.id = `VariableCollectionId:${++ids}:0`;
    this.defaultModeId = `${++ids}:0`;
    this.modes = [{ modeId: this.defaultModeId, name: "Mode 1" }];
  }
  get variableIds() {
    return this.vars.map((v) => v.id);
  }
  remove() {
    for (const v of [...this.vars]) v.remove();
    this.removed = true;
    this.api.collections = this.api.collections.filter((c) => c !== this);
  }
}

export class FakeFigma {
  mixed = Symbol("mixed");
  writes = 0;
  /** Behave like a plugin with "documentAccess": "dynamic-page". */
  dynamicPage = true;
  /** Make a flow of a top-level frame that gets a navigation, as Figma does (off by default). */
  autoFlows = false;
  loaded = new Set<string>();
  root: FakeNode;
  currentPage: FakeNode;
  viewport = { scrollAndZoomIntoView() {} };

  constructor(pageNames: string[] = ["Page 1"]) {
    this.root = new FakeNode("DOCUMENT", this);
    for (const name of pageNames) this.createPage().name = name;
    this.currentPage = this.root.children[0];
    this.currentPage.loaded = true;
  }
  requireFont(f: { family: string; style: string }) {
    if (!this.loaded.has(`${f.family}/${f.style}`)) throw new Error(`Cannot write to node with unloaded font "${f.family} ${f.style}"`);
  }
  async loadFontAsync(f: { family: string; style: string }) {
    this.loaded.add(`${f.family}/${f.style}`);
  }
  async loadAllPagesAsync() {
    for (const p of this.root.children) p.loaded = true;
  }
  async setCurrentPageAsync(p: FakeNode) {
    if (p.type !== "PAGE") throw new Error("setCurrentPageAsync: not a page");
    p.loaded = true;
    this.currentPage = p;
  }
  notify(): never {
    throw new Error("figma.notify is not allowed in silicon code");
  }
  createPage() {
    const p = new FakeNode("PAGE", this);
    this.root.appendChild(p);
    return p;
  }
  private make(type: string) {
    const n = new FakeNode(type, this);
    if (type === "FRAME" || type === "COMPONENT") n.clipsContent = true;
    this.currentPage.appendChild(n);
    return n;
  }
  createFrame() {
    return this.make("FRAME");
  }
  createRectangle() {
    return this.make("RECTANGLE");
  }
  createEllipse() {
    return this.make("ELLIPSE");
  }
  createText() {
    return this.make("TEXT");
  }
  createVector() {
    return this.make("VECTOR");
  }
  createStar() {
    const n = this.make("STAR");
    Object.assign(n, { pointCount: 5, innerRadius: 0.382 });
    return n;
  }
  createComponent() {
    return this.make("COMPONENT");
  }
  /** Like Figma: a frame sized by the svg's width/height, one vector per <path>. */
  createNodeFromSvg(svg: string) {
    if (!svg.trim().startsWith("<svg")) throw new Error("createNodeFromSvg: not an svg document");
    const f = this.make("FRAME");
    f.name = "svg";
    const w = /width="([\d.]+)"/.exec(svg);
    const h = /height="([\d.]+)"/.exec(svg);
    f.resize(w ? Number(w[1]) : 100, h ? Number(h[1]) : 100);
    for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) {
      const v = new FakeNode("VECTOR", this);
      v.name = "Vector";
      v.svgPath = m[1];
      f.appendChild(v);
    }
    return f;
  }
  /** Like Figma: an image from encoded bytes (PNG/JPEG/GIF signatures checked), referenced by hash. */
  images = new Map<string, Uint8Array>();
  createImage(bytes: Uint8Array) {
    const sig = (...b: number[]) => b.every((v, i) => bytes[i] === v);
    if (!(bytes instanceof Uint8Array) || !(sig(0x89, 0x50, 0x4e, 0x47) || sig(0xff, 0xd8) || sig(0x47, 0x49, 0x46)))
      throw new Error("createImage: Image type is unsupported");
    const hash = `img${this.images.size}`;
    this.images.set(hash, bytes);
    return { hash };
  }
  /** Every node on every page (test helper). */
  allNodes(): FakeNode[] {
    return this.root.children.flatMap((p) => [p, ...p.findAll()]);
  }

  // ---- variables and prototype (lane G)

  collections: FakeVariableCollection[] = [];
  variableById = new Map<string, FakeVariable>();
  /** setValueForMode calls (lane G measures how much the plugin clock writes). */
  variableWrites = 0;
  /** setReactionsAsync calls. */
  reactionWrites = 0;

  /** A node anywhere in the document by id (null if missing or removed). */
  nodeById(id: string): FakeNode | null {
    let found: FakeNode | null = null;
    this.root.walkRaw((n) => {
      if (!found && n.id === id) found = n;
    });
    return found;
  }
  async getNodeByIdAsync(id: string) {
    return this.nodeById(id);
  }

  variables = {
    createVariableCollection: (name: string) => {
      const c = new FakeVariableCollection(name, this);
      this.collections.push(c);
      return c;
    },
    createVariable: (name: string, c: FakeVariableCollection, type: string) => {
      if (!(c instanceof FakeVariableCollection) || c.removed) throw new Error("createVariable: pass a live collection object");
      if (!["BOOLEAN", "FLOAT", "STRING", "COLOR"].includes(type)) throw new Error(`createVariable: bad type ${type}`);
      if (!name || /[.{}]/.test(name)) throw new Error(`createVariable: invalid variable name "${name}"`);
      if (c.vars.length >= 5000) throw new Error("createVariable: collection is full (5000 variables)");
      if (c.vars.some((v) => v.name === name)) throw new Error(`createVariable: duplicate variable name ${name}`);
      const v = new FakeVariable(name, c, type, this);
      c.vars.push(v);
      this.variableById.set(v.id, v);
      return v;
    },
    getLocalVariableCollectionsAsync: async () => [...this.collections],
    getLocalVariablesAsync: async (type?: string) => [...this.variableById.values()].filter((v) => !type || v.resolvedType === type),
    getVariableByIdAsync: async (id: string) => this.variableById.get(id) ?? null,
    getVariableCollectionByIdAsync: async (id: string) => this.collections.find((c) => c.id === id) ?? null,
    /** Like Figma: a copy of a solid paint whose colour follows a COLOR variable. */
    setBoundVariableForPaint: (paint: { type: string }, field: string, v: FakeVariable) => {
      if (paint.type !== "SOLID" || field !== "color") throw new Error("setBoundVariableForPaint: only a solid paint's color");
      if (!(v instanceof FakeVariable) || v.resolvedType !== "COLOR") throw new Error("setBoundVariableForPaint: needs a COLOR variable");
      return { ...paint, boundVariables: { color: { type: "VARIABLE_ALIAS", id: v.id } } };
    },
  };

  /** Variable id → default-mode value: what the prototype starts from (for runFigmaActions). */
  variableValues(): Map<string, boolean | number | string> {
    return new Map([...this.variableById.values()].map((v) => [v.id, v.valuesByMode[v.collection.defaultModeId] as boolean | number | string]));
  }
  /** A variable by collection and name (test helper). */
  variableNamed(collection: string, name: string): FakeVariable {
    const v = [...this.variableById.values()].find((x) => x.collection.name === collection && x.name === name);
    if (!v) throw new Error(`no variable ${collection}/${name}`);
    return v;
  }
}
