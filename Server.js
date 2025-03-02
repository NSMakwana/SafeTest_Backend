const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
require("dotenv").config(); // Load environment variables from .env file

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://safe-test-lake.vercel.app" })); // Allow frontend requests

const PORT = process.env.PORT || 5000;
const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS; // Load from environment variable

// Create an auth client
const auth = new google.auth.GoogleAuth({
  keyFile: keyFilePath, 
  scopes: ["https://www.googleapis.com/auth/forms.responses.readonly"],
});

const forms = google.forms({ version: "v1", auth });

// Endpoint to fetch Google Form details
app.get("/fetch-form/:formId", async (req, res) => {
  const { formId } = req.params;
  try {
    const response = await forms.forms.get({
      formId,
    });
    res.json(response.data);
  } catch (error) {
    console.error(" Error fetching form:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch form details." });
  }
});

// Endpoint to submit Google Form responses
app.post("/submit-form", async (req, res) => {
  const { formId, answers } = req.body;
  try {
    const response = await forms.forms.responses.create({
      formId,
      requestBody: {
        responses: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          textAnswers: { answers: [{ value: answer }] },
        })),
      },
    });
    res.json({ success: true, response: response.data });
  } catch (error) {
    console.error("Error submitting form:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to submit form." });
  }
});

app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
