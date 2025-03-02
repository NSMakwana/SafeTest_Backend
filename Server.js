// const cors = require('cors');
// const express = require("express");
// const puppeteer = require("puppeteer");

// const app = express();
// const allowedOrigins = [
//     "https://safe-test-lake.vercel.app",
//     "http://localhost:3000" // Local development
// ];

// app.use(cors({
//     origin: function (origin, callback) {
//         if (!origin || allowedOrigins.includes(origin)) {
//             callback(null, true);
//         } else {
//             callback(new Error('Not allowed by CORS'));
//         }
//     }
// }));
// app.use(express.json());

// app.post("/extract-fields", async (req, res) => {
//     const { formLink } = req.body;

//     if (!formLink || !formLink.includes("viewform")) {
//         return res.status(400).json({ error: "Invalid Google Form link" });
//     }

//     try {
//         const browser = await puppeteer.launch({
//             headless: "new", // Fixes headless mode issues
//             executablePath: "/usr/bin/google-chrome-stable", // Uses Puppeteer's built-in Chromium
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });
        
//         const page = await browser.newPage();
//         await page.goto(formLink, { waitUntil: 'networkidle2' });

//         const fieldNames = await page.evaluate(() => {
//             return Array.from(document.querySelectorAll("input, textarea, select")).map(input => ({
//                 name: input.name,
//                 type: input.tagName.toLowerCase(),
//                 id: input.id,
//             }));
//         });

//         await browser.close();
//         res.json({ fieldNames });
//     } catch (error) {
//         console.error("Error extracting fields:", error);
//         res.status(500).json({ error: "Failed to extract form fields" });
//     }
// });

// app.post("/submit-exam", async (req, res) => {
//     const { formLink, studentName, studentEmail, answers } = req.body;

//     if (!formLink || !formLink.includes("viewform")) {
//         return res.status(400).json({ error: "Invalid Google Form link" });
//     }

//     try {
//         const browser = await puppeteer.launch({
//             headless: true,
//             executablePath: puppeteer.executablePath(),
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });

//         const page = await browser.newPage();
//         await page.goto(formLink, { waitUntil: 'networkidle2' });

//         console.log("Page loaded:", page.url());

//         // Fill student details
//         await page.type("input[type='text']", studentName);
//         await page.type("input[type='email']", studentEmail);

//         for (const [field, answer] of Object.entries(answers)) {
//             const inputSelector = `[name='${field}'], [id='${field}']`;

//             try {
//                 const inputElement = await page.waitForSelector(inputSelector, { timeout: 5000 });

//                 const inputType = await page.evaluate(el => el.type, inputElement);

//                 if (inputType === 'radio' || inputType === 'checkbox') {
//                     await page.evaluate((el, val) => {
//                         document.querySelectorAll(`input[name='${el.name}']`).forEach(element => {
//                             if (element.value === val) {
//                                 element.click();
//                             }
//                         });
//                     }, inputElement, answer);
//                 } else if (inputType === 'select-one') {
//                     await page.select(inputSelector, answer);
//                 } else {
//                     await inputElement.type(answer);
//                 }

//                 console.log(`Filled field: ${field} with value: ${answer}`);
//             } catch (fieldError) {
//                 console.error(`Error filling field ${field}:`, fieldError);
//             }
//         }

//         console.log("Submitting form...");
//         await Promise.all([
//             page.click("button[type='submit']"),
//             page.waitForNavigation({ waitUntil: 'networkidle2' }),
//         ]);

//         console.log("Form submitted successfully.");
//         await browser.close();
//         res.json({ message: "Exam submitted successfully due to rule violation" });
//     } catch (error) {
//         console.error("Error submitting form:", error);
//         res.status(500).json({ error: "Failed to submit form" });
//     }
// });

// app.listen(5000, () => console.log("Server running on port 5000"));
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

    const formData = new URLSearchParams();
    Object.entries(answers).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((val) => formData.append(key, val)); // Handle checkboxes
      } else {
        formData.append(key, value);
      }
    });

    await axios.post(formAction, formData, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    res.json({ success: true, message: "Form submitted successfully!" });
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).json({ success: false, message: "Failed to submit form." });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
