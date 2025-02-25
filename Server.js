const cors = require('cors'); 
const express = require("express");
const puppeteer = require("puppeteer");


const app = express();
const allowedOrigins = [
    "https://safe-test-lake.vercel.app",
   
    "http://localhost:3000" // For local development (optional, but recommended)
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) { // Allow requests with no origin (like Postman)
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    }
}));
app.use(express.json());

app.post("/extract-fields", async (req, res) => {
    const { formLink } = req.body;

    if (!formLink || !formLink.includes("viewform")) {
        return res.status(400).json({ error: "Invalid Google Form link" });
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(formLink, { waitUntil: 'networkidle2' });

        const fieldNames = await page.evaluate(() => {
            const inputs = document.querySelectorAll("input, textarea, select");
            return Array.from(inputs).map(input => ({
                name: input.name,
                type: input.tagName.toLowerCase(),
                id: input.id,
            }));
        });

        await browser.close();
        res.json({ fieldNames });
    } catch (error) {
        console.error("Error extracting fields:", error);
        res.status(500).json({ error: "Failed to extract form fields" });
    }
});

app.post("/submit-exam", async (req, res) => {
    const { formLink, studentName, studentEmail, answers } = req.body;

    if (!formLink || !formLink.includes("viewform")) {
        return res.status(400).json({ error: "Invalid Google Form link" });
    }

    try {
        const browser = await puppeteer.launch({
            headless: true, // Set to false for debugging
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(formLink, { waitUntil: 'networkidle2' });

        console.log("Page loaded. URL:", page.url());

        // Fill student name and email (using more flexible selectors)
        await page.type("input[name*='entry.'][type='text']", studentName);  // Adjust if needed
        await page.type("input[name*='entry.'][type='email']", studentEmail); // Adjust if needed

        for (const [field, answer] of Object.entries(answers)) {
            const inputSelector = `[name='${field}'], [id='${field}']`;
            try {
                const inputElement = await page.waitForSelector(inputSelector, { timeout: 5000 }); // 5-second timeout
                const inputType = await page.evaluate(el => el.type, inputElement);

                if (inputType === 'radio' || inputType === 'checkbox') {
                    // Handle radio buttons and checkboxes by value
                    await page.evaluate((el, val) => {
                        const elements = document.querySelectorAll(`input[name='${el.name}']`);
                        elements.forEach(element => {
                            if (element.value === val) {
                                element.click();
                            }
                        });
                    }, inputElement, answer);

                } else if (inputType === 'select-one') { // Handle dropdowns
                    await page.select(inputSelector, answer);

                } else {
                    await inputElement.type(answer);
                }
                console.log(`Filled field: ${field} with value: ${answer}`);

            } catch (fieldError) {
                console.error(`Error filling field ${field}:`, fieldError);
                // Optionally, throw the error to stop execution:
                // throw fieldError;
            }
        }

        console.log("Attempting to submit...");

        await Promise.all([
            page.click("button[type='submit']"), // Or a more specific selector
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        console.log("Navigation complete. URL after submit:", page.url());

        await browser.close();
        res.json({ message: "Form submitted successfully" });
    } catch (error) {
        console.error("Error submitting form:", error);
        res.status(500).json({ error: "Failed to submit form" });
    }
});

app.listen(5000, () => console.log("Server running on port 5000"));