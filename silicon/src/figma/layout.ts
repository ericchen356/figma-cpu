// Layout and wire routing for one module drawing. Pure data, no Figma API, so it is unit
// tested in Node and the drawing code only turns the result into nodes.
//
// Geometry conventions (all values in px, everything on an 8 px grid):
// - A cell's input pins sit on its left edge (x = 0), output pins on its right edge (x = w).
// - A port marker is a label band (BAND) followed by one PITCH-high row per bit; bit i's pin
//   is at y = marker.y + bitOffset(i). Inside the module, wires attach to the inner end of the
//   port's stub (x = STUB for inputs, x = w - STUB for outputs).
// - Instances go in columns by logic depth from the inputs, rows ordered by the positions of
//   their drivers. Small modules get orthogonal wires from a grid router (A*, one net at a
//   time, joining the net's existing tree); big modules, and any net the router cannot place,
//   are drawn as net labels only (every pin already shows its net name).
import { CONST0, CONST1, type InstanceDef, type ModuleDef, type PortDef, type PortDir, portBits } from "../netlist/types";
import { formatNets } from "./names";
import { textWidth } from "./style";

export const GRID = 8;
export const PITCH = 16;
export const STUB = 16;
export const BAND = 16;
export const TITLE_H = 48;
export const PAD = 16;
/** Font sizes of a port marker's name and net label (layout estimates their widths). */
export const NAME_SIZE = 9;
export const NET_SIZE = 8;

const ROW_GAP = 24;
const PORT_GAP = 8;
const MIN_CHANNEL = 32;
const MAX_CHANNEL = 192;
const LABEL_CHANNEL = 48;

const up = (v: number) => Math.ceil(v / GRID) * GRID;

export interface Point {
  x: number;
  y: number;
}
export interface Pin extends Point {
  dir: PortDir;
}
export interface LabelAnchor {
  x: number;
  y: number;
  h: number;
  size: number;
}

/** What a parent needs to know about a child cell to place and wire it. */
export interface CellGeom {
  w: number;
  h: number;
  ports: PortDef[];
  /** Pin per port bit ("A", "D[3]"): left edge for inputs, right edge for outputs. */
  pins: Map<string, Pin>;
  /** Where each output port's net label starts; long labels spill past the right edge. */
  outLabels: Map<string, LabelAnchor>;
}

export const portMarkerHeight = (width: number) => BAND + width * PITCH;
export const bitOffset = (i: number) => BAND + PITCH / 2 + i * PITCH;

/** Width of a port marker frame (stub + name + default net label). */
export function portMarkerWidth(p: PortDef): number {
  const name = textWidth(p.name, NAME_SIZE);
  return up(
    p.dir === "in"
      ? Math.max(STUB + 8, 2 + name + 4 + textWidth(formatNets(portBits(p)), NET_SIZE) + 4)
      : Math.max(STUB + 8, 6 + name + 4 + STUB),
  );
}

/** Pin geometry of a module from its port marker positions (marker top y per port). */
export function moduleGeom(ports: PortDef[], w: number, h: number, markerY: number[]): CellGeom {
  const pins = new Map<string, Pin>();
  const outLabels = new Map<string, LabelAnchor>();
  ports.forEach((p, i) => {
    portBits(p).forEach((b, k) => pins.set(b, { x: p.dir === "in" ? 0 : w, y: markerY[i] + bitOffset(k), dir: p.dir }));
    if (p.dir === "out") outLabels.set(p.name, { x: w - STUB + 2, y: markerY[i] + 4, h: 11, size: NET_SIZE });
  });
  return { w, h, ports, pins, outLabels };
}

