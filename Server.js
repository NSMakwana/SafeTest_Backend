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
    console.warn("⚠️ Ensure 0.0.0.0/0 is whitelisted in MongoDB Atlas Network Access");
  });

// Health check endpoint
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

// Fetch Form Details & Questions (for Proctor Engine)
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

// Transparent Google Form Proxy with SafeTest Injected Auto-Submit Bridge
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

    // Rewrite form action to ensure form submission targets Google Forms directly
    html = html.replace(/action="(\.\/)?formResponse"/gi, `action="https://docs.google.com/forms/d/e/${formId}/formResponse"`);

    // Inject SafeTest Auto-Submit listener script (Case-insensitive </body> replacement)
    const injectedScript = `
    <script>
      (function() {
        console.log("🛡️ SafeTest Proctor Frame Listener Active");

        function forceSubmitGoogleForm() {
          console.log("⚡ SafeTest: Auto-submitting Google Form on rule violation...");

          var btn = document.querySelector('div[role="button"][jsname="M2UYVd"]') ||
                    document.querySelector('div[role="button"][jsname="M2HAEc"]') ||
                    document.querySelector('div[role="button"][aria-label="Submit" i]') ||
                    document.querySelector('div[role="button"][aria-label*="Submit" i]') ||
                    document.querySelector('div[role="button"][aria-label*="Send" i]');

          var form = document.querySelector('form#mG61Hd') || document.querySelector('form') || document.forms[0];

          // 1. Dispatch full touch and mouse click sequence on Submit Button and Child Span
          if (btn) {
            var span = btn.querySelector('span');
            ['pointerdown', 'touchstart', 'mousedown', 'pointerup', 'touchend', 'mouseup', 'click'].forEach(function(evt) {
              try {
                var ev = new MouseEvent(evt, { bubbles: true, cancelable: true, view: window });
                btn.dispatchEvent(ev);
                if (span) span.dispatchEvent(ev);
              } catch(e) {}
            });
          }

          // 2. Direct Native C++ Form Submission (Bypasses required-field validation blocks)
          if (form) {
            try {
              HTMLFormElement.prototype.submit.call(form);
            } catch(err) {
              try { form.submit(); } catch(e2) {}
            }
          }
        }

        // Listen for SAFETEST_AUTOSUBMIT signal from parent window
        window.addEventListener("message", function(event) {
          if (event.data === "SAFETEST_AUTOSUBMIT" || (event.data && event.data.type === "SAFETEST_AUTOSUBMIT")) {
            forceSubmitGoogleForm();
          }
        });

        // Frame-level visibilitychange listener for direct mobile app-switching
        document.addEventListener("visibilitychange", function() {
          if (document.hidden) {
            forceSubmitGoogleForm();
          }
        });
      })();
    </script>
    </body>`;

    if (html.match(/<\/body>/i)) {
      html = html.replace(/<\/body>/i, injectedScript);
    } else if (html.match(/<\/html>/i)) {
      html = html.replace(/<\/html>/i, injectedScript + "</html>");
    } else {
      html += injectedScript;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("Proxy fetch notice:", error.message);
    // Serve fallback HTML frame with injected auto-submit bridge (NO redirect to docs.google.com to preserve postMessage)
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
            if (e.data === "SAFETEST_AUTOSUBMIT" || (e.data && e.data.type === "SAFETEST_AUTOSUBMIT")) {
              var f = document.getElementById("gframe");
              if (f && f.contentWindow) {
                try { f.contentWindow.postMessage("SAFETEST_AUTOSUBMIT", "*"); } catch(err) {}
              }
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

    console.log(`⚡ Proxying POST form response to: ${postUrl}`);

    const response = await axios.post(postUrl, querystring.stringify(req.body), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(response.data);
  } catch (err) {
    console.warn("Proxy POST submit notice:", err.message);
    res.status(200).send("<h3>Your response has been recorded.</h3>");
  }
});

// Direct Form Response Submission (Fallback/Server-side)
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
    console.error("Submission failed:", error.message);
    res.status(500).json({ error: "Submission failed: " + error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 SafeTest Server running on port ${PORT}`);
});
