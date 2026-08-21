const axios = require('axios');
const querystring = require('querystring');

// Helper to extract Form ID from any Google Form URL correctly
function extractFormId(urlOrId) {
  if (!urlOrId) return null;
  if (urlOrId.includes('http')) {
    const match = urlOrId.match(/\/d\/e\/([^/]+)/) || urlOrId.match(/\/d\/([^/]+)/);
    return match ? match[1] : urlOrId;
  }
  return urlOrId;
}

// Fetch public form structure, entry IDs, and fbzx token
async function fetchFormDetails(urlOrId) {
  const formId = extractFormId(urlOrId);
  
  let viewUrl = urlOrId.startsWith('http') ? urlOrId : `https://docs.google.com/forms/d/e/${formId}/viewform`;
  if (!viewUrl.includes('viewform')) {
    viewUrl = viewUrl.replace(/\/edit.*$/, '/viewform');
  }
  
  const response = await axios.get(viewUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    maxRedirects: 5
  });

  const finalUrl = response.request?.res?.responseUrl || response.config?.url || viewUrl;
  const publicIdMatch = finalUrl.match(/\/d\/e\/([^/]+)/);
  const realPublicId = publicIdMatch ? publicIdMatch[1] : formId;

  const html = response.data;
  
  // Extract fbzx token required by Google Forms for submission
  const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/) || html.match(/"fbzx"\s*,\s*"([^"]+)"/);
  const fbzx = fbzxMatch ? fbzxMatch[1] : "";

  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(.+?);<\/script>/s);
  if (!match) {
    throw new Error('Could not parse Google Form details. Ensure the form is set to public.');
  }

  const data = JSON.parse(match[1]);
  const formTitle = data[1][8] || data[1][0] || "Google Form";
  const items = data[1][1] || [];
  // data[1][10][1]: 0 = do not collect, 1 = responder input, 2 = verified
  const emailSetting = data[1][10]?.[1] ?? 0;
  const collectEmail = emailSetting === 1; // Only show email field for "Responder input"

  const questions = [];

  if (collectEmail) {
    questions.push({
      title: "Email Address",
      entryId: "emailAddress",
      questionId: "emailAddress",
      type: 0,
      options: [],
      isRequired: true
    });
  }

  items.forEach(item => {
    if (item && item[4] && item[4][0]) {
      const title = item[1];
      const entryId = `entry.${item[4][0][0]}`;
      const questionId = item[0];
      const type = item[4][0][3];
      const rawOptions = item[4][0][1];
      const options = rawOptions ? rawOptions.map(o => o[0]).filter(Boolean) : [];

      questions.push({
        title,
        entryId,
        questionId,
        type,
        options
      });
    }
  });

  return { formId: realPublicId, realPublicId, fbzx, formTitle, collectEmail, questions };
}

// Submit answers directly to Google Forms formResponse endpoint
async function submitFormResponse(formId, answers) {
  let details;
  try {
    details = await fetchFormDetails(formId);
  } catch (e) {
    console.warn("Could not fetch form details before submitting:", e.message);
    details = { realPublicId: extractFormId(formId), fbzx: "" };
  }

  const cleanId = details.realPublicId;
  const postUrl = `https://docs.google.com/forms/d/e/${cleanId}/formResponse`;
  console.log(`Posting form response to: ${postUrl}`);

  const formData = {
    fvv: '1',
    pageHistory: '0'
  };

  if (details.fbzx) {
    formData.fbzx = details.fbzx;
  }

  let answerCount = 0;
  for (const [key, value] of Object.entries(answers || {})) {
    if (value !== undefined && value !== null && value !== '') {
      if (key === 'emailAddress') {
        formData.emailAddress = value;
      } else {
        const entryKey = key.startsWith('entry.') ? key : `entry.${key}`;
        formData[entryKey] = value;
      }
      answerCount++;
    }
  }

  console.log(`Submitting ${answerCount} answered question(s) (email: ${formData.emailAddress || 'none'}) with fbzx: ${details.fbzx || 'none'}`);

  const encodedData = querystring.stringify(formData);

  const res = await axios.post(postUrl, encodedData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  return res.status === 200 || res.status === 302;
}

module.exports = { extractFormId, fetchFormDetails, submitFormResponse };


