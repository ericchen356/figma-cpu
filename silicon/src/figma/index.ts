// Lane E: drawing the circuit as Figma components and reading it back (SILICON.md §8).
export { type Bindings, collectBindings } from "./bindings";
export {
  dependencyOrder,
  draw,
  type DrawOptions,
  type DrawResult,
  drawLibrary,
  ensurePages,
  geomFromComponent,
  propertyKeys,
  siliconPages,
  type SiliconPages,
} from "./draw";
export { extract, ExtractError } from "./extract";
export { type CellGeom, layoutModule, type LayoutOptions, type ModuleLayout } from "./layout";
export * from "./names";
export { drawGates, gateGeom, type GateOptions } from "./symbols";
