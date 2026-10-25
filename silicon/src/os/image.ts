// OS image loader (docs/OS-CPU-CONTRACT.md §2, §7): an OS program is assembly source plus a
// manifest that names its entry point and RAM regions. loadImage() assembles the source with the
// ISA assembler and checks the result against the memory map of the current machine:
//   0–61 code and data, 62 INPUT (written by the plugin), 63 OUT (CPU ST latches the display).
// It never throws on a user mistake: every problem comes back as an error with a code and a
// precise message (line numbers where the assembler knows them). Pure: no Figma API.
import { assemble, disassemble, PREDEFINED_SYMBOLS } from "../isa/asm";
import { OPCODES, OUT_ADDR, RAM_BYTES } from "../isa/spec";

/** The memory-mapped input byte: the last plain RAM byte, just below OUT (plugin/src/devices.ts IN_ADDR). */
export const INPUT_ADDR = OUT_ADDR - 1;
/** Code must end below this address (§2: programs must end below INPUT). */
export const CODE_LIMIT = INPUT_ADDR;

export const REGION_KINDS = ["code", "data", "input", "output"] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

/** A named RAM range, both ends inclusive. */
export interface Region {
  name: string;
  start: number;
  end: number;
  kind: RegionKind;
}

export interface OsManifest {
  name: string;
  /** Label (or address) the program starts at. The CPU resets PC to 0, so it must resolve to 0,
   * or address 0 must hold `JMP entry`. */
  entry: string | number;
  /** RAM size the program is written for; must equal the machine's (16). */
  ram: number;
  regions: Region[];
  /** Source file name, for display (the source text itself is passed to loadImage). */
  source: string;
  /** Optional bindings file name. */
  bindings?: string;
}

export type IssueCode =
  | "manifest" // malformed manifest field
  | "ram-size" // manifest.ram is not this machine's RAM size
  | "region-range" // region outside RAM, or a code region reaching INPUT/OUT
  | "overlap" // two regions share an address
  | "io-range" // input/output region not exactly at 14 / 15
  | "asm" // assembler error
  | "oversize" // program does not fit in RAM
  | "code-range" // an instruction byte at 14 or 15
  | "code-outside-region" // an instruction byte outside every code region
  | "data-outside-region" // a .db byte outside every data region
  | "entry-missing" // entry label not defined
  | "entry-outside-code" // entry not inside a code region / not an instruction
  | "entry-not-reset" // entry is not where the CPU starts (address 0)
  | "no-input" // warning: no input region declared
  | "no-output" // warning: no output region declared
  | "asm-warning"; // assembler warning

export interface ImageIssue {
  code: IssueCode;
  msg: string;
  /** 1-based source line, when the problem is tied to one. */
  line?: number;
  addr?: number;
  region?: string;
}

/** What each RAM byte holds after loading. */
export type ByteUse = "code" | "data" | null;

