// Wires browser events to the model and re-renders after every action.
import {
  Action,
  Corner,
  GRID_H,
  GRID_W,
  PALETTE,
  State,
  Tool,
  contentBounds,
  exportDoc,
  exportRegion,
  getSelected,
  hitTest,
  initialState,
  presentFrames,
  topFrameOf,
  update,
} from "./model";
import {
  I,
  LeftTab,
  MENUS,
  MenuItem,
  Mode,
  TOOLBAR,
  flyoutItems,
  menuHtml,
  paletteCommands,
} from "./chrome";
import { imageToCells, layerCss, nearestColor } from "./code";
import { cpu } from "./cpu";
import {
  BASE_CELL,
  cellPx,
  closeHelp,
  exportCanvas,
  groupPick,
  mode,
  pageUi,
  getCellPx,
  presentHtml,
  render,
  renderRulers,
  setLeftTab,
  setMode,
  setRightTab,
  setZoom,
  toggleUiMin,
  viewToggles,
  zoom,
} from "./view";

const root = document.getElementById("app") as HTMLElement;
const artboard = document.getElementById("artboard") as HTMLElement;

let state: State = initialState();

// Undo / redo: snapshots of the whole state, taken only when an action changes the document (not selection or tool changes).
const undoStack: State[] = [];
const redoStack: State[] = [];
let pending: State | null = null; // state before the current drag, committed on pointer up if the drag changed anything
const docChanged = (a: State, b: State) =>
  a.layers !== b.layers ||
  a.paint !== b.paint ||
  a.title !== b.title;
function remember(before: State): void {
  undoStack.push(before);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function restore(from: State[], to: State[], label: string): void {
  const prev = from.pop();
  if (!prev) return;
  to.push(state);
  state = { ...prev, tool: state.tool, drag: null, clipboard: state.clipboard };
  cpu.sync(state, label); // no chip event replaces a whole file: the CPU tab's chip loads it
  render(state, root);
}
// Dev Mode is read-only, so it cannot rewind the file either.
const undo = () => mode !== "dev" && restore(undoStack, redoStack, "Undo");
const redo = () => mode !== "dev" && restore(redoStack, undoStack, "Redo");

/** A toolbar group's button shows the last tool picked from it, whether by click, flyout or key. */
function syncGroupPick(tool: Tool): void {
  for (const g of TOOLBAR) {
    const it = g.items.find((i) => i.tool === tool);
    if (it) groupPick[g.id] = it.id;
  }
}

/** Dev Mode is read-only: a click only selects what is under it, and every edit is dropped. */
function devGuard(a: Action): Action | null {
  if (a.t === "down") return { t: "select", id: hitTest(state, a.x, a.y)?.id ?? null };
  const keep = a.t === "select" || a.t === "load" || a.t === "new" || (a.t === "key" && a.key === "Escape");
  return keep ? a : null;
}

function dispatch(action: Action): void {
  const a = mode === "dev" ? devGuard(action) : action;
  if (!a) return;
  const before = state;
  state = update(state, a);
  cpu.step(before, a, state); // the CPU tab's chip fires the same action as gate events
  if (state.tool !== before.tool) syncGroupPick(state.tool);
  if (a.t === "down") pending = before;
  else if (a.t === "up") {
    if (pending && docChanged(pending, state)) remember(pending);
    pending = null;
  } else if (
    a.t !== "move" &&
    docChanged(before, state)
  )
    remember(before);
  render(state, root);
}

// Hovering a Layers row glows that layer on the canvas (DOM only, not part of the document).
function hoverLayer(e: MouseEvent, on: boolean): void {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
  if (!row) return;
  artboard
    .querySelector(`.layer[data-lid="${row.dataset.layer}"]`)
    ?.classList.toggle("hover", on);
}
document.addEventListener("mouseover", (e) => hoverLayer(e, true));
document.addEventListener("mouseout", (e) => hoverLayer(e, false));

/** Pointer position as a cell coordinate on the artboard. */
function local(e: MouseEvent) {
  const r = artboard.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left) / getCellPx()),
    y: Math.floor((e.clientY - r.top) / getCellPx()),
  };
}

