// Messages between the Figma OS panel (ui) and the plugin (main).
export type ToMain = { type: "editor" };

export type ToUi =
  | { type: "log"; level: "info" | "ok" | "error"; text: string }
  | { type: "busy"; what: string | null }
  | { type: "progress"; done: number; total: number; label: string };