export interface PlacedPort {
  def: PortDef;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PlacedInstance {
  def: InstanceDef;
  x: number;
  y: number;
  geom: CellGeom;
  col: number;
}
export interface Wire {
  net: string;
  /** Polylines (corner points). The first runs sink → driver, later ones sink → the tree. */
  paths: Point[][];
  /** T-junction points where a branch joins the net's tree. */
  junctions: Point[];
}
export interface ModuleLayout {
  name: string;
  w: number;
  h: number;
  ports: PlacedPort[];
  instances: PlacedInstance[];
  wires: Wire[];
  /** Nets with sinks that are shown by label only (no wire). */
  labeled: string[];
  mode: "wires" | "labels";
  geom: CellGeom;
}

export interface LayoutOptions {
  /** "auto" (default): wire modules up to the limits below, label bigger ones. */
  wires?: "auto" | boolean;
  maxWiredInstances?: number;
  maxWiredSinks?: number;
  /** Width of the title + subtitle, so the frame is at least that wide. */
  titleWidth?: number;
}

interface End {
  /** Instance index, or -1 for a module port. */
  inst: number;
  /** Pin key (port bit name) of the instance's cell. */
  key: string;
  /** Module port index and bit (inst = -1). */
  port: number;
  k: number;
}
interface NetInfo {
  name: string;
  driver: End | null;
  sinks: End[];
}

export function layoutModule(def: ModuleDef, geomOf: (cell: string) => CellGeom, opts: LayoutOptions = {}): ModuleLayout {
  const n = def.instances.length;
  const geoms = def.instances.map((i) => geomOf(i.cell));

  // ---- connectivity: one driver + sinks per non-constant net
  const nets = new Map<string, NetInfo>();
  const info = (name: string) => {
    let x = nets.get(name);
    if (!x) nets.set(name, (x = { name, driver: null, sinks: [] }));
    return x;
  };
  def.ports.forEach((p, pi) =>
    portBits(p).forEach((b, k) => {
      const e: End = { inst: -1, key: b, port: pi, k };
      const x = info(b);
      if (p.dir === "out") x.sinks.push(e);
      else if (!x.driver) x.driver = e;
    }),
  );
  def.instances.forEach((inst, ii) => {
    for (const p of geoms[ii].ports) {
      const bits = portBits(p);
      (inst.conn[p.name] ?? []).forEach((net, k) => {
        if (net === CONST0 || net === CONST1 || k >= bits.length) return;
        const e: End = { inst: ii, key: bits[k], port: -1, k };
        const x = info(net);
        if (p.dir === "in") x.sinks.push(e);
        else if (!x.driver) x.driver = e;
      });
    }
  });

  // ---- logic depth (longest path from the inputs; feedback edges found by DFS are ignored).
  // DFS starts at the drivers of the outputs so loops break at the latch inputs.
  const preds: number[][] = def.instances.map(() => []);
  for (const x of nets.values())
    if (x.driver && x.driver.inst >= 0) for (const s of x.sinks) if (s.inst >= 0) preds[s.inst].push(x.driver.inst);
  const depth = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const visit = (i: number): number => {
    if (depth[i] >= 0) return depth[i];
    if (onStack[i]) return -1;
    onStack[i] = 1;
    let d = 0;
    for (const j of preds[i]) d = Math.max(d, visit(j));
    onStack[i] = 0;
    return (depth[i] = d + 1);
  };
  for (const p of def.ports)
    if (p.dir === "out")
      for (const b of portBits(p)) {
        const d = nets.get(b)?.driver;
        if (d && d.inst >= 0) visit(d.inst);
      }
  for (let i = 0; i < n; i++) visit(i);
  const nLogical = n ? Math.max(...depth) : 0;
  const logical: number[][] = Array.from({ length: nLogical }, () => []);
  for (let i = 0; i < n; i++) logical[depth[i] - 1].push(i);

  let sinkCount = 0;
  for (const x of nets.values()) if (x.driver) sinkCount += x.sinks.length;
  const wired =
    opts.wires === true ||
    (opts.wires !== false && n <= (opts.maxWiredInstances ?? 40) && sinkCount <= (opts.maxWiredSinks ?? 240));

  // ---- split very tall columns (big label-mode modules) into several physical columns
  const area = geoms.reduce((a, g) => a + g.w * g.h, 0);
  const maxColH = wired ? 4800 : Math.max(1200, 1.5 * Math.sqrt(area));
  const cols: number[][] = [];
  for (const col of logical) {
    const hsum = col.reduce((a, i) => a + geoms[i].h + ROW_GAP, 0);
    const parts = Math.max(1, Math.ceil(hsum / maxColH));
    const per = Math.ceil(col.length / parts);
    for (let k = 0; k < col.length; k += per) cols.push(col.slice(k, k + per));
  }
  const ncol = cols.length;
  const colOf = new Int32Array(n);
  cols.forEach((c, ci) => c.forEach((i) => (colOf[i] = ci)));

  // ---- column x positions; channel widths grow with the nets crossing them
  const tracks = Array.from({ length: ncol + 1 }, () => new Set<string>());
  for (const x of nets.values()) {
    if (!x.driver || !x.sinks.length) continue;
    for (const s of x.sinks) tracks[s.inst >= 0 ? colOf[s.inst] : ncol].add(x.name);
    tracks[x.driver.inst >= 0 ? colOf[x.driver.inst] + 1 : 0].add(x.name);
  }
  const chan = tracks.map((t) =>
    wired ? Math.min(MAX_CHANNEL, Math.max(MIN_CHANNEL, up(GRID * (t.size + 3)))) : LABEL_CHANNEL,
  );
  const ins = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "in");
  const outs = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "out");
  const markerW = def.ports.map(portMarkerWidth);
  const inW = Math.max(0, ...ins.map((x) => markerW[x.i]));
  const outW = Math.max(0, ...outs.map((x) => markerW[x.i]));
  const colW = cols.map((c) => Math.max(...c.map((i) => geoms[i].w)));
  // The outer channels start past the port label bands, so pins next to them stay reachable.
  const colX: number[] = [];
  let cx = up(Math.max(STUB, inW) + chan[0]);
  for (let c = 0; c < ncol; c++) {
    colX.push(cx);
    cx += colW[c] + chan[c + 1];
  }
  const lastRight = ncol ? colX[ncol - 1] + colW[ncol - 1] : Math.max(inW, STUB);
  const W = up(Math.max(lastRight + chan[ncol] + Math.max(STUB, outW), inW + outW + 4 * GRID, (opts.titleWidth ?? 0) + 2 * PAD));

  // ---- rows: connected pins pull instances (and ports) level with each other; three passes
  const instY = new Float64Array(n);
  const portY = new Float64Array(def.ports.length);
  const pinY = (e: End) =>
    e.inst >= 0 ? instY[e.inst] + geoms[e.inst].pins.get(e.key)!.y : portY[e.port] + bitOffset(e.k);
  const stack = (list: { p: PortDef; i: number }[], want: (i: number) => number) => {
    let cursor = TITLE_H;
    for (const { p, i } of list) {
      const w = want(i);
      portY[i] = up(Math.max(cursor, Number.isNaN(w) ? cursor : w));
      cursor = portY[i] + portMarkerHeight(p.width) + PORT_GAP;
    }
  };
  stack(ins, () => NaN);
  stack(outs, () => NaN);
  const pinsOf = (dir: PortDir) =>
    def.instances.map((inst, ii) => {
      const out: { key: string; net: NetInfo }[] = [];
      for (const p of geoms[ii].ports) {
        if (p.dir !== dir) continue;
        const bits = portBits(p);
        (inst.conn[p.name] ?? []).forEach((net, k) => {
          const x = nets.get(net);
          if (x && k < bits.length) out.push({ key: bits[k], net: x });
        });
      }
      return out;
    });
  const inputPins = pinsOf("in");
  const outputPins = pinsOf("out");
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  // Columns left to right; each instance wants its pins level with the pins it connects to:
  // drivers already placed in this pass, and (after the first pass) sinks further right.
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < ncol; c++) {
      const items = cols[c].map((i) => {
        const back: number[] = [];
        const fwd: number[] = [];
        for (const { key, net } of inputPins[i]) {
          const d = net.driver;
          if (d && (d.inst < 0 || colOf[d.inst] < c)) back.push(pinY(d) - geoms[i].pins.get(key)!.y);
        }
        if (pass > 0)
          for (const { key, net } of outputPins[i])
            for (const s of net.sinks)
              if (s.inst < 0 || colOf[s.inst] > c) fwd.push(pinY(s) - geoms[i].pins.get(key)!.y);
        // both sides weigh the same, however many pins each has
        return { i, want: mean([mean(back), mean(fwd)].filter((v) => !Number.isNaN(v))) };
      });
      items.sort((a, b) => (Number.isNaN(a.want) ? 1e12 : a.want) - (Number.isNaN(b.want) ? 1e12 : b.want) || a.i - b.i);
      let cursor = TITLE_H;
      for (const { i, want } of items) {
        instY[i] = up(Math.max(cursor, Number.isNaN(want) ? cursor : want));
        cursor = instY[i] + geoms[i].h + ROW_GAP;
      }
    }
    const portWant = (i: number) => {
      const p = def.ports[i];
      const ys: number[] = [];
      portBits(p).forEach((b, k) => {
        const x = nets.get(b);
        if (!x) return;
        const ends = p.dir === "in" ? x.sinks : x.driver ? [x.driver] : [];
        for (const e of ends) if (e.inst >= 0) ys.push(pinY(e) - bitOffset(k));
      });
      return mean(ys);
    };
    stack(ins, portWant);
    stack(outs, portWant);
  }
  // Placement only ever pushes things down; lift the whole drawing back under the title.
  let top = Infinity;
  for (let i = 0; i < n; i++) top = Math.min(top, instY[i]);
  for (let i = 0; i < def.ports.length; i++) top = Math.min(top, portY[i]);
  if (Number.isFinite(top) && top > TITLE_H) {
    for (let i = 0; i < n; i++) instY[i] -= top - TITLE_H;
    for (let i = 0; i < def.ports.length; i++) portY[i] -= top - TITLE_H;
  }
  let bottom = TITLE_H;
  for (let i = 0; i < n; i++) bottom = Math.max(bottom, instY[i] + geoms[i].h);
  def.ports.forEach((p, i) => (bottom = Math.max(bottom, portY[i] + portMarkerHeight(p.width))));
  // Feedback wires (to a column at or left of their driver) run around the bottom: one row each.
  let feedback = 0;
  if (wired)
    for (const x of nets.values()) {
      const d = x.driver;
      if (d && d.inst >= 0 && x.sinks.some((s) => s.inst >= 0 && colOf[s.inst] <= colOf[d.inst])) feedback++;
    }
  const H = up(bottom + PAD + feedback * GRID);

  const instances: PlacedInstance[] = def.instances.map((d, i) => ({ def: d, x: colX[colOf[i]], y: instY[i], geom: geoms[i], col: colOf[i] }));
  const ports: PlacedPort[] = def.ports.map((p, i) => ({
    def: p,
    x: p.dir === "in" ? 0 : W - markerW[i],
    y: portY[i],
    w: markerW[i],
    h: portMarkerHeight(p.width),
  }));
  const geom = moduleGeom(def.ports, W, H, Array.from(portY));

  // ---- wires
  // Wire end points: instance pins on the instance edge, module ports at the stub's inner end.
  const endPoint = (e: End): Point =>
    e.inst >= 0
      ? { x: instances[e.inst].x + geoms[e.inst].pins.get(e.key)!.x, y: pinY(e) }
      : { x: def.ports[e.port].dir === "in" ? STUB : W - STUB, y: pinY(e) };
  // Wires leave instance outputs and module inputs to the right, reach the others from the left.
  const fromRight = (e: End) => (e.inst >= 0 ? geoms[e.inst].pins.get(e.key)!.dir === "out" : def.ports[e.port].dir === "in");
  const jobs = [...nets.values()]
    .filter((x) => x.driver && x.sinks.length)
    .map((x, id) => {
      const ends = [x.driver!, ...x.sinks];
      const pts = ends.map(endPoint);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x, id, ends, pts, hpwl: Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) };
    });
  /** Routes the nets in the given order on a fresh grid (null if the grid would be too big). */
  const attempt = (order: typeof jobs): Map<string, Wire> | null => {
    const router = new Router(W, H);
    if (!router.ok) return null;
    router.blockRect(0, 0, W, TITLE_H - GRID);
    router.blockRect(0, 0, STUB, H);
    router.blockRect(W - STUB, 0, W, H);
    for (const pl of ports) router.blockRect(pl.x, pl.y, pl.x + pl.w, pl.y + BAND);
    for (const pi of instances) {
      router.blockRect(pi.x, pi.y, pi.x + pi.geom.w, pi.y + pi.geom.h);
      // long output net labels spill to the right of the instance: keep wires off them
      for (const [port, a] of pi.geom.outLabels) {
        const right = a.x + textWidth(formatNets(pi.def.conn[port] ?? []), a.size);
        if (right > pi.geom.w) router.blockInside(pi.x + pi.geom.w, pi.y + a.y, pi.x + right, pi.y + a.y + a.h);
      }
      for (const [, pin] of pi.geom.pins) router.markPin(pi.x + pin.x, pi.y + pin.y, pin.dir === "out", -1);
    }
    for (const pl of ports)
      portBits(pl.def).forEach((_, k) =>
        router.markPin(pl.def.dir === "in" ? STUB : W - STUB, pl.y + bitOffset(k), pl.def.dir === "in", -1),
      );
    for (const j of jobs) j.ends.forEach((e, k) => router.markPin(j.pts[k].x, j.pts[k].y, fromRight(e), j.id));
    const out = new Map<string, Wire>();
    for (const j of order) {
      const w = router.routeNet(j.id, j.pts[0], j.pts.slice(1));
      if (w) out.set(j.x.name, { net: j.x.name, ...w });
    }
    return out;
  };
  let routed: Map<string, Wire> | null = null;
  if (wired && jobs.length) {
    // short nets first: they get the straight paths. If some net is left over, try once more
    // with the leftovers first and keep whichever pass placed more nets.
    jobs.sort((a, b) => a.hpwl - b.hpwl || a.id - b.id);
    routed = attempt(jobs);
    if (routed && routed.size < jobs.length) {
      const failed = jobs.filter((j) => !routed!.has(j.x.name));
      const retry = attempt([...failed, ...jobs.filter((j) => routed!.has(j.x.name))])!;
      if (retry.size > routed.size) routed = retry;
    }
  }
  const wires: Wire[] = [];
  const labeled: string[] = [];
  for (const x of nets.values()) {
    if (!x.sinks.length) continue;
    const w = routed?.get(x.name);
    if (w) wires.push(w);
    else labeled.push(x.name);
  }
  const mode = wired && (routed || !jobs.length) ? "wires" : "labels";
  return { name: def.name, w: W, h: H, ports, instances, wires, labeled, mode, geom };
}

