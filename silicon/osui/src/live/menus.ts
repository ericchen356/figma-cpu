// os-ui's menus on the live screen: every captured menu state (the main menu and each of its
// submenus, the File, Zoom and account menus, the toolbar flyouts, the ⌘K actions palette) as an
// overlay the size of the screen. Clicking outside the menu closes it; an item runs its command on
// the chip, the way the editor's own button or shortcut does, and closes it; a submenu entry swaps
// in that submenu when the pointer reaches it. A command the chip has no event for (undo, zoom,
// rulers, rotation…: osflow's editor does not model them) closes the menu and does nothing, and a
// dimmed entry does nothing, as in os-ui.
import type { DisplayLines } from "../cpu/disp";
import type { Layer } from "../layers";
import { screenLayers } from "../layers";
import { ALIGNS, TOOL_NAMES } from "./catalog";
import { captured, type Act, type CaptureData, type LiveNode } from "./screen";

export const MENU_PREFIX = "menu ";

/** Menu id → the captured screen that shows it. */
export const MENU_SCREENS: Record<string, string> = {
  main: "menu-main",
  ...Object.fromEntries(
    ["file", "edit", "view", "object", "text", "arrange", "vector", "help"].map(
      (s) => [`main/${s}`, `menu-main-${s}`],
    ),
  ),
  file: "menu-file",
  zoom: "menu-zoom",
  user: "menu-user",
  ...Object.fromEntries(
    ["move", "region", "shape", "creation", "text", "comment"].map((g) => [
      `fly/${g}`,
      `fly-${g}`,
    ]),
  ),
  palette: "palette",
};

/** An os-ui command as what the live screen does: a run of the catalogue (or one per selected slot),
 * another menu, or nothing (closes the menu). */
export type Command =
  | { run: string }
  | {
      perSlot: (
        slot: number,
        s: DisplayLines["slots"][number],
      ) => Array<{
        when?: "strokeNone" | "hasStroke" | "shadow" | "shadowN";
        run: string;
      }>;
    }
  | { menu: string }
  | { none: true };

const RUNS: Record<string, string> = {
  new: "new",
  cut: "key/meta+x",
  copy: "key/meta+c",
  paste: "key/meta+v",
  duplicate: "key/meta+d",
  delete: "key/Delete",
  deselect: "select/none",
  forward: "key/]",
  backward: "key/[",
  ...Object.fromEntries(ALIGNS.map((a) => [`align:${a}`, `align/${a}`])),
  ...Object.fromEntries(TOOL_NAMES.map((t) => [`tool:${t}`, `tool/${t}`])),
};

export function command(cmd: string): Command {
  if (RUNS[cmd]) return { run: RUNS[cmd] };
  if (cmd === "palette") return { menu: "palette" };
  if (cmd === "toggle-visible")
    return { perSlot: (k) => [{ run: `eye/${k}` }] };
  if (cmd === "toggle-stroke")
    return {
      perSlot: (k) => [
        { when: "strokeNone", run: `stroke/0@${k}` },
        { when: "hasStroke", run: `stroke/none@${k}` },
      ],
    };
  if (cmd === "toggle-shadow")
    return {
      perSlot: (k) => [
        { when: "shadowN", run: `shadow/on@${k}` },
        { when: "shadow", run: `shadow/off@${k}` },
      ],
    };
  return { none: true };
}

