const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();
const uploadDir = path.join(__dirname, 'uploads');
const configDir = path.join(__dirname, 'config');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
const upload = multer({ dest: uploadDir });
const accessControlFile = path.join(configDir, 'access-control.json');

const DEFAULT_ACCESS_CONTROL = {
  enabled: true,
  users: [
    {
      name: 'Administrador',
      email: 'admin@empresa.com',
      password: 'admin123',
      authorized: true,
      canApprove: true,
      notes: 'Usuário com permissão para liberar acesso de outras pessoas.'
    },
    {
      name: 'Usuário autorizado',
      email: 'usuario@empresa.com',
      password: 'usuario123',
      authorized: true,
      canApprove: false,
      notes: 'Usuário com permissão para atualizar o SGD.'
    }
  ]
};

function normalizeAccessKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isClaroEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return Boolean(normalized) && normalized.endsWith('@claro.com.br');
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
      return fallbackValue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) {
      fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
      return fallbackValue;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[AccessControl] Falha ao ler arquivo de configuração, usando fallback local.', filePath);
    return fallbackValue;
  }
}

async function sendEmail({ to, subject, text, html }) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  console.log('[AccessControl][Email] iniciando envio', {
    gmailUser: gmailUser ? `${gmailUser.slice(0, 2)}***@${gmailUser.split('@')[1]}` : null,
    recipients: Array.isArray(to) ? to : String(to || '').split(',').map((item) => item.trim()).filter(Boolean),
    subject
  });

  if (!gmailUser || !gmailPassword) {
    console.warn('[AccessControl][Email] falha: variáveis GMAIL_USER e GMAIL_APP_PASSWORD ausentes.');
    return { ok: false, skipped: true, reason: 'missing_credentials' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPassword
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    pool: true,
    maxConnections: 1,
    maxMessages: 3
  });

  console.log('[AccessControl][Email] transport config', {
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    recipients
  });

  const recipients = Array.isArray(to) ? to : String(to || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!recipients.length) {
    console.warn('[AccessControl][Email] falha: lista de destinatários vazia.', { to });
    return { ok: false, skipped: true, reason: 'empty_recipients' };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Dashboard SGD" <${gmailUser}>`,
      to: recipients,
      subject,
      text,
      html: html || `<p>${String(text || '').replace(/\n/g, '<br />')}</p>`
    });

    console.log('[AccessControl][Email] enviado com sucesso', {
      messageId: info.messageId,
      to: recipients,
      subject
    });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    console.error('[AccessControl][Email] falha ao enviar mensagem', {
      stage: 'smtp_sendMail',
      subject,
      recipients,
      gmailUser: gmailUser ? `${gmailUser.slice(0, 2)}***@${gmailUser.split('@')[1]}` : null,
      code: error?.code,
      name: error?.name,
      message: error?.message,
      response: error?.response,
      stack: error?.stack
    });
    return { ok: false, reason: 'smtp_error', error: error?.message || String(error) };
  }
}

function getApprovalRecipients() {
  const explicitRecipients = (process.env.APPROVAL_EMAILS || process.env.GMAIL_APPROVERS || '')
    .split(',')
    .map((email) => String(email).trim())
    .filter(Boolean);

  if (explicitRecipients.length) {
    return explicitRecipients;
  }

  const config = getAccessControlConfig();
  const configuredApprovers = (config?.users || [])
    .filter((user) => Boolean(user?.authorized) && Boolean(user?.canApprove))
    .map((user) => String(user?.email || '').trim())
    .filter(Boolean);

  return configuredApprovers.length ? configuredApprovers : ['admin@empresa.com'];
}

