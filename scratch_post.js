const axios = require('axios');
const querystring = require('querystring');

async function testGoogleFormPost() {
  const formId = '1FAIpQLSdsxFHD0ykMzp6mqOaUTP1N-YN1RIz2-qnmOEOmggSKrP4dTQ';
  const postUrl = `https://docs.google.com/forms/d/e/${formId}/formResponse`;
  
  const payload = querystring.stringify({
    'draftResponse': '[]',
    'pageHistory': '0',
    'fbzx': '7490266123537083266'
  });

  try {
    const res = await axios.post(postUrl, payload, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('Post Status:', res.status);
    console.log('Response includes success:', res.data.includes('Your response has been recorded') || res.data.includes('formResponse'));
  } catch(e) {
    console.log('Post Result Status:', e.response ? e.response.status : e.message);
    if (e.response && e.response.data) {
      console.log('Response snippet:', e.response.data.slice(0, 300));
    }
  }
}

testGoogleFormPost();
