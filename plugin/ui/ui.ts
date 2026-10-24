// UI iframe. LANES: asm (editor, controls, readout) + screen (canvas -> PNG: see #screen in ui.html).
import type { MachineState, ToMain, ToUi } from "../src/contracts/messages";
import { REGS } from "../src/contracts/nodes";
import { assemble, type AsmResult } from "../src/assembler/asm";
import countAsm from "../programs/count.asm";
import fibAsm from "../programs/fib.asm";

const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, "*");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");

const PROGRAMS: Record<string, string> = { "count.asm": countAsm, "fib.asm": fibAsm };
let assembled: AsmResult | null = null;

const prog = $<HTMLSelectElement>("prog");
Object.keys(PROGRAMS).forEach((n) => prog.add(new Option(n, n)));
prog.add(new Option("(custom)", ""));
const src = $<HTMLTextAreaElement>("src");
src.value = PROGRAMS["count.asm"];
prog.onchange = () => { if (prog.value) src.value = PROGRAMS[prog.value]; invalidate(); };
src.oninput = () => { prog.value = ""; invalidate(); };

function invalidate() {
  assembled = null;
  ($("load") as HTMLButtonElement).disabled = true;
  $("ok").textContent = "";
  $("errors").textContent = "";
}

$("assemble").onclick = () => {
  const r = assemble(src.value);
  $("errors").textContent = r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n");
  if (r.errors.length) { assembled = null; $("ok").textContent = ""; return; }
  assembled = r;
  $("ok").textContent = `${r.bytes.length} bytes @ 0x${hex(r.origin, 4)} ok`;
  ($("load") as HTMLButtonElement).disabled = false;
};
$("load").onclick = () => { if (assembled) send({ type: "load", bytes: assembled.bytes, origin: assembled.origin }); };

const mode = () => ($("mode") as HTMLSelectElement).value as "watch" | "turbo";
$("step").onclick = () => send({ type: "step" });
$("run").onclick = () => send({ type: "run", mode: mode(), hz: Number(($("hz") as HTMLInputElement).value) || 3 });
$("pause").onclick = () => send({ type: "pause" });
$("reset").onclick = () => send({ type: "reset" });
$("mode").onchange = () => { $("hzwrap").style.display = mode() === "watch" ? "" : "none"; };

function renderState(s: MachineState) {
  $("regs").innerHTML = REGS.map((r) => `<div class="reg mono"><b>${r}</b>${hex(s.regs[r], 2)}</div>`).join("");
  $("cpu").textContent = `PC ${hex(s.pc, 4)}   SP ${hex(s.sp, 4)}   IR ${hex(s.ir, 2)}${s.halted ? "   HALTED" : ""}`;
  (["Z", "C", "N"] as const).forEach((f) => $("f" + f).classList.toggle("on", s.flags[f]));
  $("cyc").textContent = `cycles ${s.cycles}`;
}

window.onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage as ToUi;
  if (!m) return;
  if (m.type === "bind-report") {
    $("status").textContent = `bound ${m.found} nodes, ${m.missing.length} missing`;
    if (m.missing.length) $("log").textContent += m.missing.slice(0, 20).join("\n") + "\n";
  } else if (m.type === "log") {
    $("log").textContent += m.text + "\n";
  } else if (m.type === "state") {
    renderState(m.state);
  }
};
send({ type: "ready" });
