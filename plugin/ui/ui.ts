// UI iframe. LANES: asm (editor, controls, readout) + screen (canvas -> PNG). Scaffold: shows the bind report.
import type { ToMain, ToUi } from "../src/contracts/messages";

const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, "*");
const $ = (id: string) => document.getElementById(id)!;

window.onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage as ToUi;
  if (!m) return;
  if (m.type === "bind-report") {
    $("status").textContent = `bound ${m.found} nodes, ${m.missing.length} missing`;
    $("log").textContent = m.missing.slice(0, 40).join("\n");
  } else if (m.type === "log") {
    $("log").textContent += m.text + "\n";
  }
};
send({ type: "ready" });
