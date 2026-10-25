// Receives tools/export-os.js chunks from the Supabase channel and writes the export to a file.
// node tools/receive.mjs <out.json>
import { writeFileSync } from "node:fs";
import { realtimeChannel } from "../make/realtime.js";

const REF = "tyewtrrwvzvginqoqwxs";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5ZXd0cnJ3dnp2Z2lucW9xd3hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4OTIzNjgsImV4cCI6MjEwODQ2ODM2OH0.TGenUQuD1500zlpmvyhv-yUPa8SAVpf4-ebM9yDsMGk";
const out = process.argv[2];
const parts = [];
let count = 0, timer = null;

realtimeChannel({
  ref: REF, key: KEY, channel: "figma-os-export",
  onStatus: (s) => console.log("status", s),
  onMessage: (event, m) => {
    if (event !== "chunk") return;
    count = m.count;
    parts[m.i] = m.data;
    clearTimeout(timer);
    timer = setTimeout(report, 3000);
    if (parts.filter((p) => p !== undefined).length === count) report();
  },
});

function report() {
  const missing = [...Array(count).keys()].filter((i) => parts[i] === undefined);
  if (missing.length) return console.log(`missing ${missing.length}/${count}: ${JSON.stringify(missing)}`);
  writeFileSync(out, parts.join(""));
  console.log(`wrote ${out}: ${count} chunks`);
  process.exit(0);
}
