// The gate-level back end of the flow (docs/GATES.md §2): synthesize() turns a flow program into
// a silicon Library of 2-input gates with top "OS", one clock tick per event; GateMachine runs it.
// reactions() is what one Figma reaction per event would execute (§4), and ReactionMachine runs those.
export {
  synthesize,
  type RegInfo,
  type Synth,
  type SynthOptions,
} from "./synthesize";
export { GateMachine } from "./machine";
export {
  reactions,
  ReactionMachine,
  type Commit,
  type Reaction,
} from "./reaction";
