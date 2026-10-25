// A minimal Supabase Realtime "broadcast" client (Phoenix channels over a WebSocket), no
// dependencies, so the same file runs in the extension's service worker and in the Make app.
export function realtimeChannel({
  ref,
  key,
  channel,
  onMessage,
  onStatus = () => {},
}) {
  const topic = `realtime:${channel}`;
  let ws = null,
    joined = false,
    refNo = 0,
    heartbeat = null,
    retry = 0,
    closed = false;
  const queue = [];

  const raw = (event, payload, t = topic) => {
    const msg = JSON.stringify({
      topic: t,
      event,
      payload,
      ref: String(++refNo),
      join_ref: "1",
    });
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  };

  function open() {
    if (closed) return;
    onStatus("connecting");
    ws = new WebSocket(
      `wss://${ref}.supabase.co/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`,
    );
    ws.onopen = () => {
      retry = 0;
      raw("phx_join", {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: "" },
          private: false,
        },
        access_token: key,
      });
      heartbeat = setInterval(() => raw("heartbeat", {}, "phoenix"), 20000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (
        m.event === "phx_reply" &&
        m.topic === topic &&
        m.payload?.status === "ok" &&
        !joined
      ) {
        joined = true;
        onStatus("live");
        while (queue.length) send(...queue.shift());
      } else if (m.event === "broadcast" && m.topic === topic) {
        onMessage?.(m.payload.event, m.payload.payload);
      }
    };
    ws.onclose = () => {
      joined = false;
      clearInterval(heartbeat);
      if (closed) return onStatus("off");
      onStatus("reconnecting");
      setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
    };
    ws.onerror = () => ws.close();
  }

  function send(event, payload) {
    if (!joined) {
      // the clock: only the latest state matters; inputs: every one, in order
      if (event === "cpu") {
        const i = queue.findIndex(([e]) => e === "cpu");
        if (i >= 0) queue.splice(i, 1);
      }
      queue.push([event, payload]);
      return;
    }
    raw("broadcast", { type: "broadcast", event, payload });
  }

  open();
  return {
    send,
    get live() {
      return joined;
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
