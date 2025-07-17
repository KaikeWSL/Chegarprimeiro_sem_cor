// neonApi.js
const fetch = require('node-fetch');

const NEON_API_URL = 'https://app-lively-glitter-60933263.dpl.myneon.app/sql';

async function neonQuery(sql, params = []) {
  const response = await fetch(NEON_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data;
}

module.exports = { neonQuery };