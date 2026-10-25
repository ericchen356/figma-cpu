// The Figma OS panel: buttons and a log.
import type { ToMain, ToUi } from "../src/messages";

const $ = (id: string) => document.getElementById(id)!;
const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, "*");
const log = (level: string, text: string) => {
  const line = document.createElement("div");
  line.className = level;
  line.textContent = text;
  $("log").appendChild(line);
  $("log").scrollTop = 1e9;
};

$("editor").onclick = () => send({ type: "editor" });
$("live").onclick = () => send({ type: "live", budget: 700 });
$("selftest").onclick = () => send({ type: "selftest", events: 120, seed: Date.now() % 100000 });

window.onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage as ToUi | undefined;
  if (!m) return;
  if (m.type === "log") log(m.level, m.text);
  if (m.type === "busy") for (const b of document.querySelectorAll("button")) (b as HTMLButtonElement).disabled = !!m.what;
  if (m.type === "progress") log("info", `${m.done}/${m.total} ${m.label}`);
};
