const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      responseType: "text",
    });

    let html = response.data;

    // Rewrite form action attribute to point directly to Google Forms absolute submission URL
    html = html.replace(
      /action="(\.\/)?formResponse[^"]*"/gi,
      `action="https://docs.google.com/forms/d/e/${formId}/formResponse?embedded=true"`
    );

    // Inject SafeTest Auto-Submit listener script right before </body>
    const injectedScript = `
    <script>
      (function() {
        console.log("🛡️ SafeTest Proctor Frame Listener Active");

        function triggerFormSubmit() {
          console.log("⚡ SafeTest: Auto-submitting Google Form on rule violation...");

          var btn = document.querySelector('div[role="button"][jsname="M2HAEc"]') ||
                    document.querySelector('div[role="button"][aria-label*="Submit" i]') ||
                    document.querySelector('div[role="button"][aria-label*="Send" i]') ||
                    document.querySelector('div[role="button"][aria-label*="Submit"]');

          if (btn) {
            var opts = { bubbles: true, cancelable: true, view: window };
            try { btn.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
            try { btn.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
            try { btn.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
            try { btn.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
            try { btn.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
            if (typeof btn.click === 'function') btn.click();
          }

          var form = document.querySelector('form');
          if (form) {
            try {
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.submit();
            } catch(err) {
              console.warn("Form submit notice:", err.message);
            }
          }
        }

        window.addEventListener("message", function(event) {
          if (event.data === "SAFETEST_AUTOSUBMIT" || (event.data && event.data.type === "SAFETEST_AUTOSUBMIT")) {
            triggerFormSubmit();
          }
        });
      })();
    </script>
    </body>`;

    html = html.replace("</body>", injectedScript);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.redirect(`https://docs.google.com/forms/d/e/${req.params.formId}/viewform?embedded=true`);
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
