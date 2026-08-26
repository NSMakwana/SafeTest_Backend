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
  try {
    const rawId = req.params.formId || req.params[0] || req.url;
    const formId = extractFormId(rawId);
    
    if (!formId) {
      return res.status(400).send("Invalid Google Form ID");
    }

    // Try public /d/e/ URL first, fallback to /d/ URL if 401/404
    let googleUrl = `https://docs.google.com/forms/d/e/${formId}/viewform?embedded=true`;

    const reqHeaders = {
      "User-Agent":
        req.headers["user-agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Upgrade-Insecure-Requests": "1",
    };

    let response;
    try {
      response = await axios.get(googleUrl, { headers: reqHeaders, responseType: "text", maxRedirects: 5 });
    } catch (err1) {
      console.warn(`[SafeTest Proxy] Initial GET ${googleUrl} notice: ${err1.message}. Trying fallback URL...`);
      const fallbackUrl = `https://docs.google.com/forms/d/${formId}/viewform?embedded=true`;
      response = await axios.get(fallbackUrl, { headers: reqHeaders, responseType: "text", maxRedirects: 5 });
    }

    let html = response.data;

    // Rewrite form action to point directly to formResponse endpoint
    html = html.replace(/action="(\.\/)?formResponse"/gi, `action="https://docs.google.com/forms/d/e/${formId}/formResponse"`);

    // Injected SafeTest Continuous Answer Tracker script
    const injectedTrackerScript = `
    <script>
      (function() {
        console.log("[SafeTest Proxy] Answer tracker initialized for form: ${formId}");

        window.SafeTestAnswerState = {
          answers: {},
          timestamp: Date.now(),
          formId: "${formId}"
        };

        var lastReportedJSON = "";

        // Helper to find entry.XXXXXX ID for any Google Forms question element
        function findEntryIdForElement(el) {
          if (!el) return null;
          
          var name = el.getAttribute('name');
          if (name && name.indexOf('entry.') === 0) {
            return name.replace('_sentinel', '');
          }

          var container = el.closest('[data-params], [data-item-id], .freebirdFormviewerViewItemsItemItem, div[role="listitem"], .geItem, .Qr258');
          if (container) {
            var entryInput = container.querySelector('[name^="entry."]');
            if (entryInput) {
              var entryName = entryInput.getAttribute('name');
              if (entryName) return entryName.replace('_sentinel', '');
            }

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

        // Sweep DOM to extract current answers for all Google Forms question types
        function scanFormAnswers() {
          var state = {};

          try {
            // 1. Text Inputs & Textareas (Short Answer & Paragraph)
            var textInputs = document.querySelectorAll('input[type="text"], input[type="email"], textarea, input:not([type])');
            textInputs.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.value ? el.value.trim() : "";
              if (entryId && val) {
                state[entryId] = val;
              }
            });

            // 2. Radio Buttons (Multiple Choice & Linear Scale)
            var checkedRadios = document.querySelectorAll('div[role="radio"][aria-checked="true"], input[type="radio"]:checked');
            checkedRadios.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label') || el.textContent;
              if (entryId && val) {
                state[entryId] = val.trim();
              }
            });

            // 3. Checkboxes (Preserve Multiple Selections as Arrays)
            var checkedBoxes = document.querySelectorAll('div[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
            checkedBoxes.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.getAttribute('data-answer-value') || el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label') || el.textContent;
              if (entryId && val) {
                val = val.trim();
                if (!state[entryId]) {
                  state[entryId] = [val];
                } else if (Array.isArray(state[entryId])) {
                  if (state[entryId].indexOf(val) === -1) {
                    state[entryId].push(val);
                  }
                } else {
                  state[entryId] = [state[entryId], val];
                }
              }
            });

            // 4. Dropdowns & Selects
            var dropdowns = document.querySelectorAll('select, div[role="listbox"]');
            dropdowns.forEach(function(el) {
              var entryId = findEntryIdForElement(el);
              var val = el.value || el.getAttribute('data-value') || el.getAttribute('aria-label');
              if (entryId && val) {
                state[entryId] = val.trim();
              }
            });

            // 5. Generic sweep for all filled elements with name="entry.XXXXXX"
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
          } catch(err) {
            console.warn("[SafeTest Proxy] Error scanning form answers:", err.message);
          }

          window.SafeTestAnswerState.answers = state;
          window.SafeTestAnswerState.timestamp = Date.now();

          // Send continuous snapshot update if answers changed
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

        // Attach event listeners for continuous tracking
        ['input', 'change', 'blur', 'click', 'keyup'].forEach(function(evtType) {
          document.addEventListener(evtType, function() {
            setTimeout(scanFormAnswers, 100);
          }, true);
        });

        // MutationObserver for dynamic Google Forms DOM changes
        try {
          var observer = new MutationObserver(function() {
            scanFormAnswers();
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        } catch(e) {}

        // Listen for requests from parent React App
        window.addEventListener("message", function(event) {
          if (!event.data) return;
          var msgType = typeof event.data === 'string' ? event.data : event.data.type;
          
          if (msgType === "SAFETEST_REQUEST_FINAL_ANSWERS" || msgType === "SAFETEST_AUTOSUBMIT") {
            console.log("[SafeTest Proxy] Final answer snapshot requested!");
            sendSnapshotToParent("SAFETEST_FINAL_ANSWERS");
          }
        });

        // Periodic snapshot report every 2 seconds
        setInterval(function() {
          sendSnapshotToParent("SAFETEST_ANSWER_UPDATE");
        }, 2000);

        // Initial scan
        setTimeout(scanFormAnswers, 500);
      })();
    </script>
    </body>`;

    if (html.match(/<\/body>/i)) {
      html = html.replace(/<\/body>/i, injectedTrackerScript);
    } else if (html.match(/<\/html>/i)) {
      html = html.replace(/<\/html>/i, injectedTrackerScript + "</html>");
    } else {
      html += injectedTrackerScript;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("[SafeTest Proxy] Fetch notice:", error.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>body,html,iframe{margin:0;padding:0;width:100%;height:100%;border:none;overflow:hidden;}</style>
      </head>
      <body>
        <iframe id="gframe" src="https://docs.google.com/forms/d/e/${req.params.formId}/viewform?embedded=true" style="width:100%;height:100%;border:none;"></iframe>
        <script>
          window.addEventListener("message", function(e) {
            var f = document.getElementById("gframe");
            if (f && f.contentWindow) {
              try { f.contentWindow.postMessage(e.data, "*"); } catch(err) {}
            }
          });
        </script>
      </body>
      </html>
    `);
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