// ---- Panning: wheel / trackpad scroll, Hand tool, Space+drag or middle button. View only, not part of the document.
const canvas = document.querySelector(".canvas") as HTMLElement;
let pan = { x: 0, y: 0 };
let space = false;
let panning: { px: number; py: number; x: number; y: number } | null = null;
function setPan(x: number, y: number): void {
  pan = { x, y };
  canvas.style.setProperty("--px", `${x}px`);
  canvas.style.setProperty("--py", `${y}px`);
  renderRulers(state, root, pan);
}
/** Percent as Figma states it: monitor pixels per screen pixel of the OS, and one cell is 8 of those. */
const zoomToPercent = (percent: number) => zoomAt((percent / 100 * 8) / BASE_CELL);

/** The OS screen's 14 x 10 window, centred in the visible canvas, as the view when nothing is drawn yet. */
function centerOrigin(): void {
  const cell = cellPx();
  setPan(canvas.clientWidth / 2 - 100 - (GRID_W / 2) * cell, (canvas.clientHeight - 80) / 2 - 76 - (GRID_H / 2) * cell);
}

/** Zoom to fit: everything on the canvas, centred; an empty canvas goes back to the default view. */
function zoomFit(): void {
  const b = contentBounds(state);
  setZoom(1);
  if (b) {
    const w = canvas.clientWidth - 20 - 160;
    const h = canvas.clientHeight - 20 - 80 - 80;
    const cell = Math.min(w / b.w, h / b.h);
    setZoom(cell / BASE_CELL);
    const c = Math.round(BASE_CELL * zoom);
    setPan(
      20 + 80 + w / 2 - 100 - (b.x + b.w / 2) * c,
      20 + h / 2 + 40 - 76 - (b.y + b.h / 2) * c,
    );
    return render(state, root);
  }
  render(state, root);
  centerOrigin();
}

/** Zooms keeping the point under (cx, cy) fixed; no point means the middle of the canvas. */
function zoomAt(z: number, cx?: number, cy?: number): void {
  const r = canvas.getBoundingClientRect();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  const before = zoom;
  setZoom(z);
  const k = zoom / before;
  // The artboard's origin is (100 + pan.x, 76 + pan.y) in canvas coordinates.
  setPan(px - (px - 100 - pan.x) * k - 100, py - (py - 76 - pan.y) * k - 76);
  render(state, root);
}
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey)
      zoomAt(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else setPan(pan.x - e.deltaX, pan.y - e.deltaY);
  },
  { passive: false },
);
function startPan(e: PointerEvent): void {
  e.preventDefault();
  panning = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
  canvas.classList.add("panning");
}
/** Every pointer press on the canvas, wherever it lands: the canvas has no edge to stay inside. */
canvas.addEventListener("pointerdown", (e) => {
  const t = e.target as HTMLElement;
  // The rulers, the toolbar and the text field are controls of their own, not canvas cells.
  if (t.closest(".toolbar, .restore-ui, .ruler-x, .ruler-y, .text-edit")) return;
  if (space || e.button === 1 || state.tool === "hand") return startPan(e);
  if (t.closest(".frame-name")) return; // a click on a frame's name selects the frame
  const handle = t.closest<HTMLElement>("[data-handle]");
  const at = local(e);
  const bare = !handle && (state.tool === "move" || state.tool === "scale") && !hitTest(state, at.x, at.y);
  dispatch({ t: "down", ...at, handle: handle?.dataset.handle as Corner | undefined });
  // There is no marquee yet, so dragging bare canvas with the Move tool pans it.
  if (bare) startPan(e);
});
window.addEventListener("pointermove", (e) => {
  if (panning)
    setPan(
      panning.x + e.clientX - panning.px,
      panning.y + e.clientY - panning.py,
    );
});
window.addEventListener("pointerup", () => {
  panning = null;
  canvas.classList.remove("panning");
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    space = false;
    canvas.classList.remove("space");
  }
});

