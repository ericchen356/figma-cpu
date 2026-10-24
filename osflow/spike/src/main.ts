// Spike plugin entry. Builds the page and closes; nothing runs at prototype time but Figma.
import { buildSpike, SPIKE_COMMANDS, type SpikeCommand } from "./spike";

const command = (SPIKE_COMMANDS as readonly string[]).includes(figma.command) ? (figma.command as SpikeCommand) : "all";

buildSpike(figma, command)
  .then((r) => figma.closePlugin(r.ok ? "OS spike built. Press ▶ Present." : `OS spike built with ${r.errors.length} error(s): see "OS spike log" on the page`))
  .catch((e) => figma.closePlugin(`OS spike failed: ${e instanceof Error ? e.message : e}`));
