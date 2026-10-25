Live link from FINAL CPU (Figma Present) to the Silicon CPU Lab.

1. Put cpu-link.js and os-link.js next to viewer.js in the Make project.
2. Put everything in public/data/ into the project's public/data/ folder (next to runtime-*.txt).
3. Add these 4 lines at the very end of viewer.js:

import {connectCpuLink} from './cpu-link.js';
import {connectOsLink} from './os-link.js';
connectCpuLink(window.siliconCAD);
connectOsLink();

Then open the lab: a "LIVE FROM FIGMA" badge (CPU tab clock) and a "FIGMA OS CHIP" panel
(every OS gate, lit as it switches) follow what is done in Figma.
