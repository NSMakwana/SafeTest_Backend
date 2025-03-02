const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://safe-test-lake.vercel.app/" })); // Allow frontend requests

const API_KEY = "AIzaSyD9Qq1hrkdoiEkETiiegaZuqpnCK7hfoCI"; 
const PORT = process.env.PORT || 5000;

// Endpoint to fetch Google Form details
app.get("/fetch-form/:formId", async (req, res) => {
  const { formId } = req.params;
  try {
    const response = await axios.get(
      `https://forms.googleapis.com/v1/forms/${formId}?key=${API_KEY}`
    );
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error fetching form:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch form details." });
  }
});

//  Endpoint to submit Google Form responses
app.post("/submit-form", async (req, res) => {
  const { formId, answers } = req.body;
  try {
    const response = await axios.post(
      `https://forms.googleapis.com/v1/forms/${formId}:submit?key=${API_KEY}`,
      {
        responses: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          textAnswers: { answers: [{ value: answer }] },
        })),
      }
    );

    res.json({ success: true, response: response.data });
  } catch (error) {
    console.error(" Error submitting form:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to submit form." });
  }
});

app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
