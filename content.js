(() => {
  const ROOT_ID = "chzzk-manager-chat-root";
  const MAX_ITEMS = 200;
  const DEFAULTS = {
    enabled: true,
    managerPanelHeight: 260
  };

  const chatSelectorHints = [
    "[class*='live_chatting_message']",
    "[class*='chatting_message']",
    "[class*='chat_message']",
    "[class*='ChatMessage']",
    "[class*='message_container']",
    "[data-testid*='chat']",
    "[role='listitem']"
  ];

  const state = {
    enabled: true,
    collapsed: false,
    managerPanelHeight: 260,
    recentKeys: new Map(),
    root: null,
    shadow: null,
    list: null,
    collapseButton: null,
    resizeHandle: null,
    dockHost: null,
    dockTimer: null,
    pendingChats: [],
    stickToBottom: true,
    resizing: false,
    resizeStartY: 0,
    resizeStartHeight: 0,
    locationKey: "",
    locationTimer: null
  };

  injectPageHook();
  init();

  async function init() {
    window.addEventListener("message", handlePageMessage);

    const settings = await chrome.storage.local.get(DEFAULTS);
    Object.assign(state, settings);

    await waitForBody();
    state.locationKey = getLocationKey();
    mountPanel();
    startLocationWatch();
    startDockSync();
    flushPendingChats();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const [key, change] of Object.entries(changes)) {
        if (key in state) {
          state[key] = change.newValue;
        }
      }
      renderVisibility();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "CHZZK_MANAGER_CHAT_SETTING" && message.key in state) {
        state[message.key] = message.value;
        renderVisibility();
      }
    });
  }

  function injectPageHook() {
    const inject = () => {
      if (!document.documentElement) return false;

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("page_hook.js");
      script.onload = () => script.remove();
      document.documentElement.appendChild(script);
      return true;
    };

    if (!inject()) {
      document.addEventListener("readystatechange", inject, { once: true });
    }
  }

  function waitForBody() {
    if (document.body) return Promise.resolve();

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function handlePageMessage(event) {
    if (event.source !== window) return;
    if (event.data?.source !== "CHZZK_MANAGER_CHAT_WS") return;

    if (event.data.type === "socket-open") {
      resetChatHistory();
      return;
    }

    const chat = event.data.chat;
    if (!chat || !chat.message) return;
    collectChat({
      id: chat.id,
      nickname: chat.nickname || "매니저",
      message: chat.message,
      time: formatTime(chat.time),
      role: chat.role || "manager",
      source: "ws"
    });
  }

  function mountPanel() {
    if (document.getElementById(ROOT_ID)) return;

    state.root = document.createElement("div");
    state.root.id = ROOT_ID;
    state.shadow = state.root.attachShadow({ mode: "open" });
    state.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          display: block;
          width: 100%;
          min-height: 0;
          flex: 0 0 auto;
          color-scheme: dark;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .panel {
          position: relative;
          z-index: 1;
          width: 100%;
          height: var(--chzzk-manager-chat-height, 260px);
          min-height: 72px;
          max-height: 58vh;
          display: grid;
          grid-template-rows: 1fr 14px;
          overflow: hidden;
          border: 0;
          border-radius: 0;
          background: #111318;
          box-shadow: none;
          color: #f7f8fb;
        }

        .panel.is-hidden {
          display: none;
        }

        .panel.is-collapsed {
          height: 30px;
          grid-template-rows: 24px 14px;
        }

        button {
          width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          border: 0;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: #f7f8fb;
          cursor: pointer;
          font: 700 13px/1 system-ui, sans-serif;
        }

        button:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        .body {
          position: relative;
          min-height: 0;
        }

        .panel.is-collapsed .body {
          min-height: 24px;
        }

        .list {
          height: 100%;
          overflow: auto;
          padding: 8px 34px 8px 8px;
          scrollbar-width: thin;
        }

        .panel.is-collapsed .list {
          display: none;
        }

        .collapse {
          position: absolute;
          top: 4px;
          right: 6px;
          z-index: 2;
        }

        .empty {
          height: 100%;
          min-height: 56px;
          display: grid;
          place-items: center;
          color: #9ba6b8;
          font-size: 13px;
          text-align: center;
        }

        .item {
          display: grid;
          gap: 4px;
          padding: 9px 10px;
          border-radius: 8px;
          background: transparent;
        }

        .item + .item {
          margin-top: 4px;
        }

        .item.is-new {
          animation: flash 900ms ease-out;
        }

        .meta {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          color: #b8c2d4;
          font-size: 12px;
        }

        .badge {
          flex: 0 0 auto;
          border-radius: 999px;
          background: rgba(0, 255, 163, 0.12);
          color: #00ffa3;
          font-weight: 700;
          padding: 2px 7px;
        }

        .nick {
          min-width: 0;
          overflow: hidden;
          color: #ffffff;
          font-weight: 700;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .time {
          flex: 0 0 auto;
          margin-left: auto;
          color: #7f8b9e;
        }

        .message {
          color: #edf1f7;
          font-size: 14px;
          line-height: 1.42;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        .resize-handle {
          position: relative;
          height: 14px;
          cursor: ns-resize;
          background: rgba(0, 255, 163, 0.16);
          touch-action: none;
          user-select: none;
        }

        .resize-handle::before {
          content: "";
          position: absolute;
          left: 50%;
          top: 4px;
          width: 48px;
          height: 6px;
          transform: translateX(-50%);
          border-radius: 999px;
          background:
            radial-gradient(circle, rgba(220, 255, 244, 0.9) 0 2px, transparent 2.5px) 6px 50% / 12px 6px repeat-x,
            rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        }

        .resize-handle:hover,
        .resize-handle.is-active {
          background: rgba(0, 255, 163, 0.34);
        }

        .resize-handle:hover::before,
        .resize-handle.is-active::before {
          background:
            radial-gradient(circle, #ffffff 0 2px, transparent 2.5px) 6px 50% / 12px 6px repeat-x,
            rgba(0, 255, 163, 0.22);
        }

        @keyframes flash {
          0% { background: rgba(0, 255, 163, 0.2); }
          100% { background: transparent; }
        }
      </style>

      <section class="panel" aria-live="polite">
        <div class="body">
          <button class="collapse" type="button" title="접기">−</button>
          <div class="list">
            <div class="empty">매니저 채팅을 기다리는 중</div>
          </div>
        </div>
        <div class="resize-handle" title="영역 높이 조절"></div>
      </section>
    `;

    state.list = state.shadow.querySelector(".list");
    state.collapseButton = state.shadow.querySelector(".collapse");
    state.resizeHandle = state.shadow.querySelector(".resize-handle");
    state.root.style.setProperty("--chzzk-manager-chat-height", `${state.managerPanelHeight}px`);

    state.list.addEventListener("scroll", () => {
      state.stickToBottom = isListNearBottom();
    }, { passive: true });

    state.collapseButton.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      state.collapseButton.textContent = state.collapsed ? "+" : "−";
      state.collapseButton.title = state.collapsed ? "펼치기" : "접기";
      renderVisibility();
    });

    setupResizeHandle();
    renderVisibility();
  }

  function renderVisibility() {
    const panel = state.shadow?.querySelector(".panel");
    if (!panel) return;
    panel.classList.toggle("is-hidden", !state.enabled);
    panel.classList.toggle("is-collapsed", state.collapsed);
  }

  function setupResizeHandle() {
    state.resizeHandle.addEventListener("mousedown", (event) => {
      if (state.collapsed) return;

      state.resizing = true;
      state.resizeStartY = event.clientY;
      state.resizeStartHeight = state.managerPanelHeight;
      state.resizeHandle.classList.add("is-active");
      document.documentElement.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.resizing || !state.root?.isConnected) return;

      const nextHeight = clamp(
        state.resizeStartHeight + event.clientY - state.resizeStartY,
        96,
        Math.min(window.innerHeight * 0.58, 520)
      );
      setPanelHeight(nextHeight);
    });

    window.addEventListener("mouseup", async () => {
      if (!state.resizing) return;

      state.resizing = false;
      state.resizeHandle.classList.remove("is-active");
      document.documentElement.style.cursor = "";
      document.body.style.userSelect = "";

      await chrome.storage.local.set({ managerPanelHeight: state.managerPanelHeight });
    });
  }

  function setPanelHeight(height) {
    state.managerPanelHeight = Math.round(height);
    state.root.style.setProperty("--chzzk-manager-chat-height", `${state.managerPanelHeight}px`);
  }

  function startDockSync() {
    tryDockPanel();
    window.addEventListener("resize", tryDockPanel, { passive: true });

    if (state.dockTimer) window.clearInterval(state.dockTimer);
    state.dockTimer = window.setInterval(tryDockPanel, 2000);
  }

  function startLocationWatch() {
    if (state.locationTimer) window.clearInterval(state.locationTimer);

    state.locationTimer = window.setInterval(() => {
      const nextKey = getLocationKey();
      if (nextKey === state.locationKey) return;

      state.locationKey = nextKey;
      resetChatHistory();
      tryDockPanel();
    }, 500);
  }

  function getLocationKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function tryDockPanel() {
    if (!state.root) return;

    const target = findLiveChatTarget();
    if (!target) {
      if (state.root.isConnected) state.root.remove();
      state.dockHost = null;
      return;
    }

    dockPanel(target);
    state.root.style.setProperty("--chzzk-manager-chat-width", `${Math.round(target.width)}px`);
  }

  function dockPanel(target) {
    const { host, before } = target;

    if (state.root.parentElement === host && (!before || state.root.nextElementSibling === before)) {
      return;
    }

    host.insertBefore(state.root, before || host.firstChild);
    state.dockHost = host;
  }

  function findLiveChatTarget() {
    const selectors = [
      "[class*='live_chatting_container']",
      "[class*='live_chatting_area']",
      "[class*='chatting_container']",
      "[class*='chatting_area']",
      "[class*='chat_container']",
      "[class*='chat_area']"
    ];

    const firstMessage = document.querySelector(chatSelectorHints.join(","));
    const candidates = new Set();

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        candidates.add(element);
      }
    }

    let parent = firstMessage?.parentElement;
    let depth = 0;
    while (parent && depth < 9) {
      candidates.add(parent);
      parent = parent.parentElement;
      depth += 1;
    }

    const ranked = Array.from(candidates)
      .map((element) => {
        if (!(element instanceof HTMLElement) || state.root?.contains(element)) return null;
        const rect = element.getBoundingClientRect();
        const className = String(element.className || "");
        const containsMessage = firstMessage ? element.contains(firstMessage) : false;
        const messageLikePenalty = /message|comment|listitem/i.test(className) ? 20 : 0;
        const chatClassScore = /chat|chatting|live_chatting/i.test(className) ? 20 : 0;
        const messageScore = containsMessage ? 30 : 0;
        const rightSideScore = rect.right > window.innerWidth * 0.55 ? 8 : 0;
        const heightScore = rect.height > 240 ? 8 : 0;

        if (rect.width < 240 || rect.width > 680 || rect.height < 180) return null;
        if (rect.left < 0 || rect.top < 0) return null;

        return {
          element,
          rect,
          score: chatClassScore + messageScore + rightSideScore + heightScore - messageLikePenalty - Math.abs(rect.width - 360) / 100
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const host = ranked[0]?.element;
    if (!host) return null;

    const insertion = findChatListInsertion(host, firstMessage);
    return {
      host: insertion.host,
      before: insertion.before,
      width: ranked[0].rect.width,
      height: ranked[0].rect.height
    };
  }

  function findChatListInsertion(host, firstMessage) {
    if (!firstMessage || !host.contains(firstMessage)) {
      return { host, before: host.firstChild };
    }

    let node = firstMessage;
    let candidate = null;

    while (node.parentElement && node.parentElement !== host) {
      const parent = node.parentElement;
      const rect = parent.getBoundingClientRect();
      const className = String(parent.className || "");

      if (rect.height > 180 && rect.width > 200 && /chat|message|list|scroll|content/i.test(className)) {
        candidate = parent;
      }

      node = parent;
    }

    if (!candidate) {
      return { host, before: node };
    }

    const parent = candidate.parentElement;
    if (parent && host.contains(parent)) {
      return { host: parent, before: candidate };
    }

    return { host, before: node };
  }

  function collectChat(chat) {
    const normalized = {
      ...chat,
      nickname: normalize(chat.nickname || "매니저"),
      message: normalize(chat.message || "")
    };
    if (!normalized.message) return;

    const now = Date.now();
    const key = normalized.id
      ? `id:${normalized.id}`
      : `text:${normalized.role || ""}|${normalized.nickname}|${normalized.message}`;
    const textKey = `text:${normalized.role || ""}|${normalized.nickname}|${normalized.message}`;

    const lastSeen = state.recentKeys.get(key) || state.recentKeys.get(textKey) || 0;
    if (now - lastSeen < 90_000) return;

    state.recentKeys.set(key, now);
    state.recentKeys.set(textKey, now);
    trimRecentKeys(now);

    if (!state.list) {
      state.pendingChats.push(normalized);
      return;
    }

    appendChat(normalized);
  }

  function flushPendingChats() {
    const pending = state.pendingChats.splice(0);
    for (const chat of pending) {
      appendChat(chat);
    }
  }

  function appendChat(chat) {
    const empty = state.list.querySelector(".empty");
    if (empty) empty.remove();

    const shouldAutoScroll = state.stickToBottom || isListNearBottom();
    const previousScrollTop = state.list.scrollTop;
    let removedHeight = 0;

    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="meta">
        <span class="badge">매니저</span>
        <span class="nick"></span>
        <span class="time"></span>
      </div>
      <div class="message"></div>
    `;

    item.querySelector(".nick").textContent = chat.nickname;
    item.querySelector(".time").textContent = chat.time;
    item.querySelector(".message").textContent = chat.message;
    // Live chat order: older messages stay above, newest messages are added below.
    state.list.appendChild(item);

    while (state.list.querySelectorAll(".item").length > MAX_ITEMS) {
      const first = state.list.querySelector(".item");
      if (!first) break;
      const styles = getComputedStyle(first);
      removedHeight += first.offsetHeight
        + Number.parseFloat(styles.marginTop || "0")
        + Number.parseFloat(styles.marginBottom || "0");
      first.remove();
    }

    if (shouldAutoScroll) {
      scrollToBottom();
    } else if (removedHeight > 0) {
      state.list.scrollTop = Math.max(0, previousScrollTop - removedHeight);
    }
  }

  function resetChatHistory() {
    state.recentKeys.clear();
    state.pendingChats = [];
    state.stickToBottom = true;

    if (!state.list) return;
    state.list.innerHTML = `<div class="empty">매니저 채팅을 기다리는 중</div>`;
  }

  function trimRecentKeys(now) {
    for (const [key, timestamp] of state.recentKeys) {
      if (now - timestamp > 180_000) {
        state.recentKeys.delete(key);
      }
    }
  }

  function formatTime(value) {
    const date = new Date(Number(value) || Date.now());
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function isListNearBottom() {
    if (!state.list) return true;
    const distance = state.list.scrollHeight - state.list.scrollTop - state.list.clientHeight;
    return distance <= 24;
  }

  function scrollToBottom() {
    if (!state.list) return;
    state.list.scrollTop = state.list.scrollHeight;
    state.stickToBottom = true;
  }

  function normalize(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

})();