// ---------- grid router ----------

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const BEND = 6;
const CROSS = 10;
const NOBODY = 0x7fffffff;
const MAX_NODES = 600_000;
const WINDOW = 14;

/** Binary min-heap of (priority, value) pairs. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.v.length;
  }
  clear() {
    this.k.length = 0;
    this.v.length = 0;
  }
  push(key: number, val: number) {
    const { k, v } = this;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    const n = v.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/** Orthogonal router on the 8 px grid. Each node carries the net using it horizontally and
 * vertically; a net may cross another straight through, but never overlap it, bend on it,
 * or touch its pins, so every drawn junction is a real connection. */
class Router {
  readonly nx: number;
  readonly ny: number;
  readonly ok: boolean;
  private blocked!: Uint8Array;
  /** Net id + 1 of the pin at a node (pins are only reachable by their own net). */
  private pin!: Int32Array;
  /** Approach node next to a pin: only that pin's net may use it (NOBODY: no net). */
  private reserve!: Int32Array;
  private occH!: Int32Array;
  private occV!: Int32Array;
  private corner!: Int32Array;
  private tree!: Int32Array;
  private g!: Int32Array;
  private prev!: Int32Array;
  private seen!: Int32Array;
  private closed!: Int32Array;
  private stamp = 0;
  private heap = new Heap();

