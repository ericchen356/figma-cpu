// The Figma OS builder: puts every screen of os-ui into the document, captured from the running app
// (osui/capture → osui/data/screens.json), on a page named "Figma OS". Build time only: nothing here
// runs when the file is used.
import data from "../../data/screens.json";
import parts from "../../data/parts.json";
import { buildLive } from "../../src/live/build";
import type { CaptureData } from "../../src/live/screen";
import { liveSelfTest } from "../../src/live/selftest";
import {
  Fonts,
  type ScreensFile,
  buildLayers,
  screenLayers,
  textStyles,
} from "../../src/layers";
import type { ToMain, ToUi } from "./messages";

export const PAGE = "Figma OS";
/** Every screen frame is named `${SCREEN_PREFIX}${title}`. */
export const SCREEN_PREFIX = "os-ui · ";
const COLUMNS = 6;
const GAP = 240;

export const SCREENS = data as unknown as ScreensFile;

export interface AppOptions {
  /** Hands control back to Figma between chunks of work (a long run drops its server connection). */
  yield?: () => Promise<void>;
}

export class OsuiApp {
  private breathe: () => Promise<void>;
  constructor(
    private api: PluginAPI,
    private post: (m: ToUi) => void,
    opts: AppOptions = {},
  ) {
    this.breathe = opts.yield ?? (() => new Promise((r) => setTimeout(r, 0)));
  }

  async handle(msg: ToMain): Promise<void> {
    this.post({ type: "busy", what: msg.type });
    try {
      if (msg.type === "editor") await this.screens();
      if (msg.type === "live") await this.live(msg.budget);
      if (msg.type === "selftest") await this.selftest(msg.events, msg.seed);
    } catch (e) {
      this.post({
        type: "log",
        level: "error",
        text:
          e instanceof Error
            ? `${e.message}${e.stack ? `\n${e.stack.split("\n").slice(0, 6).join("\n")}` : ""}`
            : String(e),
      });
    } finally {
      this.post({ type: "busy", what: null });
    }
  }

  /** The live OS: the Default screen bound to the gate-level chip, on the "Figma OS" page. */
  async live(budget: number): Promise<void> {
    const page = await this.page();
    await this.api.setCurrentPageAsync(page);
    const t0 = Date.now();
    const { frame, stats } = await buildLive(
      this.api,
      page,
      { screens: SCREENS, parts: parts as unknown as CaptureData["parts"] },
      {
        budget,
        breathe: this.breathe,
        log: (text) => this.post({ type: "log", level: "info", text }),
        progress: (done, total, label) =>
          this.post({ type: "progress", done, total, label }),
      },
    );
    if (stats.problems.length)
      this.post({
        type: "log",
        level: "error",
        text: `${stats.problems.length} layer properties Figma refused (each layer kept the rest), e.g. ${stats.problems.slice(0, 3).join("; ")}`,
      });
    this.post({
      type: "log",
      level: "ok",
      text: `live OS built in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${stats.gates} gates, ${stats.variables} variables, ${stats.runs} control reactions (${stats.storedActions} stored actions, longest event ${stats.longestEvent}), ${stats.overlays} overlays, ${stats.layers} layers. ▶ Present the flow "Figma OS (gate-level CPU)".`,
    });
    this.api.viewport.scrollAndZoomIntoView([frame]);
  }

  async selftest(events: number, seed: number): Promise<void> {
    const page = await this.page();
    const r = await liveSelfTest(this.api, page, { events, seed });
    this.post({ type: "log", level: r.ok ? "ok" : "error", text: r.text });
  }

  /** The page the OS lives on: an existing "Figma OS" page, a new one, or the current page. */
  private async page(): Promise<PageNode> {
    const found = this.api.root.children.find((p) => p.name === PAGE);
    if (found) {
      await found.loadAsync();
      return found;
    }
    try {
      const p = this.api.createPage();
      p.name = PAGE;
      return p;
    } catch {
      return this.api.currentPage;
    }
  }

  /** Every os-ui screen as captured, 1:1, each in a frame the size of the browser window it came
   * from, in a grid in capture order. A rebuild replaces the screens of the previous one. */
  async screens(): Promise<FrameNode[]> {
    const file = SCREENS;
    const page = await this.page();
    await this.api.setCurrentPageAsync(page);
    for (const n of [...page.children])
      if (n.name.startsWith(SCREEN_PREFIX)) n.remove();
    const [w, h] = file.viewport;
    const fonts = new Fonts(this.api);
    const all = file.screens.flatMap((s) => s.layers);
    const { families, weights } = textStyles(all);
    await fonts.load(families, weights);
    const frames: FrameNode[] = [];
    const problems: string[] = [];
    let layers = 0;
    for (const [i, screen] of file.screens.entries()) {
      this.post({
        type: "progress",
        done: i,
        total: file.screens.length,
        label: screen.title,
      });
      const frame = this.api.createFrame();
      frame.name = `${SCREEN_PREFIX}${screen.title}`;
      frame.resize(w, h);
      frame.clipsContent = true;
      frame.fills = [];
      frame.x = (i % COLUMNS) * (w + GAP);
      frame.y = Math.floor(i / COLUMNS) * (h + GAP);
      page.appendChild(frame);
      const before = problems.length;
      const made = await buildLayers(
        { api: this.api, breathe: this.breathe, problems },
        frame,
        screenLayers(file, screen),
        fonts,
      );
      // the first screen's refusals tell what this Figma does not take: say them at once
      if (i === 0)
        for (const p of problems.slice(before, before + 6))
          this.post({ type: "log", level: "error", text: `${screen.title}: ${p}` });
      layers += made.size;
      frames.push(frame);
      await this.breathe();
    }
    if (problems.length) {
      const kinds = new Map<string, number>();
      for (const p of problems) {
        const what = p.split(" — ")[1]?.split(":")[0] ?? p;
        kinds.set(what, (kinds.get(what) ?? 0) + 1);
      }
      this.post({
        type: "log",
        level: "error",
        text: `Figma refused ${problems.length} properties (each layer kept the rest): ${[...kinds].map(([k, n]) => `${k} ×${n}`).join(", ")}`,
      });
      console.log(problems.join("\n"));
    }
    this.post({
      type: "log",
      level: "ok",
      text: `os-ui: ${frames.length} screens, ${layers} layers, each ${w} × ${h}, on the page "${page.name}"`,
    });
    this.api.viewport.scrollAndZoomIntoView(frames.slice(0, 1));
    return frames;
  }
}
