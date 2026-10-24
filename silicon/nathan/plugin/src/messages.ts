// Messages between the plugin panel (ui/ui.ts, an iframe) and the plugin code (src/main.ts,
// Figma's sandbox). Plain JSON in both directions.

/** Panel → plugin. */
export type ToMain =
  | { type: "init" }
  | { type: "hardware"; gateLabels: boolean; redraw: boolean }
  | {
      type: "os";
      latch: "auto" | "gates" | "compact";
      budget: number;
      alias: boolean;
      longKeys?: boolean;
    }
  | { type: "selftest"; events: number; seed: number }
  | { type: "platform" }
  | { type: "clean" };

export type LogLevel = "info" | "ok" | "error";

/** What the document holds right now. */
export interface DocStatus {
  /** The page CPU NATHAN lives on, if it exists. */
  page: string | null;
  /** cell/ENGINE is drawn. */
  hardware: boolean;
  /** The variables and the editor frame are built. */
  built: boolean;
}

export interface HardwareStats {
  modules: number;
  drawn: number;
  reused: number;
  gates: number;
  ms: number;
  engineSize: { w: number; h: number };
  page: string;
}

export interface OsStats {
  gates: number;
  variables: number;
  collections: number;
  reactions: number;
  /** Executed actions of the heaviest reaction (upper bound: every branch counted). */
  worstReaction: { name: string; actions: number };
  /** Layers bound to variables (gate lamps, wires, the screen). */
  bound: number;
  missing: number;
  uiLayers: number;
  ms: number;
}

export interface SelfTestResult {
  ok: boolean;
  events: number;
  text: string;
}

/** Plugin → panel. */
export type ToUi =
  | { type: "hello"; status: DocStatus }
  | { type: "status"; status: DocStatus }
  | { type: "log"; level: LogLevel; text: string }
  | { type: "busy"; task: string | null }
  | {
      type: "progress";
      task: string;
      done: number;
      total: number;
      label: string;
    }
  | { type: "hardware"; stats: HardwareStats }
  | { type: "os"; stats: OsStats }
  | { type: "selftest"; result: SelfTestResult }
  | {
      type: "platform";
      tests: Array<{ id: string; title: string; how: string }>;
    };
