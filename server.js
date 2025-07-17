const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const upload = multer({
  dest: 'uploads/', // pasta local para salvar arquivos
  limits: { fileSize: 10 * 1024 * 1024 } // até 10MB por arquivo
});

const app = express();
app.use(cors({
  origin: ['https://chegarprimeiro.netlify.app', 'http://localhost:8888'],
  credentials: true
}));
app.options('*', cors());
app.use(bodyParser.json());

// Configuração do banco Neon (PostgreSQL) com conexão persistente
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_G43vPwgWaRkh@ep-empty-snow-acqkbuow-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  max: 20, // Máximo de conexões no pool
  min: 5, // Mínimo de conexões sempre ativas
  idleTimeoutMillis: 0, // 0 = nunca encerra conexões ociosas
  connectionTimeoutMillis: 60000, // 60 segundos para estabelecer conexão
  keepAlive: true,
  keepAliveInitialDelayMillis: 0,
  statement_timeout: 0, // 0 = sem timeout para queries
  query_timeout: 0, // 0 = sem timeout para queries
  application_name: 'chegar_primeiro_api',
  // Configurações adicionais para manter conexão viva
  ssl: {
    rejectUnauthorized: false
  }
});

// Eventos de monitoramento do pool
pool.on('connect', (client) => {
  console.log(`[${new Date().toISOString()}] [INFO] Nova conexão estabelecida com o banco de dados`);
  
  // Configura o cliente para manter conexão viva
  client.query('SET statement_timeout = 0');
  client.query('SET idle_in_transaction_session_timeout = 0');
});

pool.on('acquire', (client) => {
  console.log(`[${new Date().toISOString()}] [INFO] Conexão adquirida do pool`);
});

pool.on('release', (client) => {
  console.log(`[${new Date().toISOString()}] [INFO] Conexão liberada para o pool`);
});

pool.on('error', (err, client) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Erro no pool de conexões:`, err);
  // Não encerra o processo, apenas loga o erro
});

pool.on('remove', (client) => {
  console.log(`[${new Date().toISOString()}] [INFO] Conexão removida do pool`);
});

// Função para testar a conexão com o banco
async function testarConexao() {
  try {
    console.log(`[${new Date().toISOString()}] [INFO] Testando conexão com o banco de dados...`);
    const client = await pool.connect();
    const result = await client.query('SELECT NOW(), version()');
    client.release();
    console.log(`[${new Date().toISOString()}] [INFO] Conexão com banco estabelecida com sucesso:`, result.rows[0]);
    return true;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro ao conectar com o banco:`, err);
    // Tenta reconectar automaticamente
    setTimeout(testarConexao, 5000);
    return false;
  }
}

