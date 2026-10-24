// MCP smoke bundle entry: the smoke test plus the shipped demo programs.
import bounce from "../programs/bounce.asm";
import count from "../programs/count.asm";
import fib from "../programs/fib.asm";
import paint from "../programs/paint.asm";
import rect from "../programs/rect.asm";
import { smoke as run, type SmokeOptions } from "./smoke";

export const PROGRAMS: Record<string, string> = { count, fib, rect, bounce, paint };
export const smoke = (o: SmokeOptions) => run(o, PROGRAMS);
