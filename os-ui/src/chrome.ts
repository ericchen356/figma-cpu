// The Figma editor's chrome as data: nav rail, toolbar groups, menus, icons. view.ts renders these
// specs and main.ts runs their commands, so adding a menu item or a tool is one entry here, not a
// layout change. An entry is live when it carries a `cmd` / `tool`; anything else is drawn dimmed,
// like Figma's own features this OS does not have. The document model is not touched.
import type { Tool } from "./model";

import { I, svg } from "./icons";
export { I, svg };

// ---- Left nav rail (Figma's File / Assets / Tools switcher)
export type LeftTab = "file" | "assets" | "tools";
export const RAIL: { id: LeftTab; label: string; icon: string }[] = [
  { id: "file", label: "File", icon: I.file },
  { id: "assets", label: "Assets", icon: I.assets },
  { id: "tools", label: "Tools", icon: I.tools },
];

/** Keyboard reference shown in the Tools panel. */
export const SHORTCUTS: [string, string][] = [
  ["V / H / K", "Move / Hand / Scale"],
  ["F / ⇧S / S", "Frame / Section / Slice"],
  ["R / L / ⇧L / O", "Rectangle / Line / Arrow / Ellipse"],
  ["P / ⇧P / E", "Pen / Pencil / Eraser"],
  ["T / C", "Text / Comment"],
  ["Enter", "Finish a Pen line"],
  ["Double-click", "Edit text or a comment"],
  ["Space + drag", "Pan"],
  ["⌘ + scroll", "Zoom"],
  ["+ / − / 0", "Zoom in / out / fit"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["⌘X / ⌘C / ⌘V", "Cut / copy / paste"],
  ["⌘D", "Duplicate"],
  ["] / [", "Bring forward / send backward"],
  ["⌫", "Delete"],
  ["Esc", "Deselect"],
  ["← →", "Previous / next frame while presenting"],
  ["⌘K", "Actions"],
  ["⌘\\", "Minimize UI"],
];

// ---- Toolbar: each group is one button plus a caret that opens a flyout of its tools
export interface ToolItem {
  id: string;
  label: string;
  key?: string;
  icon: string;
  /** Present when picking the item switches to a tool. */
  tool?: Tool;
  /** Present when picking the item runs a command instead (Place image). */
  cmd?: string;
}
export interface ToolGroup {
  id: string;
  title: string;
  items: ToolItem[];
}
export const TOOLBAR: ToolGroup[] = [
  {
    id: "move",
    title: "Move tools",
    items: [
      { id: "move", label: "Move", key: "V", icon: I.move, tool: "move" },
      { id: "hand", label: "Hand tool", key: "H", icon: I.hand, tool: "hand" },
      { id: "scale", label: "Scale", key: "K", icon: I.scale, tool: "scale" },
    ],
  },
  {
    id: "region",
    title: "Region tools",
    items: [
      { id: "frame", label: "Frame", key: "F", icon: I.frame, tool: "frame" },
      {
        id: "section",
        label: "Section",
        key: "⇧S",
        icon: I.section,
        tool: "section",
      },
      { id: "slice", label: "Slice", key: "S", icon: I.slice, tool: "slice" },
    ],
  },
  {
    id: "shape",
    title: "Shape tools",
    items: [
      { id: "rect", label: "Rectangle", key: "R", icon: I.rect, tool: "rect" },
      { id: "line", label: "Line", key: "L", icon: I.line, tool: "line" },
      { id: "arrow", label: "Arrow", key: "⇧L", icon: I.arrow, tool: "arrow" },
      {
        id: "ellipse",
        label: "Ellipse",
        key: "O",
        icon: I.ellipse,
        tool: "ellipse",
      },
      { id: "polygon", label: "Polygon", icon: I.polygon, tool: "polygon" },
      { id: "star", label: "Star", icon: I.star, tool: "star" },
      { id: "image", label: "Image…", key: "⇧⌘K", icon: I.image, cmd: "image" },
    ],
  },
  {
    id: "creation",
    title: "Creation tools",
    items: [
      { id: "pen", label: "Pen", key: "P", icon: I.pen, tool: "pen" },
      {
        id: "pencil",
        label: "Pencil",
        key: "⇧P",
        icon: I.pencil,
        tool: "paint",
      },
      { id: "erase", label: "Eraser", key: "E", icon: I.erase, tool: "erase" },
    ],
  },
  {
    id: "text",
    title: "Type tools",
    items: [
      { id: "text", label: "Text", key: "T", icon: I.text, tool: "text" },
    ],
  },
  {
    id: "comment",
    title: "Comment tools",
    items: [
      {
        id: "comment",
        label: "Comment",
        key: "C",
        icon: I.comment,
        tool: "comment",
      },
    ],
  },
];

/** The item a group's button shows: the last tool picked from it, else its first (as the real toolbar does). */
export function shownItem(
  g: ToolGroup,
  picked: Record<string, string>,
): ToolItem {
  return g.items.find((i) => i.id === picked[g.id] && i.tool) ?? g.items[0];
}

/** The mode switcher at the right of the toolbar. */
export type Mode = "design" | "dev" | "draw";
export const MODES: {
  id: string;
  label: string;
  icon: string;
  live: boolean;
}[] = [
  { id: "draw", label: "Draw", icon: I.modeDraw, live: true },
  { id: "design", label: "Design", icon: I.modeDesign, live: true },
  { id: "motion", label: "Motion", icon: I.modeMotion, live: false },
  { id: "dev", label: "Dev Mode", icon: I.modeDev, live: true },
];

// ---- Menus. `cmd` runs in main.ts; `sub` opens another menu; neither means "not in this OS".
export interface MenuItem {
  label: string;
  cmd?: string;
  hint?: string;
  sub?: string;
  check?: boolean;
  divider?: boolean;
}
const D: MenuItem = { label: "", divider: true };

export const MENUS: Record<string, MenuItem[]> = {
  main: [
    { label: "Actions…", cmd: "palette", hint: "⌘K" },
    D,
    { label: "File", sub: "file" },
    { label: "Edit", sub: "edit" },
    { label: "View", sub: "view" },
    { label: "Object", sub: "object" },
    { label: "Text", sub: "text" },
    { label: "Arrange", sub: "arrange" },
    { label: "Vector", sub: "vector" },
    { label: "Plugins" },
    { label: "Widgets" },
    D,
    { label: "Preferences" },
    { label: "Libraries" },
    D,
    { label: "Help and account", sub: "help" },
  ],
  file: [
    { label: "New file", cmd: "new" },
    { label: "Place image…", cmd: "image", hint: "⇧⌘K" },
    D,
    { label: "Export…", cmd: "export" },
    { label: "Share…", cmd: "share" },
    { label: "Present", cmd: "present" },
    D,
    { label: "Rename file", cmd: "rename" },
  ],
  edit: [
    { label: "Undo", cmd: "undo", hint: "⌘Z" },
    { label: "Redo", cmd: "redo", hint: "⇧⌘Z" },
    D,
    { label: "Cut", cmd: "cut", hint: "⌘X" },
    { label: "Copy", cmd: "copy", hint: "⌘C" },
    { label: "Paste", cmd: "paste", hint: "⌘V" },
    D,
    { label: "Duplicate", cmd: "duplicate", hint: "⌘D" },
    { label: "Delete", cmd: "delete", hint: "⌫" },
    { label: "Deselect", cmd: "deselect", hint: "Esc" },
  ],
  view: [
    { label: "Zoom in", cmd: "zoom-in", hint: "+" },
    { label: "Zoom out", cmd: "zoom-out", hint: "−" },
    { label: "Zoom to fit", cmd: "zoom-reset", hint: "0" },
    { label: "Zoom to 100%", cmd: "zoom-to:100" },
    { label: "Zoom to 200%", cmd: "zoom-to:200" },
    { label: "Zoom to 400%", cmd: "zoom-to:400" },
    { label: "Zoom to 800%", cmd: "zoom-to:800" },
    D,
    { label: "Rulers", cmd: "toggle-rulers" },
    { label: "Pixel grid", cmd: "toggle-grid" },
    { label: "Minimize UI", cmd: "toggle-ui", hint: "⌘\\" },
  ],
  object: [
    { label: "Hide / show", cmd: "toggle-visible" },
    { label: "Rotate 90°", cmd: "rotate-90" },
    { label: "Add or remove stroke", cmd: "toggle-stroke" },
    { label: "Add or remove drop shadow", cmd: "toggle-shadow" },
  ],
  text: [
    { label: "Add text", cmd: "tool:text", hint: "T" },
    { label: "Add comment", cmd: "tool:comment", hint: "C" },
  ],
  arrange: [
    { label: "Bring forward", cmd: "forward", hint: "]" },
    { label: "Send backward", cmd: "backward", hint: "[" },
    D,
    { label: "Align left", cmd: "align:left" },
    { label: "Align horizontal centers", cmd: "align:hcenter" },
    { label: "Align right", cmd: "align:right" },
    { label: "Align top", cmd: "align:top" },
    { label: "Align vertical centers", cmd: "align:vcenter" },
    { label: "Align bottom", cmd: "align:bottom" },
  ],
  vector: [
    { label: "Pen", cmd: "tool:pen", hint: "P" },
    { label: "Pencil", cmd: "tool:paint", hint: "⇧P" },
    { label: "Eraser", cmd: "tool:erase", hint: "E" },
  ],
  help: [
    { label: "Keyboard shortcuts", cmd: "shortcuts" },
    { label: "Open in desktop app" },
  ],
  ctx: [
    { label: "Cut", cmd: "cut", hint: "⌘X" },
    { label: "Copy", cmd: "copy", hint: "⌘C" },
    { label: "Paste", cmd: "paste", hint: "⌘V" },
    D,
    { label: "Duplicate", cmd: "duplicate", hint: "⌘D" },
    { label: "Bring forward", cmd: "forward", hint: "]" },
    { label: "Send backward", cmd: "backward", hint: "[" },
    { label: "Delete", cmd: "delete", hint: "⌫" },
    D,
    { label: "Undo", cmd: "undo", hint: "⌘Z" },
    { label: "Redo", cmd: "redo", hint: "⇧⌘Z" },
  ],
  zoom: [
    { label: "Zoom in", cmd: "zoom-in", hint: "+" },
    { label: "Zoom out", cmd: "zoom-out", hint: "−" },
    { label: "Zoom to fit", cmd: "zoom-reset", hint: "0" },
    { label: "Zoom to 100%", cmd: "zoom-to:100" },
    { label: "Zoom to 200%", cmd: "zoom-to:200" },
    { label: "Zoom to 400%", cmd: "zoom-to:400" },
    { label: "Zoom to 800%", cmd: "zoom-to:800" },
    D,
    { label: "Rulers", cmd: "toggle-rulers" },
    { label: "Pixel grid", cmd: "toggle-grid" },
  ],
  user: [
    { label: "Rename file", cmd: "rename" },
    { label: "Share…", cmd: "share" },
  ],
};

/** A toolbar item's command: switch to its tool, or run its own command. */
const commandOf = (i: ToolItem) => (i.tool ? `tool:${i.tool}` : i.cmd);

/** A toolbar group's flyout, built from its tools; `current` is the active tool (gets the check). */
export function flyoutItems(g: ToolGroup, current: Tool): MenuItem[] {
  return g.items.map((i) => ({
    label: i.label,
    hint: i.key,
    cmd: commandOf(i),
    check: !!i.tool && i.tool === current,
  }));
}

export function menuHtml(items: MenuItem[]): string {
  return items
    .map((i, n) => {
      if (i.divider) return `<div class="mi-sep"></div>`;
      const live = i.cmd || i.sub;
      const cls = `mi${live ? "" : " dis"}${i.check ? " checked" : ""}`;
      const attrs = i.cmd
        ? ` data-cmd="${i.cmd}"`
        : i.sub
          ? ` data-sub="${i.sub}"`
          : "";
      const lead = `<span class="mi-check">${i.check ? I.check : ""}</span>`;
      const tail = i.sub
        ? `<span class="hint">${I.chevRight}</span>`
        : `<span class="hint">${i.hint ?? ""}</span>`;
      return `<div class="${cls}" data-i="${n}"${attrs}>${lead}<span class="mi-label">${i.label}</span>${tail}</div>`;
    })
    .join("");
}

/** Every command a user can reach, flattened for the ⌘K Actions palette. */
export function paletteCommands(): {
  cmd: string;
  label: string;
  hint?: string;
}[] {
  const out: { cmd: string; label: string; hint?: string }[] = [];
  const seen = new Set<string>();
  const add = (cmd: string | undefined, label: string, hint?: string) => {
    if (!cmd || cmd === "palette" || seen.has(cmd)) return;
    seen.add(cmd);
    out.push({ cmd, label, hint });
  };
  for (const g of TOOLBAR)
    for (const i of g.items) add(commandOf(i), i.label, i.key);
  for (const key of ["file", "edit", "view", "object", "arrange", "help"])
    for (const i of MENUS[key]) add(i.cmd, i.label, i.hint);
  return out;
}
