const $ = (id) => document.getElementById(id);
const COLORS = {
  live: "#3ddc84",
  connecting: "#f5c542",
  reconnecting: "#f5c542",
  off: "#777",
};

async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: "status" });
  $("status").textContent = s.status;
  $("dot").style.background = COLORS[s.status] ?? "#777";
  $("sent").textContent = s.sent;
  $("inputs").textContent = s.inputs ?? 0;
  if (s.last) {
    $("program").textContent = s.last.program;
    $("clock").textContent =
      `${s.last.tick} · ${s.last.phase}/${s.last.phases}${s.last.running ? " (running)" : ""}`;
  }
  if (document.activeElement !== $("channel")) $("channel").value = s.channel;
  $("enabled").checked = s.enabled;
}

$("channel").addEventListener("change", (e) =>
  chrome.runtime
    .sendMessage({
      type: "settings",
      settings: { channel: e.target.value.trim() || "figma-cpu" },
    })
    .then(refresh),
);
$("enabled").addEventListener("change", (e) =>
  chrome.runtime
    .sendMessage({ type: "settings", settings: { enabled: e.target.checked } })
    .then(refresh),
);

refresh();
setInterval(refresh, 500);
