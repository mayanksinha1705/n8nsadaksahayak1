/**
 * netlify/functions/ollama-status.js
 * ---------------------------------------------------------------
 * Server-side proxy for the Ollama /api/tags call, used only to
 * light up the OLLAMA node in the pipeline diagram. Same reasoning
 * as ollama-chat.js: keeps OLLAMA_API_KEY out of the browser.
 * ---------------------------------------------------------------
 */

exports.handler = async function () {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const apiKey = process.env.OLLAMA_API_KEY || "7be24f9d5a33471295a70f7b32643a83";

  const headers = {};
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

  try {
    const upstream = await fetch(baseUrl + "/api/tags", { headers: headers });
    if (!upstream.ok) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          reason: upstream.status === 401 || upstream.status === 403 ? "auth" : "http_" + upstream.status
        })
      };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, reason: "unreachable" })
    };
  }
};
