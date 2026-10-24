// Plugin main thread. LANE: engine owns this file (bind -> table parse -> stepper -> render).
// Now: binds to the page, reads the opcode table LIVE from the canvas and reports problems. Stepper is still a stub.
import { N, requiredNames } from "./contracts/nodes";
import type { ToMain, ToUi } from "./contracts/messages";
import { readTable, toTree, findByName } from "./engine/table";

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });
const post = (m: ToUi) => figma.ui.postMessage(m);

/** Prefer the plugin-team sandbox page; fall back to the canvas team's page. */
function findMachinePage(): PageNode | undefined {
  const pages = figma.root.children;
  return pages.find((p) => p.name === N.testPage) ?? pages.find((p) => p.name === N.page);
}

async function bind() {
  const page = findMachinePage();
  if (!page) {
    post({ type: "log", text: `No page "${N.testPage}" or "${N.page}". Run tools/draw-machine / tools/clone-test-page.` });
    return;
  }
  await page.loadAsync();
  const have = new Set<string>();
  page.findAll((n) => (have.add(n.name), false));
  const need = requiredNames();
  const missing = need.filter((n) => !have.has(n));
  post({ type: "bind-report", missing, found: need.length - missing.length });
  post({ type: "log", text: `bound to page "${page.name}"` });

  // Behavior comes from the canvas table, re-read every time (the text may have been edited).
  const tableNode = page.findOne((n) => n.name === N.decoderTable);
  if (!tableNode) return post({ type: "log", text: `table node "${N.decoderTable}" not found` });
  const t = readTable(findByName(toTree(tableNode), N.decoderTable)!);
  post({ type: "log", text: `opcode table: ${t.rows.length} valid rows from canvas, ${t.problems.length} problem(s)` });
  t.problems.forEach((p) => post({ type: "log", text: `  ! ${p}` }));
}

figma.ui.onmessage = (m: ToMain) => {
  if (m.type === "ready") void bind();
};