async function notifyNewAccessRequest(request) {
  const testMode = String(process.env.ACCESS_REQUEST_EMAIL_TEST || '').trim().toLowerCase() === 'true';
  const testApprover = 'kaike.santos.terceiros@claro.com.br';
  const testRequester = 'kaike.santos.terceiros@claro.com.br';
  const requesterEmail = String(request?.email || '').trim().toLowerCase();

  const approvers = testMode && requesterEmail === testRequester
    ? [testApprover]
    : getApprovalRecipients();

  if (!approvers.length) {
    console.warn('[AccessControl][Email] falha ao notificar aprovação: lista de aprovadores vazia.', { raw: process.env.APPROVAL_EMAILS || process.env.GMAIL_APPROVERS || '', fallback: 'admin@empresa.com' });
    return { ok: false, skipped: true, reason: 'empty_approvers' };
  }

  const subject = 'Nova solicitação de acesso ao dashboard';
  const text = [
    'Nova solicitação de acesso recebida.',
    `Nome: ${request?.name || 'Não informado'}`,
    `E-mail: ${request?.email || 'Não informado'}`,
    `Data: ${new Date(request?.requestedAt || Date.now()).toLocaleString('pt-BR')}`,
    'Acesse o painel de aprovações para autorizar ou recusar.'
  ].join('\n');

  console.log('[AccessControl][Email][TESTE] solicitante e aprovador usados', {
    requester: requesterEmail,
    approvers,
    testMode,
    forcedApprover: testApprover
  });

  return sendEmail({
    to: approvers,
    subject,
    text,
    html: `<h3>Nova solicitação de acesso</h3><p><strong>Nome:</strong> ${request?.name || 'Não informado'}</p><p><strong>E-mail:</strong> ${request?.email || 'Não informado'}</p><p><strong>Data:</strong> ${new Date(request?.requestedAt || Date.now()).toLocaleString('pt-BR')}</p><p>Acesse o painel de aprovações para autorizar ou recusar.</p>`
  });
}

async function notifyAccessDecision(request, decision, actorName = '') {
  const email = request?.email;
  if (!email) {
    console.warn('[AccessControl][Email] falha ao notificar decisão: e-mail do solicitante ausente.', { request });
    return { ok: false, skipped: true, reason: 'missing_request_email' };
  }

  const approved = decision === 'approved';
  const subject = approved ? 'Seu acesso foi aprovado' : 'Sua solicitação de acesso foi recusada';
  const text = [
    approved ? 'Seu acesso ao dashboard foi aprovado.' : 'Sua solicitação de acesso foi recusada.',
    `Nome: ${request?.name || 'Não informado'}`,
    `E-mail: ${request?.email || 'Não informado'}`,
    `Responsável: ${actorName || 'Administrador'}`,
    approved ? 'Você já pode realizar login e acessar o painel.' : 'Se quiser, pode solicitar acesso novamente com outro contato ou entrar em contato com a equipe.'
  ].join('\n');

  return sendEmail({
    to: email,
    subject,
    text,
    html: `<h3>${approved ? 'Acesso aprovado' : 'Solicitação recusada'}</h3><p>${approved ? 'Seu acesso ao dashboard foi aprovado.' : 'Sua solicitação de acesso foi recusada.'}</p><p><strong>Nome:</strong> ${request?.name || 'Não informado'}</p><p><strong>E-mail:</strong> ${request?.email || 'Não informado'}</p><p><strong>Responsável:</strong> ${actorName || 'Administrador'}</p>`
  });
}

function getAccessControlConfig() {
  const envUsers = process.env.UPDATE_ACCESS_USERS || process.env.ACCESS_CONTROL_USERS || '';
  const fallback = readJsonFile(accessControlFile, DEFAULT_ACCESS_CONTROL);

  if (!envUsers) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(envUsers);
    return {
      enabled: true,
      users: Array.isArray(parsed) ? parsed : fallback.users
    };
  } catch (error) {
    return fallback;
  }
}

