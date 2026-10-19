const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

const allowedOrigins = [
  'https://dashboardinventariogpon.netlify.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

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

function parseWorkbookRows(buffer, fileName) {
  if (!buffer) return [];

  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
  return Array.isArray(rows) ? rows : [];
}

function readGitHubFileBuffer(response, fallbackBuffer = null) {
  const payload = response?.data || response;
  if (!payload || typeof payload !== 'object') {
    return fallbackBuffer ? Buffer.from(fallbackBuffer) : null;
  }

  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (payload.content && typeof payload.content === 'string') {
    const normalized = payload.content.replace(/\s+/g, '');
    return normalized ? Buffer.from(normalized, 'base64') : null;
  }

  if (payload.data && typeof payload.data !== 'string') {
    return readGitHubFileBuffer(payload.data, fallbackBuffer);
  }

  if (fallbackBuffer) {
    return Buffer.from(fallbackBuffer);
  }

  return null;
}

async function fetchGitHubFileRows(filePath) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!filePath || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return [];
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const response = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath });
  const data = response?.data;

  if (Array.isArray(data)) {
    return [];
  }

  if (data?.download_url) {
    try {
      const rawResponse = await fetch(data.download_url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/octet-stream'
        }
      });

      if (!rawResponse.ok) {
        throw new Error(`GitHub raw download falhou: ${rawResponse.status}`);
      }

      const arrayBuffer = await rawResponse.arrayBuffer();
      return parseWorkbookRows(Buffer.from(arrayBuffer), filePath);
    } catch (error) {
      console.error('[GitHub Excel] Falha ao baixar o arquivo binário do GitHub', error.message);
      return [];
    }
  }

  const buffer = readGitHubFileBuffer(data);
  if (!buffer) {
    return [];
  }

  return parseWorkbookRows(buffer, filePath);
}

function getGithubRepoContext(req) {
  const { GITHUB_OWNER, GITHUB_REPO } = process.env;
  return {
    owner: GITHUB_OWNER || req?.body?.owner || req?.query?.owner,
    repo: GITHUB_REPO || req?.body?.repo || req?.query?.repo
  };
}

