import { A, B, C, E, V, add, set, sel, State, sub, run, newCost, Cost, staticSize } from "./fig";

export const NREG = 8, NM = Number(process.env.NM ?? 256);
export const OPS = ["NOP", "LDI", "MOV", "ADD", "SUB", "ADDI", "LD", "ST", "JMP", "BEQ", "BNE", "BLT", "BGE", "HLT"] as const;
export type Op = (typeof OPS)[number];
export interface Ins { op: Op; a: number; b: number; c: number }
const R = (i: number) => `R${i}`, M = (i: number) => `M${i}`;
const rd = (idx: string, dest: string): A[] => sel(V(idx), 0, NREG, (i) => [set(dest, V(R(i)))]);
const wr = (idx: string, f: (i: number) => E): A[] => sel(V(idx), 0, NREG, (i) => [set(R(i), f(i))]);

// ---------- assembler ----------
export function assemble(src: string): Ins[] {
  const lines = src.split("\n").map((l) => l.replace(/;.*/, "").trim()).filter(Boolean);
  const labels: Record<string, number> = {};
  const raw: string[] = [];
  for (const l of lines) {
    const m = l.match(/^(\w+):\s*(.*)$/);
    if (m) { labels[m[1]] = raw.length; if (m[2]) raw.push(m[2]); } else raw.push(l);
  }
  const reg = (s: string) => { const m = s.match(/^R(\d)$/); if (!m) throw new Error("reg " + s); return +m[1]; };
  const val = (s: string) => (s in labels ? labels[s] : Number(s));
  return raw.map((l) => {
    const [op, rest = ""] = l.split(/\s+/, 2).length > 1 ? [l.split(/\s+/)[0], l.slice(l.indexOf(" ") + 1)] : [l, ""];
    const p = rest.split(",").map((x) => x.trim()).filter(Boolean);
    const O = op as Op;
    switch (O) {
      case "NOP": case "HLT": return { op: O, a: 0, b: 0, c: 0 };
      case "LDI": case "ADDI": return { op: O, a: reg(p[0]), b: 0, c: val(p[1]) };
      case "MOV": case "ADD": case "SUB": return { op: O, a: reg(p[0]), b: reg(p[1]), c: 0 };
      case "LD": case "ST": return { op: O, a: reg(p[0]), b: reg(p[1]), c: val(p[2] ?? "0") };
      case "JMP": return { op: O, a: 0, b: 0, c: val(p[0]) };
      case "BEQ": case "BNE": case "BLT": case "BGE": return { op: O, a: reg(p[0]), b: reg(p[1]), c: val(p[2]) };
    }
    throw new Error("unknown op " + op);
  });
}

// ---------- DATA mode: program lives in variables; fetch tree + decode tree + operand trees ----------
export function dataMachine(prog: Ins[]) {
  const P = prog.length;
  const branch = (cmp: string): A[] => [...rd("IA", "T1"), ...rd("IB", "T2"), { i: [{ c: B(cmp, V("T1"), V("T2")), t: [set("PC", V("IC"))] }] }];
  const body: Record<Op, A[]> = {
    NOP: [],
    LDI: wr("IA", () => V("IC")),
    MOV: [...rd("IB", "T2"), ...wr("IA", () => V("T2"))],
    ADD: [...rd("IB", "T2"), ...wr("IA", (i) => add(V(R(i)), V("T2")))],
    SUB: [...rd("IB", "T2"), ...wr("IA", (i) => sub(V(R(i)), V("T2")))],
    ADDI: wr("IA", (i) => add(V(R(i)), V("IC"))),
    LD: [...rd("IB", "T2"), set("AD", add(V("T2"), V("IC"))), ...sel(V("AD"), 0, NM, (m) => [set("T3", V(M(m)))]), ...wr("IA", () => V("T3"))],
    ST: [...rd("IA", "T1"), ...rd("IB", "T2"), set("AD", add(V("T2"), V("IC"))), ...sel(V("AD"), 0, NM, (m) => [set(M(m), V("T1"))])],
    JMP: [set("PC", V("IC"))],
    BEQ: branch("=="), BNE: branch("!="), BLT: branch("<"), BGE: branch(">="),
    HLT: [set("HALT", C(1)), set("PC", sub(V("PC"), C(1)))],
  };
  const fetch = sel(V("PC"), 0, P, (k) => [set("IO", C(OPS.indexOf(prog[k].op))), set("IA", C(prog[k].a)), set("IB", C(prog[k].b)), set("IC", C(prog[k].c))]);
  const decode = sel(V("IO"), 0, OPS.length, (o) => body[OPS[o]]);
  const tick: A[] = [...fetch, set("PC", add(V("PC"), C(1))), ...decode];
  return { tick, size: staticSize(tick) };
}