async function saveAccessControlConfig(config) {
  const safeConfig = config && typeof config === 'object' ? config : DEFAULT_ACCESS_CONTROL;
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const githubPath = 'config/access-control.json';

  if (GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO) {
    try {
      const octokit = new Octokit({ auth: GITHUB_TOKEN });
      const currentFile = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: githubPath }).catch((error) => {
        if (error?.status === 404) {
          return null;
        }
        throw error;
      });

      const encodedContent = Buffer.from(JSON.stringify(safeConfig, null, 2), 'utf8').toString('base64');
      await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: githubPath,
        message: `Atualizar configuração de acesso (${safeConfig?.enabled ? 'ativa' : 'inativa'})`,
        content: encodedContent,
        sha: currentFile?.data?.sha || undefined
      });

      console.log('[AccessControl] config salva no GitHub', {
        file: githubPath,
        users: safeConfig?.users?.length || 0,
        enabled: safeConfig?.enabled
      });
    } catch (error) {
      console.error('[AccessControl] falha ao salvar config no GitHub', error?.message || error);
    }
  }

  fs.mkdirSync(path.dirname(accessControlFile), { recursive: true });
  fs.writeFileSync(accessControlFile, JSON.stringify(safeConfig, null, 2));
  console.log('[AccessControl] config salva no storage local', { file: accessControlFile, users: safeConfig?.users?.length || 0 });

  return safeConfig;
}

async function getPendingAccessRequests() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const githubPath = 'config/access-requests.json';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO precisam estar configurados para persistir solicitações de acesso.');
  }

  try {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const response = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: githubPath });
    const payload = response?.data;

    if (Array.isArray(payload)) {
      return [];
    }

    const raw = Buffer.from(String(payload?.content || ''), 'base64').toString('utf8');
    const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.status === 404) {
      return [];
    }
    console.error('[AccessControl] erro ao ler fetch de solicitações no GitHub', error?.message || error);
    return [];
  }
}

async function savePendingAccessRequests(requests) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const githubPath = 'config/access-requests.json';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO precisam estar configurados para persistir solicitações de acesso.');
  }

  const safeRequests = Array.isArray(requests) ? requests : [];
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const currentFile = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: githubPath }).catch((error) => {
    if (error?.status === 404) {
      return null;
    }
    throw error;
  });

  const encodedContent = Buffer.from(JSON.stringify(safeRequests, null, 2), 'utf8').toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: githubPath,
    message: `Atualizar solicitações de acesso (${safeRequests.length} pendentes)`,
    content: encodedContent,
    sha: currentFile?.data?.sha || undefined
  });

  console.log('[AccessControl] salvar pedidos pendentes no GitHub', {
    file: githubPath,
    total: safeRequests.length,
    preview: safeRequests.slice(0, 2)
  });

  return safeRequests;
}

function getUserByCredentials(email, password = '') {
  const config = getAccessControlConfig();
  const normalizedEmail = normalizeAccessKey(email);
  const normalizedPassword = String(password || '').trim();

  return (config?.users || []).find((user) => {
    const matchesEmail = normalizeAccessKey(user.email) === normalizedEmail;
    const matchesPassword = user.password === undefined || user.password === null || user.password === '' || String(user.password) === normalizedPassword;
    return matchesEmail && matchesPassword;
  }) || null;
}

function getAccessControlState(email, password = '') {
  const config = getAccessControlConfig();
  const normalizedEmail = normalizeAccessKey(email);
  const userMatch = (config?.users || []).find((user) => normalizeAccessKey(user.email) === normalizedEmail);
  const userByCredentials = userMatch && String(password || '').trim() !== '' && String(userMatch.password || '') === String(password || '')
    ? userMatch
    : null;

  const finalMatch = userByCredentials || userMatch || null;
  const state = {
    enabled: Boolean(config?.enabled !== false),
    isAuthorized: Boolean(finalMatch && finalMatch.authorized),
    canApprove: Boolean(finalMatch && finalMatch.canApprove),
    user: finalMatch || null,
    users: config?.users || []
  };

  console.log('[AccessControl] Verificando acesso', {
    email: String(email || ''),
    normalizedEmail,
    matchedUser: finalMatch ? { name: finalMatch.name, email: finalMatch.email, authorized: finalMatch.authorized, canApprove: finalMatch.canApprove } : null,
    state
  });

  return state;
}

function isAccessRequestAllowed(req) {
  const email = req.headers['x-user-email'] || req.body?.email || req.query?.email || '';
  const password = req.headers['x-user-password'] || req.body?.password || req.query?.password || '';

  const state = getAccessControlState(email, password);
  return {
    ...state,
    email: String(email || ''),
    password: String(password || '')
  };
}

