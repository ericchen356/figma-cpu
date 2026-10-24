// Messages between the plugin panel (ui/ui.ts, an iframe) and the plugin code (src/main.ts,
// Figma's sandbox). Plain JSON in both directions.

/** Panel → plugin. */
export type ToMain =
  | { type: "init" }
  | { type: "build"; gateLabels: boolean; redraw: boolean; separatePages?: boolean }
  | { type: "panel" }
  | { type: "compile"; source: string; flat?: boolean; runDelayMs?: number; maxActionsPerEvent?: number }
  | { type: "load"; source: string }
  | { type: "clock"; action: "step" | "run" | "pause" | "reset"; tps?: number; source?: string }
  | { type: "verify"; source: string; maxTicks?: number };

export type LogLevel = "info" | "ok" | "error";

/** What the canvas and the document hold right now. */
export interface DocStatus {
  /** cell/CPU exists on the CPU page. */
  hardware: boolean;
  /** The front panel component exists. */
  panel: boolean;
  /** The prototype's variable collection exists. */
  compiled: boolean;
  /** Name of the program last loaded into the variables, if known. */
  program: string | null;
  /** Where the hardware lives (a page name, or the three page names). */
  page: string | null;
}

export interface BuildStats {
  modules: number;
  drawn: number;
  reused: number;
  gates: number;
  ms: number;
  /** cell/CPU size on the canvas. */
  cpuSize: { w: number; h: number };
  /** The page it was drawn on ("separate pages" for Silicon · Gates / Cells / CPU). */
  page: string;
}

export interface CompileStats {
  gates: number;
  nets: number;
  variables: number;
  collections: number;
  actionsPerTick: number;
  actionsPerStep: number;
  lowPass: number;
  highPass: number;
  maxDepth: number;
  /** Lit layers bound (gates + wires + front panel). */
  bound: number;
  unbound: number;
  /** Gates without a `lit` layer on the canvas. */
  missingLits: number;
  panelLamps: number;
  ms: { extract: number; compile: number; apply: number; total: number };
}

export interface ClockStatus {
  running: boolean;
  ticks: number;
  /** Ticks per second over the last frame(s); 0 when stopped. */
  tps: number;
  halted: boolean;
  /** Variables written in the last frame. */
  writes: number;
  probes: Record<string, number>;
}

/** Plugin → panel. */
export type ToUi =
  | { type: "hello"; status: DocStatus }
  | { type: "status"; status: DocStatus }
  | { type: "log"; level: LogLevel; text: string }
  | { type: "busy"; task: string | null }
  | { type: "progress"; task: string; done: number; total: number; label: string }
  | { type: "build"; stats: BuildStats }
  | { type: "compile"; stats: CompileStats }
  | { type: "asm"; errors: Array<{ line: number; msg: string }> }
  | { type: "clock"; status: ClockStatus }
  | { type: "verify"; ok: boolean; text: string };
