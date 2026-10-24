// Stage 4 — the control unit: phase lamps, the T-state counter, and every control signal grouped by role.

function signalGroups() {
  const sigs = SPEC.signals.signals;
  const memory = ["MAR_LOAD", "MEM_READ", "MEM_WRITE", "MDR_LOAD"];
  const aluSigs = ["ALU_OP", "Y_LOAD", "FLAGS_LOAD"];
  const pick = (f) => sigs.filter(f);
  const loads = pick((s) => /_LOAD$/.test(s.name) && !memory.includes(s.name) && !aluSigs.includes(s.name));
  const groups = [
    ["ADDRESS BUS DRIVERS", pick((s) => s.drives === "addr")],
    ["DATA BUS DRIVERS", pick((s) => s.drives === "data")],
    ["MEMORY", pick((s) => memory.includes(s.name))],
    ["LATCH LOADS", loads.slice(0, 6)],
    ["LATCH LOADS (cont.)", loads.slice(6)],
    ["ALU", pick((s) => aluSigs.includes(s.name))],
    ["COUNTERS · SEQUENCE", pick((s) => /_(INC|DEC)$/.test(s.name) || s.name === "T_RESET" || s.name === "HALT")],
  ];
  const placed = new Set(groups.flatMap((g) => g[1].map((s) => s.name)));
  const rest = sigs.filter((s) => !placed.has(s.name));
  if (rest.length) groups.push(["OTHER", rest]);
  return groups;
}

function drawControl(M, Lamp) {
  const b = frame(M, "cpu/control", 40, ROW_D, 2040, 360, { fill: C.card });
  caption(b, "CONTROL UNIT · each T-state turns on a set of signals; Watch mode lights them");
  lampLabel(Lamp, b, "cpu/phase/FETCH", "FETCH", 16, 44, 104);
  lampLabel(Lamp, b, "cpu/phase/DECODE", "DECODE", 128, 44, 104);
  lampLabel(Lamp, b, "cpu/phase/EXEC", "EXEC", 240, 44, 96);
  lampLabel(Lamp, b, "cpu/clock", "CLK", 344, 44, 80);
  text(b, "cpu/cycles", "instr 0 · T-states 0", 16, 84, { size: 12, mono: true, color: C.dim });
  const ts = frame(b, "cpu/tstate", 16, 112, 440, 232, { fill: C.cell });
  caption(ts, "T-STATE");
  text(ts, "value", "—", 16, 34, { size: 36, mono: true, bold: true });
  for (let t = 0; t < SPEC.signals.maxTStates; t++)
    lampLabel(Lamp, ts, `cpu/tstate/T${t}`, `T${t}`, 16 + (t % 6) * 70, 96 + Math.floor(t / 6) * 40, 64);
  const groups = signalGroups();
  const gx0 = 488, gw = (2040 - gx0 - 16 - (groups.length - 1) * 8) / groups.length;
  groups.forEach(([label, list], gi) => {
    const x = gx0 + gi * (gw + 8);
    text(b, "group-label", label, x, 44, { size: 10, bold: true, color: C.dim, track: 6 });
    list.forEach((s, i) =>
      lampLabel(Lamp, b, `cpu/sig/${s.name}`, s.name, x, 68 + i * 36, gw, s.drives ? C.busOn : C.dim));
  });
}