  constructor(w: number, h: number) {
    this.nx = w / GRID + 1;
    this.ny = h / GRID + 1;
    const size = this.nx * this.ny;
    this.ok = size <= MAX_NODES;
    if (!this.ok) return;
    this.blocked = new Uint8Array(size);
    this.pin = new Int32Array(size);
    this.reserve = new Int32Array(size);
    this.occH = new Int32Array(size);
    this.occV = new Int32Array(size);
    this.corner = new Int32Array(size);
    this.tree = new Int32Array(size);
    this.g = new Int32Array(size * 4);
    this.prev = new Int32Array(size * 4);
    this.seen = new Int32Array(size * 4);
    this.closed = new Int32Array(size * 4);
  }

  private node(x: number, y: number): number {
    const gx = Math.round(x / GRID);
    const gy = Math.round(y / GRID);
    return gx < 0 || gy < 0 || gx >= this.nx || gy >= this.ny ? -1 : gy * this.nx + gx;
  }

  /** Blocks every grid node in the closed rectangle (px; edges snap outward). */
  blockRect(x0: number, y0: number, x1: number, y1: number) {
    this.fill(Math.floor(x0 / GRID), Math.floor(y0 / GRID), Math.ceil(x1 / GRID), Math.ceil(y1 / GRID));
  }
  /** Blocks only grid nodes strictly covered by the rectangle (edges snap inward). */
  blockInside(x0: number, y0: number, x1: number, y1: number) {
    this.fill(Math.ceil(x0 / GRID), Math.ceil(y0 / GRID), Math.floor(x1 / GRID), Math.floor(y1 / GRID));
  }
  private fill(gx0: number, gy0: number, gx1: number, gy1: number) {
    for (let gy = Math.max(0, gy0); gy <= Math.min(this.ny - 1, gy1); gy++)
      for (let gx = Math.max(0, gx0); gx <= Math.min(this.nx - 1, gx1); gx++) this.blocked[gy * this.nx + gx] = 1;
  }

