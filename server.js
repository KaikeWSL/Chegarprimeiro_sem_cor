const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

function getSharePointConfig() {
  return {
    tenantId: process.env.TENANT_ID,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    siteUrl: process.env.SHAREPOINT_SITE_URL,
    listName: process.env.SHAREPOINT_LIST_NAME,
    listFields: process.env.SHAREPOINT_LIST_FIELDS || ''
  };
}

async function getGraphToken() {
  const { tenantId, clientId, clientSecret } = getSharePointConfig();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('TENANT_ID, CLIENT_ID e CLIENT_SECRET não configurados no Render.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || 'Falha ao obter token do Microsoft Graph.');
  }

  return data.access_token;
}

async function fetchSharePointListRows() {
  const { siteUrl, listName } = getSharePointConfig();
  if (!siteUrl || !listName) {
    throw new Error('SHAREPOINT_SITE_URL e SHAREPOINT_LIST_NAME não configurados no Render.');
  }

  const site = new URL(siteUrl);
  const sitePath = site.pathname.replace(/\/$/, '');
  const graphUrl = `https://graph.microsoft.com/v1.0/sites/${site.hostname}:${sitePath}:/lists/${encodeURIComponent(listName)}/items?$expand=fields&$top=1000`;
  const token = await getGraphToken();

  const response = await fetch(graphUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Erro ao consultar lista do SharePoint.');
  }

  return Array.isArray(data.value) ? data.value.map((item) => item.fields || {}) : [];
}

app.get('/api/sharepoint-list', async (req, res) => {
  try {
    const rows = await fetchSharePointListRows();
    res.json({ ok: true, count: rows.length, rows });
  } catch (error) {
    console.error('sharepoint-list-error', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, originalname: req.file.originalname, path: req.file.path });
});

app.post('/update-github', async (req, res) => {
  try {
    const { fileName, originalname } = req.body;
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATH, GITHUB_PATH_IR, GITHUB_PATH_INVENTARIO } = process.env;
    if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    const filePath = path.join(uploadDir, fileName);
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: 'File not found on server' });
    const content = fs.readFileSync(filePath);
    const b64content = content.toString('base64');

    const owner = GITHUB_OWNER || req.body.owner;
    const repo = GITHUB_REPO || req.body.repo;

    const fileLabel = String(originalname || fileName || '').toUpperCase();
    const inferredGithubPath = /IR_AREA/i.test(fileLabel)
      ? (GITHUB_PATH_IR || GITHUB_PATH || req.body.path || fileName)
      : /INVENTARIO/i.test(fileLabel)
        ? (GITHUB_PATH_INVENTARIO || GITHUB_PATH || req.body.path || fileName)
        : (GITHUB_PATH || req.body.path || req.body.originalname || fileName);

    const githubPath = req.body.githubPath || inferredGithubPath;

    let sha;
    try {
      const existing = await octokit.repos.getContent({ owner, repo, path: githubPath });
      sha = existing.data.sha;
    } catch (err) {
      sha = undefined;
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: githubPath,
      message: req.body.message || `Update ${githubPath}`,
      content: b64content,
      sha,
    });

    res.json({ ok: true, githubPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
