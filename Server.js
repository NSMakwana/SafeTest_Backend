const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS to allow frontend to communicate with backend

// 🔹 Extract all form field IDs dynamically
app.post("/extract-fields", async (req, res) => {
  const { formLink } = req.body;

  if (!formLink.includes("viewform")) {
    return res.status(400).json({ error: "Invalid Google Form link" });
  }

  try {
    const browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--single-process",
        "--headless=new"
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath(),
    });
    
    const page = await browser.newPage();
    await page.goto(formLink, { waitUntil: "networkidle2" });

    // Extract all form field IDs dynamically
    const fieldNames = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input, select, textarea")).map(input => input.name);
    });

    await browser.close();
    res.json({ fieldNames });
  } catch (error) {
    console.error("Error extracting fields:", error);
    res.status(500).json({ error: "Failed to extract form fields" });
  }
});

// 🔹 Submit the form dynamically (No Separate Name & Email Fields)
app.post("/submit-exam", async (req, res) => {
  const { formLink, answers } = req.body;

  if (!formLink.includes("viewform")) {
    return res.status(400).json({ error: "Invalid Google Form link" });
  }

  try {
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.goto(formLink, { waitUntil: "networkidle2" });

    // Extract all form field IDs dynamically
    const fieldNames = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input, select, textarea")).map(input => input.name);
    });

    // 🔹 Fill all form fields dynamically
    for (let i = 0; i < fieldNames.length; i++) {
      if (answers[i]) {
        await page.type(`input[name='${fieldNames[i]}']`, answers[i]);
      }
    }

    // 🔹 Click Submit button
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation(),
    ]);

    await browser.close();
    res.json({ message: "Form submitted successfully" });
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).json({ error: "Failed to submit form" });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