  /** Marks a pin and reserves the grid node in front of it (to its right if `fromRight`) for
   * the pin's net; net = -1 marks it for nobody (unrouted pins stay clear too). */
  markPin(x: number, y: number, fromRight: boolean, net: number) {
    const p = this.node(x, y);
    if (p < 0) return;
    const gx = p % this.nx;
    const a = fromRight ? (gx + 1 < this.nx ? p + 1 : -1) : gx > 0 ? p - 1 : -1;
    const v = net < 0 ? NOBODY : net + 1;
    if (net >= 0 || !this.pin[p]) this.pin[p] = v;
    if (a >= 0 && (net >= 0 || !this.reserve[a])) this.reserve[a] = v;
  }

  /** Routes one net from its driver pin to each sink pin. Returns null (and leaves the grid
   * untouched) if any sink cannot be reached. */
  routeNet(net: number, drv: Point, sinks: Point[]): { paths: Point[][]; junctions: Point[] } | null {
    const K = net + 1;
    const d = this.node(drv.x, drv.y);
    if (d < 0) return null;
    const touched: number[] = [d];
    this.tree[d] = K;
    const bb = { x0: d % this.nx, y0: Math.floor(d / this.nx), x1: d % this.nx, y1: Math.floor(d / this.nx) };
    const paths: Point[][] = [];
    const junctions: Point[] = [];
    const order = sinks
      .map((s) => ({ s, dist: Math.abs(s.x - drv.x) + Math.abs(s.y - drv.y) }))
      .sort((a, b) => a.dist - b.dist);
    for (const { s } of order) {
      const start = this.node(s.x, s.y);
      let states = start < 0 ? null : this.search(start, K, d, bb, true);
      if (!states && start >= 0) states = this.search(start, K, d, bb, false);
      if (!states) {
        for (const t of touched) {
          if (this.occH[t] === K) this.occH[t] = 0;
          if (this.occV[t] === K) this.occV[t] = 0;
          if (this.corner[t] === K) this.corner[t] = 0;
          if (this.tree[t] === K) this.tree[t] = 0;
        }
        return null;
      }
      const nodes = states.map((x) => x >> 2);
      const dirs = states.map((x) => x & 3);
      const pts: Point[] = [this.point(nodes[0])];
      for (let i = 1; i < nodes.length; i++) {
        const axis = dirs[i] < 2 ? this.occH : this.occV;
        axis[nodes[i - 1]] = K;
        axis[nodes[i]] = K;
        touched.push(nodes[i]);
        if (i < nodes.length - 1 && dirs[i + 1] !== dirs[i]) {
          this.corner[nodes[i]] = K;
          pts.push(this.point(nodes[i]));
        }
      }
      const end = nodes[nodes.length - 1];
      pts.push(this.point(end));
      if (end !== d) {
        this.corner[end] = K;
        junctions.push(this.point(end));
      }
      for (let i = 1; i < nodes.length; i++) {
        const q = nodes[i];
        this.tree[q] = K;
        const qx = q % this.nx;
        const qy = (q - qx) / this.nx;
        bb.x0 = Math.min(bb.x0, qx);
        bb.x1 = Math.max(bb.x1, qx);
        bb.y0 = Math.min(bb.y0, qy);
        bb.y1 = Math.max(bb.y1, qy);
      }
      paths.push(pts);
    }
    return { paths, junctions };
  }

