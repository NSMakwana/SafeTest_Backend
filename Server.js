const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

// 🔹 Route to Extract Google Form Field Names
app.post("/extract-fields", async (req, res) => {
    const { formLink } = req.body;

    if (!formLink || !formLink.includes("viewform")) { // More robust check
        return res.status(400).json({ error: "Invalid Google Form link" });
    }

    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Crucial for server environments
        });
        const page = await browser.newPage();

        await page.goto(formLink, { waitUntil: 'networkidle2' }); // Wait for page to fully load

        const fieldNames = await page.evaluate(() => {
            const inputs = document.querySelectorAll("input, textarea, select");
            return Array.from(inputs).map(input => ({
                name: input.name,
                type: input.tagName.toLowerCase(),
                id: input.id, // Include the ID as well, it might be used
            }));
        });

        await browser.close();
        res.json({ fieldNames });
    } catch (error) {
        console.error("Error extracting fields:", error);
        res.status(500).json({ error: "Failed to extract form fields" });
    }
});

// 🔹 Route to Submit Form Data Automatically
app.post("/submit-exam", async (req, res) => {
    const { formLink, studentName, studentEmail, answers } = req.body;

    if (!formLink || !formLink.includes("viewform")) { // More robust check
        return res.status(400).json({ error: "Invalid Google Form link" });
    }

    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Crucial for server environments
        });
        const page = await browser.newPage();
        await page.goto(formLink, { waitUntil: 'networkidle2' }); // Wait for the page to load

        // 🔹 Fill in the form dynamically (Improved)
        await page.type("input[name*='entry.'][type='text']", studentName); // More flexible selector
        await page.type("input[name*='entry.'][type='email']", studentEmail); // More flexible selector

        for (const [field, answer] of Object.entries(answers)) {
            const inputSelector = `[name='${field}'], [id='${field}']`; // Try name, then ID
            const inputElement = await page.waitForSelector(inputSelector); // Wait for input to exist
            const inputType = await page.evaluate(el => el.type, inputElement);
            
            if (inputType === 'radio' || inputType === 'checkbox') {
                await inputElement.click(); // Handle radio buttons and checkboxes
            } else {
                await inputElement.type(answer);
            }
        }

        // 🔹 Submit the form (Improved)
        await Promise.all([
            page.click("button[type='submit']"), // Or a more specific selector if needed
            page.waitForNavigation({ waitUntil: 'networkidle2' }), // Wait for navigation to complete
        ]);

        await browser.close();
        res.json({ message: "Form submitted successfully" });
    } catch (error) {
        console.error("Error submitting form:", error);
        res.status(500).json({ error: "Failed to submit form" });
    }
});

app.listen(5000, () => console.log("Server running on port 5000"));