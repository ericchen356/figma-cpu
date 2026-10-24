// LANE: asm. Two-pass assembler: labels, .org, .db only. Pure function, no Figma, tested in Node.
// Encoding comes from spec/opcodes.json (fmt column); registers packed rd<<4 | rs, A=0..L=5 (REGS order).
export interface AsmResult {
  bytes: number[];
  origin: number;
  labels: Record<string, number>;
  errors: { line: number; message: string }[];
}

export function assemble(_source: string): AsmResult {
  throw new Error("asm lane: assemble not implemented");
}
