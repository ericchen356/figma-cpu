// PRD stage 5 exit criterion: Turbo >= 50k instructions/second. Measured on the pure core (no Figma writes).
import { it, expect } from "vitest";
import fixture from "./fixtures/decoder-table.json";
import { createCpu } from "../src/engine/cpu";
import { readTable, type TreeNode } from "../src/engine/table";
import { assemble } from "../src/assembler/asm";

it("pure core runs >= 50k instructions per second", () => {
  const cpu = createCpu(readTable(fixture as TreeNode).rows);
  cpu.load(assemble("loop: INC A\nADD B, A\nJMP loop").bytes, 0);
  const N = 200_000, t0 = performance.now();
  for (let i = 0; i < N; i++) cpu.step();
  const ips = N / ((performance.now() - t0) / 1000);
  console.log(`IPS ${Math.round(ips)}`);
  expect(ips).toBeGreaterThanOrEqual(50_000);
});
