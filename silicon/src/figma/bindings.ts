// Maps the flat netlist onto canvas layers for the prototype compiler (lane F): each gate's
// hidden `lit` layer and each net's hidden `wire/<net>/lit` copies. It walks the instance tree
// under the top component, so a flat gate path like "b1/master/and1" is found as the layer
// chain b1 › master › and1 › lit. Wire names are local to their module, so "wire/take/lit"
// inside b1 › master is net "b1/master/take", resolved through FlatNetlist.aliases.
import type { FlatNetlist } from "../netlist/types";
import { LIT, PORT_PREFIX, wireLitNet } from "./names";

export interface Bindings {
  /** Gate index (into FlatNetlist.gates) → its `lit` layer. */
  gateLit: Map<number, SceneNode>;
  /** Net id → every `wire/<net>/lit` layer showing it (one per module scope it is drawn in). */
  wireLit: Map<number, SceneNode[]>;
  /** Gate paths with no `lit` layer on the canvas (empty when canvas and netlist agree). */
  missing: string[];
}

type Container = BaseNode & ChildrenMixin;

export function collectBindings(top: Container, net: FlatNetlist): Bindings {
  const gateAt = new Map<string, number>();
  net.gates.forEach((g, i) => gateAt.set(g.path, i));
  const gateLit = new Map<number, SceneNode>();
  const wireLit = new Map<number, SceneNode[]>();

  const walk = (node: Container, prefix: string) => {
    for (const c of node.children) {
      if (c.type === "INSTANCE") {
        const path = prefix + c.name;
        const gi = gateAt.get(path);
        if (gi === undefined) walk(c, `${path}/`);
        else {
          const lit = c.children.find((x) => x.name === LIT);
          if (lit) gateLit.set(gi, lit);
        }
        continue;
      }
      const local = wireLitNet(c.name);
      if (local !== null) {
        const id = net.aliases.get(prefix + local);
        if (id !== undefined && id > 1) {
          const list = wireLit.get(id);
          if (list) list.push(c);
          else wireLit.set(id, [c]);
        }
        continue;
      }
      if (c.name.startsWith(PORT_PREFIX)) continue;
      if ("children" in c) walk(c, prefix);
    }
  };
  walk(top, "");
  const missing = net.gates.filter((_, i) => !gateLit.has(i)).map((g) => g.path);
  return { gateLit, wireLit, missing };
}
