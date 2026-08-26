const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const querystring = require("querystring");
require("dotenv").config();

const { extractFormId, fetchFormDetails, submitFormResponse } = require("./googleFormHelper");
const authRoutes = require("./routes/authRoutes");
const examRoutes = require("./routes/examRoutes");
const Submission = require("./models/Submission");
const ExamRoom = require("./models/ExamRoom");
const ExamSession = require("./models/ExamSession");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/safetest";

// Connect to MongoDB Atlas
mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  })
  .then(() => {
    console.log(`✅ Connected to MongoDB Atlas at: ${MONGODB_URI.includes("@") ? MONGODB_URI.split("@")[1].split("/")[0] : MONGODB_URI}`);
  })
  .catch((err) => {
    console.warn("⚠️ MongoDB connection error:", err.message);
  });

// Health check endpoints
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "🚀 SafeTest Backend Server Running",
    database: mongoose.connection.readyState === 1 ? "connected" : "connecting/disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", dbState: mongoose.connection.readyState });
});

// Mount API Routes
app.use("/api/auth", authRoutes);
app.use("/api/exams", examRoutes);

// Fetch Form Details & Questions
app.get("/fetch-form-details/:formId", async (req, res) => {
  try {
    const rawId = req.params.formId;
    const formId = extractFormId(rawId);
    const details = await fetchFormDetails(formId);
    res.json({ success: true, ...details });
  } catch (error) {
    console.error("Error fetching form details:", error.message);
    res.status(500).json({ error: "Failed to fetch form details: " + error.message });
  }
});

