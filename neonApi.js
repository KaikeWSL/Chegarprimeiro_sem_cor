// neonApi.js
const fetch = require('node-fetch');

const NEON_API_URL = 'https://app-jolly-tooth-51509944.dpl.myneon.app';

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