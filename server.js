const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const { neonQuery } = require('./neonApi');
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
app.use(cors({
  origin: ['https://chegarprimeiro.netlify.app', 'http://localhost:8888'],
  credentials: true
}));
app.options('*', cors());
app.use(bodyParser.json());

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
  return protocolo;
}

// Função para inserir solicitação genérica
async function salvarSolicitacao(dados) {
  let senhaHash = null;
  if (dados.tipo === 'novo_cliente' && dados.senha) {
    senhaHash = await bcrypt.hash(dados.senha, 10);
  }

  // Se for novo cliente, verifica duplicidade antes de inserir na tabela clientes
  if (dados.tipo === 'novo_cliente') {
    const existe = await neonQuery(
      'SELECT 1 FROM clientes WHERE cpf = $1 OR email = $2',
      [dados.cpf, dados.email]
    );
    if (existe.rows.length > 0) {
      return { jaExiste: true };
    }
  }

  const protocolo = gerarProtocolo();

  // Insere na tabela solicitacoes
  await neonQuery(
    `INSERT INTO solicitacoes
      (tipo, nome_cliente, cpf, cep, email, endereco, apartamento, bloco, nome_empreendimento, servico_atual, novo_servico, telefone, melhor_horario, descricao, data_registro, status, protocolo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16)`,
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

  // Se for novo cliente, insere também na tabela clientes
  if (dados.tipo === 'novo_cliente') {
    await neonQuery(
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
  }

  // Envia o protocolo por e-mail, se houver e-mail
  if (dados.email) {
    try {
      await transporter.sendMail({
        from: `Chegar Primeiro <${process.env.EMAIL_USER}>`,
        to: dados.email,
        subject: 'Protocolo da sua solicitação',
        text: `Sua solicitação foi registrada com sucesso!\nProtocolo: ${protocolo}`,
        html: `<p>Sua solicitação foi registrada com sucesso!<br>Protocolo: <b>${protocolo}</b></p>`
      });
    } catch (err) {
      console.error(`[EMAIL ERROR]`, err.message);
    }
  }

  return protocolo;
}

// Função para buscar cliente (novo_cliente) por CPF
async function buscarClientePorCPF(cpf) {
  const result = await neonQuery(
    'SELECT * FROM solicitacoes WHERE cpf = $1 AND tipo = $2',
    [cpf, 'novo_cliente']
  );
  return result.rows[0];
}

// Rota única para inserir qualquer solicitação
app.post('/api/solicitacoes', async (req, res) => {
  try {
    const resultado = await salvarSolicitacao(req.body);
    if (resultado && resultado.jaExiste) {
      return res.status(200).json({ success: false, motivo: 'ja_existe' });
    }
    res.status(200).json({ success: true, protocolo: resultado });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para buscar cliente por CPF (apenas novo_cliente)
app.get('/api/clientes/:cpf', async (req, res) => {
  try {
    const cliente = await buscarClientePorCPF(req.params.cpf);
    if (cliente) {
      res.status(200).json({ success: true, cliente });
    } else {
      res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint de login de cliente
app.post('/api/login', async (req, res) => {
  const { cpf, senha } = req.body;
  try {
    const result = await neonQuery('SELECT * FROM clientes WHERE cpf = $1', [cpf]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'CPF ou senha inválidos' });
    }

    const cliente = result.rows[0];
    const senhaOk = await bcrypt.compare(senha, cliente.senha);
    if (!senhaOk) {
      return res.status(401).json({ success: false, error: 'CPF ou senha inválidos' });
    }

    delete cliente.senha;
    res.status(200).json({ success: true, cliente });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Novo endpoint para buscar dados completos do cliente por CPF
app.get('/api/cliente-completo/:cpf', async (req, res) => {
  try {
    const result = await neonQuery('SELECT * FROM clientes WHERE cpf = $1', [req.params.cpf]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    const cliente = result.rows[0];
    delete cliente.senha;
    res.status(200).json({ success: true, cliente });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Novo endpoint para buscar solicitação por protocolo
app.get('/api/solicitacao/:protocolo', async (req, res) => {
  try {
    const result = await neonQuery('SELECT * FROM solicitacoes WHERE protocolo = $1', [req.params.protocolo]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
    }
    res.status(200).json({ success: true, solicitacao: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adicione aqui outros endpoints conforme necessário...

// Inicie o servidor
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`API Chegar Primeiro rodando na porta ${PORT}`);
});
