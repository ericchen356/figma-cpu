// The Figma OS builder: puts os-ui's own screen into the document, captured from the running app
// (osui/capture → osui/data), on a page named "Figma OS". Build time only: nothing here runs when
// the file is used.
import empty from "../../data/empty.json";
import { type Capture, Fonts, buildLayers, textStyles } from "../../src/layers";
import type { ToMain, ToUi } from "./messages";

export const PAGE = "Figma OS";
export const EDITOR = "Figma OS · editor";

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
      if (msg.type === "editor") await this.editor();
    } catch (e) {
      this.post({
        type: "log",
        level: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.post({ type: "busy", what: null });
    }
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

  /** os-ui's screen as captured, 1:1, in a frame the size of the browser window it came from. */
  async editor(): Promise<FrameNode> {
    const capture = empty as unknown as Capture;
    const page = await this.page();
    await this.api.setCurrentPageAsync(page);
    for (const n of [...page.children]) if (n.name === EDITOR) n.remove();
    const [w, h] = capture.viewport;
    const frame = this.api.createFrame();
    frame.name = EDITOR;
    frame.resize(w, h);
    frame.clipsContent = true;
    frame.fills = [];
    page.appendChild(frame);
    const fonts = new Fonts(this.api);
    const { families, weights } = textStyles(capture.layers);
    await fonts.load(families, weights);
    const made = await buildLayers(
      { api: this.api, breathe: this.breathe },
      frame,
      capture.layers,
      fonts,
    );
    this.post({
      type: "log",
      level: "ok",
      text: `os-ui (${capture.state}): ${made.size} layers, ${w} × ${h}`,
    });
    this.api.viewport.scrollAndZoomIntoView([frame]);
    return frame;
  }
}
