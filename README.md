# Ollama Test Case Chatbot → n8n → Google Sheets

A minimal prototype proving out this pipeline:

```
Netlify (static UI + serverless proxy)  →  Ollama  →  n8n webhook  →  Google Sheets
```

The browser never talks to Ollama directly. It calls same-origin Netlify
Functions (`/api/ollama-chat`, `/api/ollama-status`), which hold the real
Ollama URL and API key as server-side environment variables and forward the
request. This avoids the CORS restrictions on Ollama's hosted API and keeps
the API key out of the page source. n8n is called once per turn, directly
from the browser, to relay the exchange — no secret is involved there so
that call can stay client-side.

---

## 0. Deploy to Netlify

**A. Push this folder to a GitHub repo**, then in Netlify: **Add new site →
Import an existing project** → pick the repo. Netlify will read
`netlify.toml` automatically (`publish = "."`, `functions =
"netlify/functions"`) — no build command needed.

*(Or, for a quick one-off: `netlify deploy --prod` from this folder using the
[Netlify CLI](https://docs.netlify.com/cli/get-started/), no git required.)*

**B. Set environment variables** — Site configuration → Environment
variables → Add a variable:

| Key | Value |
|---|---|
| `OLLAMA_BASE_URL` | `https://ollama.com` (or your endpoint) |
| `OLLAMA_API_KEY` | your Ollama API key |

**C. Redeploy** (env var changes require a new deploy to take effect —
trigger one from the Netlify UI, or `git push` again).

**D. Test it**: open the deployed URL, check the OLLAMA node in the pipeline
diagram turns green, then send a message.

To test locally against the real functions before deploying: copy
`.env.example` to `.env`, fill in the two values, then run
`netlify dev` (Netlify CLI) from this folder — it serves `index.html` and
runs the functions on `http://localhost:8888` with `.env` loaded.

---

## 1. Requirements

- [Ollama](https://ollama.com) installed locally
- A modern browser
- Any static file server (or just open `index.html` directly)
- An n8n instance (this prototype uses n8n cloud: `mayankn8n.app.n8n.cloud`)
- A Google account with access to Google Sheets

## 2. Install & run Ollama

```bash
# install Ollama, then pull a lightweight model
ollama pull llama3.2

# Ollama needs to allow browser (CORS) requests from your local page.
# On macOS/Linux:
OLLAMA_ORIGINS="*" ollama serve

# On Windows (PowerShell):
$env:OLLAMA_ORIGINS="*"; ollama serve
```

If `ollama serve` is already running as a background service, stop it first
(`ollama stop` / kill the process / disable the login-item service) then
restart it with `OLLAMA_ORIGINS` set, otherwise the browser's `fetch()` calls
will be blocked by CORS.

Ollama listens on `http://localhost:11434` by default — this matches
`config.js`.

## 3. Run the frontend

No build step needed. Either:

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

or just double-click `index.html` to open it in a browser.

## 4. Configure `config.js`

`config.js` no longer holds a URL or API key — those live server-side as
Netlify environment variables (see section 0). The only Ollama setting left
here is the model name:

```javascript
window.APP_CONFIG = {
  ollama: {
    model: "gpt-oss:120b",   // change to any model available at OLLAMA_BASE_URL
    pingIntervalMs: 15000
  },
  n8n: {
    webhookUrl: "https://mayankn8n.app.n8n.cloud/webhook/test-case"
  },
  maxFollowups: 3,
  // ...
};
```

The model field is also editable live from the Settings panel in the UI.

## 5. How the chatbot works

1. You enter a **Test Case ID** and an **Initial Input** and click **Start Test**.
2. The initial input is sent to Ollama along with a system prompt that tells
   it to act as an intake assistant: it works through predefined categories
   (identify the situation → relevant entities → missing facts → context →
   confirmation → final response), asking **one question at a time**, never
   repeating a question, and capped at `MAX_FOLLOWUPS` follow-ups.
3. Ollama replies with strict JSON (`{"type":"question"|"final","content":"..."}`)
   so the frontend can tell a follow-up question from the final answer
   without any hardcoded question list.
4. You answer each question in the message box; the full exchange is kept in
   memory as `conversation = [{role, content}, ...]`.
5. Once Ollama returns `type: "final"`, the **Complete Test** button
   activates.
6. Clicking **Complete Test** builds:
   ```json
   {
     "testId": "...",
     "initialInput": "...",
     "conversation": [...],
     "finalResponse": "...",
     "status": "Completed",
     "timestamp": "..."
   }
   ```
   and POSTs it once to the n8n webhook.

## 6. n8n workflow architecture

Created via the n8n MCP: **"Ollama Chatbot Test Case - Google Sheets Automation"**
(workflow ID `1OhabudD3FFeYBpf`).

```
Test Case Webhook (POST /test-case)
        ↓
Validate And Format  (Code node: checks required fields,
                       turns the conversation array into readable
                       "ROLE:\ncontent" text)
        ↓
   Is Valid? (If)
   ├── true  → Upsert Test Case Row (Google Sheets: "Append or Update",
   │            matched on "Test ID" — new IDs are appended, existing
   │            IDs are updated, so re-running a test never duplicates it)
   │              ├── success → Respond Success   (200, JSON)
   │              └── error   → Respond Sheets Error (500, JSON)
   └── false → Respond Validation Error (400, JSON)
```

Webhook URLs (from the created workflow):

| Purpose | URL |
|---|---|
| Test (fires once after clicking "Test workflow" in the n8n editor) | `https://mayankn8n.app.n8n.cloud/webhook-test/test-case` |
| Production (works anytime, requires the workflow to be **Activated**) | `https://mayankn8n.app.n8n.cloud/webhook/test-case` |

## 7. Google Sheets setup — manual step required

The workflow logic was built and test-executed via the n8n MCP, but it
**cannot finish the Google Sheets step yet** because no Google Sheets
credential exists in this n8n account. This must be done manually:

1. In n8n, open the workflow → the **"Upsert Test Case Row"** node.
2. Under **Credential**, click **Create New** → sign in with the Google
   account that owns (or should own) the tracking spreadsheet.
3. Create a Google Sheet with these column headers in row 1:

   | Test ID | Initial Input | Conversation | Final Response | Status | Timestamp |
   |---|---|---|---|---|---|

4. In the node, set **Document** to that spreadsheet and **Sheet** to the
   correct tab (currently both are empty placeholders).
5. Save the node, then click **Activate** on the workflow (top-right toggle)
   so the production webhook URL is live.

Until step 4 is done, test executions will fail at this node with
`Parameter "Document" is required` / `Parameter "Sheet" is required` — this
was confirmed by running the workflow via MCP.

## 8. Testing the complete system

1. Complete section 7 above (credential + Document/Sheet + Activate).
2. Start Ollama (`OLLAMA_ORIGINS="*" ollama serve`) and pull a model.
3. Serve/open `index.html`.
4. Enter Test Case ID `TC-006` and initial input:
   *"Police officer checks a two-wheeler carrying three people without helmets."*
5. Click **Start Test**, answer Ollama's follow-up questions (vehicle type,
   number of people, helmet status, etc.) until it returns a final response.
6. Click **Complete Test**.
7. Check the status bar — it should show
   `Saved: Test case stored successfully`.
8. Open the Google Sheet and confirm a row exists with the Test ID, initial
   input, full formatted conversation, final response, status
   `Completed`, and a timestamp.
9. Run the same Test ID again with a different final answer — confirm the
   **same row updates** instead of a new row being appended.

## 9. Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| OLLAMA node stays red / "unreachable" on the deployed site | `OLLAMA_BASE_URL`/`OLLAMA_API_KEY` not set, or set but not redeployed | Check Site configuration → Environment variables in Netlify, then trigger a new deploy |
| OLLAMA node shows "auth failed" | `OLLAMA_API_KEY` wrong or expired | Regenerate the key at ollama.com and update the Netlify env var |
| Status dot stays red locally / "Could not reach Ollama" | Running via `python3 -m http.server` instead of `netlify dev` | The functions only run under `netlify dev` (or once deployed) — a plain static server can't serve `/api/ollama-chat` |
| Ollama replies with plain text instead of asking questions | Model ignoring `format: "json"` | Try a different model, e.g. `llama3.2` or `qwen2.5` |
| "Could not reach the n8n webhook" | Wrong URL, or workflow not active/tested | Use the **test** URL after clicking "Test workflow", or activate the workflow for the **production** URL |
| `success: false, message: "Google Sheets error: ..."` | Credential not configured, or Document/Sheet not selected | Follow section 7 |
| `success: false, message: "Missing ..."` | A required field was empty when Complete Test was clicked | Make sure the test actually reached a `final` response before completing |
| New row created instead of updating existing Test ID | Test ID typed differently between runs (case/whitespace) | Reuse the exact same Test ID string |

## 10. Project structure

```
ollama-n8n-chatbot/
├── index.html                        Chat UI markup
├── style.css                         Styling
├── config.js                         Model name, n8n webhook, prompt, copy (no secrets)
├── script.js                         Conversation logic, calls /api/ollama-*, n8n POST
├── netlify.toml                      Publish dir + function routing (/api/ollama-* redirects)
├── netlify/functions/ollama-chat.js  Server-side Ollama /api/chat proxy (holds OLLAMA_API_KEY)
├── netlify/functions/ollama-status.js Server-side Ollama /api/tags proxy, for the pipeline dot
├── .env.example                      Template for local `netlify dev` testing
└── README.md                         This file
```
#   n 8 n s a d a k s a h a y a k  
 #   n 8 n s a d a k s a h a y a k 1  
 #   n 8 n s a d a k s a h a y a k 1  
 