/** The acts a layer that runs `cmd` gets, and the hot spots a per-slot command needs inside it. */
export function commandLayer(
  n: LiveNode,
  cmd: string,
  d: DisplayLines,
  size: { w: number; h: number },
): LiveNode {
  const c = command(cmd);
  if ("run" in c) return { ...n, acts: [{ on: "item", run: c.run }] };
  if ("menu" in c)
    return { ...n, acts: [{ on: "sub", menu: c.menu, click: true }] };
  if ("none" in c) return { ...n, acts: [{ on: "dismiss" }] };
  // one hot spot per selected slot (and state), picked by the slot's lines; none when nothing is
  // selected (the item then just closes the menu)
  const hit = (
    name: string,
    acts: Act[],
    p: Partial<LiveNode> = {},
  ): LiveNode => ({
    name,
    type: "frame",
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
    acts,
    ...p,
  });
  const kids: LiveNode[] = [
    hit("nothing selected", [{ on: "dismiss" }], { visible: d.noSel }),
  ];
  d.slots.forEach((s, k) => {
    const variants = c.perSlot(k, s);
    kids.push({
      name: `slot ${k}`,
      type: "frame",
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      visible: s.sel,
      children: variants.map((v) =>
        hit(v.run, [{ on: "item", run: v.run }], {
          visible:
            v.when === "strokeNone"
              ? s.strokeNone
              : v.when === "hasStroke"
                ? s.hasStroke
                : v.when === "shadow"
                  ? s.shadow.bits[0]
                  : v.when === "shadowN"
                    ? s.shadow.inv[0]
                    : undefined,
        }),
      ),
    });
  });
  return { ...n, children: [...(n.children ?? []), ...kids] };
}

const isCls = (l: Layer, cls: string) =>
  (l.dom?.cls ?? "").split(/\s+/).includes(cls);

export interface MenuOverlay {
  id: string;
  root: LiveNode;
}

/** Every menu state as an overlay frame the size of the screen. */
export function liveMenus(data: CaptureData, d: DisplayLines): MenuOverlay[] {
  const [W, H] = data.screens.viewport;
  const screen = (id: string) => {
    const s = data.screens.screens.find((x) => x.id === id);
    if (!s) throw new Error(`the capture has no screen ${id}`);
    return screenLayers(data.screens, s);
  };
  // the palette lists commands by label: what each label runs, from the menus that show it
  const byLabel = new Map<string, string>();
  for (const id of Object.values(MENU_SCREENS)) {
    if (id === "palette") continue;
    const layers = screen(id);
    for (const l of layers) {
      const cmd = l.dom?.data?.["data-cmd"];
      if (!cmd || !isCls(l, "mi")) continue;
      const label = labelOf(layers, l);
      if (label) byLabel.set(label, cmd);
    }
  }
  return Object.entries(MENU_SCREENS).map(([id, screenId]) => {
    const layers = screen(screenId);
    const roots = layers.filter((l) =>
      id === "palette"
        ? l.dom?.id === "actions"
        : l.dom?.id === "menu" || l.dom?.id === "submenu",
    );
    if (!roots.length) throw new Error(`the capture ${screenId} shows no menu`);
    const edit = (l: Layer, n: LiveNode): LiveNode => {
      if (!isCls(l, "mi") || isCls(l, "dis")) return n;
      const size = { w: l.w, h: l.h };
      const sub = l.dom?.data?.["data-sub"];
      // the submenu already open: hovering its entry again does nothing (Figma also refuses a
      // swap to the overlay itself)
      if (sub) return `main/${sub}` === id ? n : { ...n, acts: [{ on: "sub", menu: `main/${sub}` }] };
      const cmd =
        l.dom?.data?.["data-cmd"] ??
        (l.dom?.data?.["data-act"] !== undefined
          ? byLabel.get(labelOf(layers, l) ?? "")
          : undefined);
      return cmd
        ? commandLayer(n, cmd, d, size)
        : { ...n, acts: [{ on: "dismiss" }] };
    };
    const menus = roots.map((r) => {
      const n = captured(layers, r, { x: 0, y: 0 }, { edit });
      // the palette's own backdrop closes it too
      return r.dom?.id === "actions"
        ? { ...n, acts: [{ on: "dismiss" } as Act] }
        : n;
    });
    return {
      id,
      root: {
        name: `${MENU_PREFIX}${id}`,
        type: "frame",
        w: W,
        h: H,
        children: [
          // a click anywhere off the menu closes it
          {
            name: "outside",
            type: "frame",
            x: 0,
            y: 0,
            w: W,
            h: H,
            acts: [{ on: "dismiss" }],
          },
          ...menus,
        ],
      },
    };
  });
}

/** The label text of a menu item. */
function labelOf(layers: Layer[], item: Layer): string | undefined {
  const span = layers.find((l) => l.parent === item.id && isCls(l, "mi-label"));
  return (
    span &&
    layers.find((l) => l.parent === span.id && l.type === "TEXT")?.text?.chars
  );
}
