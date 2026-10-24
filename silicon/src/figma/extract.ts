// Reads the circuit back off the canvas: every `cell/<NAME>` main component becomes a
// ModuleDef again. Only names, component properties and port markers count — positions,
// sizes, wires and labels are ignored, so moving things around never changes the machine,
// while editing a property, renaming an instance or swapping a gate does.
//   ports      port markers `port/<in|out>/<NAME>/<width>`, in layer order
//   instances  INSTANCE layers in layer order: name = instance name, main component = cell
//              (gate/AND → "gate/AND", cell/DFF → "DFF"), TEXT properties = connections
//   doc        the component description
import { gatePorts, gateTypeOf, type InstanceDef, isGateCell, type Library, type ModuleDef, type PortDef } from "../netlist/types";
import { dependencyOrder } from "./draw";
import { cellOfComponent, parseNets, parsePortMarker, propName } from "./names";

export class ExtractError extends Error {}

/** Rebuilds the module library from the `cell/*` components on `pages` (dependency order). */
export async function extract(pages: readonly PageNode[]): Promise<Library> {
  const found = new Map<string, ModuleDef>();
  for (const page of pages) {
    await page.loadAsync();
    for (const comp of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
      const name = cellOfComponent(comp.name);
      if (!name || isGateCell(name)) continue;
      if (found.has(name)) throw new ExtractError(`two components are named ${comp.name}`);
      found.set(name, await readModule(comp, name));
    }
  }

  // Connections in the child's port order; widths must match the child's ports.
  for (const def of found.values())
    for (const inst of def.instances) {
      const where = `cell/${def.name} › ${inst.name}`;
      const ports: PortDef[] | undefined = isGateCell(inst.cell) ? gatePorts(gateTypeOf(inst.cell)) : found.get(inst.cell)?.ports;
      if (!ports) throw new ExtractError(`${where}: its component cell/${inst.cell} is not on the extracted pages`);
      const conn: Record<string, string[]> = {};
      for (const p of ports) {
        const nets = inst.conn[p.name];
        if (nets === undefined) continue;
        if (nets.length !== p.width)
          throw new ExtractError(`${where}: ${p.name} needs ${p.width} net${p.width > 1 ? "s" : ""}, got ${nets.length} (${nets.join(", ")})`);
        conn[p.name] = nets;
      }
      inst.conn = conn;
    }

  try {
    return new Map(dependencyOrder(found).map((n) => [n, found.get(n)!]));
  } catch (e) {
    throw new ExtractError((e as Error).message);
  }
}

async function readModule(comp: ComponentNode, name: string): Promise<ModuleDef> {
  const ports: PortDef[] = [];
  const instances: InstanceDef[] = [];
  const walk = async (node: BaseNode & ChildrenMixin): Promise<void> => {
    for (const c of node.children) {
      if (c.type === "INSTANCE") {
        const inst = await readInstance(c);
        if (inst) instances.push(inst);
        continue;
      }
      const port = parsePortMarker(c.name);
      if (port) {
        ports.push(port);
        continue;
      }
      if ("children" in c) await walk(c);
    }
  };
  await walk(comp);
  const dup = (names: string[]) => names.find((n, i) => names.indexOf(n) !== i);
  const dp = dup(ports.map((p) => p.name));
  if (dp) throw new ExtractError(`cell/${name}: two port markers for ${dp}`);
  const di = dup(instances.map((i) => i.name));
  if (di) throw new ExtractError(`cell/${name}: two instances named ${di}`);
  return { name, ports, instances, doc: comp.description || undefined };
}

/** An instance layer → InstanceDef (null for instances of non-circuit components). */
async function readInstance(node: InstanceNode): Promise<InstanceDef | null> {
  const main = await node.getMainComponentAsync();
  if (!main) throw new ExtractError(`${node.name}: instance has no main component`);
  const cell = cellOfComponent(main.name);
  if (!cell) return null;
  const conn: Record<string, string[]> = {};
  for (const [key, prop] of Object.entries(node.componentProperties)) {
    if (prop.type !== "TEXT") continue;
    const nets = parseNets(String(prop.value));
    if (nets.length) conn[propName(key)] = nets;
  }
  return { name: node.name, cell, conn };
}
