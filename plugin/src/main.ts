// Plugin main thread. LANE: engine owns this file (bind -> table parse -> stepper -> render).
// Scaffold only: opens the UI and reports which contract nodes are missing.
import { N, requiredNames } from "./contracts/nodes";
import type { ToMain, ToUi } from "./contracts/messages";

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });
const post = (m: ToUi) => figma.ui.postMessage(m);

async function bindReport() {
  const page = figma.root.children.find((p) => p.name === N.page);
  if (!page) {
    post({ type: "log", text: `Page "${N.page}" not found. Run tools/draw-machine first.` });
    return;
  }
  await page.loadAsync();
  const have = new Set<string>();
  page.findAll((n) => (have.add(n.name), false));
  const need = requiredNames();
  const missing = need.filter((n) => !have.has(n));
  post({ type: "bind-report", missing, found: need.length - missing.length });
}

figma.ui.onmessage = (m: ToMain) => {
  if (m.type === "ready") void bindReport();
};