  private point(p: number): Point {
    const gx = p % this.nx;
    return { x: gx * GRID, y: ((p - gx) / this.nx) * GRID };
  }

  /** Can the search stop at tree node p, arriving in direction d? */
  private isStop(p: number, d: number, K: number, drv: number): boolean {
    if (p === drv) return d === 1;
    if (this.pin[p]) return false;
    const h = this.occH[p];
    const v = this.occV[p];
    return !((h && h !== K) || (v && v !== K));
  }

  private enterable(q: number, nd: number, K: number): boolean {
    if (this.blocked[q] || this.pin[q]) return false;
    const r = this.reserve[q];
    if (r && r !== K) return false;
    const c = this.corner[q];
    if (c && c !== K) return false;
    const same = nd < 2 ? this.occH[q] : this.occV[q];
    return !(same && same !== K);
  }

  /** A* from a sink pin (leaving it leftwards) to any node of the net's tree. */
  private search(start: number, K: number, drv: number, bb: { x0: number; y0: number; x1: number; y1: number }, windowed: boolean): number[] | null {
    const { nx, ny, heap, g, prev, seen, closed } = this;
    const st = ++this.stamp;
    const sx = start % nx;
    const sy = (start - sx) / nx;
    const m = windowed ? WINDOW : nx + ny;
    const wx0 = Math.max(0, Math.min(sx, bb.x0) - m);
    const wx1 = Math.min(nx - 1, Math.max(sx, bb.x1) + m);
    const wy0 = Math.max(0, Math.min(sy, bb.y0) - m);
    const wy1 = Math.min(ny - 1, Math.max(sy, bb.y1) + m);
    const h = (qx: number, qy: number) =>
      Math.max(0, bb.x0 - qx, qx - bb.x1) + Math.max(0, bb.y0 - qy, qy - bb.y1);
    heap.clear();
    const s0 = start * 4 + 1;
    seen[s0] = st;
    g[s0] = 0;
    prev[s0] = -1;
    heap.push(h(sx, sy), s0);
    let budget = 4 * (wx1 - wx0 + 1) * (wy1 - wy0 + 1) + 64;
    while (heap.size) {
      const s = heap.pop();
      if (closed[s] === st) continue;
      closed[s] = st;
      const p = s >> 2;
      const d = s & 3;
      if (p !== start && this.tree[p] === K && this.isStop(p, d, K, drv)) {
        const out: number[] = [];
        for (let x = s; x !== -1; x = prev[x]) out.push(x);
        return out.reverse();
      }
      if (--budget < 0) return null;
      const px = p % nx;
      const py = (p - px) / nx;
      const bendOk = p !== start && !this.pin[p] && !this.occH[p] && !this.occV[p] && !this.corner[p];
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d ^ 1) || (nd !== d && !bendOk)) continue;
        const qx = px + DX[nd];
        const qy = py + DY[nd];
        if (qx < wx0 || qx > wx1 || qy < wy0 || qy > wy1) continue;
        const q = qy * nx + qx;
        let cost = 1 + (nd !== d ? BEND : 0);
        if (!(this.tree[q] === K && this.isStop(q, nd, K, drv))) {
          if (!this.enterable(q, nd, K)) continue;
          const other = nd < 2 ? this.occV[q] : this.occH[q];
          if (other && other !== K) cost += CROSS;
        }
        const ns = q * 4 + nd;
        const ng = g[s] + cost;
        if (seen[ns] !== st || ng < g[ns]) {
          seen[ns] = st;
          g[ns] = ng;
          prev[ns] = s;
          heap.push(ng + h(qx, qy), ns);
        }
      }
    }
    return null;
  }
}
