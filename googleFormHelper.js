const axios = require('axios');
const querystring = require('querystring');

// Helper to extract Form ID from any Google Form URL correctly
function extractFormId(urlOrId) {
  if (!urlOrId) return null;
  let str = String(urlOrId).trim();
  try { str = decodeURIComponent(str); } catch(e) {}

  if (str.includes('/d/e/')) {
    const match = str.match(/\/d\/e\/([^/?#]+)/);
    if (match && match[1]) return match[1];
  }

  if (str.includes('/d/')) {
    const match = str.match(/\/d\/([^/?#]+)/);
    if (match && match[1]) return match[1];
  }

  // Strip leading slashes, protocols, proxy-form prefixes
  str = str
    .replace(/^(https?:\/\/[^/]+)?\/?(proxy-form\/)?/, '')
    .replace(/^\/+/, '')
    .replace(/\/(viewform|edit).*$/, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '');

  const idMatch = str.match(/([a-zA-Z0-9_-]{15,})/);
  if (idMatch) return idMatch[1];

  return str;
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
  const emailSetting = data[1][10]?.[1] ?? 0;
  const collectEmail = emailSetting === 1;

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
async function submitFormResponse(formId, answers, providedFbzx) {
  let details;
  try {
    details = await fetchFormDetails(formId);
  } catch (e) {
    console.warn("[SafeTest Backend] Notice: Could not fetch form details before submitting:", e.message);
    details = { realPublicId: extractFormId(formId), fbzx: providedFbzx || "" };
  }

  const cleanId = details.realPublicId;
  const postUrl = `https://docs.google.com/forms/d/e/${cleanId}/formResponse`;
  console.log(`[SafeTest Backend] Submitting form response to: ${postUrl}`);

  // Build params URLSearchParams to support array checkbox entries correctly
  const params = new URLSearchParams();
  params.append('fvv', '1');
  params.append('pageHistory', '0');

  const fbzxToken = providedFbzx || details.fbzx;
  if (fbzxToken) {
    params.append('fbzx', fbzxToken);
  }

  let answerCount = 0;
  for (const [key, value] of Object.entries(answers || {})) {
    if (value !== undefined && value !== null && value !== '') {
      const entryKey = key === 'emailAddress' ? 'emailAddress' : (key.startsWith('entry.') ? key : `entry.${key}`);
      
      if (Array.isArray(value)) {
        // Checkboxes array values -> multiple entries for same key
        value.forEach(val => {
          if (val !== undefined && val !== null && val !== '') {
            params.append(entryKey, val);
            answerCount++;
          }
        });
      } else {
        params.append(entryKey, value);
        answerCount++;
      }
    }
  }

  console.log(`[SafeTest Backend] Prepared ${answerCount} answered item(s) for submission.`);

  try {
    const res = await axios.post(postUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      maxRedirects: 5,
    });

    const isSuccessText = res.data && (
      res.data.includes('Your response has been recorded') ||
      res.data.includes('recorded') ||
      res.data.includes('formResponse')
    );

    const statusOk = res.status === 200 || res.status === 302;

    if (statusOk && isSuccessText) {
      console.log(`[SafeTest Backend] ✅ Submission verified: HTTP ${res.status}`);
      return {
        success: true,
        submissionStatus: "SUBMITTED",
        googleResponseStatus: res.status,
        error: null,
      };
    } else if (statusOk) {
      console.log(`[SafeTest Backend] ⚠️ Submission unverified text: HTTP ${res.status}`);
      return {
        success: true,
        submissionStatus: "SUBMISSION_UNVERIFIED",
        googleResponseStatus: res.status,
        error: null,
      };
    } else {
      console.warn(`[SafeTest Backend] ❌ Submission failed: HTTP ${res.status}`);
      return {
        success: false,
        submissionStatus: "SUBMISSION_FAILED",
        googleResponseStatus: res.status,
        error: `Google returned HTTP status ${res.status}`,
      };
    }
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const errMsg = err.response && err.response.data ? (typeof err.response.data === 'string' ? err.response.data.slice(0, 200) : JSON.stringify(err.response.data)) : err.message;
    console.error(`[SafeTest Backend] ❌ Submission error: HTTP ${status} - ${errMsg}`);

    return {
      success: false,
      submissionStatus: "SUBMISSION_FAILED",
      googleResponseStatus: status,
      error: `Google Forms submission rejected: ${errMsg}`,
    };
  }
}

module.exports = { extractFormId, fetchFormDetails, submitFormResponse };
