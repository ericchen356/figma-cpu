// Magnifiers: instances of the REAL cell components drawn by Build hardware (cell/FULL_ADDER,
// cell/DFFE, cell/DLATCH, …), placed in the dashboard and bound to the nets of one particular
// copy of that cell inside the CPU. A gate path p inside the instance is the flat gate
// `<prefix><p>` of the netlist (e.g. FULL_ADDER's `p` at prefix alu/add/fa3/ is the CPU gate
// alu/add/fa3/p), so its `lit` layer gets that gate's output variable and glows exactly when
// the CPU's own wire does. Same walk as lane E's collectBindings (src/figma/bindings.ts), with
// a path prefix: an instance whose path is a gate is that gate; any other instance is a cell
// to walk into; `wire/<net>/lit` layers resolve <prefix><scope>/<net> through the aliases.
import { formatNets, LIT, parsePortMarker, PORT_PREFIX, propName, wireLitNet } from "../figma/names";
import type { FlatNetlist } from "../netlist/types";
import { portBits } from "../netlist/types";
import { magName } from "./names";
import { type Ctx, frame, L, text } from "./style";
import { lamp } from "./widgets";

type Container = BaseNode & ChildrenMixin;

export interface PrefixedBindings {
  /** Gate index → its `lit` layer inside the instance. */
  gateLit: Map<number, SceneNode>;
  /** Net id → `wire/<net>/lit` layers inside the instance. */
  wireLit: Map<number, SceneNode[]>;
  /** Gates of the netlist under `prefix` that have no `lit` layer in the instance. */
  missing: string[];
  /** `lit` layers of gate instances whose path is not a gate of the netlist. */
  stray: string[];
}

/** collectBindings for a cell instance standing for the netlist subtree at `prefix` ("alu/add/fa3/"). */
export function collectPrefixed(top: Container, net: FlatNetlist, prefix: string): PrefixedBindings {
  const gateAt = new Map<string, number>();
  net.gates.forEach((g, i) => {
    if (g.path.startsWith(prefix)) gateAt.set(g.path, i);
  });
  const gateLit = new Map<number, SceneNode>();
  const wireLit = new Map<number, SceneNode[]>();
  const stray: string[] = [];
  const walk = (node: Container, scope: string) => {
    for (const c of node.children) {
      if (c.type === "INSTANCE") {
        const path = scope + c.name;
        const gi = gateAt.get(path);
        if (gi !== undefined) {
          const lit = c.children.find((x) => x.name === LIT);
          if (lit) gateLit.set(gi, lit);
        } else if (c.children.some((x) => x.name === LIT) && !c.children.some((x) => x.type === "INSTANCE")) stray.push(path);
        else walk(c, `${path}/`);
        continue;
      }
      const local = wireLitNet(c.name);
      if (local !== null) {
        const id = net.aliases.get(scope + local);
        if (id !== undefined && id > 1) {
          const list = wireLit.get(id);
          if (list) list.push(c);
          else wireLit.set(id, [c]);
        }
        continue;
      }
      if (c.name.startsWith(PORT_PREFIX)) continue;
      if ("children" in c) walk(c, scope);
    }
  };
  walk(top, prefix);
  const missing = [...gateAt].filter(([, i]) => !gateLit.has(i)).map(([p]) => p);
  return { gateLit, wireLit, missing, stray };
}

export interface MagnifierSpec {
  /** Module name: the component is `cell/<cell>`. */
  cell: string;
  /** Flat path prefix of the copy to show, without the trailing slash ("alu/add/fa3"). */
  prefix: string;
  title: string;
  caption: string;
}

/** Default magnifiers: the adder's bit 3, R0's bit 0, and the RAM bit that holds bit 1 of the
 * OUT byte (a store to 15 flips it in mul). */
export const DEFAULT_MAGNIFIERS: MagnifierSpec[] = [
  { cell: "FULL_ADDER", prefix: "alu/add/fa3", title: "the adder's bit 3", caption: "cell/FULL_ADDER at alu/add/fa3 · these gates are the CPU's own, live" },
  { cell: "DFFE", prefix: "regs/r0/b0", title: "R0, bit 0", caption: "cell/DFFE at regs/r0/b0 · a flip-flop: master + slave latch" },
  { cell: "DLATCH", prefix: "ram/row15/b1", title: "RAM[15], bit 1", caption: "cell/DLATCH at ram/row15/b1 · one bit of memory" },
];