// ---- Inline rename (file title, layer and frame names): click the title or double-click a name.
function rename(el: HTMLElement): void {
  const kind = el.dataset.rename as "title" | "layer";
  const id = Number(el.dataset.id);
  const name = el.querySelector<HTMLElement>(".name") ?? el;
  const old = name.textContent ?? "";
  const input = document.createElement("input");
  input.value = old;
  input.className = "rename";
  name.textContent = "";
  name.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (ok: boolean) => {
    if (done) return;
    done = true;
    const v = input.value;
    if (ok && v.trim())
      dispatch(
        kind === "title" ? { t: "title", name: v } : { t: "layer-rename", id, name: v },
      );
    else render(state, root);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit(true);
    if (e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
}
document
  .getElementById("title")!
  .addEventListener("click", (e) => rename(e.currentTarget as HTMLElement));
// Panel rows are redrawn on every click, so the browser never sees a "dblclick" on them: detect it by hand.
let lastRow = { key: "", t: 0 };
function exportImage(): void {
  const region = exportRegion(state);
  const jpg = pageUi.fmt === "jpg";
  exportCanvas(state, pageUi.scale, region).toBlob(
    (b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${region?.name ?? state.title}${pageUi.suffix}${pageUi.scale > 1 ? `@${pageUi.scale}x` : ""}.${pageUi.fmt}`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    jpg ? "image/jpeg" : "image/png",
    0.92,
  );
}

root.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-rename="layer"]',
  );
  if (!row || (e.target as HTMLElement).closest(".vis, input")) return;
  const key = `${row.dataset.rename}${row.dataset.id}`;
  const dbl = key === lastRow.key && e.timeStamp - lastRow.t < 500;
  lastRow = { key: dbl ? "" : key, t: e.timeStamp };
  if (dbl) {
    // After the click handler below has redrawn the panel.
    setTimeout(() => {
      const fresh = root.querySelector<HTMLElement>(
        `[data-rename="${row.dataset.rename}"][data-id="${row.dataset.id}"]`,
      );
      if (fresh) rename(fresh);
    }, 0);
  }
});
// Double-clicking text or a comment on the canvas types into it again.
root.addEventListener("dblclick", (e) => {
  const t = e.target as HTMLElement;
  if (!artboard.contains(t) || t.closest(".frame-name, .text-edit")) return;
  const at = local(e);
  const hit = hitTest(state, at.x, at.y);
  if (hit && (hit.kind === "text" || hit.kind === "comment")) dispatch({ t: "edit", id: hit.id });
});

// ---- Share: a link that opens the file view-only (the document travels in the URL hash).
const shareBox = document.getElementById("share") as HTMLElement;
const shareLink = document.getElementById("share-link") as HTMLInputElement;
const shareFrame = document.getElementById("share-frame") as HTMLIFrameElement;
const shareMsg = document.getElementById("share-msg") as HTMLElement;
const encodeDoc = (s: State) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(exportDoc(s)))));
const decodeDoc = (b64: string) =>
  JSON.parse(decodeURIComponent(escape(atob(b64))));
function openShare(): void {
  const link = `${location.origin}${location.pathname}#share=${encodeDoc(state)}`;
  shareLink.value = link;
  shareFrame.src = "about:blank";
  shareFrame.src = link;
  shareMsg.textContent = "";
  shareBox.hidden = false;
}
document.querySelector(".btn-share")!.addEventListener("click", openShare);
document
  .getElementById("share-close")!
  .addEventListener("click", () => (shareBox.hidden = true));
document.getElementById("share-copy")!.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    shareMsg.textContent = "Link copied.";
  } catch {
    shareLink.select();
    shareMsg.textContent = "Press ⌘C to copy.";
  }
});
shareLink.addEventListener("focus", () => shareLink.select());

window.addEventListener("pointermove", (e) => {
  if (state.drag) dispatch({ t: "move", ...local(e) });
});
window.addEventListener("pointerup", () => {
  if (state.drag) dispatch({ t: "up" });
});

root.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const tool = el.closest<HTMLElement>(".tool[data-tool]");
  const vis = el.closest<HTMLElement>("[data-visible]");
  const layer = el.closest<HTMLElement>("[data-layer]");
  const fill = el.closest<HTMLElement>("[data-fill]");
  const align = el.closest<HTMLElement>("[data-align]");
  const rail = el.closest<HTMLElement>("[data-rail]");
  if (rail)
    return (setLeftTab(rail.dataset.rail as LeftTab), render(state, root));
  if (el.closest("[data-export]")) return exportImage();
  if (el.closest("[data-preview]"))
    return ((pageUi.preview = !pageUi.preview), render(state, root));
  const help = el.closest<HTMLElement>("[data-close-help]");
  if (help) (closeHelp(help.dataset.closeHelp as string), render(state, root));
  else if (align) dispatch({ t: "align", to: align.dataset.align as never });
  else if (tool) dispatch({ t: "tool", tool: tool.dataset.tool as never });
  else if (vis) dispatch({ t: "visible", id: Number(vis.dataset.visible) });
  else if (layer) dispatch({ t: "select", id: Number(layer.dataset.layer) });
  else if (fill) dispatch({ t: "fill", color: fill.dataset.fill as string });
});