const allowedOrigins = [
  'https://dashboardinventariogpon.netlify.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email, x-user-password, x-user-name');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

function normalizeSharePointListName(value) {
  const normalized = String(value || '').trim();
  return normalized || 'Inventario_Gpon';
}

function getSharePointConfig() {
  const primaryListName = normalizeSharePointListName(process.env.SHAREPOINT_LIST_NAME || 'ResumoDashInventario');
  const secondaryListName = normalizeSharePointListName(
    process.env.SHAREPOINT_SECONDARY_LIST_NAME ||
    process.env.SHAREPOINT_FALLBACK_LIST_NAME ||
    process.env.SHAREPOINT_LIST_NAME_2 ||
    'Inventario_Gpon'
  );

  return {
    tenantId: process.env.TENANT_ID,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    siteUrl: process.env.SHAREPOINT_SITE_URL,
    listName: primaryListName,
    secondaryListName,
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

async function fetchSharePointListRows(listNameOverride) {
  const { siteUrl, listName: primaryListName, secondaryListName } = getSharePointConfig();
  const listName = normalizeSharePointListName(listNameOverride || primaryListName || secondaryListName || 'Inventario_Gpon');
  if (!siteUrl || !listName) {
    throw new Error('SHAREPOINT_SITE_URL e SHAREPOINT_LIST_NAME não configurados no Render.');
  }

  const site = new URL(siteUrl);
  const sitePath = site.pathname.replace(/\/$/, '');
  const token = await getGraphToken();
  const pageLimit = 1000;
  let nextUrl = `https://graph.microsoft.com/v1.0/sites/${site.hostname}:${sitePath}:/lists/${encodeURIComponent(listName)}/items?$expand=fields&$top=${pageLimit}`;
  const rows = [];
  let page = 0;

  console.log('[SharePoint] Consultando lista', {
    siteUrl,
    listName,
    pageLimit,
    initialUrl: nextUrl
  });

  while (nextUrl) {
    page += 1;
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Erro ao consultar lista do SharePoint.');
    }

    const currentPageRows = Array.isArray(data.value) ? data.value.map((item) => item.fields || {}) : [];
    rows.push(...currentPageRows);

    console.log('[SharePoint PAGINATION]', {
      listName,
      page,
      pageLimit,
      fetchedThisPage: currentPageRows.length,
      accumulatedRows: rows.length,
      hasNextLink: Boolean(data?.['@odata.nextLink']),
      nextLink: data?.['@odata.nextLink'] || null
    });

    nextUrl = data?.['@odata.nextLink'] || null;

    if (page >= 50) {
      console.warn('[SharePoint PAGINATION] Limite máximo de paginação atingido para evitar loop infinito.', { listName, page, accumulatedRows: rows.length });
      break;
    }
  }

  if (rows.length) {
    const sampleKeys = Object.keys(rows[0]);
    console.log('[SharePoint] Lista retornada com sucesso', {
      listName,
      count: rows.length,
      sampleKeys,
      firstRow: rows[0]
    });
    console.log('[SharePoint TOTAL BEFORE FILTER]', {
      listName,
      totalReceivedBeforeFilter: rows.length,
      pageCount: page,
      sampleKeys
    });
  } else {
    console.warn('[SharePoint] Lista retornou zero registros', { listName, siteUrl });
    console.log('[SharePoint TOTAL BEFORE FILTER]', {
      listName,
      totalReceivedBeforeFilter: 0,
      pageCount: page,
      sampleKeys: []
    });
  }

  return rows;
}

async function fetchSharePointLists() {
  const { primaryListName, secondaryListName } = getSharePointConfig();
  const primaryRows = await fetchSharePointListRows(primaryListName);
  const secondaryRows = secondaryListName ? await fetchSharePointListRows(secondaryListName) : [];

  return {
    primary: primaryRows,
    secondary: secondaryRows,
    primaryListName,
    secondaryListName
  };
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

  const directBuffer = readGitHubFileBuffer(data);
  if (directBuffer) {
    console.log('[GitHub Excel] Lendo arquivo diretamente do conteúdo do GitHub em memória.', { filePath });
    return parseWorkbookRows(directBuffer, filePath);
  }

  if (data?.download_url) {
    try {
      console.log('[GitHub Excel] Usando fallback de download_url porque o conteúdo direto não estava disponível.', { filePath, downloadUrl: data.download_url });
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
      console.error('[GitHub Excel] Falha ao abrir o arquivo via fallback de download', error.message);
      return [];
    }
  }

  return [];
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

async function getLatestGithubFileDate(octokit, owner, repo, filePath) {
  if (!octokit || !owner || !repo || !filePath) return null;

  try {
    const response = await octokit.repos.listCommits({
      owner,
      repo,
      path: normalizeGithubPath(filePath),
      per_page: 1,
    });

    const latestCommit = Array.isArray(response?.data) ? response.data[0] : null;
    const commitDate = latestCommit?.commit?.author?.date || latestCommit?.commit?.committer?.date;
    if (commitDate) {
      const parsed = new Date(commitDate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('[GitHub Excel] Falha ao buscar data real do commit do arquivo.', {
      filePath,
      message: error?.message || 'unknown'
    });
  }

  return null;
}

async function getLatestExcelDateFromPaths(paths = [], octokit = null, owner = null, repo = null) {
  const dates = [];

  for (const value of paths || []) {
    const normalizedPath = String(value || '').trim();
    if (!normalizedPath) continue;

    const fileName = normalizedPath.split('/').pop();
    const filePrefixDate = extractDatePrefix(fileName);
    if (Number.isFinite(filePrefixDate) && filePrefixDate > 0) {
      const isoDate = String(filePrefixDate);
      const year = Number(isoDate.slice(0, 4));
      const month = Number(isoDate.slice(4, 6)) - 1;
      const day = Number(isoDate.slice(6, 8));
      dates.push(new Date(year, month, day));
    }

    const githubDate = await getLatestGithubFileDate(octokit, owner, repo, normalizedPath);
    if (githubDate) {
      dates.push(githubDate);
    }
  }

  if (!dates.length) return null;

  return dates.reduce((latest, current) => {
    if (!latest || current > latest) return current;
    return latest;
  }, null);
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
    const { primaryListName, secondaryListName, primary, secondary } = await fetchSharePointLists();
    res.json({
      ok: true,
      primaryListName,
      secondaryListName,
      count: primary.length,
      rows: primary,
      secondaryRows: secondary,
      primaryRows: primary,
      secondaryCount: secondary.length
    });
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

    const [{ primary: sharepointRows, secondary: secondarySharepointRows, primaryListName, secondaryListName }, irAreaRows, inventarioRows] = await Promise.all([
      fetchSharePointLists(),
      fetchGitHubFileRows(irPath),
      fetchGitHubFileRows(inventarioPath)
    ]);

    const sharepointConfig = getSharePointConfig();
    const extractionDate = await getLatestExcelDateFromPaths([irPath, inventarioPath], octokit, owner, repo);

    res.json({
      ok: true,
      rows: {
        sharepoint: sharepointRows,
        sharepointSecondary: secondarySharepointRows,
        irArea: irAreaRows,
        inventario: inventarioRows,
      },
      config: {
        irPath,
        inventarioPath,
        sharepoint: {
          siteUrl: sharepointConfig.siteUrl,
          listName: primaryListName,
          secondaryListName: secondaryListName || null
        }
      },
      extractionDate: extractionDate ? extractionDate.toISOString() : null
    });
  } catch (error) {
    console.error('latest-dashboard-data-error', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/update-access/status', (req, res) => {
  try {
    const state = isAccessRequestAllowed(req);
    console.log('[AccessControl] status', {
      origin: req.headers.origin || 'sem-origin',
      email: state.email,
      isAuthorized: state.isAuthorized,
      canApprove: state.canApprove,
      users: state.users?.map((user) => ({ name: user.name, email: user.email, authorized: user.authorized, canApprove: user.canApprove })) || []
    });
    res.json({ ok: true, access: state });
  } catch (error) {
    console.error('[AccessControl] Erro no status', error);
    res.status(500).json({ error: error.message || 'Erro ao verificar autorização.' });
  }
});

app.post('/api/update-access/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    const requestEmail = String(email || req.headers['x-user-email'] || '').trim();
    const requestPassword = String(password || req.headers['x-user-password'] || '').trim();

    if (!requestEmail || !requestPassword) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    if (!isClaroEmail(requestEmail)) {
      return res.status(400).json({ error: 'Use um e-mail com domínio @claro.com.br.' });
    }

    const user = getUserByCredentials(requestEmail, requestPassword);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    res.json({ ok: true, user: { name: user.name, email: user.email, authorized: user.authorized, canApprove: user.canApprove } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erro ao autenticar usuário.' });
  }
});

app.post('/api/update-access/request', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const requestName = String(name || req.headers['x-user-name'] || '').trim();
    const requestEmail = String(email || req.headers['x-user-email'] || '').trim();
    const requestPassword = String(password || req.headers['x-user-password'] || '').trim();
    const isTestRequest = String(requestEmail || '').trim().toLowerCase() === 'kaike.santos@claro.com.br';

    if (isTestRequest) {
      console.log('[AccessControl][TESTE] ativado para solicitação de teste', {
        requestName,
        requestEmail,
        approver: 'kaike.santos.terceiros@claro.com.br',
        user: 'kaike.wesley12@gmail.com'
      });
    }

    if (!requestName || !requestEmail || !requestPassword) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    }

    if (!isClaroEmail(requestEmail)) {
      return res.status(400).json({ error: 'Use um e-mail com domínio @claro.com.br.' });
    }

    const config = getAccessControlConfig();
    const pendingRequests = await getPendingAccessRequests();
    const alreadyAuthorized = (config?.users || []).some((user) => normalizeAccessKey(user.email) === normalizeAccessKey(requestEmail));
    const exists = pendingRequests.some((request) => normalizeAccessKey(request.email) === normalizeAccessKey(requestEmail));

    console.log('[AccessControl] nova solicitação', {
      requestName,
      requestEmail,
      hasPassword: !!requestPassword,
      pendingRequests: pendingRequests.length
    });

    if (alreadyAuthorized) {
      return res.status(409).json({ error: 'Este e-mail já está autorizado.' });
    }

    if (exists) {
      console.warn('[AccessControl] conflito 409 em solicitação', {
        requestName,
        requestEmail,
        pendingRequests
      });
      return res.status(409).json({ error: 'Já existe uma solicitação pendente para este e-mail.' });
    }

    const nextRequest = {
      id: `req-${Date.now()}`,
      name: requestName,
      email: requestEmail,
      password: requestPassword,
      requestedAt: new Date().toISOString(),
      status: 'pending'
    };

    pendingRequests.push(nextRequest);
    await savePendingAccessRequests(pendingRequests);
    await notifyNewAccessRequest(nextRequest).catch((error) => {
      console.error('[AccessControl][Email] falha ao enviar e-mail de nova solicitação', {
        requestId: nextRequest.id,
        email: nextRequest.email,
        error: error?.message || String(error),
        name: error?.name,
        stack: error?.stack
      });
    });
    console.log('[AccessControl] solicitação salva com sucesso', { requestId: nextRequest.id, file: 'config/access-requests.json' });

    res.json({ ok: true, request: nextRequest });
  } catch (error) {
    console.error('[AccessControl] erro ao registrar solicitação', error);
    res.status(500).json({ error: error.message || 'Erro ao registrar solicitação de acesso.' });
  }
});

app.get('/api/update-access/requests', async (req, res) => {
  try {
    const requests = await getPendingAccessRequests();
    res.json({ ok: true, requests });
  } catch (error) {
    console.error('[AccessControl] erro ao listar solicitações', error);
    res.status(500).json({ error: error.message || 'Erro ao listar solicitações.' });
  }
});

app.post('/api/update-access/approve', async (req, res) => {
  try {
    const { requestId, approved = true, actorEmail, actorPassword, canApprove = false, actorName } = req.body || {};
    const actor = getAccessControlState(actorEmail || req.headers['x-user-email'] || '', actorPassword || req.headers['x-user-password'] || '');

    if (!actor.isAuthorized || !actor.canApprove) {
      return res.status(403).json({ error: 'Você não tem permissão para autorizar acessos.' });
    }

    const pendingRequests = await getPendingAccessRequests();
    const foundRequest = pendingRequests.find((request) => request.id === requestId);
    if (!foundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    const config = getAccessControlConfig();
    const nextUsers = Array.isArray(config.users) ? [...config.users] : [];
    const index = nextUsers.findIndex((user) => normalizeAccessKey(user.email) === normalizeAccessKey(foundRequest.email));
    const grantCanApprove = Boolean(approved && canApprove);

    if (approved) {
      const createdUser = {
        name: foundRequest.name,
        email: foundRequest.email,
        password: foundRequest.password,
        authorized: true,
        canApprove: grantCanApprove,
        notes: 'Acesso liberado pela aprovação de um usuário autorizado.'
      };

      if (index >= 0) {
        nextUsers[index] = { ...nextUsers[index], ...createdUser };
      } else {
        nextUsers.push(createdUser);
      }
    }

    foundRequest.status = approved ? 'approved' : 'rejected';
    foundRequest.updatedAt = new Date().toISOString();
    foundRequest.resolvedBy = actorEmail || req.headers['x-user-email'] || '';

    await savePendingAccessRequests(pendingRequests);
    await saveAccessControlConfig({ ...config, enabled: true, users: nextUsers });
    await notifyAccessDecision(foundRequest, approved ? 'approved' : 'rejected', actorName || actorEmail || 'Administrador').catch((error) => {
      console.error('[AccessControl][Email] falha ao enviar e-mail de decisão da solicitação', {
        requestId: foundRequest.id,
        email: foundRequest.email,
        decision: approved ? 'approved' : 'rejected',
        actorName: actorName || actorEmail || 'Administrador',
        error: error?.message || String(error),
        name: error?.name,
        stack: error?.stack
      });
    });

    res.json({ ok: true, approved: Boolean(approved), users: nextUsers, request: foundRequest });
  } catch (error) {
    console.error('[AccessControl] erro ao aprovar solicitação', error);
    res.status(500).json({ error: error.message || 'Erro ao aprovar solicitação.' });
  }
});

app.post('/api/update-access/reject', async (req, res) => {
  try {
    const { requestId, actorEmail, actorPassword } = req.body || {};
    const actor = getAccessControlState(actorEmail || req.headers['x-user-email'] || '', actorPassword || req.headers['x-user-password'] || '');

    if (!actor.isAuthorized || !actor.canApprove) {
      return res.status(403).json({ error: 'Você não tem permissão para recusar acessos.' });
    }

    const pendingRequests = await getPendingAccessRequests();
    const foundRequest = pendingRequests.find((request) => request.id === requestId);
    if (!foundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    foundRequest.status = 'rejected';
    foundRequest.updatedAt = new Date().toISOString();
    foundRequest.resolvedBy = actorEmail || req.headers['x-user-email'] || '';

    await savePendingAccessRequests(pendingRequests);
    await notifyAccessDecision(foundRequest, 'rejected', actorEmail || req.headers['x-user-email'] || 'Administrador').catch((error) => {
      console.error('[AccessControl][Email] falha ao enviar e-mail de rejeição da solicitação', {
        requestId: foundRequest.id,
        email: foundRequest.email,
        actorEmail: actorEmail || req.headers['x-user-email'] || 'Administrador',
        error: error?.message || String(error),
        name: error?.name,
        stack: error?.stack
      });
    });

    res.json({ ok: true, rejected: true, request: foundRequest });
  } catch (error) {
    console.error('[AccessControl] erro ao recusar solicitação', error);
    res.status(500).json({ error: error.message || 'Erro ao recusar solicitação.' });
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

    const accessState = isAccessRequestAllowed(req);
    if (!accessState.enabled || !accessState.isAuthorized || !accessState.canApprove) {
      return res.status(403).json({
        error: 'Acesso de atualização negado. Apenas usuários com canApprove: true podem atualizar o Excel/SGD.',
        access: accessState
      });
    }

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
