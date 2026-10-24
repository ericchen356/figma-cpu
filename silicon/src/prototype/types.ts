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
  /** Actions in the tick, counting every branch (gate actions + the two CLK sets). Without
   * gating this is also what one tick executes. */
  actionsPerTick: number;
  lowPass: number;
  highPass: number;
  /** Deepest expression nesting in the tick (1 = a single operator over vars/consts). */
  maxDepth: number;
  /** Most actions one tick can execute (every gated block taken). = actionsPerTick ungated. */
  worstCase: number;
  /** Clock-gating blocks (`if` actions added by `gate: true`), 0 without gating. */
  gatedBlocks: number;
  /** Events per tick (chunks) and the worst case of one event incl. dispatch, if chunked. */
  chunks?: number;
  maxEvent?: number;
}

/** The tick split for engines that limit the actions one event may execute (Figma's viewer
 * overflows its stack somewhere between 501 and 2001 actions per click). Running the chunks
 * one after another is exactly one tick. Each event runs one chunk through a dispatcher:
 *   phaseNow = phase                                    1
 *   if phaseNow == k { chunk k; phase = k+1 mod K;      K conditionals (all evaluated)
 *                      phaseText = "" + phase }         + chunk + 2
 *   … and the last chunk also updates the tick counter  + tickExtra
 * plus 2 for a Run-loop hop (its CONDITIONAL and NAVIGATE). So every chunk's worst case is at
 * most maxActionsPerEvent − (K + 5) − tickExtra. */
export interface Chunking {
  maxActionsPerEvent: number;
  tickExtra: number;
  chunks: PlanAction[][];
  /** Worst-case executed actions of each event, dispatch included (≤ maxActionsPerEvent). */
  perEvent: number[];
}

export interface PrototypePlan {
  name: string;
  variables: PlanVariable[];
  /** Net id of the global clock. */
  clk: number;
  /** Net id that stops the Run loop when 1 (e.g. HALTED), if the circuit has one. */
  halt?: number;
  /** Plan-only boolean variables (clock-gating dirty flags). Their ids are ≥ the netlist's
   * net count, so they never collide with nets; all are false at every tick boundary. */
  flags: PlanVariable[];
  /** Gate index → output net id, so canvas `lit` layers of gates can be bound. */
  gateOut: number[];
  /** One clock cycle: CLK=0, LOW pass gates, CLK=1, HIGH pass gates. */
  tick: PlanAction[];
  /** Sets every variable (and flag) back to its power-on value. */
  reset: PlanAction[];
  /** The event budget the plan was made for (absent: unlimited), and the chunks if the tick
   * does not fit in one event. */
  maxActionsPerEvent?: number;
  chunking?: Chunking;
  stats: PlanStats;
}

/** Canvas nodes to bind (lane E's `collectBindings`): gate output highlights and wire copies. */
export interface LitBindings {
  gateLit: Map<number, SceneNode>;
  wireLit: Map<number, SceneNode[]>;
}