function normalizeGithubPath(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

function extractDatePrefix(fileName) {
  const match = String(fileName || '').match(/^(\d{8})/);
  return match ? Number(match[1]) : 0;
}

function logGithubExcelStatus(stage, details = {}) {
  const sanitized = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value ?? 'undefined')}`)
    .join(' | ');

  console.log(`[GitHub Excel] ${stage}${sanitized ? ` | ${sanitized}` : ''}`);
}

async function resolveGithubExcelPaths(octokit, owner, repo) {
  const configuredIrPath = normalizeGithubPath(process.env.GITHUB_PATH_IR || process.env.GITHUB_PATH || '');
  const configuredInventarioPath = normalizeGithubPath(process.env.GITHUB_PATH_INVENTARIO || process.env.GITHUB_PATH || '');

  logGithubExcelStatus('Iniciando busca dos arquivos Excel na raiz do repositório', {
    owner,
    repo,
    configuredIrPath: configuredIrPath || 'não informado',
    configuredInventarioPath: configuredInventarioPath || 'não informado'
  });

  if (configuredIrPath && configuredInventarioPath) {
    logGithubExcelStatus('Usando caminhos configurados no ambiente', {
      irPath: configuredIrPath,
      inventarioPath: configuredInventarioPath
    });
    return { irPath: configuredIrPath, inventarioPath: configuredInventarioPath };
  }

  const rootContent = await octokit.repos.getContent({ owner, repo, path: '' });
  const files = Array.isArray(rootContent.data) ? rootContent.data : [];
  const excelFiles = files
    .filter((item) => item.type === 'file' && /\.(xlsx|xls|csv)$/i.test(item.name || ''))
    .map((item) => item.name);

  logGithubExcelStatus('Verificação da raiz do repositório concluída', {
    arquivosExcelEncontrados: excelFiles.length,
    lista: excelFiles.join(', ') || 'nenhum arquivo excel encontrado'
  });

  const irFiles = excelFiles.filter((name) => /IR_AREA/i.test(name));
  const inventarioFiles = excelFiles.filter((name) => /INVENTARIO/i.test(name));

  const pickLatest = (list) => {
    if (!list.length) return '';
    return [...list].sort((a, b) => {
      const dateA = extractDatePrefix(a);
      const dateB = extractDatePrefix(b);
      return dateB - dateA || b.localeCompare(a);
    })[0];
  };

  const irPath = configuredIrPath || pickLatest(irFiles) || '';
  const inventarioPath = configuredInventarioPath || pickLatest(inventarioFiles) || '';

  if (!irPath || !inventarioPath) {
    logGithubExcelStatus('Arquivo Excel não encontrado na raiz do repositório', {
      irFound: Boolean(irPath),
      inventarioFound: Boolean(inventarioPath),
      irCandidates: irFiles.join(', ') || 'nenhum',
      inventarioCandidates: inventarioFiles.join(', ') || 'nenhum'
    });
  } else {
    logGithubExcelStatus('Arquivo Excel encontrado com sucesso', {
      irPath,
      inventarioPath
    });
  }

  return { irPath, inventarioPath };
}

function buildGithubAccessErrorMessage(error, owner, repo) {
  const message = error?.message || '';

  if (/Resource not accessible by personal access token|SAML|Not Found|Bad credentials|Requires authentication/i.test(message)) {
    const repoTarget = owner && repo ? `${owner}/${repo}` : 'o repositório configurado';
    return `Token do GitHub sem permissão para ${repoTarget}. Verifique se o PAT tem permissão de Contents: Read and write e se o SSO foi habilitado para esse repositório/organização.`;
  }

  return error?.message || 'Erro ao atualizar o arquivo no GitHub.';
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

app.get('/api/latest-dashboard-data', async (req, res) => {
  try {
    const { GITHUB_TOKEN } = process.env;
    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GITHUB_TOKEN not set' });
    }

    const { owner, repo } = getGithubRepoContext(req);
    if (!owner || !repo) {
      return res.status(500).json({ error: 'GITHUB_OWNER e GITHUB_REPO não configurados no Render.' });
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    console.log(`[GitHub] Conectado ao repositório ${owner}/${repo} e iniciando leitura dos arquivos Excel.`);

    const resolvedPaths = await resolveGithubExcelPaths(octokit, owner, repo);
    const irPath = normalizeGithubPath(resolvedPaths.irPath || process.env.GITHUB_PATH_IR || process.env.GITHUB_PATH || '');
    const inventarioPath = normalizeGithubPath(resolvedPaths.inventarioPath || process.env.GITHUB_PATH_INVENTARIO || process.env.GITHUB_PATH || '');

    if (!irPath || !inventarioPath) {
      console.warn('[GitHub] Nenhum arquivo Excel IR_AREA ou INVENTARIO_IR foi encontrado na raiz do repositório.');
      return res.status(500).json({ error: 'Nenhum arquivo Excel IR_AREA ou INVENTARIO_IR encontrado na raiz do repositório do GitHub.' });
    }

    console.log(`[GitHub] Arquivos Excel confirmados: IR_AREA=${irPath} | INVENTARIO=${inventarioPath}`);

    const [sharepointRows, irAreaRows, inventarioRows] = await Promise.all([
      fetchSharePointListRows(),
      fetchGitHubFileRows(irPath),
      fetchGitHubFileRows(inventarioPath)
    ]);

    res.json({
      ok: true,
      rows: {
        sharepoint: sharepointRows,
        irArea: irAreaRows,
        inventario: inventarioRows,
      },
      config: {
        irPath,
        inventarioPath
      }
    });
  } catch (error) {
    console.error('latest-dashboard-data-error', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test-github', async (req, res) => {
  try {
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GITHUB_TOKEN not set' });
    }

    const owner = GITHUB_OWNER || req.query.owner;
    const repo = GITHUB_REPO || req.query.repo;

    if (!owner || !repo) {
      return res.status(500).json({ error: 'GITHUB_OWNER e GITHUB_REPO não configurados no Render.' });
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const response = await octokit.repos.get({ owner, repo });

    console.log(`[GitHub] Conexão validada com sucesso para ${owner}/${repo}. Branch padrão: ${response?.data?.default_branch || 'indefinida'}.`);

    res.json({
      ok: true,
      owner,
      repo,
      access: 'granted',
      private: Boolean(response?.data?.private),
      defaultBranch: response?.data?.default_branch || null
    });
  } catch (error) {
    console.error('github-test-error', error);
    const { GITHUB_OWNER, GITHUB_REPO } = process.env;
    const owner = GITHUB_OWNER || req.query.owner;
    const repo = GITHUB_REPO || req.query.repo;
    const friendly = buildGithubAccessErrorMessage(error, owner, repo);
    res.status(500).json({ error: friendly, rawError: error.message });
  }
});

app.post('/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, originalname: req.file.originalname, path: req.file.path });
});

app.post('/update-github', async (req, res) => {
  try {
    const { fileName, originalname } = req.body;
    const { GITHUB_TOKEN, GITHUB_PATH, GITHUB_PATH_IR, GITHUB_PATH_INVENTARIO } = process.env;
    if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

    const { owner, repo } = getGithubRepoContext(req);
    if (!owner || !repo) {
      return res.status(500).json({ error: 'GITHUB_OWNER e GITHUB_REPO não configurados no Render.' });
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    const filePath = path.join(uploadDir, fileName);
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: 'File not found on server' });
    const content = fs.readFileSync(filePath);
    const b64content = content.toString('base64');

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
    console.error('update-github-error', err);
    const { owner, repo } = getGithubRepoContext(req);
    const friendlyError = buildGithubAccessErrorMessage(err, owner, repo);
    res.status(500).json({ error: friendlyError, rawError: err.message });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = {
  app,
  parseWorkbookRows,
  readGitHubFileBuffer,
  fetchGitHubFileRows,
  normalizeGithubPath,
  getGithubRepoContext,
  resolveGithubExcelPaths,
  buildGithubAccessErrorMessage,
  getSharePointConfig,
  getGraphToken,
  fetchSharePointListRows
};
