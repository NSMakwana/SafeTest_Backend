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
app.get("/proxy-form/:formId", async (req, res) => {
  try {
    const rawId = req.params.formId;
    const formId = extractFormId(rawId);
    const googleUrl = `https://docs.google.com/forms/d/e/${formId}/viewform?embedded=true`;

    const response = await axios.get(googleUrl, {
      headers: {
        "User-Agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
        Cookie: req.headers.cookie || "",
      },
      responseType: "text",
    });

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

        // Sweep DOM to extract current answers for all Google Forms question types
        function scanFormAnswers() {
          var state = {};

          try {
            // 1. Text Inputs & Textareas (Short Answer & Paragraph)
            var textInputs = document.querySelectorAll('input[type="text"], input[type="email"], textarea, input:not([type])');
            textInputs.forEach(function(el) {
              var name = el.getAttribute('name');
              var entryId = name || el.getAttribute('data-initial-value');
              
              if (!entryId && el.name) entryId = el.name;
              
              // Find entry ID from name="entry.XXXXXX"
              if (name && name.indexOf('entry.') === 0) {
                var val = el.value ? el.value.trim() : "";
                if (val) state[name] = val;
              }
            });

            // 2. Radio Buttons (Multiple Choice & Linear Scale)
            var radios = document.querySelectorAll('div[role="radio"][aria-checked="true"], input[type="radio"]:checked');
            radios.forEach(function(el) {
              var entryId = el.getAttribute('name') || el.getAttribute('data-entry-id');
              var val = el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label');

              if (!entryId) {
                var parentContainer = el.closest('[data-params]');
                if (parentContainer) {
                  var paramsStr = parentContainer.getAttribute('data-params');
                  var entryMatch = paramsStr ? paramsStr.match(/entry\.(\d+)/) : null;
                  if (entryMatch) entryId = 'entry.' + entryMatch[1];
                }
              }

              if (entryId && val) {
                state[entryId] = val.trim();
              }
            });

            // 3. Checkboxes (Preserve Multiple Selections as Arrays)
            var checkboxes = document.querySelectorAll('div[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
            checkboxes.forEach(function(el) {
              var entryId = el.getAttribute('name') || el.getAttribute('data-entry-id');
              var val = el.getAttribute('data-answer-value') || el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-label');

              if (!entryId) {
                var parentContainer = el.closest('[data-params]');
                if (parentContainer) {
                  var paramsStr = parentContainer.getAttribute('data-params');
                  var entryMatch = paramsStr ? paramsStr.match(/entry\.(\d+)/) : null;
                  if (entryMatch) entryId = 'entry.' + entryMatch[1];
                }
              }

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
            var selects = document.querySelectorAll('select, div[role="listbox"]');
            selects.forEach(function(el) {
              var name = el.getAttribute('name');
              var val = el.value || el.getAttribute('data-value');
              if (name && name.indexOf('entry.') === 0 && val) {
                state[name] = val.trim();
              }
            });

            // 5. Date & Time Inputs
            var dateInputs = document.querySelectorAll('input[type="date"], input[type="time"]');
            dateInputs.forEach(function(el) {
              var name = el.getAttribute('name');
              if (name && name.indexOf('entry.') === 0 && el.value) {
                state[name] = el.value.trim();
              }
            });

            // 6. Generic Sweep for all name="entry.XXXXXX" elements
            var allEntryInputs = document.querySelectorAll('[name^="entry."]');
            allEntryInputs.forEach(function(el) {
              var name = el.getAttribute('name');
              if (!name) return;

              var type = el.getAttribute('type');
              if (type === 'radio' && !el.checked) return;
              if (type === 'checkbox' && !el.checked) return;

              var val = el.value;
              if (val !== undefined && val !== null && val !== '') {
                if (type === 'checkbox') {
                  if (!state[name]) state[name] = [val];
                  else if (Array.isArray(state[name]) && state[name].indexOf(val) === -1) state[name].push(val);
                } else {
                  state[name] = val;
                }
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
        ['input', 'change', 'blur', 'click'].forEach(function(evtType) {
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

        // Periodic snapshot report every 3 seconds
        setInterval(function() {
          sendSnapshotToParent("SAFETEST_ANSWER_UPDATE");
        }, 3000);

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