// Inputs commit on change (Enter or blur) so typing is not interrupted by re-rendering.
root.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const prop = input.dataset.prop;
  if (prop) dispatch({ t: "prop", prop: prop as never, value: input.value });
  if (input.dataset.pageColor !== undefined) {
    const hex = input.value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) pageUi.color = hex.toUpperCase();
    render(state, root);
  }
  if (input.dataset.pageExports !== undefined) {
    pageUi.showInExports = input.checked;
    render(state, root);
  }
  if (input.dataset.pageOpacity !== undefined) {
    const n = Number(input.value.replace("%", ""));
    if (Number.isFinite(n))
      pageUi.opacity = Math.min(100, Math.max(0, Math.round(n)));
    render(state, root);
  }
  if (input.dataset.exportScale !== undefined)
    pageUi.scale = Number(input.value);
  if (input.dataset.exportFmt !== undefined)
    pageUi.fmt = input.value as "png" | "jpg";
});

// Right-click on the canvas: select what is under the pointer (the pointerdown already did) and offer layer actions, like Figma.
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const at = {
    getBoundingClientRect: () => ({ bottom: e.clientY, left: e.clientX }),
  } as unknown as HTMLElement;
  menu.dataset.for = "ctx";
  openMenu("ctx", at);
});
window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return void openPalette();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
    e.preventDefault();
    return void runCmd("toggle-ui");
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return void (e.shiftKey ? redo() : undo());
  }
  if ((e.key === "+" || e.key === "=") && !e.metaKey && !e.ctrlKey)
    return void zoomAt(zoom * 1.25);
  if (e.key === "-" && !e.metaKey && !e.ctrlKey) return void zoomAt(zoom * 0.8);
  if (e.key === "0" && !e.metaKey && !e.ctrlKey) return void zoomFit();
  if (e.key === " ") {
    e.preventDefault();
    space = true;
    canvas.classList.add("space");
    return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && "dcxv".includes(key)) e.preventDefault();
  dispatch({ t: "key", key, meta, shift: e.shiftKey });
});

// Static icons in index.html are placeholders; the icon set (icons.ts) is the one source of every glyph.
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = I[el.dataset.icon as keyof typeof I] ?? "";
});

render(state, root);
centerOrigin();

window.addEventListener("resize", () => render(state, root));

// ---- Menus (rail logo = main menu, title chevron / Drafts = file menu, avatar = account,
// toolbar carets = tool flyouts), tabs, Present, hex input. Menu contents live in chrome.ts.
const menu = document.getElementById("menu") as HTMLElement;
const submenu = document.getElementById("submenu") as HTMLElement;
const presentEl = document.getElementById("present") as HTMLElement;

/** View toggles show a check while on. */
const withChecks = (i: MenuItem): MenuItem =>
  i.cmd === "toggle-rulers"
    ? { ...i, check: viewToggles.rulers }
    : i.cmd === "toggle-grid"
      ? { ...i, check: viewToggles.grid }
      : i;