// Função para executar queries com retry automático e reconexão
async function executarQuery(query, params = [], tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      console.log(`[${new Date().toISOString()}] [INFO] Executando query (tentativa ${i + 1}/${tentativas}):`, query.substring(0, 100) + '...');
      const result = await pool.query(query, params);
      console.log(`[${new Date().toISOString()}] [INFO] Query executada com sucesso. Linhas afetadas: ${result.rowCount}`);
      return result;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [ERROR] Erro na query (tentativa ${i + 1}/${tentativas}):`, err.message);
      
      // Se é erro de conexão, tenta reconectar
      if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        console.log(`[${new Date().toISOString()}] [INFO] Erro de conexão detectado, tentando reconectar...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      
      if (i === tentativas - 1) throw err;
      // Aguarda um pouco antes de tentar novamente
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Função para manter conexões ativas
async function manterConexoesAtivas() {
  try {
    console.log(`[${new Date().toISOString()}] [INFO] Executando query de manutenção para manter conexões ativas...`);
    await executarQuery('SELECT 1 as heartbeat');
    console.log(`[${new Date().toISOString()}] [INFO] Heartbeat executado com sucesso`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no heartbeat:`, err);
  }
}

// Teste inicial da conexão
testarConexao();

// Monitoramento periódico da conexão (a cada 30 segundos)
setInterval(async () => {
  console.log(`[${new Date().toISOString()}] [INFO] Verificação periódica da conexão...`);
  await testarConexao();
}, 30000);

// Heartbeat para manter conexões ativas (a cada 10 segundos)
setInterval(manterConexoesAtivas, 10000);

// Armazenamento temporário dos códigos de verificação (em memória)
const codigosVerificacao = {};

// Configuração do transporter (ajuste para seu provedor de e-mail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

console.log(`[${new Date().toISOString()}] [INFO] Configuração do transporter de e-mail concluída`);

async function salvarCadastroNoBanco(dados) {
  console.log(`[${new Date().toISOString()}] [INFO] Salvando cadastro no banco:`, { nome: dados.nome, cpf: dados.cpf?.substring(0, 3) + '***' });
  try {
    await executarQuery(
      'INSERT INTO cadastros (nome, cpf, cep, apartamento, bloco) VALUES ($1, $2, $3, $4, $5)',
      [dados.nome, dados.cpf, dados.cep, dados.apartamento, dados.bloco]
    );
    console.log(`[${new Date().toISOString()}] [INFO] Cadastro salvo com sucesso`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro ao salvar cadastro:`, err);
    throw err;
  }
}

// Função para gerar protocolo único com ano, mês, dia, hora, minuto e segundo
function gerarProtocolo() {
  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const protocolo = (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
  console.log(`[${new Date().toISOString()}] [INFO] Protocolo gerado: ${protocolo}`);
  return protocolo;
}

// Função para inserir solicitação genérica
async function salvarSolicitacao(dados) {
  console.log(`[${new Date().toISOString()}] [INFO] Iniciando salvamento de solicitação:`, { tipo: dados.tipo, cpf: dados.cpf?.substring(0, 3) + '***' });
  
  let senhaHash = null;
  if (dados.tipo === 'novo_cliente' && dados.senha) {
    console.log(`[${new Date().toISOString()}] [INFO] Gerando hash da senha para novo cliente`);
    senhaHash = await bcrypt.hash(dados.senha, 10);
  }
  
  // Se for novo cliente, verifica duplicidade antes de inserir na tabela clientes
  if (dados.tipo === 'novo_cliente') {
    console.log(`[${new Date().toISOString()}] [INFO] Verificando duplicidade para novo cliente`);
    try {
      const existe = await executarQuery(
        'SELECT 1 FROM clientes WHERE cpf = $1 OR email = $2',
        [dados.cpf, dados.email]
      );
      if (existe.rows.length > 0) {
        console.log(`[${new Date().toISOString()}] [WARN] Cliente já existe no banco`);
        return { jaExiste: true };
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [ERROR] Erro ao verificar duplicidade:`, err);
      throw err;
    }
  }
  
  // Gera protocolo único
  const protocolo = gerarProtocolo();
  
  // Insere na tabela solicitacoes
  console.log(`[${new Date().toISOString()}] [INFO] Inserindo solicitação na tabela solicitacoes`);
  try {
    const result = await executarQuery(
      `INSERT INTO solicitacoes
        (tipo, nome_cliente, cpf, cep, email, endereco, apartamento, bloco, nome_empreendimento, servico_atual, novo_servico, telefone, melhor_horario, descricao, data_registro, status, protocolo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16) RETURNING id`,
      [
        dados.tipo,
        dados.nome_cliente || null,
        dados.cpf || null,
        dados.cep || null,
        dados.email || null,
        dados.endereco || null,
        dados.apartamento || null,
        dados.bloco || null,
        dados.nome_empreendimento || null,
        dados.servico_atual || null,
        dados.novo_servico || null,
        dados.telefone || null,
        dados.melhor_horario || null,
        dados.descricao || null,
        'Em análise',
        protocolo
      ]
    );
    console.log(`[${new Date().toISOString()}] [INFO] Solicitação inserida com ID: ${result.rows[0].id}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro ao inserir solicitação:`, err);
    throw err;
  }
  
  // Se for novo cliente, insere também na tabela clientes
  if (dados.tipo === 'novo_cliente') {
    console.log(`[${new Date().toISOString()}] [INFO] Inserindo cliente na tabela clientes`);
    try {
      await executarQuery(
        `INSERT INTO clientes
          (nome_cliente, cpf, cep, email, endereco, apartamento, bloco, nome_empreendimento, servico, senha)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          dados.nome_cliente || null,
          dados.cpf || null,
          dados.cep || null,
          dados.email || null,
          dados.endereco || null,
          dados.apartamento || null,
          dados.bloco || null,
          dados.nome_empreendimento || null,
          dados.novo_servico || null,
          senhaHash
        ]
      );
      console.log(`[${new Date().toISOString()}] [INFO] Cliente inserido na tabela clientes com sucesso`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [ERROR] Erro ao inserir cliente:`, err);
      throw err;
    }
  }
  
  // Envia o protocolo por e-mail, se houver e-mail
  if (dados.email) {
    console.log(`[${new Date().toISOString()}] [INFO] Enviando protocolo por e-mail para: ${dados.email}`);
    try {
      await transporter.sendMail({
        from: `Chegar Primeiro <${process.env.EMAIL_USER}>`,
        to: dados.email,
        subject: 'Protocolo da sua solicitação',
        text: `Sua solicitação foi registrada com sucesso!\nProtocolo: ${protocolo}`,
        html: `<p>Sua solicitação foi registrada com sucesso!<br>Protocolo: <b>${protocolo}</b></p>`
      });
      console.log(`[${new Date().toISOString()}] [INFO] E-mail de protocolo enviado com sucesso`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [ERROR] Erro ao enviar e-mail de protocolo:`, err.message);
    }
  }
  
  console.log(`[${new Date().toISOString()}] [INFO] Solicitação salva com sucesso. Protocolo: ${protocolo}`);
  return protocolo;
}

// Função para buscar cliente (novo_cliente) por CPF
async function buscarClientePorCPF(cpf) {
  console.log(`[${new Date().toISOString()}] [INFO] Buscando cliente por CPF: ${cpf.substring(0, 3)}***`);
  try {
    const result = await executarQuery(
      'SELECT * FROM solicitacoes WHERE cpf = $1 AND tipo = $2',
      [cpf, 'novo_cliente']
    );
    if (result.rows.length > 0) {
      console.log(`[${new Date().toISOString()}] [INFO] Cliente encontrado`);
    } else {
      console.log(`[${new Date().toISOString()}] [INFO] Cliente não encontrado`);
    }
    return result.rows[0];
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro ao buscar cliente:`, err);
    throw err;
  }
}

// Rota única para inserir qualquer solicitação
app.post('/api/solicitacoes', async (req, res) => {
  console.log(`[${new Date().toISOString()}] [INFO] POST /api/solicitacoes - Iniciando processamento`);
  try {
    const resultado = await salvarSolicitacao(req.body);
    if (resultado && resultado.jaExiste) {
      console.log(`[${new Date().toISOString()}] [INFO] Retornando erro: cliente já existe`);
      return res.status(200).json({ success: false, motivo: 'ja_existe' });
    }
    console.log(`[${new Date().toISOString()}] [INFO] Solicitação processada com sucesso`);
    res.status(200).json({ success: true, protocolo: resultado });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no endpoint /api/solicitacoes:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para buscar cliente por CPF (apenas novo_cliente)
app.get('/api/clientes/:cpf', async (req, res) => {
  console.log(`[${new Date().toISOString()}] [INFO] GET /api/clientes/${req.params.cpf.substring(0, 3)}*** - Iniciando busca`);
  try {
    const cliente = await buscarClientePorCPF(req.params.cpf);
    if (cliente) {
      console.log(`[${new Date().toISOString()}] [INFO] Cliente encontrado e retornado`);
      res.status(200).json({ success: true, cliente });
    } else {
      console.log(`[${new Date().toISOString()}] [INFO] Cliente não encontrado`);
      res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no endpoint /api/clientes:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint de login de cliente
app.post('/api/login', async (req, res) => {
  const { cpf, senha } = req.body;
  console.log(`[${new Date().toISOString()}] [INFO] POST /api/login - Tentativa de login para CPF: ${cpf?.substring(0, 3)}***`);
  
  try {
    const result = await executarQuery('SELECT * FROM clientes WHERE cpf = $1', [cpf]);
    if (result.rows.length === 0) {
      console.log(`[${new Date().toISOString()}] [WARN] Login falhou: CPF não encontrado`);
      return res.status(401).json({ success: false, error: 'CPF ou senha inválidos' });
    }
    
    const cliente = result.rows[0];
    console.log(`[${new Date().toISOString()}] [INFO] Cliente encontrado, verificando senha`);
    
    const senhaOk = await bcrypt.compare(senha, cliente.senha);
    if (!senhaOk) {
      console.log(`[${new Date().toISOString()}] [WARN] Login falhou: senha incorreta`);
      return res.status(401).json({ success: false, error: 'CPF ou senha inválidos' });
    }
    
    delete cliente.senha;
    console.log(`[${new Date().toISOString()}] [INFO] Login realizado com sucesso`);
    res.status(200).json({ success: true, cliente });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no endpoint /api/login:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Novo endpoint para buscar dados completos do cliente por CPF
app.get('/api/cliente-completo/:cpf', async (req, res) => {
  console.log(`[${new Date().toISOString()}] [INFO] GET /api/cliente-completo/${req.params.cpf.substring(0, 3)}*** - Iniciando busca`);
  try {
    const result = await executarQuery('SELECT * FROM clientes WHERE cpf = $1', [req.params.cpf]);
    if (result.rows.length === 0) {
      console.log(`[${new Date().toISOString()}] [INFO] Cliente completo não encontrado`);
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    const cliente = result.rows[0];
    delete cliente.senha;
    console.log(`[${new Date().toISOString()}] [INFO] Cliente completo encontrado e retornado`);
    res.status(200).json({ success: true, cliente });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no endpoint /api/cliente-completo:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Novo endpoint para buscar solicitação por protocolo
app.get('/api/solicitacao/:protocolo', async (req, res) => {
  console.log(`[${new Date().toISOString()}] [INFO] GET /api/solicitacao/${req.params.protocolo} - Iniciando busca`);
  try {
    const result = await executarQuery('SELECT * FROM solicitacoes WHERE protocolo = $1', [req.params.protocolo]);
    if (result.rows.length === 0) {
      console.log(`[${new Date().toISOString()}] [INFO] Solicitação não encontrada`);
      return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
    }
    const solicitacao = result.rows[0];
    console.log(`[${new Date().toISOString()}] [INFO] Solicitação encontrada e retornada`);
    res.status(200).json({ success: true, solicitacao });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro no endpoint /api/solicitacao:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para enviar código de verificação
app.post('/api/enviar-codigo-email', async (req, res) => {
  const { email } = req.body;
  console.log(`[${new Date().toISOString()}] [INFO] POST /api/enviar-codigo-email - Enviando código para: ${email}`);
  
  if (!email) {
    console.log(`[${new Date().toISOString()}] [WARN] E-mail não informado`);
    return res.status(400).json({ success: false, error: 'E-mail não informado' });
  }
  
  // Gera código de 6 dígitos
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  codigosVerificacao[email] = codigo;
  console.log(`[${new Date().toISOString()}] [INFO] Código de verificação gerado para ${email}`);
  
  // Envia o e-mail
  try {
    await transporter.sendMail({
      from: `Chegar Primeiro <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Código de verificação',
      text: `Seu código de verificação é: ${codigo}`,
      html: `<p>Seu código de verificação é: <b>${codigo}</b></p>`
    });
    console.log(`[${new Date().toISOString()}] [INFO] Código de verificação enviado com sucesso para ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Erro ao enviar código de verificação:`, err);
    res.status(500).json({ success: false, error: 'Erro ao enviar e-mail' });
  }
});