// ---------- BLOCK mode: PC is a basic-block id; operands resolved at build time ----------
export function blockMachine(prog: Ins[]) {
  const isBr = (o: Op) => ["BEQ", "BNE", "BLT", "BGE"].includes(o);
  const leaders = new Set<number>([0]);
  prog.forEach((ins, k) => {
    if (ins.op === "JMP" || isBr(ins.op)) { leaders.add(ins.c); leaders.add(k + 1); }
    if (ins.op === "HLT") leaders.add(k + 1);
  });
  const starts = [...leaders].filter((k) => k < prog.length).sort((a, b) => a - b);
  const id = (k: number) => starts.indexOf(k);
  const blocks: A[][] = starts.map((s, bi) => {
    const out: A[] = [];
    const end = bi + 1 < starts.length ? starts[bi + 1] : prog.length;
    for (let k = s; k < end; k++) {
      const x = prog[k];
      const cmp = { BEQ: "==", BNE: "!=", BLT: "<", BGE: ">=" } as Record<string, string>;
      switch (x.op) {
        case "NOP": break;
        case "LDI": out.push(set(R(x.a), C(x.c))); break;
        case "MOV": out.push(set(R(x.a), V(R(x.b)))); break;
        case "ADD": out.push(set(R(x.a), add(V(R(x.a)), V(R(x.b))))); break;
        case "SUB": out.push(set(R(x.a), sub(V(R(x.a)), V(R(x.b))))); break;
        case "ADDI": out.push(set(R(x.a), add(V(R(x.a)), C(x.c)))); break;
        case "LD": out.push(set("AD", add(V(R(x.b)), C(x.c))), ...sel(V("AD"), 0, NM, (m) => [set(R(x.a), V(M(m)))])); break;
        case "ST": out.push(set("AD", add(V(R(x.b)), C(x.c))), ...sel(V("AD"), 0, NM, (m) => [set(M(m), V(R(x.a)))])); break;
        case "JMP": out.push(set("PC", C(id(x.c)))); break;
        case "HLT": out.push(set("HALT", C(1))); break;
        default: out.push({ i: [{ c: B(cmp[x.op], V(R(x.a)), V(R(x.b))), t: [set("PC", C(id(x.c)))] }, { t: [set("PC", C(id(k + 1)))] }] });
      }
    }
    const last = prog[end - 1];
    if (!(last.op === "JMP" || isBr(last.op) || last.op === "HLT") && end < prog.length) out.push(set("PC", C(id(end))));
    return out;
  });
  const tick = sel(V("PC"), 0, blocks.length, (b) => blocks[b]);
  return { tick, size: staticSize(tick), nBlocks: blocks.length };
}

export interface RunResult { st: State; cost: Cost; ticks: number }
export function execute(tick: A[], mem: number[], maxTicks = 100000): RunResult {
  const st: State = { PC: 0, HALT: 0, IO: 0, IA: 0, IB: 0, IC: 0, T1: 0, T2: 0, T3: 0, AD: 0 };
  for (let i = 0; i < NREG; i++) st[R(i)] = 0;
  for (let i = 0; i < NM; i++) st[M(i)] = mem[i] ?? 0;
  const cost = newCost();
  let ticks = 0;
  while (!st.HALT && ticks < maxTicks) { run(tick, st, cost); ticks++; }
  return { st, cost, ticks };
}