// Reverse Proxy with SafeTest Injected Continuous Answer Tracker
app.get(["/proxy-form/:formId", "/proxy-form/*"], async (req, res) => {
  const rawId = req.params.formId || req.params[0] || req.url;
  const formId = extractFormId(rawId);

  console.log(`[SafeTest Proxy] Serving proxy for formId: "${formId}" (raw: "${rawId}")`);

  if (!formId) {
    return res.status(400).send("Invalid Google Form ID");
  }

  // Fetch clean viewform without embedded=true parameter (prevents 401 error from Google)
  const googleUrl = `https://docs.google.com/forms/d/e/${formId}/viewform`;

  try {
    const response = await axios.get(googleUrl, {
      headers: {
        "User-Agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      },
      responseType: "text",
      maxRedirects: 5,
    });

    let html = response.data;
    console.log(`[SafeTest Proxy] ✅ Fetched Google Form HTML for ${formId}: ${html.length} bytes`);

    // Rewrite form action to point directly to formResponse endpoint
    html = html.replace(/action="(\.\/)?formResponse"/gi, `action="https://docs.google.com/forms/d/e/${formId}/formResponse"`);

    const injectedScript = `
    <script>
      (function() {
        console.log("[SafeTest Proxy] Answer tracker initialized for form: ${formId}");
        window.SafeTestAnswerState = { answers: {}, timestamp: Date.now(), formId: "${formId}" };
        var lastReportedJSON = "";

        function findEntryIdForElement(el) {
          if (!el) return null;
          var name = el.getAttribute('name');
          if (name && name.indexOf('entry.') === 0) return name.replace('_sentinel', '');

          var container = el.closest('[data-params], [data-item-id], .freebirdFormviewerViewItemsItemItem, div[role="listitem"], .geItem, .Qr258');
          if (container) {
            var entryInput = container.querySelector('[name^="entry."]');
            if (entryInput && entryInput.getAttribute('name')) return entryInput.getAttribute('name').replace('_sentinel', '');
            var itemId = container.getAttribute('data-item-id');
            if (itemId) return 'entry.' + itemId;
            var params = container.getAttribute('data-params');
            if (params) {
              var match = params.match(/\[(\d{8,12}),/);
              if (match) return 'entry.' + match[1];
            }
          }
          return null;
        }

        function scanFormAnswers() {
          var state = {};
          try {
            var textInputs = document.querySelectorAll('input[type="text"], input[type="email"], textarea, input:not([type])');
            textInputs.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.value ? el.value.trim() : "";
              if (entryId && val) state[entryId] = val;
            });

            var checkedRadios = document.querySelectorAll('div[role="radio"][aria-checked="true"], input[type="radio"]:checked');
            checkedRadios.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label') || el.textContent;
              if (entryId && val) state[entryId] = val.trim();
            });

            var checkedBoxes = document.querySelectorAll('div[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
            checkedBoxes.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.getAttribute('data-answer-value') || el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label') || el.textContent;
              if (entryId && val) {
                val = val.trim();
                if (!state[entryId]) state[entryId] = [val];
                else if (Array.isArray(state[entryId]) && state[entryId].indexOf(val) === -1) state[entryId].push(val);
                else state[entryId] = [state[entryId], val];
              }
            });

            var dropdowns = document.querySelectorAll('select, div[role="listbox"]');
            dropdowns.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.value || el.getAttribute('data-value') || el.getAttribute('aria-label');
              if (entryId && val) state[entryId] = val.trim();
            });

            var allEntryInputs = document.querySelectorAll('[name^="entry."]');
            allEntryInputs.forEach(function(el) {
              var name = el.getAttribute('name');
              if (!name) return;
              var cleanName = name.replace('_sentinel', '');
              var type = el.getAttribute('type');
              if (type === 'radio' || type === 'checkbox') {
                if (el.checked && el.value) {
                  if (type === 'checkbox') {
                    if (!state[cleanName]) state[cleanName] = [el.value];
                    else if (Array.isArray(state[cleanName]) && state[cleanName].indexOf(el.value) === -1) state[cleanName].push(el.value);
                  } else {
                    state[cleanName] = el.value;
                  }
                }
              } else if (el.value) {
                state[cleanName] = el.value.trim();
              }
            });
          } catch(err) {}

          window.SafeTestAnswerState.answers = state;
          window.SafeTestAnswerState.timestamp = Date.now();

          var currentJSON = JSON.stringify(state);
          if (currentJSON !== lastReportedJSON && currentJSON !== "{}") {
            lastReportedJSON = currentJSON;
            console.log("[SafeTest Proxy] Answer changed:", Object.keys(state).length, "item(s)");
            sendSnapshotToParent("SAFETEST_ANSWER_UPDATE");
          }
          return state;
        }

        function sendSnapshotToParent(msgType) {
          scanFormAnswers();
          var payload = {
            type: msgType,
            answers: window.SafeTestAnswerState.answers,
            timestamp: window.SafeTestAnswerState.timestamp,
            formId: "${formId}"
          };
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(payload, "*");
            }
          } catch(e) {}
        }

        ['input', 'change', 'blur', 'click', 'keyup'].forEach(function(evtType) {
          document.addEventListener(evtType, function() { setTimeout(scanFormAnswers, 100); }, true);
        });

        try {
          var observer = new MutationObserver(function() { scanFormAnswers(); });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        } catch(e) {}

        window.addEventListener("message", function(event) {
          if (!event.data) return;
          var msgType = typeof event.data === 'string' ? event.data : event.data.type;
          if (msgType === "SAFETEST_REQUEST_FINAL_ANSWERS" || msgType === "SAFETEST_AUTOSUBMIT") {
            console.log("[SafeTest Proxy] Final answer snapshot requested!");
            sendSnapshotToParent("SAFETEST_FINAL_ANSWERS");
          }
        });

        setInterval(function() { sendSnapshotToParent("SAFETEST_ANSWER_UPDATE"); }, 2000);
        setTimeout(scanFormAnswers, 500);
      })();
    </script>
    </body>`;

    if (html.match(/<\/body>/i)) html = html.replace(/<\/body>/i, injectedScript);
    else if (html.match(/<\/html>/i)) html = html.replace(/<\/html>/i, injectedScript + "</html>");
    else html += injectedScript;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error(`[SafeTest Proxy] Server-side fetch notice for ${formId}: ${err.message}`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(`<h3>Failed to load form via proxy: ${err.message}</h3>`);
  }
});

// Proxy POST submission fallback for /proxy-form/formResponse
app.all(["/proxy-form/formResponse", "/proxy-form/:formId/formResponse"], express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const rawId = req.params.formId || (req.headers.referer ? extractFormId(req.headers.referer) : null);
    const formId = extractFormId(rawId);
    const postUrl = formId
      ? `https://docs.google.com/forms/d/e/${formId}/formResponse`
      : "https://docs.google.com/forms/d/e/formResponse";

    console.log(`[SafeTest Backend] Proxying POST form response to: ${postUrl}`);

    const response = await axios.post(postUrl, querystring.stringify(req.body), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(response.data);
  } catch (err) {
    console.warn("[SafeTest Backend] Proxy POST submit notice:", err.message);
    res.status(200).send("<h3>Your response has been recorded.</h3>");
  }
});

// Direct Form Response Submission Endpoint
app.post("/submit-form-response", async (req, res) => {
  try {
    const { formId, formLink, answers, fbzx } = req.body;
    const targetId = extractFormId(formId || formLink);

    if (!targetId) {
      return res.status(400).json({ error: "Missing formId or formLink" });
    }

    const result = await submitFormResponse(targetId, answers || {}, fbzx);
    res.json(result);
  } catch (error) {
    console.error("[SafeTest Backend] Submission failed:", error.message);
    res.status(500).json({ error: "Submission failed: " + error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 SafeTest Server running on port ${PORT}`);
});
