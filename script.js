/**
 * script.js
 * ---------------------------------------------------------------
 * All behaviour for the Signal Desk console. Reads defaults from
 * window.APP_CONFIG (config.js) and never talks to anything other
 * than the Ollama base URL and n8n webhook the user has set.
 * ---------------------------------------------------------------
 */
(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var messages = []; // { role: 'user' | 'assistant', content: string }
  var thinking = false;
  var entryCount = 0;
  var followupCount = 0;

  // System prompt with ${MAX_FOLLOWUPS} filled in.
  var SYSTEM_PROMPT = (CFG.systemPrompt || "").replace(
    /\$\{MAX_FOLLOWUPS\}/g,
    String(CFG.maxFollowups != null ? CFG.maxFollowups : 3)
  );

  var els = {
    log: document.getElementById("log"),
    emptyState: document.getElementById("emptyState"),
    emptyHeadline: document.getElementById("emptyHeadline"),
    emptyBody: document.getElementById("emptyBody"),
    input: document.getElementById("inputBox"),
    sendBtn: document.getElementById("sendBtn"),
    sendHint: document.getElementById("sendHint"),
    statusLabel: document.getElementById("statusLabel"),
    clearBtn: document.getElementById("clearBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsPanel: document.getElementById("settingsPanel"),
    settingsHint: document.getElementById("settingsHint"),
    ollamaModel: document.getElementById("ollamaModel"),
    n8nWebhook: document.getElementById("n8nWebhook"),
    brandTitle: document.getElementById("brandTitle"),
    brandSub: document.getElementById("brandSub"),
    dotYou: document.getElementById("dotYou"),
    stateYou: document.getElementById("stateYou"),
    labelYou: document.getElementById("labelYou"),
    dotOllama: document.getElementById("dotOllama"),
    stateOllama: document.getElementById("stateOllama"),
    labelOllama: document.getElementById("labelOllama"),
    dotN8n: document.getElementById("dotN8n"),
    stateN8n: document.getElementById("stateN8n"),
    labelN8n: document.getElementById("labelN8n")
  };

  // ---------- apply config-driven copy & defaults ----------
  function applyConfig() {
    var copy = CFG.copy || {};
    if (copy.title) { document.title = copy.title + " — " + (copy.subtitle || ""); els.brandTitle.textContent = copy.title; }
    if (copy.subtitle) els.brandSub.textContent = copy.subtitle;
    if (copy.readyHeadline) els.emptyHeadline.textContent = copy.readyHeadline;
    els.emptyBody.textContent = copy.readyBody || "";
    els.input.setAttribute("placeholder", copy.inputPlaceholder || "type a message\u2026");
    els.sendHint.textContent = copy.sendHint || "";
    els.clearBtn.textContent = copy.clearLabel || "CLEAR";
    els.settingsHint.textContent = copy.settingsHint || "";
    if (copy.nodeLabels) {
      els.labelYou.textContent = copy.nodeLabels.you || "YOU";
      els.labelOllama.textContent = copy.nodeLabels.ollama || "OLLAMA";
      els.labelN8n.textContent = copy.nodeLabels.n8n || "N8N";
    }

    els.ollamaModel.value = (CFG.ollama && CFG.ollama.model) || "";
    els.n8nWebhook.value = (CFG.n8n && CFG.n8n.webhookUrl) || "";
  }

  // ---------- helpers ----------
  function setNode(dotEl, stateEl, cls, label) {
    dotEl.className = "node-dot " + cls;
    stateEl.textContent = label;
  }

  function setThinking(v) {
    thinking = v;
    els.statusLabel.textContent = v ? "awaiting response" : "idle";
    els.input.disabled = v;
    els.sendBtn.disabled = v || !els.input.value.trim();
    setNode(els.dotOllama, els.stateOllama, v ? "warn pulse" : (lastOllamaOk ? "on" : "off"), v ? "awaiting reply" : (lastOllamaOk ? "connected" : "unreachable"));
  }

  // Model is instructed to return {"type":"question"|"final","content":"..."}.
  // Falls back to treating the raw text as a final answer if parsing fails
  // (e.g. the model ignored the JSON instruction).
  function parseModelReply(raw) {
    var text = String(raw || "").trim();
    // strip accidental code fences just in case
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      var parsed = JSON.parse(text);
      if (parsed && (parsed.type === "question" || parsed.type === "final") && typeof parsed.content === "string") {
        return { type: parsed.type, content: parsed.content, malformed: false };
      }
    } catch (e) { /* fall through */ }
    return { type: "final", content: text, malformed: true };
  }

  function addEntry(role, text, subLabel) {
    if (els.emptyState) { els.emptyState.remove(); els.emptyState = null; }
    entryCount += 1;

    var row = document.createElement("div");
    row.className = "entry " + role;

    var label = document.createElement("div");
    label.className = "entry-label mono";
    var idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = "#" + String(entryCount).padStart(3, "0");
    var who = document.createElement("span");
    who.textContent = subLabel || (role === "user" ? "you" : role === "error" ? "error" : "assistant");
    label.appendChild(idx);
    label.appendChild(who);
    row.appendChild(label);

    var body = document.createElement("div");
    body.className = "entry-body";
    body.textContent = text;
    row.appendChild(body);

    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
    return row;
  }

  function addRelayTag(row, ok, text) {
    var tag = document.createElement("div");
    tag.className = "relay-tag mono " + (ok ? "ok" : "err");
    tag.textContent = text;
    row.appendChild(tag);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 140) + "px";
  }

  // ---------- Ollama connectivity ----------
  var lastOllamaOk = false;
  var pingTimer = null;

  function checkOllama() {
    fetch("/api/ollama-status").then(function (res) {
      if (!res.ok) throw new Error("bad status " + res.status);
      return res.json();
    }).then(function (data) {
      lastOllamaOk = !!(data && data.ok);
      var label = lastOllamaOk ? "connected" : (data && data.reason === "auth" ? "auth failed" : "unreachable");
      if (!thinking) setNode(els.dotOllama, els.stateOllama, lastOllamaOk ? "on" : "off", label);
    }).catch(function () {
      lastOllamaOk = false;
      if (!thinking) setNode(els.dotOllama, els.stateOllama, "off", "unreachable");
    });
  }

  function scheduleOllamaPing() {
    if (pingTimer) clearInterval(pingTimer);
    var interval = (CFG.ollama && CFG.ollama.pingIntervalMs) || 15000;
    pingTimer = setInterval(checkOllama, interval);
  }

  // ---------- Ollama chat call ----------
  function callOllama(conversation) {
    var model = els.ollamaModel.value.trim();
    var payload = {
      model: model,
      stream: false,
      format: "json", // ask Ollama to constrain output to valid JSON where the model supports it
      messages: [{ role: "system", content: SYSTEM_PROMPT }].concat(conversation)
    };
    return fetch("/api/ollama-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var extra = (res.status === 401 || res.status === 403) ? " \u2014 check OLLAMA_API_KEY in the Netlify site's environment variables." : "";
          throw new Error("Ollama returned HTTP " + res.status + extra + (t ? (": " + t) : ""));
        });
      }
      return res.json();
    }).then(function (data) {
      if (data && data.message && typeof data.message.content === "string") {
        return data.message.content;
      }
      throw new Error("Unexpected response shape from Ollama.");
    });
  }

  // ---------- n8n relay ----------
  function relayToN8n(userInput, llmOutput, row) {
    var url = els.n8nWebhook.value.trim();
    if (!url) {
      setNode(els.dotN8n, els.stateN8n, "off", "no webhook");
      addRelayTag(row, false, "not relayed \u2014 no n8n webhook URL set");
      return;
    }
    setNode(els.dotN8n, els.stateN8n, "warn pulse", "relaying\u2026");
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: userInput, llmOutput: llmOutput })
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().catch(function () { return {}; });
    }).then(function (data) {
      var testId = data && data.testId ? data.testId : "";
      setNode(els.dotN8n, els.stateN8n, "on", "relayed");
      addRelayTag(row, true, "relayed to n8n" + (testId ? " \u00b7 " + testId : ""));
    }).catch(function (err) {
      setNode(els.dotN8n, els.stateN8n, "off", "relay failed");
      addRelayTag(row, false, "n8n relay failed: " + err.message);
    });
  }

  // ---------- send flow ----------
  function send() {
    var text = els.input.value.trim();
    if (!text || thinking) return;

    els.input.value = "";
    autoGrow();
    setNode(els.dotYou, els.stateYou, "off", "idle");
    addEntry("user", text);
    messages.push({ role: "user", content: text });
    setThinking(true);

    callOllama(messages).then(function (reply) {
      // Keep the raw reply in history so the model sees its own prior
      // JSON output on the next turn, matching its own conventions.
      messages.push({ role: "assistant", content: reply });

      var parsed = parseModelReply(reply);
      var row;
      if (parsed.type === "question") {
        followupCount += 1;
        row = addEntry("assistant", parsed.content, "follow-up " + followupCount + (CFG.maxFollowups ? "/" + CFG.maxFollowups : ""));
      } else {
        row = addEntry("assistant", parsed.content, parsed.malformed ? "final \u00b7 unparsed" : "final answer");
      }
      relayToN8n(text, parsed.content, row);
    }).catch(function (err) {
      addEntry("error", "Couldn't reach Ollama: " + err.message + ". Check the Ollama URL/model in settings and that Ollama is running.");
    }).finally(function () {
      setThinking(false);
    });
  }

  // ---------- events ----------
  els.input.addEventListener("input", function () {
    autoGrow();
    var hasText = !!els.input.value.trim();
    els.sendBtn.disabled = thinking || !hasText;
    if (!thinking) setNode(els.dotYou, els.stateYou, hasText ? "on" : "off", hasText ? "typing" : "idle");
  });
  els.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  els.sendBtn.addEventListener("click", send);

  els.clearBtn.addEventListener("click", function () {
    messages = [];
    entryCount = 0;
    followupCount = 0;
    els.log.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "emptyState";
    var copy = CFG.copy || {};
    empty.innerHTML = '<div class="glyph"><span>&gt;</span></div>' +
      '<h2 class="mono">' + (copy.readyHeadline || "READY") + '</h2>' +
      '<p>' + (copy.readyBody || "") + '</p>';
    els.log.appendChild(empty);
    els.emptyState = empty;
  });

  els.settingsBtn.addEventListener("click", function () {
    els.settingsPanel.classList.toggle("open");
  });

  els.ollamaModel.addEventListener("change", checkOllama);
  els.n8nWebhook.addEventListener("change", function () {
    var hasHook = !!els.n8nWebhook.value.trim();
    setNode(els.dotN8n, els.stateN8n, hasHook ? "on" : "off", hasHook ? "ready" : "no webhook");
  });

  // ---------- init ----------
  applyConfig();
  checkOllama();
  scheduleOllamaPing();
  setThinking(false);
  setNode(els.dotYou, els.stateYou, "off", "idle");
  setNode(els.dotN8n, els.stateN8n, els.n8nWebhook.value.trim() ? "on" : "off", els.n8nWebhook.value.trim() ? "ready" : "no webhook");
})();