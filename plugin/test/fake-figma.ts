// A small in-memory stand-in for the Figma Plugin API: enough to run the draw script,
// the binder and the renderer in Node, so canvas bugs show up before spending MCP calls.
// Like real Figma, writing text with an unloaded font throws.

type Pred = (n: FakeNode) => boolean;

let ids = 0;

export class FakeNode {
  id = `${++ids}:1`;
  name = "";
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  removed = false;
  fills: unknown = [];
  strokes: unknown = [];
  strokeWeight = 1;
  cornerRadius = 0;
  clipsContent = false;
  dashPattern: number[] = [];
  fontSize = 12;
  textAutoResize = "WIDTH_AND_HEIGHT";
  textAlignHorizontal = "LEFT";
  private _chars = "";
  private _font: { family: string; style: string } = { family: "Inter", style: "Regular" };
  private pluginData = new Map<string, string>();
  rangeFills: [number, number][] = [];

  constructor(
    public type: string,
    private api: FakeFigma,
  ) {}

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
    this._chars = s;
    this.api.writes++;
  }
  getRangeAllFontNames() {
    return [this._font];
  }
  setRangeFills(start: number, end: number) {
    this.api.requireFont(this._font);
    if (start < 0 || end > this._chars.length || start > end) throw new Error(`bad range ${start}-${end}`);
    this.rangeFills.push([start, end]);
  }
  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  appendChild(c: FakeNode) {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = this;
    this.children.push(c);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
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
  findAllWithCriteria({ types }: { types: string[] }) {
    return this.findAll((n) => types.includes(n.type));
  }
  setPluginData(k: string, v: string) {
    this.pluginData.set(k, v);
  }
  getPluginData(k: string) {
    return this.pluginData.get(k) ?? "";
  }
  async loadAsync() {}
  createInstance(): FakeNode {
    const clone = (src: FakeNode, type: string): FakeNode => {
      const n = new FakeNode(type, this.api);
      Object.assign(n, { name: src.name, x: src.x, y: src.y, width: src.width, height: src.height, fills: src.fills });
      n._font = src._font;
      n._chars = src._chars;
      for (const c of src.children) n.appendChild(clone(c, c.type === "COMPONENT" ? "INSTANCE" : c.type));
      return n;
    };
    return clone(this, "INSTANCE");
  }
}

export class FakeFigma {
  mixed = Symbol("mixed");
  writes = 0;
  loaded = new Set<string>();
  images: Uint8Array[] = [];
  root: FakeNode;
  currentPage: FakeNode;
  viewport = { scrollAndZoomIntoView() {} };

  constructor(pageNames: string[]) {
    this.root = new FakeNode("DOCUMENT", this);
    for (const name of pageNames) this.createPage().name = name;
    this.currentPage = this.root.children[0];
  }
  requireFont(f: { family: string; style: string }) {
    if (!this.loaded.has(`${f.family}/${f.style}`)) throw new Error(`Cannot write to node with unloaded font "${f.family} ${f.style}"`);
  }
  async loadFontAsync(f: { family: string; style: string }) {
    this.loaded.add(`${f.family}/${f.style}`);
  }
  async setCurrentPageAsync(p: FakeNode) {
    this.currentPage = p;
  }
  createPage() {
    const p = new FakeNode("PAGE", this);
    this.root.appendChild(p);
    return p;
  }
  private make(type: string) {
    const n = new FakeNode(type, this);
    this.currentPage.appendChild(n);
    return n;
  }
  createFrame() {
    return this.make("FRAME");
  }
  createRectangle() {
    return this.make("RECTANGLE");
  }
  createText() {
    return this.make("TEXT");
  }
  createComponent() {
    return this.make("COMPONENT");
  }
  combineAsVariants(nodes: FakeNode[], parent: FakeNode) {
    const set = new FakeNode("COMPONENT_SET", this);
    for (const n of nodes) set.appendChild(n);
    parent.appendChild(set);
    return set;
  }
  createImage(bytes: Uint8Array) {
    this.images.push(bytes);
    return { hash: `img${this.images.length}` };
  }
}
