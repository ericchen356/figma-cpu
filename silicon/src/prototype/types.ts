// Contracts of the prototype compiler (lane F). A PrototypePlan is plain JSON-able data:
// one boolean variable per wire and the list of SET_VARIABLE actions that Figma's prototype
// engine runs on every Step. `interpret` runs a plan in JS; `toFigmaActions` turns it into
// Plugin API `Action` objects; `apply` creates the variables and wires the buttons.

/** A boolean expression over net variables. Net ids index FlatNetlist.netNames.
 * NAND = not(and), NOR = not(or), XOR = neq, XNOR = eq, BUF = var. */
export type Expr =
  | { var: number }
  | { const: 0 | 1 }
  | { not: Expr }
  | { and: [Expr, Expr] }
  | { or: [Expr, Expr] }
  | { eq: [Expr, Expr] }
  | { neq: [Expr, Expr] };

/** One prototype action. `set` is a net id; actions run in order and each one reads the
 * values left by the previous ones (that is how Figma runs a reaction's action list). */
export type PlanAction = { set: number; to: Expr } | { if: Expr; then: PlanAction[]; else?: PlanAction[] };

export interface PlanVariable {
  /** Net id. */
  net: number;
  /** Figma variable name, `net/<hierarchical name>` (slashes group variables in Figma's UI). */
  name: string;
  /** Power-on value. */
  init: boolean;
}

export interface PlanStats {
  gates: number;
  variables: number;
  /** Actions in one Step (gate actions + the two CLK sets), = Figma work per tick. */
  actionsPerTick: number;
  lowPass: number;
  highPass: number;
  /** Deepest expression nesting in the tick (1 = a single operator over vars/consts). */
  maxDepth: number;
}

export interface PrototypePlan {
  name: string;
  variables: PlanVariable[];
  /** Net id of the global clock. */
  clk: number;
  /** Net id that stops the Run loop when 1 (e.g. HALTED), if the circuit has one. */
  halt?: number;
  /** Gate index → output net id, so canvas `lit` layers of gates can be bound. */
  gateOut: number[];
  /** One clock cycle: CLK=0, LOW pass gates, CLK=1, HIGH pass gates. */
  tick: PlanAction[];
  /** Sets every variable back to its power-on value. */
  reset: PlanAction[];
  stats: PlanStats;
}

/** Canvas nodes to bind (lane E's `collectBindings`): gate output highlights and wire copies. */
export interface LitBindings {
  gateLit: Map<number, SceneNode>;
  wireLit: Map<number, SceneNode[]>;
}