export interface OsImage {
  ok: boolean;
  name: string;
  /** RAM image, always RAM_BYTES long (unused bytes 0). */
  bytes: number[];
  /** Labels defined by the source → address (predefined symbols such as OUT excluded). */
  labels: Record<string, number>;
  /** Resolved entry address, null if it could not be resolved. */
  entry: number | null;
  regions: Region[];
  /** Per address: an instruction byte, a .db byte, or nothing emitted. */
  use: ByteUse[];
  warnings: ImageIssue[];
  errors: ImageIssue[];
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const span = (s: number, e: number) => (s === e ? `${s}` : `${s}–${e}`);

/** Checks the manifest's shape; returns the usable regions (malformed ones are dropped). */
function checkManifest(m: unknown, errors: ImageIssue[]): { name: string; entry: string | number | null; ram: number | null; regions: Region[] } {
  const bad = (msg: string, region?: string) => errors.push({ code: "manifest", msg, region });
  if (!isObj(m)) {
    bad("manifest must be a JSON object {name, entry, ram, regions, source}");
    return { name: "?", entry: null, ram: null, regions: [] };
  }
  const name = typeof m.name === "string" && m.name.trim() ? m.name : "?";
  if (name === "?") bad('manifest "name" must be a non-empty string');
  let entry: string | number | null = null;
  if (typeof m.entry === "string" && m.entry.trim()) entry = m.entry.trim();
  else if (isInt(m.entry)) entry = m.entry;
  else bad('manifest "entry" must be a label name or an address');
  let ram: number | null = null;
  if (!isInt(m.ram) || m.ram <= 0) bad('manifest "ram" must be a positive integer (bytes of RAM)');
  else ram = m.ram;
  if (m.source !== undefined && typeof m.source !== "string") bad('manifest "source" must be a file name');
  const regions: Region[] = [];
  if (!Array.isArray(m.regions)) {
    bad('manifest "regions" must be an array of {name, start, end, kind}');
    return { name, entry, ram, regions };
  }
  const names = new Set<string>();
  m.regions.forEach((r, i) => {
    const label = isObj(r) && typeof r.name === "string" && r.name ? r.name : `#${i}`;
    if (!isObj(r)) return bad(`region ${label} must be an object {name, start, end, kind}`, label);
    if (typeof r.name !== "string" || !r.name) return bad(`region ${label} needs a "name"`, label);
    if (names.has(r.name)) return bad(`region name "${r.name}" is used twice`, label);
    if (!REGION_KINDS.includes(r.kind as RegionKind))
      return bad(`region "${label}" has kind ${JSON.stringify(r.kind)}; use one of ${REGION_KINDS.join(", ")}`, label);
    if (!isInt(r.start) || !isInt(r.end)) return bad(`region "${label}" needs integer "start" and "end" (inclusive)`, label);
    if (r.end < r.start) return bad(`region "${label}" ends (${r.end}) before it starts (${r.start})`, label);
    names.add(r.name);
    regions.push({ name: r.name, start: r.start, end: r.end, kind: r.kind as RegionKind });
  });
  return { name, entry, ram, regions };
}

/** Region placement against the memory map: in range, I/O at 14/15, code below 14, no overlaps. */
function checkRegions(regions: Region[], errors: ImageIssue[], warnings: ImageIssue[]): Region[] {
  const ok: Region[] = [];
  for (const r of regions) {
    if (r.start < 0 || r.end >= RAM_BYTES) {
      errors.push({ code: "region-range", region: r.name, msg: `region "${r.name}" (${span(r.start, r.end)}) is outside RAM (0–${RAM_BYTES - 1})` });
      continue;
    }
    if (r.kind === "input" && (r.start !== INPUT_ADDR || r.end !== INPUT_ADDR)) {
      errors.push({ code: "io-range", region: r.name, msg: `input region "${r.name}" is ${span(r.start, r.end)}; the INPUT byte is exactly ${INPUT_ADDR}` });
      continue;
    }
    if (r.kind === "output" && (r.start !== OUT_ADDR || r.end !== OUT_ADDR)) {
      errors.push({ code: "io-range", region: r.name, msg: `output region "${r.name}" is ${span(r.start, r.end)}; the OUT byte is exactly ${OUT_ADDR}` });
      continue;
    }
    if ((r.kind === "code" || r.kind === "data") && r.end >= CODE_LIMIT) {
      const what = r.end === OUT_ADDR ? `${OUT_ADDR} (OUT)` : r.end === INPUT_ADDR ? `${INPUT_ADDR} (INPUT)` : `${r.end}`;
      errors.push({
        code: "region-range",
        region: r.name,
        msg: `${r.kind} region "${r.name}" ends at ${what}; code and data must end below ${CODE_LIMIT} (${INPUT_ADDR} is INPUT, ${OUT_ADDR} is OUT)`,
      });
      continue;
    }
    ok.push(r);
  }
  const sorted = [...ok].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j].start <= sorted[i].end; j++) {
      const a = sorted[i];
      const b = sorted[j];
      errors.push({
        code: "overlap",
        region: b.name,
        msg: `regions "${a.name}" (${span(a.start, a.end)}) and "${b.name}" (${span(b.start, b.end)}) overlap at ${span(b.start, Math.min(a.end, b.end))}`,
      });
    }
  if (!ok.some((r) => r.kind === "code") && !errors.some((e) => e.code === "region-range" || e.code === "manifest"))
    errors.push({ code: "region-range", msg: "manifest declares no code region" });
  if (!regions.some((r) => r.kind === "input")) warnings.push({ code: "no-input", msg: `no input region: the program cannot read clicks or keys (RAM[${INPUT_ADDR}])` });
  if (!regions.some((r) => r.kind === "output")) warnings.push({ code: "no-output", msg: `no output region: RAM[${OUT_ADDR}] (OUT) is not declared` });
  return ok;
}

