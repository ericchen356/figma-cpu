// Live link: makes this lab's CPU follow the gate-level CPU running in Figma Present (FINAL CPU's
// CPU tab), streamed by the "Figma CPU Live Link" Chrome extension through Supabase Realtime.
//
// Both run the same 2,298-wire netlist, so only the clock travels: {program, tick, phase}. On a new
// program, or when Figma's clock goes back (Reset), the engine reloads that program's power-on wires;
// then it steps its own source phases until it reaches Figma's tick and phase.
import PROGRAMS from "./programs.js";
import { realtimeChannel } from "./realtime.js";

const SUPABASE_REF = "tyewtrrwvzvginqoqwxs";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5ZXd0cnJ3dnp2Z2lucW9xd3hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4OTIzNjgsImV4cCI6MjEwODQ2ODM2OH0.TGenUQuD1500zlpmvyhv-yUPa8SAVpf4-ebM9yDsMGk";

// The engine side, no DOM: load a program, aim at Figma's clock, step towards it within a time budget.
export function createFollower(engine) {
  const phases = engine.runtime.phases.length;
  const wires = PROGRAMS.names.map((n) => engine.ids.get(n));
  let program = null,
    target = null;
  const position = () =>
    engine.read("ctl/ticks") * phases + engine.read("ctl/phase");
  function load(name) {
    const bits = PROGRAMS.programs[name];
    if (!bits) throw new Error(`Unknown program ${name}`);
    engine.reset();
    wires.forEach((id, i) => {
      if (id)
        engine.state.set(
          id,
          ((parseInt(bits[i >> 2], 16) >> (i & 3)) & 1) === 1,
        );
    });
    program = name;
  }
  return {
    get program() {
      return program;
    },
    get target() {
      return target;
    },
    position,
    // Figma splits a tick into 10 chunks, this engine into 11 phases (10 equal ones and a short last
    // one), so Figma's phase p lands on phase p here and whole ticks line up exactly.
    aim(s) {
      const want = s.tick * phases + Math.min(s.phase, phases - 1);
      let reloaded = false;
      if (s.program !== program || want < position()) {
        load(s.program);
        reloaded = true;
      }
      target = want;
      return reloaded;
    },
    advance(budgetMs = 12) {
      const t0 = performance.now();
      let steps = 0;
      while (
        target !== null &&
        position() < target &&
        performance.now() - t0 < budgetMs
      ) {
        engine.step();
        steps++;
      }
      return steps;
    },
  };
}

// The page side: join the channel, pause the lab's own clock, redraw as the engine catches up.
export function connectCpuLink(
  cad,
  {
    channel = new URLSearchParams(location.search).get("channel") ||
      "figma-cpu",
  } = {},
) {
  const { engine, live, simulation } = cad;
  const follower = createFollower(engine);
  const badge = document.createElement("div");
  badge.id = "cpu-link";
  badge.style.cssText =
    "position:absolute;left:20px;bottom:108px;z-index:6;padding:6px 10px;border-radius:9px;font:600 11px -apple-system,sans-serif;letter-spacing:.04em;background:rgba(10,30,50,.82);border:1px solid rgba(110,200,255,.35);color:#8fb7d6;pointer-events:none";
  document.querySelector("#viewport").append(badge);
  let status = "connecting",
    last = null,
    linked = false;
  const show = () => {
    const s = last;
    badge.innerHTML = s
      ? `<span style="color:#5dff9a">●</span> LIVE FROM FIGMA · ${s.program} · tick ${s.tick} · phase ${s.phase}/${s.phases}${s.running ? " · running" : ""}`
      : `<span style="color:${status === "live" ? "#ffd35d" : "#ff7a7a"}">●</span> Figma link: ${status === "live" ? "waiting for Figma" : status} (channel ${channel})`;
  };
  show();
  realtimeChannel({
    ref: SUPABASE_REF,
    key: SUPABASE_ANON_KEY,
    channel,
    onStatus: (s) => {
      status = s;
      show();
    },
    onMessage: (event, s) => {
      if (event !== "cpu" || !PROGRAMS.programs[s.program]) return;
      if (!linked || simulation.running) {
        linked = true;
        simulation.setRunning(false);
      }
      last = s;
      if (follower.aim(s)) live.update(true);
      show();
    },
  });
  (function frame() {
    if (follower.advance()) {
      live.update();
      simulation.refresh();
      document.querySelector("#hud-run").textContent = "FIGMA";
    }
    requestAnimationFrame(frame);
  })();
  return follower;
}
