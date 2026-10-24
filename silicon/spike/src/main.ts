// Spike plugin entry. Builds the page and closes; nothing runs at prototype time but Figma.
import { buildSpike, SPIKE_COMMANDS, type SpikeCommand } from "./spike";

const command = (SPIKE_COMMANDS as string[]).includes(figma.command) ? (figma.command as SpikeCommand) : "all";

buildSpike(figma, command)
  .then((r) =>
    figma.closePlugin(r.ok ? "Silicon spike built. Press ▶ Present." : `Spike built with ${r.errors.length} error(s): see "Spike log" on the page`),
  )
  .catch((e) => figma.closePlugin(`Spike failed: ${e instanceof Error ? e.message : e}`));
