// The "Leila's CPU" extension's plugin (Figma's sandbox): a panel with Add and Remove. Add puts the
// silicon CPU and its Live dashboard into the live frame's CPU tab (livetab/src/patch.ts); nothing
// here runs in Present.
import { PROGRAMS } from "../../../src/isa";
import { addLiveTab, DEFAULT_PROGRAM, findLive, removeLiveTab } from "../../src/patch";

figma.showUI(__html__, { width: 360, height: 440, title: "Figma OS · Leila's CPU" });

type ToUi =
  | { type: "log"; level: "info" | "ok" | "error"; text: string }
  | { type: "busy"; on: boolean }
  | { type: "programs"; names: string[]; selected: string };
const post = (m: ToUi) => figma.ui.postMessage(m);
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
post({ type: "programs", names: Object.keys(PROGRAMS), selected: DEFAULT_PROGRAM });

figma.ui.onmessage = async (msg: { type: "add" | "remove"; program?: string }) => {
  post({ type: "busy", on: true });
  try {
    if (msg.type === "add") {
      const t0 = Date.now();
      const r = await addLiveTab(figma, { program: msg.program, breathe, log: (text) => post({ type: "log", level: "info", text }) });
      if (r.problems.length)
        post({ type: "log", level: "error", text: `${r.problems.length} things Figma refused, e.g. ${r.problems.slice(0, 4).join("; ")}` });
      post({
        type: "log",
        level: "ok",
        text: `Added in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${r.variables} variables, ${r.chunks} events per tick. ▶ Present, open the CPU tab, then Step or Run.`,
      });
      const where = await findLive(figma);
      if (where) figma.viewport.scrollAndZoomIntoView([where.frame]);
    } else {
      const n = await removeLiveTab(figma);
      post({ type: "log", level: "ok", text: `Removed: ${n} nodes and the "Leila CPU" variables.` });
    }
  } catch (e) {
    post({ type: "log", level: "error", text: e instanceof Error ? e.message : String(e) });
  } finally {
    post({ type: "busy", on: false });
  }
};
