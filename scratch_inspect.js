const axios = require('axios');
const fs = require('fs');

async function check() {
  const url = 'https://docs.google.com/forms/d/e/1FAIpQLSdsxFHD0ykMzp6mqOaUTP1N-YN1RIz2-qnmOEOmggSKrP4dTQ/viewform';
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const html = res.data;
  
  // Check form action and form element
  const formMatch = html.match(/<form[\s\S]*?>/i);
  console.log('Form tag:', formMatch ? formMatch[0] : 'None');
  
  // Check if there are relative URLs
  const relativeUrls = html.match(/(src|href)=["']\/(?!\/)[^"']*["']/g) || [];
  console.log('Relative root URLs count:', relativeUrls.length);
  console.log('Sample relative root URLs:', relativeUrls.slice(0, 10));
}

check().catch(console.error);