// Endpoint para validar código de verificação
app.post('/api/validar-codigo-email', (req, res) => {
  const { email, codigo } = req.body;
  console.log(`[${new Date().toISOString()}] [INFO] POST /api/validar-codigo-email - Validando código para: ${email}`);
  
  if (!email || !codigo) {
    console.log(`[${new Date().toISOString()}] [WARN] Dados incompletos para validação`);
    return res.status(400).json({ success: false, error: 'Dados incompletos' });
  }
  
  if (codigosVerificacao[email] && codigosVerificacao[email] === codigo) {
    delete codigosVerificacao[email];
    console.log(`[${new Date().toISOString()}] [INFO] Código validado com sucesso para ${email}`);
    return res.json({ success: true });
  }
  
  console.log(`[${new Date().toISOString()}] [WARN] Código inválido para ${email}`);
  res.json({ success: false, error: 'Código inválido' });
});

// --- Recuperação de senha ---

// Endpoint para buscar e-mail mascarado por CPF
app.post('/api/recuperar-email', async (req, res) => {
  const { cpf } = req.body;
  if (!cpf) return res.status(400).json({ success: false, error: 'CPF não informado' });
  try {
    const result = await executarQuery('SELECT email FROM clientes WHERE cpf = $1', [cpf]);
    if (result.rows.length === 0 || !result.rows[0].email) {
      return res.status(404).json({ success: false, error: 'E-mail não encontrado para este CPF' });
    }
    const email = result.rows[0].email;
    // Mascara o e-mail (ex: kaike*********@gmail.com)
    const [user, domain] = email.split('@');
    const maskedUser = user.length <= 2 ? user[0] + '***' : user.substring(0, 2) + '*'.repeat(user.length - 2);
    const maskedEmail = maskedUser + '@' + domain;
    res.json({ success: true, email: maskedEmail, realEmail: email }); // realEmail só para uso interno do próximo endpoint
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para enviar código de verificação para o e-mail do cliente (recuperação de senha)
const codigosRecuperacaoSenha = {};
app.post('/api/enviar-codigo-recuperacao', async (req, res) => {
  const { cpf } = req.body;
  if (!cpf) return res.status(400).json({ success: false, error: 'CPF não informado' });
  try {
    const result = await executarQuery('SELECT email FROM clientes WHERE cpf = $1', [cpf]);
    if (result.rows.length === 0 || !result.rows[0].email) {
      return res.status(404).json({ success: false, error: 'E-mail não encontrado para este CPF' });
    }
    const email = result.rows[0].email;
    // Gera código de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    codigosRecuperacaoSenha[cpf] = { codigo, email, criadoEm: Date.now() };
    await transporter.sendMail({
      from: `Chegar Primeiro <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Código de recuperação de senha',
      text: `Seu código de recuperação de senha é: ${codigo}`,
      html: `<p>Seu código de recuperação de senha é: <b>${codigo}</b></p>`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para validar código e trocar senha
app.post('/api/trocar-senha', async (req, res) => {
  const { cpf, codigo, novaSenha } = req.body;
  if (!cpf || !codigo || !novaSenha) {
    return res.status(400).json({ success: false, error: 'Dados incompletos' });
  }
  const registro = codigosRecuperacaoSenha[cpf];
  if (!registro || registro.codigo !== codigo) {
    return res.status(400).json({ success: false, error: 'Código inválido' });
  }
  // Código válido, troca a senha
  try {
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await executarQuery('UPDATE clientes SET senha = $1 WHERE cpf = $2', [senhaHash, cpf]);
    delete codigosRecuperacaoSenha[cpf];
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Recuperação de senha para síndico ---
const codigosRecuperacaoSenhaSindico = {};

// Endpoint para buscar e-mail mascarado por documento
app.post('/api/recuperar-email-sindico', async (req, res) => {
  const { documento } = req.body;
  if (!documento) return res.status(400).json({ success: false, error: 'Documento não informado' });
  try {
    const result = await executarQuery('SELECT email FROM sindico WHERE documento = $1', [documento]);
    if (result.rows.length === 0 || !result.rows[0].email) {
      return res.status(404).json({ success: false, error: 'E-mail não encontrado para este documento' });
    }
    const email = result.rows[0].email;
    // Mascara o e-mail (ex: si****@gmail.com)
    const [user, domain] = email.split('@');
    const maskedUser = user.length <= 2 ? user[0] + '***' : user.substring(0, 2) + '*'.repeat(user.length - 2);
    const maskedEmail = maskedUser + '@' + domain;
    res.json({ success: true, email: maskedEmail, realEmail: email });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para enviar código de verificação para o e-mail do síndico
app.post('/api/enviar-codigo-recuperacao-sindico', async (req, res) => {
  const { documento } = req.body;
  if (!documento) return res.status(400).json({ success: false, error: 'Documento não informado' });
  try {
    const result = await executarQuery('SELECT email FROM sindico WHERE documento = $1', [documento]);
    if (result.rows.length === 0 || !result.rows[0].email) {
      return res.status(404).json({ success: false, error: 'E-mail não encontrado para este documento' });
    }
    const email = result.rows[0].email;
    // Gera código de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    codigosRecuperacaoSenhaSindico[documento] = { codigo, email, criadoEm: Date.now() };
    await transporter.sendMail({
      from: `Chegar Primeiro <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Código de recuperação de senha',
      text: `Seu código de recuperação de senha é: ${codigo}`,
      html: `<p>Seu código de recuperação de senha é: <b>${codigo}</b></p>`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para validar código e trocar senha do síndico
app.post('/api/trocar-senha-sindico', async (req, res) => {
  const { documento, codigo, novaSenha } = req.body;
  if (!documento || !codigo || !novaSenha) {
    return res.status(400).json({ success: false, error: 'Dados incompletos' });
  }
  const registro = codigosRecuperacaoSenhaSindico[documento];
  if (!registro || registro.codigo !== codigo) {
    return res.status(400).json({ success: false, error: 'Código inválido' });
  }
  // Código válido, troca a senha
  try {
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await executarQuery('UPDATE sindico SET senha = $1 WHERE documento = $2', [senhaHash, documento]);
    delete codigosRecuperacaoSenhaSindico[documento];
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para cadastro de empreendimento (síndico)
app.post('/api/empreendimento', async (req, res) => {
  const {
    empresa_responsavel,
    cnpj_empresa,
    email_responsavel_empresa,
    telefone_responsavel_empresa,
    nome_empreendimento,
    qtd_torres,
    qtd_aptos_por_andar,
    qtd_aptos_total,
    nome_sindico,
    email_sindico,
    telefone_sindico,
    data_entrega,
    existe_rede_operadora,
    qual_operadora
  } = req.body;

  // Validação simples
  if (!empresa_responsavel || !cnpj_empresa || !email_responsavel_empresa || !telefone_responsavel_empresa ||
      !nome_empreendimento || !qtd_torres || !qtd_aptos_por_andar || !qtd_aptos_total ||
      !nome_sindico || !email_sindico || !telefone_sindico || !data_entrega || typeof existe_rede_operadora === 'undefined') {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
  }

  try {
    await executarQuery(
      `INSERT INTO Empreendimento (
        empresa_responsavel, cnpj_empresa, email_responsavel_empresa, telefone_responsavel_empresa,
        nome_empreendimento, qtd_torres, qtd_aptos_por_andar, qtd_aptos_total,
        nome_sindico, email_sindico, telefone_sindico, data_entrega, existe_rede_operadora, qual_operadora
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        empresa_responsavel,
        cnpj_empresa,
        email_responsavel_empresa,
        telefone_responsavel_empresa,
        nome_empreendimento,
        qtd_torres,
        qtd_aptos_por_andar,
        qtd_aptos_total,
        nome_sindico,
        email_sindico,
        telefone_sindico,
        data_entrega,
        !!existe_rede_operadora,
        qual_operadora || null
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ERRO] Falha ao salvar empreendimento:', err);
    res.status(500).json({ success: false, error: 'Erro ao salvar empreendimento' });
  }
});

// Endpoint para cadastro de empreendimento da construtora
app.post('/api/empreendimento-construtora', upload.fields([
  { name: 'memorial_descritivo', maxCount: 1 },
  { name: 'projeto_telefonia', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      construtora_responsavel,
      nome_empreendimento,
      cep,
      endereco,
      numero,
      qtd_torres,
      qtd_aptos_por_andar,
      qtd_aptos_total,
      data_inicio_obra,
      data_fim_obra,
      engenheiro_responsavel,
      telefone_responsavel,
      email_responsavel,
      endereco_stand,
      data_inicio_vendas,
      data_fim_vendas,
      nome_responsavel_stand,
      telefone_responsavel_stand,
      email_responsavel_stand
    } = req.body;

    // Caminhos dos arquivos salvos
    const memorialDescritivoBuffer = req.files['memorial_descritivo'] ? require('fs').readFileSync(req.files['memorial_descritivo'][0].path) : null;
    const projetoTelefoniaBuffer = req.files['projeto_telefonia'] ? require('fs').readFileSync(req.files['projeto_telefonia'][0].path) : null;

    // Validação simples
    if (!construtora_responsavel || !nome_empreendimento || !cep || !endereco || !numero ||
        !qtd_torres || !qtd_aptos_por_andar || !qtd_aptos_total || !data_inicio_obra || !data_fim_obra ||
        !engenheiro_responsavel || !telefone_responsavel || !email_responsavel ||
        !memorialDescritivoPath || !projetoTelefoniaPath ||
        !endereco_stand || !data_inicio_vendas || !data_fim_vendas ||
        !nome_responsavel_stand || !telefone_responsavel_stand || !email_responsavel_stand) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
    }

    await executarQuery(
      `INSERT INTO Construtora (
        construtora_responsavel, nome_empreendimento, cep, endereco, numero,
        qtd_torres, qtd_aptos_por_andar, qtd_aptos_total, data_inicio_obra, data_fim_obra,
        engenheiro_responsavel, telefone_responsavel, email_responsavel,
        memorial_descritivo, projeto_telefonia,
        endereco_stand, data_inicio_vendas, data_fim_vendas,
        nome_responsavel_stand, telefone_responsavel_stand, email_responsavel_stand
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        construtora_responsavel,
        nome_empreendimento,
        cep,
        endereco,
        numero,
        qtd_torres,
        qtd_aptos_por_andar,
        qtd_aptos_total,
        data_inicio_obra,
        data_fim_obra,
        engenheiro_responsavel,
        telefone_responsavel,
        email_responsavel,
        memorialDescritivoBuffer,
        projetoTelefoniaBuffer,
        endereco_stand,
        data_inicio_vendas,
        data_fim_vendas,
        nome_responsavel_stand,
        telefone_responsavel_stand,
        email_responsavel_stand
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ERRO] Falha ao salvar empreendimento construtora:', err);
    res.status(500).json({ success: false, error: 'Erro ao salvar empreendimento' });
  }
});

// Endpoint para cadastro de síndico
app.post('/api/sindico', async (req, res) => {
  const { nome, documento, email, telefone, empreendimentos, senha } = req.body;
  if (!nome || !documento || !email || !telefone || !empreendimentos || !senha) {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
  }
  try {
    // Verifica duplicidade
    const existe = await executarQuery('SELECT 1 FROM sindico WHERE documento = $1 OR email = $2', [documento, email]);
    if (existe.rows.length > 0) {
      return res.status(200).json({ success: false, error: 'Já existe cadastro com este documento ou email.' });
    }
    const senhaHash = await bcrypt.hash(senha, 10);
    await executarQuery(
      'INSERT INTO sindico (nome, documento, email, telefone, empreendimentos, senha) VALUES ($1, $2, $3, $4, $5, $6)',
      [nome, documento, email, telefone, JSON.stringify(empreendimentos), senhaHash]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ERRO] Falha ao cadastrar síndico:', err);
    res.status(500).json({ success: false, error: 'Erro ao cadastrar síndico' });
  }
});

// Endpoint de login de síndico
app.post('/api/sindico-login', async (req, res) => {
  const { documento, senha } = req.body;
  if (!documento || !senha) {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
  }
  try {
    const result = await executarQuery('SELECT * FROM sindico WHERE documento = $1', [documento]);
    if (result.rows.length === 0) {
      return res.status(200).json({ success: false, error: 'Documento ou senha inválidos' });
    }
    const sindico = result.rows[0];
    const senhaOk = await bcrypt.compare(senha, sindico.senha);
    if (!senhaOk) {
      return res.status(200).json({ success: false, error: 'Documento ou senha inválidos' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[ERRO] Falha no login de síndico:', err);
    res.status(500).json({ success: false, error: 'Erro ao fazer login' });
  }
});

// Endpoint de health check
app.get('/api/health', async (req, res) => {
  try {
    const result = await executarQuery('SELECT NOW() as timestamp');
    res.json({ 
      success: true, 
      timestamp: result.rows[0].timestamp,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Middleware para capturar erros não tratados
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Unhandled Rejection at:`, promise, 'reason:', reason);
  // Não encerra o processo, apenas loga
});

process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Uncaught Exception:`, error);
  // Não encerra o processo, apenas loga
});

// Removido o graceful shutdown para manter a aplicação sempre rodando
// Os handlers de SIGTERM e SIGINT foram removidos

// Configuração para manter o processo vivo
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] [INFO] Recebido SIGTERM, mas mantendo aplicação rodando...`);
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] [INFO] Recebido SIGINT, mas mantendo aplicação rodando...`);
});

// Restart automático em caso de erro crítico
process.on('exit', (code) => {
  console.log(`[${new Date().toISOString()}] [INFO] Processo terminando com código: ${code}`);
});

app.listen(3000, () => {
  console.log(`[${new Date().toISOString()}] [INFO] Servidor rodando na porta 3000`);
  console.log(`[${new Date().toISOString()}] [INFO] Configuração de conexão persistente ativada`);
});