// ---------- source statements (which bytes are instructions, which are .db) ----------

const CHAR = /^'(\\.|[^\\'])'/;

/** The statement part of a source line: comment and leading label removed (char literals respected). */
function statementOf(line: string): string {
  let end = line.length;
  for (let i = 0; i < line.length; i++) {
    const lit = line[i] === "'" ? line.slice(i).match(CHAR) : null;
    if (lit) i += lit[0].length - 1;
    else if (line[i] === ";") {
      end = i;
      break;
    }
  }
  return line
    .slice(0, end)
    .trim()
    .replace(/^[A-Za-z_]\w*\s*:/, "")
    .trim();
}

/** Number of top-level comma-separated operands of a `.db` statement. */
function dbCount(stmt: string): number {
  const args = stmt.replace(/^\.db\b/i, "");
  let n = 1;
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const lit = args[i] === "'" ? args.slice(i).match(CHAR) : null;
    if (lit) i += lit[0].length - 1;
    else if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) n++;
  }
  return n;
}

const regionAt = (regions: Region[], addr: number) => regions.find((r) => addr >= r.start && addr <= r.end);
const JMP = OPCODES.find((o) => o.mnem === "JMP")!.code;

/** Assembles `source` and validates it against `manifest` and the memory map. Never throws on
 * user mistakes; `ok` is true only when `errors` is empty. */
