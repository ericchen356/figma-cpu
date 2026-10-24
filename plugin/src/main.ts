// Plugin main thread. LANE: engine. bind -> read table LIVE from canvas -> step -> render -> screen.
// SAFETY: writes to the canvas only happen on the plugin team's test page; on "Machine v2" everything is read-only.
import { N, requiredNames } from "./contracts/nodes";
import type { ToMain, ToUi } from "./contracts/messages";
import { MEM, PALETTE } from "./contracts/spec";
import { readTable, toTree, findByName } from "./engine/table";
import { createCpu, type Cpu } from "./engine/cpu";
import { Renderer } from "./engine/render";
import { Runner } from "./engine/runner";
import { FigmaPort } from "./engine/figma-port";
import { Io } from "./screen/io";
import { ScreenPresenter } from "./screen/present";
import { vramToPng } from "./screen/png";

const SCALE = 6;
figma.showUI(__html__, { width: 420, height: 640, themeColors: true });
const post = (m: ToUi) => figma.ui.postMessage(m);
const log = (text: string) => post({ type: "log", text });

interface Session { page: PageNode; port: FigmaPort; cpu: Cpu; io: Io; renderer: Renderer; runner: Runner; presenter: ScreenPresenter }
let S: Session | null = null;

/** Prefer the plugin-team sandbox page; fall back to the canvas team's page (read-only). */
function findMachinePage(): PageNode | undefined {
  const pages = figma.root.children;
  return pages.find((p) => p.name === N.testPage) ?? pages.find((p) => p.name === N.page);
}

/** Re-read the opcode table from the canvas (it may have been edited). Returns false if it is unusable. */
function refreshTable(s: Session): boolean {
  const tableNode = s.page.findOne((n) => n.name === N.decoderTable);
  if (!tableNode) { log(`table node "${N.decoderTable}" not found`); return false; }
  const t = readTable(findByName(toTree(tableNode), N.decoderTable)!);
  s.cpu.setTable(t.rows);
  log(`opcode table: ${t.rows.length} valid rows read from the canvas, ${t.problems.length} problem(s)`);
  t.problems.forEach((p) => log(`  ! ${p}`));
  return t.rows.length > 0;
}

function pushState(s: Session) { post({ type: "state", state: JSON.parse(JSON.stringify(s.cpu.state)) }); }

async function bind() {
  const page = findMachinePage();
  if (!page) return log(`No page "${N.testPage}" or "${N.page}". Run tools/clone-test-page first.`);
  await page.loadAsync();
  const have = new Set<string>();
  page.findAll((n) => (have.add(n.name), false));
  const need = requiredNames();
  const missing = need.filter((n) => !have.has(n));
  post({ type: "bind-report", missing, found: need.length - missing.length });

  const writable = page.name === N.testPage;
  log(writable
    ? `bound to "${page.name}" (writable test page)`
    : `bound to "${page.name}": READ-ONLY. Nothing will be written. Run tools/clone-test-page to get a safe test page.`);
  const port = new FigmaPort(page, { loadFontAsync: (f) => figma.loadFontAsync(f), createImage: (b) => figma.createImage(b) }, writable);
  const io = new Io();
  const cpu = createCpu([], { read: (a) => io.read(a), write: (a, v) => io.write(a, v) });
  const renderer = new Renderer(port);
  const presenter = new ScreenPresenter(
    async (vram) => vramToPng(vram, SCALE, PALETTE),
    (png) => void port.applyScreen(png),
  );
  const vram = () => cpu.mem.subarray(MEM.vramStart, MEM.vramStart + MEM.vramW * MEM.vramH);
  const draw = (info: Parameters<Renderer["render"]>[2]) => {
    renderer.render(cpu.state, cpu.mem, info, {
      TICK: io.read(MEM.io.TICK), MOUSE_X: io.read(MEM.io.MOUSE_X), MOUSE_Y: io.read(MEM.io.MOUSE_Y),
      MOUSE_BTN: io.read(MEM.io.MOUSE_BTN), KEY: io.read(MEM.io.KEY),
    });
    void port.flush();
  };
  const runner = new Runner({
    cpu,
    onStep: (info) => { draw(info); pushState(S!); },
    onFrame: () => { io.tickFrame(); presenter.present(vram()); },
    onStop: (why) => { log(`stopped: ${why}`); pushState(S!); },
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as number),
    now: () => Date.now(),
  });
  S = { page, port, cpu, io, renderer, runner, presenter };
  if (!refreshTable(S)) return;
  draw(null);
  pushState(S);
}

figma.ui.onmessage = (m: ToMain) => {
  if (m.type === "ready") return void bind();
  const s = S;
  if (!s) return log("not bound yet");
  switch (m.type) {
    case "load":
      s.runner.pause(false);
      refreshTable(s); // the canvas table is the program's CPU: re-read on every load
      s.cpu.reset();
      s.cpu.mem.fill(0);
      s.cpu.load(m.bytes, m.origin);
      s.cpu.state.pc = m.origin;
      s.renderer.invalidate();
      s.presenter.present(s.cpu.mem.subarray(MEM.vramStart, MEM.vramStart + 12288), true);
      void s.port.flush();
      s.renderer.render(s.cpu.state, s.cpu.mem, null);
      void s.port.flush();
      pushState(s);
      log(`loaded ${m.bytes.length} bytes at 0x${m.origin.toString(16)}`);
      break;
    case "step": s.runner.pause(false); s.runner.stepOnce(); break;
    case "run": refreshTable(s); s.runner.start(m.mode, m.hz); break;
    case "pause": s.runner.pause(); break;
    case "reset": s.runner.pause(false); s.cpu.reset(); s.renderer.invalidate(); s.renderer.render(s.cpu.state, s.cpu.mem, null); void s.port.flush(); pushState(s); break;
    case "input":
      if (m.mouseX !== undefined || m.mouseY !== undefined || m.mouseBtn !== undefined)
        s.io.setMouse(m.mouseX ?? s.io.read(MEM.io.MOUSE_X)!, m.mouseY ?? s.io.read(MEM.io.MOUSE_Y)!, m.mouseBtn ?? (s.io.read(MEM.io.MOUSE_BTN) as 0 | 1));
      if (m.key !== undefined) s.io.setKey(m.key);
      break;
  }
};
