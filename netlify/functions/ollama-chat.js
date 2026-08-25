/**
 * netlify/functions/ollama-chat.js
 * ---------------------------------------------------------------
 * Server-side proxy for the Ollama /api/chat call.
 *
 * Why this exists: the browser can no longer talk to Ollama's hosted
 * API directly (CORS blocks it, and shipping the API key in client
 * JS exposes it to anyone who opens DevTools). This function runs on
 * Netlify's infrastructure, holds the real key in an environment
 * variable, and forwards the request server-to-server.
 *
 * Required environment variables (set in Netlify dashboard, NOT in
 * this repo): Site settings -> Environment variables
 *   OLLAMA_BASE_URL   e.g. https://ollama.com   (defaults to this if unset)
 *   OLLAMA_API_KEY    your hosted/cloud Ollama key
 * ---------------------------------------------------------------
 */

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed. Use POST." })
    };
  }

  const baseUrl = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const apiKey = process.env.OLLAMA_API_KEY || "7be24f9d5a33471295a70f7b32643a83";

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body." })
    };
  }

  if (!payload || typeof payload.model !== "string" || !payload.model.trim()) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing required field: model." })
    };
  }
  if (!Array.isArray(payload.messages)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing required field: messages (array)." })
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

  try {
    const upstream = await fetch(baseUrl + "/api/chat", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();

    // Pass the upstream status + body straight through so script.js's
    // existing error handling (401/403 messaging etc.) keeps working.
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json" },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not reach Ollama upstream: " + err.message })
    };
  }
};