export function loadImage(manifest: unknown, source: string): OsImage {
  const errors: ImageIssue[] = [];
  const warnings: ImageIssue[] = [];
  const m = checkManifest(manifest, errors);
  if (m.ram !== null && m.ram !== RAM_BYTES)
    errors.push({ code: "ram-size", msg: `manifest is for ${m.ram} bytes of RAM; this machine has ${RAM_BYTES} (docs/CPU-V2.md prices larger RAM)` });
  const regions = checkRegions(m.regions, errors, warnings);

  const use: ByteUse[] = new Array<ByteUse>(RAM_BYTES).fill(null);
  if (typeof source !== "string") {
    errors.push({ code: "asm", msg: "source must be assembly text" });
    return { ok: false, name: m.name, bytes: new Array(RAM_BYTES).fill(0), labels: {}, entry: null, regions, use, warnings, errors };
  }

  let asm;
  try {
    asm = assemble(source);
  } catch (e) {
    errors.push({ code: "asm", msg: `assembler failed: ${(e as Error).message}` });
    return { ok: false, name: m.name, bytes: new Array(RAM_BYTES).fill(0), labels: {}, entry: null, regions, use, warnings, errors };
  }
  for (const e of asm.errors)
    errors.push({ code: /^program needs \d+ bytes/.test(e.msg) ? "oversize" : "asm", line: e.line, msg: `line ${e.line}: ${e.msg}` });
  for (const w of asm.warnings) warnings.push({ code: "asm-warning", line: w.line, msg: `line ${w.line}: ${w.msg}` });

  const labels: Record<string, number> = {};
  for (const [k, v] of Object.entries(asm.symbols)) if (!(k in PREDEFINED_SYMBOLS)) labels[k] = v;

  // Which bytes each assembled line emitted, and whether they are code or data.
  const lines = source.split(/\r?\n/);
  const instrStart = new Set<number>();
  for (const [ln, addr] of Object.entries(asm.lineAddr)) {
    const line = Number(ln);
    const stmt = statementOf(lines[line - 1] ?? "");
    const isDb = /^\.db\b/i.test(stmt);
    const size = isDb ? dbCount(stmt) : disassemble(asm.bytes, addr).size;
    const kind: ByteUse = isDb ? "data" : "code";
    if (!isDb) instrStart.add(addr);
    const what = isDb ? ".db" : `"${disassemble(asm.bytes, addr).text}"`;
    for (let a = addr; a < addr + size && a < RAM_BYTES; a++) {
      use[a] = kind;
      const r = regionAt(regions, a);
      if (kind === "code" && a >= CODE_LIMIT) {
        const port = a === OUT_ADDR ? `${OUT_ADDR}, the OUT port` : `${INPUT_ADDR}, the INPUT byte`;
        errors.push({ code: "code-range", line, addr: a, msg: `line ${line}: ${what} reaches address ${port}; code must end below ${CODE_LIMIT}` });
      } else if (kind === "code" && r?.kind !== "code") {
        errors.push({
          code: "code-outside-region",
          line,
          addr: a,
          msg: `line ${line}: instruction byte at ${a} (${what}) is ${r ? `in ${r.kind} region "${r.name}"` : "outside every region"}; it must be in a code region`,
        });
      } else if (kind === "data" && r?.kind !== "data") {
        errors.push({
          code: "data-outside-region",
          line,
          addr: a,
          msg: `line ${line}: .db byte at ${a} is ${r ? `in ${r.kind} region "${r.name}"` : "outside every region"}; .db bytes must be in a data region`,
        });
      }
    }
  }

  // Entry point.
  let entry: number | null = null;
  if (m.entry !== null) {
    if (typeof m.entry === "number") entry = m.entry;
    else if (m.entry in labels) entry = labels[m.entry];
    else {
      const near = Object.keys(labels).find((k) => k.toLowerCase() === String(m.entry).toLowerCase());
      const known = Object.keys(labels).join(", ") || "none";
      errors.push({
        code: "entry-missing",
        msg: `entry "${m.entry}" is not a label in the source${near ? ` (did you mean "${near}"?)` : ""}; labels: ${known}`,
      });
    }
  }
  if (entry !== null) {
    const r = regionAt(regions, entry);
    if (entry < 0 || entry >= RAM_BYTES || r?.kind !== "code")
      errors.push({ code: "entry-outside-code", addr: entry, msg: `entry ${JSON.stringify(m.entry)} is address ${entry}, which is not inside a code region` });
    else if (asm.ok && !instrStart.has(entry))
      errors.push({ code: "entry-outside-code", addr: entry, msg: `entry ${JSON.stringify(m.entry)} is address ${entry}, which is not the start of an instruction` });
    else if (entry !== 0 && !(use[0] === "code" && asm.bytes[0] >> 4 === JMP && asm.bytes[1] === entry))
      errors.push({
        code: "entry-not-reset",
        addr: entry,
        msg: `entry ${JSON.stringify(m.entry)} is address ${entry}, but the CPU starts at 0 (PC resets to 0); put the entry label at 0 or start with "JMP ${m.entry}"`,
      });
  }

  return { ok: errors.length === 0, name: m.name, bytes: asm.bytes, labels, entry, regions, use, warnings, errors };
}

/** One-line-per-issue text for logs and the plugin UI. */
export function formatIssues(img: Pick<OsImage, "errors" | "warnings">): string {
  return [...img.errors.map((e) => `error [${e.code}] ${e.msg}`), ...img.warnings.map((w) => `warning [${w.code}] ${w.msg}`)].join("\n");
}