function itemsFor(kind: string): MenuItem[] {
  if (kind.startsWith("fly:")) {
    const g = TOOLBAR.find((x) => x.id === kind.slice(4));
    return g ? flyoutItems(g, state.tool) : [];
  }
  return (MENUS[kind] ?? []).map(withChecks);
}
function hideMenus(): void {
  menu.hidden = true;
  submenu.hidden = true;
}
function openMenu(kind: string, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  menu.innerHTML = menuHtml(itemsFor(kind));
  submenu.hidden = true;
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 230))}px`;
  // Toolbar flyouts open upward from the pill; every other menu hangs below its trigger.
  menu.style.top = kind.startsWith("fly:")
    ? `${r.top - menu.offsetHeight - 8}px`
    : `${r.bottom + 6}px`;
}
// Hovering a row with a submenu opens it beside the row; hovering any other row closes it.
menu.addEventListener("mouseover", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".mi");
  if (!item) return;
  const key = item.dataset.sub;
  if (!key) {
    submenu.hidden = true;
    return;
  }
  const r = item.getBoundingClientRect();
  submenu.innerHTML = menuHtml((MENUS[key] ?? []).map(withChecks));
  submenu.hidden = false;
  const fitsRight = r.right + 2 + submenu.offsetWidth <= window.innerWidth;
  submenu.style.left = `${fitsRight ? r.right + 2 : r.left - submenu.offsetWidth - 2}px`;
  submenu.style.top = `${r.top - 4}px`;
});

// ---- Actions palette (⌘K): every command in the menus and toolbar, filtered as you type.
const actionsBox = document.getElementById("actions") as HTMLElement;
const actionsInput = document.getElementById(
  "actions-input",
) as HTMLInputElement;
const actionsList = document.getElementById("actions-list") as HTMLElement;
let actionsShown: ReturnType<typeof paletteCommands> = [];
let actionsSel = 0;
function renderActions(): void {
  const q = actionsInput.value.trim().toLowerCase();
  actionsShown = paletteCommands().filter((c) =>
    c.label.toLowerCase().includes(q),
  );
  actionsSel = Math.min(actionsSel, Math.max(0, actionsShown.length - 1));
  actionsList.innerHTML =
    actionsShown
      .map(
        (c, i) =>
          `<div class="mi${i === actionsSel ? " sel" : ""}" data-act="${i}"><span class="mi-label">${c.label}</span><span class="hint">${c.hint ?? ""}</span></div>`,
      )
      .join("") || `<div class="empty">No actions match.</div>`;
}
function openPalette(): void {
  hideMenus();
  actionsInput.value = "";
  actionsSel = 0;
  renderActions();
  actionsBox.hidden = false;
  actionsInput.focus();
}
function closePalette(): void {
  actionsBox.hidden = true;
}
function runAction(i: number): void {
  const c = actionsShown[i];
  if (!c) return;
  closePalette();
  runCmd(c.cmd);
}
actionsInput.addEventListener("input", () => {
  actionsSel = 0;
  renderActions();
});
actionsInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") closePalette();
  else if (e.key === "Enter") runAction(actionsSel);
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    actionsSel = Math.max(
      0,
      Math.min(
        actionsShown.length - 1,
        actionsSel + (e.key === "ArrowDown" ? 1 : -1),
      ),
    );
    renderActions();
  }
});
actionsList.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (row) runAction(Number(row.dataset.act));
});
actionsBox.addEventListener("pointerdown", (e) => {
  if (e.target === actionsBox) closePalette();
});
let viewOnly = false;
/** Which slide (top-level frame) Present is showing. */
let presentIndex = 0;
function showPresent(): void {
  presentEl.innerHTML = presentHtml(state, viewOnly, presentIndex);
}
/** Present starts at the selection's frame, or the first one. */
function openPresent(): void {
  const sel = getSelected(state);
  const top = sel && !viewOnly ? topFrameOf(state, sel) : undefined;
  presentIndex = Math.max(0, presentFrames(state).findIndex((f) => f.id === top?.id));
  showPresent();
  presentEl.hidden = false;
}
function stepPresent(by: number): void {
  const n = presentFrames(state).length;
  if (!n) return;
  presentIndex = (presentIndex + by + n) % n;
  showPresent();
}
/** Runs `fn` on the selected layer, if there is one. */
function onSelected(fn: (l: NonNullable<ReturnType<typeof getSelected>>) => void): void {
  const l = getSelected(state);
  if (l) fn(l);
}
/** The OS screen's 14 x 10 cell window, centred on what is visible. */
function viewWindow() {
  const r = canvas.getBoundingClientRect();
  const a = artboard.getBoundingClientRect();
  const cell = getCellPx();
  const cx = Math.floor((r.left + r.width / 2 - a.left) / cell);
  const cy = Math.floor((r.top + r.height / 2 - a.top) / cell);
  return { x: cx - GRID_W / 2, y: cy - GRID_H / 2, w: GRID_W, h: GRID_H };
}
/** Place image: a picture is stretched over the selected frame (or the whole canvas) and snapped to the 16 colors. */
function placeImage(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const region = exportRegion(state) ?? viewWindow();
    const bitmap = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = region.w * 8;
    c.height = region.h * 8;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    dispatch({ t: "image", cells: imageToCells(data, c.width, c.height, region) });
  });
  input.click();
}
function runCmd(cmd: string): void {
  hideMenus();
  if (cmd.startsWith("tool:"))
    dispatch({ t: "tool", tool: cmd.slice(5) as Tool });
  else if (cmd.startsWith("align:"))
    dispatch({ t: "align", to: cmd.slice(6) as never });
  else if (cmd === "cut" || cmd === "copy" || cmd === "paste")
    dispatch({ t: "key", key: { cut: "x", copy: "c", paste: "v" }[cmd], meta: true });
  else if (cmd.startsWith("zoom-to:")) zoomToPercent(Number(cmd.slice(8)));
  else if (cmd === "palette") openPalette();
  else if (cmd === "image") placeImage();
  else if (cmd === "toggle-visible") onSelected((l) => dispatch({ t: "visible", id: l.id }));
  else if (cmd === "rotate-90")
    onSelected((l) => dispatch({ t: "prop", prop: "rotation", value: String((l.rotation + 90) % 360) }));
  else if (cmd === "toggle-stroke")
    onSelected((l) => dispatch({ t: "stroke", color: l.stroke ? "" : PALETTE[0] }));
  else if (cmd === "toggle-shadow") onSelected((l) => dispatch({ t: "shadow", on: !l.shadow }));
  else if (cmd === "export") exportImage();
  else if (cmd === "deselect")
    dispatch({ t: "key", key: "Escape", meta: false });
  else if (cmd === "toggle-ui") (toggleUiMin(), render(state, root));
  else if (cmd === "toggle-rulers")
    ((viewToggles.rulers = !viewToggles.rulers), render(state, root));
  else if (cmd === "toggle-grid")
    ((viewToggles.grid = !viewToggles.grid), render(state, root));
  else if (cmd === "shortcuts") (setLeftTab("tools"), render(state, root));
  else if (cmd === "new") dispatch({ t: "new" });
  else if (cmd === "forward") dispatch({ t: "key", key: "]", meta: false });
  else if (cmd === "backward") dispatch({ t: "key", key: "[", meta: false });
  else if (cmd === "delete") dispatch({ t: "key", key: "Delete", meta: false });
  else if (cmd === "undo") undo();
  else if (cmd === "redo") redo();
  else if (cmd === "duplicate") dispatch({ t: "key", key: "d", meta: true });
  else if (cmd === "present") openPresent();
  else if (cmd === "share") openShare();
  else if (cmd === "zoom-in") zoomAt(zoom * 1.25);
  else if (cmd === "zoom-out") zoomAt(zoom * 0.8);
  else if (cmd === "zoom-reset") zoomFit();
  else if (cmd === "edit-copy") {
    viewOnly = false;
    history.replaceState(null, "", location.pathname);
    presentEl.hidden = true;
  } else if (cmd === "rename")
    rename(document.getElementById("title") as HTMLElement);
}
document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const nav = el.closest<HTMLElement>("[data-present]");
  if (nav) return stepPresent(nav.dataset.present === "next" ? 1 : -1);
  const trigger = el.closest<HTMLElement>("[data-menu]");
  const item = el.closest<HTMLElement>("[data-cmd]");
  const tab = el.closest<HTMLElement>("[data-tab]");
  if (item) runCmd(item.dataset.cmd as string);
  else if (trigger) {
    if (menu.hidden || menu.dataset.for !== trigger.dataset.menu)
      ((menu.dataset.for = trigger.dataset.menu),
        openMenu(trigger.dataset.menu as string, trigger));
    else hideMenus();
  } else if (tab) {
    setRightTab(tab.dataset.tab as "design" | "prototype");
    render(state, root);
  } else if (!el.closest("#menu, #submenu")) hideMenus();
  if (
    !viewOnly &&
    el.closest("#present") &&
    !el.closest(".present-art") &&
    !el.closest(".present-bar")
  )
    presentEl.hidden = true;
});
window.addEventListener(
  "keydown",
  (e) => {
    if (presentEl.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape" && !viewOnly) presentEl.hidden = true;
    else if (["ArrowRight", "ArrowDown", " "].includes(e.key)) stepPresent(1);
    else if (["ArrowLeft", "ArrowUp"].includes(e.key)) stepPresent(-1);
  },
  true,
);
window.addEventListener("resize", () => {
  if (!presentEl.hidden) showPresent();
});

// Opened from a share link: show the shared file view-only, the same screen the Share preview shows.
const shared = /^#share=(.+)$/.exec(location.hash);
if (shared) {
  try {
    dispatch({ t: "load", doc: decodeDoc(shared[1]) });
    viewOnly = true;
    document.title = `${state.title} — Figma OS`;
    openPresent();
  } catch {
    history.replaceState(null, "", location.pathname);
  }
}
root.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.hex === undefined) return;
  const m = /^#?([0-9a-f]{6})$/i.exec(input.value.trim());
  if (!m) return render(state, root);
  const n = parseInt(m[1], 16);
  const dist = (c: string) => {
    const k = parseInt(c.slice(1), 16);
    return (
      ((k >> 16) - (n >> 16)) ** 2 +
      (((k >> 8) & 255) - ((n >> 8) & 255)) ** 2 +
      ((k & 255) - (n & 255)) ** 2
    );
  };
  // The OS has 16 colors, so any hex snaps to the nearest palette color.
  dispatch({
    t: "fill",
    color: PALETTE.reduce((a, b) => (dist(b) < dist(a) ? b : a)),
  });
});

// ---- Panel controls added with the full tool set: modes, stroke, effects, export options, Dev Mode.
root.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const modeBtn = el.closest<HTMLElement>("[data-set-mode]");
  if (modeBtn) {
    const next = modeBtn.dataset.setMode as Mode;
    // Switch tools while edits are still allowed, then lock or unlock the file.
    setMode("design");
    dispatch({ t: "tool", tool: next === "draw" ? "paint" : "move" });
    setMode(next);
    return render(state, root);
  }
  const stroke = el.closest<HTMLElement>("[data-stroke]");
  if (stroke) return dispatch({ t: "stroke", color: stroke.dataset.stroke === "add" ? PALETTE[0] : "" });
  const strokeColor = el.closest<HTMLElement>("[data-stroke-color]");
  if (strokeColor) return dispatch({ t: "stroke", color: strokeColor.dataset.strokeColor as string });
  const shadow = el.closest<HTMLElement>("[data-shadow]");
  if (shadow) return dispatch({ t: "shadow", on: shadow.dataset.shadow === "add" });
  if (el.closest("[data-export-advanced]")) return ((pageUi.advanced = !pageUi.advanced), render(state, root));
  if (el.closest("[data-export-reset]")) {
    Object.assign(pageUi, { scale: 1, fmt: "png", suffix: "", advanced: false });
    return render(state, root);
  }
  if (el.closest("[data-copy-code]"))
    onSelected((l) => void navigator.clipboard?.writeText(layerCss(l).join("\n")));
});

root.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.strokeHex !== undefined) {
    const m = /^#?([0-9a-f]{6})$/i.exec(input.value.trim());
    if (!m) return render(state, root);
    const n = parseInt(m[1], 16);
    return dispatch({ t: "stroke", color: PALETTE[nearestColor(n >> 16, (n >> 8) & 255, n & 255)] });
  }
  if (input.dataset.textOf !== undefined)
    return dispatch({ t: "text", id: Number(input.dataset.textOf), value: input.value });
  if (input.dataset.exportSuffix !== undefined)
    pageUi.suffix = input.value.replace(/[^\w.@-]/g, "");
});

// Text and comments are typed into a field that sits on the canvas: Enter keeps it, Esc puts the old words back.
function commitText(input: HTMLInputElement, keep: boolean): void {
  const id = Number(input.dataset.edit);
  if (state.editing !== id) return;
  dispatch({ t: "text", id, value: keep ? input.value : (input.dataset.orig ?? "") });
}
root.addEventListener("keydown", (e) => {
  const input = (e.target as HTMLElement).closest<HTMLInputElement>(".text-edit");
  if (!input) return;
  e.stopPropagation();
  if (e.key === "Enter") commitText(input, true);
  else if (e.key === "Escape") commitText(input, false);
});
root.addEventListener("focusout", (e) => {
  const input = (e.target as HTMLElement).closest<HTMLInputElement>(".text-edit");
  if (input) commitText(input, true);
});
