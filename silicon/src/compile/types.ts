// Contract between the compiler (lane A) and its consumers (FastSim, prototype emitter).
// A schedule is the order in which Figma (or JS) evaluates gates for one clock tick.

export interface Pass {
  /** Level of CLK during this pass. A tick is passes[0] (CLK=0) then passes[1] (CLK=1). */
  clk: 0 | 1;
  /** Gate indices (into FlatNetlist.gates) in evaluation order. Gates in a feedback
   * group appear several times so the group settles within one pass. */
  order: number[];
}

export interface Schedule {
  passes: [Pass, Pass];
  /** Feedback groups (strongly connected components with >1 gate or a self-loop), per pass. */
  sccs: [number[][], number[][]];
  stats: {
    gates: number;
    /** Gate evaluations per tick = prototype SET_VARIABLE actions per Step. */
    actionsPerTick: number;
    largestScc: number;
  };
}
