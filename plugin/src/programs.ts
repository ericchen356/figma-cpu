// Demo programs and the include libraries, bundled as text by esbuild.
import bounce from "../programs/bounce.asm";
import count from "../programs/count.asm";
import fib from "../programs/fib.asm";
import gfx from "../programs/gfx.asm";
import hw from "../programs/hw.asm";
import paint from "../programs/paint.asm";
import rect from "../programs/rect.asm";

export const PROGRAMS: Record<string, string> = {
  "count.asm": count,
  "fib.asm": fib,
  "rect.asm": rect,
  "bounce.asm": bounce,
  "paint.asm": paint,
};

export const LIBRARIES: Record<string, string> = {
  "hw.asm": hw,
  "gfx.asm": gfx,
};
