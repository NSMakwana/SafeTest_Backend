const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post("/submit-form", async (req, res) => {
  try {
    const { formAction, answers } = req.body;

    if (!formAction || !answers) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    const formData = new URLSearchParams();
    Object.entries(answers).forEach(([key, value]) => {
      formData.append(key, value);
    });

    await axios.post(formAction, formData, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    res.json({ success: true, message: "Form submitted successfully!" });
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).json({ success: false, message: "Failed to submit form." });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
