(() => {
  if (window.__chzzkManagerChatWebSocketHooked) return;
  window.__chzzkManagerChatWebSocketHooked = true;

  const NativeWebSocket = window.WebSocket;
  const managerRoles = new Set([
    "streaming_chat_manager",
    "streaming_channel_manager",
    "manager"
  ]);

  class HookedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      if (protocols === undefined) {
        super(url);
      } else {
        super(url, protocols);
      }

      if (looksLikeChatSocket(url)) {
        window.postMessage({
          source: "CHZZK_MANAGER_CHAT_WS",
          type: "socket-open",
          url: String(url || "")
        }, "*");
      }

      this.addEventListener("message", (event) => {
        readPayload(event.data).then(inspectPayload).catch(() => {});
      });
    }
  }

  Object.setPrototypeOf(HookedWebSocket, NativeWebSocket);
  window.WebSocket = HookedWebSocket;

  function looksLikeChatSocket(url) {
    return /chat|ntalk|chzzk|game\.naver/i.test(String(url || ""));
  }

  async function readPayload(data) {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return "";
  }

  function inspectPayload(raw) {
    const packet = parseMaybeJson(raw);
    if (!packet) return;

    for (const event of findChatEvents(packet)) {
      const profile = parseMaybeJson(event.profile) || event.profile || {};
      if (!isManagerProfile(profile)) continue;

      const message = normalize(
        event.message || event.msg || event.content || event.text || ""
      );
      if (!message) continue;

      window.postMessage({
        source: "CHZZK_MANAGER_CHAT_WS",
        chat: {
          id: String(event.serviceId || event.messageId || event.msgId || event.time || event.ctime || ""),
          nickname: normalize(profile.nickname || profile.nickName || profile.name || "매니저"),
          message,
          time: Number(event.time || event.ctime || event.createdTime || Date.now()),
          role: profile.userRoleCode || ""
        }
      }, "*");
    }
  }

  function findChatEvents(packet) {
    const events = [];
    const command = Number(packet.cmd ?? packet.command ?? packet.type);
    const body = packet.bdy || packet.body || packet.data;

    if (command === 93101 || command === 15101 || command === 94010) {
      collectBodyEvents(body, events);
      return events;
    }

    collectBodyEvents(packet, events);
    return events.filter((event) => event.profile && (event.message || event.msg || event.content || event.text));
  }

  function collectBodyEvents(value, events) {
    const parsed = parseMaybeJson(value) || value;

    if (Array.isArray(parsed)) {
      for (const item of parsed) collectBodyEvents(item, events);
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    if (parsed.profile && (parsed.message || parsed.msg || parsed.content || parsed.text)) {
      events.push(parsed);
      return;
    }

    for (const key of ["bdy", "body", "data", "events", "list", "messages"]) {
      if (key in parsed) collectBodyEvents(parsed[key], events);
    }
  }

  function isManagerProfile(profile) {
    const role = String(profile.userRoleCode || profile.role || "").toLowerCase();
    if (managerRoles.has(role)) return true;

    const haystack = JSON.stringify(profile).toLowerCase();
    return haystack.includes("streaming_chat_manager")
      || haystack.includes("streaming_channel_manager")
      || haystack.includes('"manager"');
  }

  function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function normalize(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }
})();