/** Port definitions of a cell component, read from its port markers (the canvas contract). */
export function componentPorts(main: ComponentNode): { name: string; dir: "in" | "out"; width: number }[] {
  const out: { name: string; dir: "in" | "out"; width: number }[] = [];
  for (const c of main.children) {
    const p = parsePortMarker(c.name);
    if (p) out.push({ name: p.name, dir: p.dir, width: p.width });
  }
  return out;
}

export interface MagnifierResult {
  frame: FrameNode;
  instance: InstanceNode | null;
  scale: number;
}

/** One magnifier panel at (x, y): title, caption, the cell instance scaled to fit, and a lamp
 * per port bit. With no component (`main` null) it shows how to get one. */
export function drawMagnifier(ctx: Ctx, parent: Container, spec: MagnifierSpec, main: ComponentNode | null, net: FlatNetlist, x: number, y: number, w: number, h: number): MagnifierResult {
  const prefix = `${spec.prefix.replace(/\/+$/, "")}/`;
  const f = frame(ctx, parent, magName(prefix), x, y, w, h, { fill: L.block, radius: 10, stroke: L.line });
  text(ctx, f, spec.title, 14, 10, { size: 11, font: "bold", name: "title" });
  text(ctx, f, spec.caption, 14, 26, { size: 9, color: L.text3, name: "caption" });
  const vpY = 44;
  const vpH = h - vpY - 30;
  const vp = frame(ctx, f, "viewport", 14, vpY, w - 28, vpH, { fill: "#1A1A1A", radius: 6, clip: true });
  if (!main) {
    text(ctx, vp, `cell/${spec.cell} is not on the canvas: run Build hardware`, 12, vpH / 2 - 7, { size: 10, color: L.text3, name: "missing" });
    return { frame: f, instance: null, scale: 0 };
  }
  const inst = main.createInstance();
  vp.appendChild(inst);
  // Label the ports with the CPU's real (canonical) net names, e.g. A = a[3].
  try {
    const props: Record<string, string> = {};
    const ports = new Map(componentPorts(main).map((p) => [p.name, p]));
    for (const [key, d] of Object.entries(main.componentPropertyDefinitions)) {
      const p = ports.get(propName(key));
      if (d.type !== "TEXT" || !p) continue;
      const nets = portBits(p).map((b) => {
        const id = net.aliases.get(prefix + b);
        return id === undefined ? b : net.netNames[id];
      });
      props[key] = formatNets(nets);
    }
    if (Object.keys(props).length) inst.setProperties(props);
  } catch {
    /* cosmetic: the labels keep the cell's own port names */
  }
  const scale = Math.min(1, (w - 44) / inst.width, (vpH - 12) / inst.height);
  if (scale < 1 && typeof (inst as Partial<InstanceNode>).rescale === "function") inst.rescale(scale);
  const sw = typeof inst.rescale === "function" ? inst.width : inst.width * scale;
  const sh = typeof inst.rescale === "function" ? inst.height : inst.height * scale;
  inst.x = Math.round((w - 28 - sw) / 2);
  inst.y = Math.round((vpH - sh) / 2);

  // Port lamps: inputs, then outputs.
  let px = 14;
  const py = h - 22;
  for (const p of [...componentPorts(main)].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === "in" ? -1 : 1))) {
    for (const b of portBits(p)) {
      const label = text(ctx, f, b, px, py + 1, { size: 8.5, font: "mono", color: p.dir === "in" ? L.text2 : L.text, name: `port/${b}` });
      px += Math.max(label.width, b.length * 5.3) + 4;
      lamp(ctx, f, prefix + b, px, py, 12, p.dir === "in" ? L.load : L.alu);
      px += 22;
    }
    if (p.dir === "in") px += 0;
  }
  return { frame: f, instance: inst, scale };
}
