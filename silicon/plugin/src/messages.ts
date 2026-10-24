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
  | { type: "verify"; source: string; maxTicks?: number }
  /** Input byte (0–255) for the memory-mapped input register RAM[IN_ADDR] (devices.ts). */
  | { type: "input"; value: number }
  /** OS card (os-host.ts): manifest and bindings are JSON text, source is assembly. */
  | { type: "os-load"; manifest: string; source: string; bindings: string }
  /** Loads the OS first when `load` is given and no OS is active; then runs the plugin clock. */
  | { type: "os-run"; tps?: number; load?: { manifest: string; source: string; bindings: string } }
  /** A keymap event: a click on a named layer or a key (KeyboardEvent.key). */
  | { type: "os-event"; event: { type: "click"; node: string } | { type: "key"; key: string } }
  /** Creates the layers the loaded OS's bindings name, in a frame "OS demo" beside the CPU. */
  | { type: "os-demo" }
  /** Live view card (live-card.ts): the Live dashboard + its Present-mode frames, after Compile. */
  | { type: "live" };

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
  | { type: "verify"; ok: boolean; text: string }
  | { type: "os"; report: OsReport }
  | { type: "live"; stats: LiveStats };

/** Result of Build Live view. */
export interface LiveStats {
  /** Layers in the Live · Dashboard component. */
  layers: number;
  /** Lit layers bound to CPU / control variables, and nets the dashboard names that have no variable. */
  bound: number;
  unbound: number;
  /** Layer names whose net is not in the circuit. */
  unknown: number;
  /** Text layers bound to STRING variables (tick, phase, program, listing). */
  texts: number;
  /** Magnifier instances, and the gates they light. */
  magnifiers: number;
  magnifierGates: number;
  /** The controls were wired (lane L2's wireLive); otherwise `note` says why not. */
  wired: boolean;
  note?: string;
  /** The Live frames (Present mode: flow "FigmaCPU Live"). */
  frames: string[];
  disks: number;
  padCells: number;
  eventsPerTick?: number;
  ms: number;
}

/** One binding, as the OS card lists it. */
export interface OsBindingRow {
  node: string;
  prop: string;
  /** e.g. "RAM[12].0–6". */
  ram: string;
  /** e.g. "×24 + 40" or 'table ["closed","open"]'; "" without a map. */
  map: string;
}

/** Result of Load OS: loader / bindings messages verbatim, the region map and the bindings. */
export interface OsReport {
  /** No errors. */
  ok: boolean;
  /** The bytes went through Load program and the bindings are live. */
  loaded: boolean;
  name: string;
  /** "error [code] message" lines, exactly as the loader / bindings validator wrote them. */
  errors: string[];
  warnings: string[];
  regions: Array<{ name: string; start: number; end: number; kind: string }>;
  bytes: number[];
  bindings: OsBindingRow[];
  keymap: { click: Record<string, number>; key: Record<string, number> };
}
