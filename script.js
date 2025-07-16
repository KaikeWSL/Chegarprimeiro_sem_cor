function mostrarLogin() {
  document.getElementById('telaInicial').style.display = 'none';
  document.getElementById('formLogin').style.display = 'flex';
  document.getElementById('formCadastro').style.display = 'none';
  document.getElementById('areaAutenticada').style.display = 'none';
}
function mostrarCadastro() {
  document.getElementById('telaInicial').style.display = 'none';
  document.getElementById('formLogin').style.display = 'none';
  document.getElementById('formCadastro').style.display = 'flex';
  document.getElementById('areaAutenticada').style.display = 'none';
}
function voltarInicio() {
  document.getElementById('telaInicial').style.display = 'block';
  document.getElementById('formLogin').style.display = 'none';
  document.getElementById('formCadastro').style.display = 'none';
  document.getElementById('areaAutenticada').style.display = 'none';
}
window.mostrarLogin = mostrarLogin;
window.mostrarCadastro = mostrarCadastro;
window.voltarInicio = voltarInicio;

document.addEventListener('DOMContentLoaded', function() {
  function showTab(idx) {
    const forms = [
      document.getElementById('formVistoria'),
      document.getElementById('formTrocaServico'),
      document.getElementById('acompanharSolicitacao')
    ];
    document.querySelectorAll('.tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === idx);
      forms[i].style.display = i === idx ? 'block' : 'none';
    });
    if (idx === 2) {
      document.getElementById('resultadoAcompanhamento').innerHTML = '';
      document.getElementById('inputProtocolo').value = '';
    }
    document.getElementById('notification').style.display = 'none';
  }
  function submitForm(event) {
    event.preventDefault();
    document.getElementById('notification').style.display = 'block';
    setTimeout(() => {
      document.getElementById('notification').style.display = 'none';
    }, 5000); // Esconde após 5 segundos (simulação)
    return false;
  }
  function abrirModalServicos(contexto) {
    document.getElementById('modalServicos').classList.add('active');
    window.modalServicoContexto = contexto || null;
  }
  window.abrirModalServicos = abrirModalServicos;

  function fecharModalServicos() {
    document.getElementById('modalServicos').classList.remove('active');
  }
  window.fecharModalServicos = fecharModalServicos;

  function selecionarServico(nome, contexto) {
    if (contexto === 'cadastro') {
      document.getElementById('cadServicoContainer').innerHTML = `
        <div class="servico-contratado-row">
          <input type="text" id="cadServico" name="cadServico" value="${nome}" readonly style="flex:1; min-width:0;">
          <button type="button" class="remove-servico-btn" onclick="removerServicoCadastro()">&times;</button>
        </div>
      `;
      fecharModalServicos();
      return;
    }
    if (contexto === 'troca') {
      document.getElementById('trocaServicoContainer').innerHTML = `
        <div class="servico-contratado-row">
          <input type="text" id="trocaNovoServico" value="${nome}" readonly style="flex:1; min-width:0;">
          <button type="button" class="remove-servico-btn" onclick="removerServicoTroca()">&times;</button>
        </div>
      `;
      fecharModalServicos();
      return;
    }
  }
  window.selecionarServico = selecionarServico;

  function removerServicoCadastro() {
    document.getElementById('cadServicoContainer').innerHTML = `
      <button type="button" class="select-service-btn" onclick="abrirModalServicos('cadastro')" id="btnSelecionarServico">Selecionar serviço</button>
    `;
  }
  window.removerServicoCadastro = removerServicoCadastro;

  function removerServicoTroca() {
    document.getElementById('trocaServicoContainer').innerHTML = `
      <button type="button" class="select-service-btn" onclick="abrirModalServicos('troca')" id="btnSelecionarNovoServico">Selecionar novo serviço</button>
    `;
  }
  window.removerServicoTroca = removerServicoTroca;
  function toggleClienteCampos() {
    const isCliente = document.querySelector('input[name="jaCliente"]:checked').value === 'sim';
    document.getElementById('camposNovoCliente').style.display = isCliente ? 'none' : 'block';
    document.getElementById('camposClienteExistente').style.display = isCliente ? 'block' : 'none';
    document.getElementById('btnCadastrarVendas').style.display = isCliente ? 'none' : 'block';
    // Limpa área de troca de serviço e esconde dados ao trocar opção
    if (!isCliente) {
      document.getElementById('dadosClienteEncontrado').style.display = 'none';
      document.getElementById('trocaServicoArea').innerHTML = '';
      document.getElementById('btnTrocarServico').style.display = 'inline-block';
    }
  }
  function buscarCadastroCliente() {
    const cpf = document.getElementById('cpfContrato').value;
    fetch(`https://chegarprimeiro-sem-cor.onrender.com/api/clientes/${cpf}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          document.getElementById('dadosClienteEncontrado').style.display = 'block';
          document.getElementById('nomeCompletoCliente').value = data.cliente.nome_cliente;
          document.getElementById('enderecoCompletoCliente').value = data.cliente.endereco;
          document.getElementById('empreendimentoCliente').value = data.cliente.nome_empreendimento;
          document.getElementById('servicoAtualCliente').value = data.cliente.servico;
          document.getElementById('trocaServicoArea').innerHTML = '';
          document.getElementById('btnTrocarServico').style.display = 'inline-block';
        } else {
          alert('Cliente não encontrado!');
        }
      })
      .catch(() => {
        alert('Erro ao buscar cliente!');
      });
  }
  function iniciarTrocaServico() {
    abrirModalServicos('clienteExistente');
  }
  function removerTrocaServico() {
    document.getElementById('trocaServicoArea').innerHTML = '';
    document.getElementById('btnTrocarServico').style.display = 'inline-block';
  }
  function enviarSolicitacaoTroca() {
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/troca-servico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_cliente: document.getElementById('nomeCompletoCliente').value,
        cpf_ou_contrato: document.getElementById('cpfContrato').value,
        servico_atual: document.getElementById('servicoAtualCliente').value,
        novo_servico: document.querySelector('#trocaServicoArea input[type="text"]').value
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        document.getElementById('solicitacaoMsg').innerHTML = `
          <div style="background:#fff3cd; color:#856404; padding:10px; border-radius:6px; text-align:center; margin-top:8px;">
            Solicitação enviada com sucesso!<br>
            Protocolo: <b id='protocoloNumTroca'>${data.protocolo}</b> <button onclick='copiarProtocoloTroca()' style='margin-left:8px;padding:2px 8px;font-size:0.95em;cursor:pointer;'>Copiar</button>
          </div>
        `;
        // Limpa campos após sucesso
        document.getElementById('nomeCompletoCliente').value = '';
        document.getElementById('cpfContrato').value = '';
        document.getElementById('servicoAtualCliente').value = '';
        document.getElementById('trocaServicoArea').innerHTML = '';
        setTimeout(() => {
          document.getElementById('solicitacaoMsg').innerHTML = '';
          removerTrocaServico();
        }, 6000);
      } else {
        document.getElementById('solicitacaoMsg').innerHTML = `
          <div style="background:#f8d7da; color:#721c24; padding:10px; border-radius:6px; text-align:center; margin-top:8px;">
            Erro ao enviar solicitação!
          </div>
        `;
      }
    })
    .catch(() => {
      document.getElementById('solicitacaoMsg').innerHTML = `
        <div style="background:#f8d7da; color:#721c24; padding:10px; border-radius:6px; text-align:center; margin-top:8px;">
          Erro ao enviar solicitação!
        </div>
      `;
    });
  }

  window.copiarProtocoloTroca = function() {
    const num = document.getElementById('protocoloNumTroca').textContent;
    navigator.clipboard.writeText(num);
  }

  // Limpar campos do formulário de cliente após sucesso
  function limparFormCliente() {
    document.getElementById('nomeCliente').value = '';
    document.getElementById('cpfCliente').value = '';
    document.getElementById('cepCliente').value = '';
    document.getElementById('enderecoCliente').value = '';
    document.getElementById('apartamentoCliente').value = '';
    document.getElementById('blocoCliente').value = '';
    document.getElementById('nomeEmpreendimento').value = '';
    if (document.getElementById('servicoContratado')) document.getElementById('servicoContratado').value = '';
    removerServicoSelecionado();
  }

  // Limpar campos do formulário de manutenção após sucesso
  function limparFormManutencao() {
    document.getElementById('nomeVistoria').value = '';
    document.getElementById('cpfVistoria').value = '';
    document.getElementById('cepVistoria').value = '';
    document.getElementById('enderecoVistoria').value = '';
    document.getElementById('apartamentoVistoria').value = '';
    document.getElementById('blocoVistoria').value = '';
    document.getElementById('telefoneVistoria').value = '';
    document.getElementById('horarioVistoria').value = '';
  }

  // Proteção para campos antigos que podem não existir mais
  const cpfInput = document.getElementById('cpfCliente');
  if (cpfInput) {
    cpfInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '');
      if (this.value.length > 11) this.value = this.value.slice(0, 11);
    });
    cpfInput.addEventListener('blur', function() {
      if (this.value.length !== 11) {
        alert('O CPF deve ter 11 dígitos.');
        return;
      }
      if (!validaCPF(this.value)) {
        alert('CPF inválido!');
      }
    });
  }
  function validaCPF(cpf) {
    if (!cpf || cpf.length !== 11 || /^([0-9])\1+$/.test(cpf)) return false;
    let soma = 0, resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i-1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i-1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    return true;
  }
  // Proteção para campos antigos que podem não existir mais
  const cepInput = document.getElementById('cepCliente');
  if (cepInput) {
    let cepErroFlag = false;
    cepInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '');
      if (this.value.length > 8) this.value = this.value.slice(0, 8);
      cepErroFlag = false;
    });
    cepInput.addEventListener('blur', function() {
      if (this.value.length !== 8) {
        if (!cepErroFlag) {
          alert('O CEP deve ter 8 dígitos.');
          cepErroFlag = true;
        }
        return;
      }
      cepErroFlag = false;
      // Busca endereço se válido
      const cep = this.value;
      fetch(`https://viacep.com.br/ws/${cep}/json/`)
        .then(response => response.json())
        .then(data => {
          if (!data.erro) {
            const enderecoCliente = document.getElementById('enderecoCliente');
            if (enderecoCliente) enderecoCliente.value = `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`;
          } else {
            if (!cepErroFlag) {
              alert('CEP não encontrado.');
              cepErroFlag = true;
            }
            const enderecoCliente = document.getElementById('enderecoCliente');
            if (enderecoCliente) enderecoCliente.value = '';
          }
        })
        .catch(() => {
          if (!cepErroFlag) {
            alert('Erro ao buscar o CEP.');
            cepErroFlag = true;
          }
          const enderecoCliente = document.getElementById('enderecoCliente');
          if (enderecoCliente) enderecoCliente.value = '';
        });
    });
  }

  // Função utilitária para mostrar mensagem na tela com protocolo e botão de copiar
  function mostrarMensagemProtocolo(msg, protocolo) {
    let div = document.getElementById('mensagemFeedback');
    if (!div) {
      div = document.createElement('div');
      div.id = 'mensagemFeedback';
      div.style.position = 'fixed';
      div.style.top = '20px';
      div.style.left = '50%';
      div.style.transform = 'translateX(-50%)';
      div.style.zIndex = '9999';
      div.style.padding = '14px 24px';
      div.style.borderRadius = '8px';
      div.style.fontWeight = 'bold';
      div.style.fontSize = '1.1em';
      div.style.boxShadow = '0 2px 8px #0002';
      document.body.appendChild(div);
    }
    div.innerHTML = `${msg}<br><span style='font-size:0.95em;'>Protocolo: <b id='protocoloNum'>${protocolo}</b> <button onclick='copiarProtocolo()' class='btn-copiar-protocolo'>Copiar</button></span>`;
    div.style.background = '#d4edda';
    div.style.color = '#155724';
    div.style.border = '1px solid #c3e6cb';
    div.style.display = 'block';
    setTimeout(() => { div.style.display = 'none'; }, 10000);
    // Notificação web
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Protocolo gerado', { body: `Seu protocolo é: ${protocolo}` });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification('Protocolo gerado', { body: `Seu protocolo é: ${protocolo}` });
          }
        });
      }
    }
  }

  window.copiarProtocolo = function() {
    const num = document.getElementById('protocoloNum').textContent;
    navigator.clipboard.writeText(num);
  }

  // Funções para mostrar/esconder o overlay de carregamento
  function mostrarCarregando() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
  }
  function esconderCarregando() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  window.mostrarCarregando = mostrarCarregando;
  window.esconderCarregando = esconderCarregando;

  // Cadastro de cliente
  const formCadastro = document.getElementById('formCadastro');
  formCadastro.addEventListener('submit', function(e) {
    e.preventDefault();
    const senha = document.getElementById('cadSenha').value;
    const senha2 = document.getElementById('cadSenha2').value;
    const cpf = document.getElementById('cadCpf').value;
    const cep = document.getElementById('cadCep').value;
    if (senha !== senha2) {
      mostrarMensagem('As senhas não coincidem!', false);
      return;
    }
    if (cpf.length !== 11 || !validaCPF(cpf)) {
      mostrarMensagem('CPF inválido!', false);
      return;
    }
    if (cep.length !== 8) {
      mostrarMensagem('CEP inválido! O CEP deve ter 8 dígitos.', false);
      return;
    }
    mostrarCarregando();
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/solicitacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'novo_cliente',
        nome_cliente: document.getElementById('cadNome').value,
        cpf: document.getElementById('cadCpf').value,
        cep: document.getElementById('cadCep').value,
        email: document.getElementById('cadEmail').value,
        endereco: document.getElementById('cadEndereco').value,
        apartamento: document.getElementById('cadApartamento').value,
        bloco: document.getElementById('cadBloco').value,
        nome_empreendimento: document.getElementById('cadEmpreendimento').value,
        novo_servico: document.getElementById('cadServico') ? document.getElementById('cadServico').value : '',
        senha: senha
      })
    })
    .then(res => res.json())
    .then(data => {
      esconderCarregando();
      if (data.success) {
        mostrarMensagemProtocolo('Cadastro realizado com sucesso! Seu pedido está em análise. Guarde o número de protocolo para acompanhar a solicitação.', data.protocolo);
        formCadastro.reset();
        voltarInicio();
      } else if (data.motivo === 'ja_existe') {
        mostrarMensagem('Já existe um cadastro com este CPF ou Email. Faça login para acessar.');
        mostrarLogin();
      } else {
        mostrarMensagem('Erro ao cadastrar cliente!', false);
      }
    })
    .catch(() => {
      esconderCarregando();
      mostrarMensagem('Erro ao cadastrar cliente!', false);
    });
  });

  // Login de cliente
  const formLogin = document.getElementById('formLogin');
  formLogin.addEventListener('submit', function(e) {
    e.preventDefault();
    mostrarCarregando();
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpf: document.getElementById('loginCpf').value,
        senha: document.getElementById('loginSenha').value
      })
    })
    .then(res => res.json())
    .then(data => {
      esconderCarregando();
      if (data.success) {
        autenticarCliente(data.cliente);
      } else {
        mostrarMensagem('CPF ou senha inválidos!', false);
      }
    })
    .catch(() => {
      esconderCarregando();
      mostrarMensagem('Erro ao fazer login!', false);
    });
  });

  // Função para preencher os campos dos formulários com os dados do cliente
  function preencherCamposCliente(cliente) {
    // Manutenção
    if (document.getElementById('vistoriaNomeCliente')) document.getElementById('vistoriaNomeCliente').value = cliente.nome_cliente || '';
    if (document.getElementById('vistoriaCpf')) document.getElementById('vistoriaCpf').value = cliente.cpf || '';
    if (document.getElementById('vistoriaCep')) document.getElementById('vistoriaCep').value = cliente.cep || '';
    if (document.getElementById('vistoriaEndereco')) document.getElementById('vistoriaEndereco').value = cliente.endereco || '';
    if (document.getElementById('vistoriaApartamento')) document.getElementById('vistoriaApartamento').value = cliente.apartamento || '';
    if (document.getElementById('vistoriaBloco')) document.getElementById('vistoriaBloco').value = cliente.bloco || '';
    if (document.getElementById('vistoriaServicoAtual')) document.getElementById('vistoriaServicoAtual').value = cliente.servico || '';
    if (document.getElementById('vistoriaTelefone')) document.getElementById('vistoriaTelefone').value = cliente.telefone || '';
    // Troca de Serviço
    if (document.getElementById('trocaNomeCliente')) document.getElementById('trocaNomeCliente').value = cliente.nome_cliente || '';
    if (document.getElementById('trocaCpf')) document.getElementById('trocaCpf').value = cliente.cpf || '';
    if (document.getElementById('trocaEndereco')) document.getElementById('trocaEndereco').value = cliente.endereco || '';
    if (document.getElementById('trocaApartamento')) document.getElementById('trocaApartamento').value = cliente.apartamento || '';
    if (document.getElementById('trocaBloco')) document.getElementById('trocaBloco').value = cliente.bloco || '';
    if (document.getElementById('trocaServicoAtual')) document.getElementById('trocaServicoAtual').value = cliente.servico || '';
  }

  // Modificar autenticarCliente para buscar e preencher os dados completos
  function autenticarCliente(cliente) {
    document.getElementById('telaInicial').style.display = 'none';
    document.getElementById('formLogin').style.display = 'none';
    document.getElementById('formCadastro').style.display = 'none';
    document.getElementById('areaAutenticada').style.display = 'block';

    // Buscar dados completos do cliente e preencher os campos
    fetch(`https://chegarprimeiro-sem-cor.onrender.com/api/cliente-completo/${cliente.cpf}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          preencherCamposCliente(data.cliente);
        } else {
          preencherCamposCliente(cliente); // fallback para dados básicos
        }
      })
      .catch(() => preencherCamposCliente(cliente));
  }

  // Inicializa abas
  showTab(0);
  document.getElementById('formVistoria').style.display = 'block';
  document.getElementById('formTrocaServico').style.display = 'none';

  // Envio do formulário de manutenção autenticada
  const formVistoria = document.getElementById('formVistoria');
  if (formVistoria) {
    formVistoria.addEventListener('submit', function(e) {
      e.preventDefault();
      mostrarCarregando();
      fetch('https://chegarprimeiro-sem-cor.onrender.com/api/solicitacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'manutencao',
          nome_cliente: document.getElementById('vistoriaNomeCliente') ? document.getElementById('vistoriaNomeCliente').value : '',
          cpf: document.getElementById('vistoriaCpf').value,
          cep: document.getElementById('vistoriaCep') ? document.getElementById('vistoriaCep').value : '',
          endereco: document.getElementById('vistoriaEndereco') ? document.getElementById('vistoriaEndereco').value : '',
          apartamento: document.getElementById('vistoriaApartamento') ? document.getElementById('vistoriaApartamento').value : '',
          bloco: document.getElementById('vistoriaBloco') ? document.getElementById('vistoriaBloco').value : '',
          servico_atual: document.getElementById('vistoriaServicoAtual') ? document.getElementById('vistoriaServicoAtual').value : '',
          telefone: document.getElementById('vistoriaTelefone').value,
          melhor_horario: document.getElementById('vistoriaHorario').value,
          descricao: document.getElementById('vistoriaDescricao').value,
          nome_empreendimento: document.getElementById('vistoriaEmpreendimento') ? document.getElementById('vistoriaEmpreendimento').value : ''
        })
      })
      .then(res => res.json())
      .then(data => {
        esconderCarregando();
        if (data.success) {
          mostrarMensagemProtocolo('Solicitação de manutenção enviada com sucesso!', data.protocolo);
          formVistoria.reset();
        } else {
          mostrarMensagem('Erro ao enviar solicitação!', false);
        }
      })
      .catch(() => {
        esconderCarregando();
        mostrarMensagem('Erro ao enviar solicitação!', false);
      });
    });
  }

  // Envio do formulário de troca de serviço autenticada
  const formTroca = document.getElementById('formTrocaServico');
  if (formTroca) {
    formTroca.addEventListener('submit', function(e) {
      e.preventDefault();
      mostrarCarregando();
      fetch('https://chegarprimeiro-sem-cor.onrender.com/api/solicitacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'troca_servico',
          nome_cliente: document.getElementById('trocaNomeCliente') ? document.getElementById('trocaNomeCliente').value : '',
          cpf: document.getElementById('trocaCpf').value,
          servico_atual: document.getElementById('trocaServicoAtual').value,
          novo_servico: document.getElementById('trocaNovoServico') ? document.getElementById('trocaNovoServico').value : '',
          nome_empreendimento: document.getElementById('trocaEmpreendimento') ? document.getElementById('trocaEmpreendimento').value : ''
        })
      })
      .then(res => res.json())
      .then(data => {
        esconderCarregando();
        if (data.success) {
          mostrarMensagemProtocolo('Solicitação de troca enviada com sucesso!', data.protocolo);
          formTroca.reset();
          removerServicoTroca();
        } else {
          mostrarMensagem('Erro ao solicitar troca!', false);
        }
      })
      .catch(() => {
        esconderCarregando();
        mostrarMensagem('Erro ao solicitar troca!', false);
      });
    });
  }

  // Adicionar autocomplete nos campos de senha e email
  var loginSenha = document.getElementById('loginSenha');
  if (loginSenha) loginSenha.setAttribute('autocomplete', 'current-password');
  var cadSenha = document.getElementById('cadSenha');
  if (cadSenha) cadSenha.setAttribute('autocomplete', 'new-password');
  var cadSenha2 = document.getElementById('cadSenha2');
  if (cadSenha2) cadSenha2.setAttribute('autocomplete', 'new-password');
  var cadEmail = document.getElementById('cadEmail');
  if (cadEmail) cadEmail.setAttribute('autocomplete', 'email');

  // Lógica para buscar solicitação pelo protocolo
  const btnBuscarProtocolo = document.getElementById('btnBuscarProtocolo');
  if (btnBuscarProtocolo) {
    btnBuscarProtocolo.addEventListener('click', function() {
      const protocolo = document.getElementById('inputProtocolo').value.trim();
      const resultadoDiv = document.getElementById('resultadoAcompanhamento');
      if (!protocolo) {
        resultadoDiv.innerHTML = '<span style="color:#721c24;">Digite o número do protocolo.</span>';
        return;
      }
      mostrarCarregando();
      resultadoDiv.innerHTML = '';
      fetch(`https://chegarprimeiro-sem-cor.onrender.com/api/solicitacao/${protocolo}`)
        .then(res => res.json())
        .then(data => {
          esconderCarregando();
          if (data.success && data.solicitacao) {
            const s = data.solicitacao;
            resultadoDiv.innerHTML = `
              <div style='background:#eafaf1;border:1px solid #b7e4c7;padding:18px 20px;border-radius:8px;'>
                <div style='margin-bottom:6px;'><span style='font-weight:bold;color:#155724;'>Tipo:</span> <span style='color:#222;'>${s.tipo || '-'}</span></div>
                <div style='margin-bottom:6px;'><span style='font-weight:bold;color:#155724;'>Nome:</span> <span style='color:#222;'>${s.nome_cliente || '-'}</span></div>
                <div style='margin-bottom:6px;'><span style='font-weight:bold;color:#155724;'>Status:</span> <span style='color:#218838;font-weight:bold;'>${s.status || 'Em análise'}</span></div>
                <div style='margin-bottom:6px;'><span style='font-weight:bold;color:#155724;'>Descrição:</span> <span style='color:#222;'>${s.descricao || '-'}</span></div>
                <div><span style='font-weight:bold;color:#155724;'>Data de registro:</span> <span style='color:#222;'>${formatarDataBrasilia(s.data_registro)}</span></div>
              </div>
            `;
          } else {
            resultadoDiv.innerHTML = `<span style='color:#721c24;'>Solicitação não encontrada.</span>`;
          }
        })
        .catch(() => {
          esconderCarregando();
          resultadoDiv.innerHTML = `<span style='color:#721c24;'>Erro ao buscar solicitação.</span>`;
        });
    });
  }

  // Proteção para campos antigos que podem não existir mais
  // --- Validação de CPF e CEP no cadastro ---
  const cadCpfInput = document.getElementById('cadCpf');
  if (cadCpfInput) {
    cadCpfInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '');
      if (this.value.length > 11) this.value = this.value.slice(0, 11);
    });
    cadCpfInput.addEventListener('blur', function() {
      if (this.value.length !== 11) {
        alert('O CPF deve ter 11 dígitos.');
        return;
      }
      if (!validaCPF(this.value)) {
        alert('CPF inválido!');
      }
    });
  }

  const cadCepInput = document.getElementById('cadCep');
  if (cadCepInput) {
    let cadCepErroFlag = false;
    cadCepInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '');
      if (this.value.length > 8) this.value = this.value.slice(0, 8);
      cadCepErroFlag = false;
    });
    cadCepInput.addEventListener('blur', function() {
      if (this.value.length !== 8) {
        if (!cadCepErroFlag) {
          alert('O CEP deve ter 8 dígitos.');
          cadCepErroFlag = true;
        }
        return;
      }
      cadCepErroFlag = false;
      // Busca endereço se válido
      const cep = this.value;
      fetch(`https://viacep.com.br/ws/${cep}/json/`)
        .then(response => response.json())
        .then(data => {
          if (!data.erro) {
            const cadEndereco = document.getElementById('cadEndereco');
            if (cadEndereco) cadEndereco.value = `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`;
          } else {
            if (!cadCepErroFlag) {
              alert('CEP não encontrado.');
              cadCepErroFlag = true;
            }
            const cadEndereco = document.getElementById('cadEndereco');
            if (cadEndereco) cadEndereco.value = '';
          }
        })
        .catch(() => {
          if (!cadCepErroFlag) {
            alert('Erro ao buscar o CEP.');
            cadCepErroFlag = true;
          }
          const cadEndereco = document.getElementById('cadEndereco');
          if (cadEndereco) cadEndereco.value = '';
        });
    });
  }

  // --- Verificação de e-mail no cadastro ---
  let emailVerificado = false;
  const btnVerificarEmail = document.getElementById('btnVerificarEmail');
  const btnValidarCodigoEmail = document.getElementById('btnValidarCodigoEmail');
  const areaCodigoEmail = document.getElementById('areaCodigoEmail');
  const statusCodigoEmail = document.getElementById('statusCodigoEmail');
  const inputCodigoEmail = document.getElementById('inputCodigoEmail');
  const cadEmailInput = document.getElementById('cadEmail');
  const iconeEmailVerificado = document.getElementById('iconeEmailVerificado');

  if (btnVerificarEmail && cadEmailInput) {
    btnVerificarEmail.addEventListener('click', function() {
      const email = cadEmailInput.value.trim();
      if (!email) {
        statusCodigoEmail.textContent = 'Digite o e-mail.';
        statusCodigoEmail.style.color = '#721c24';
        areaCodigoEmail.style.display = 'block';
        return;
      }
      mostrarCarregando();
      fetch('https://chegarprimeiro-sem-cor.onrender.com/api/enviar-codigo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      .then(res => res.json())
      .then(data => {
        esconderCarregando();
        if (data.success) {
          areaCodigoEmail.style.display = 'block';
          statusCodigoEmail.textContent = 'Código enviado! Confira seu e-mail.';
          statusCodigoEmail.style.color = '#218838';
          emailVerificado = false;
          if (iconeEmailVerificado) iconeEmailVerificado.style.display = 'none';
        } else {
          statusCodigoEmail.textContent = 'Erro ao enviar código.';
          statusCodigoEmail.style.color = '#721c24';
        }
      })
      .catch(() => {
        esconderCarregando();
        statusCodigoEmail.textContent = 'Erro ao enviar código.';
        statusCodigoEmail.style.color = '#721c24';
      });
    });
  }

  if (btnValidarCodigoEmail && cadEmailInput) {
    btnValidarCodigoEmail.addEventListener('click', function() {
      const email = cadEmailInput.value.trim();
      const codigo = inputCodigoEmail.value.trim();
      if (!codigo || codigo.length !== 6) {
        statusCodigoEmail.textContent = 'Digite o código de 6 dígitos.';
        statusCodigoEmail.style.color = '#721c24';
        return;
      }
      mostrarCarregando();
      fetch('https://chegarprimeiro-sem-cor.onrender.com/api/validar-codigo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, codigo })
      })
      .then(res => res.json())
      .then(data => {
        esconderCarregando();
        if (data.success) {
          statusCodigoEmail.textContent = 'E-mail verificado!';
          statusCodigoEmail.style.color = '#218838';
          emailVerificado = true;
          areaCodigoEmail.style.display = 'none';
          btnVerificarEmail.style.display = 'none';
          if (iconeEmailVerificado) iconeEmailVerificado.style.display = 'inline';
        } else {
          statusCodigoEmail.textContent = 'Código inválido.';
          statusCodigoEmail.style.color = '#721c24';
          emailVerificado = false;
          areaCodigoEmail.style.display = 'none';
          statusCodigoEmail.textContent = '';
          if (iconeEmailVerificado) iconeEmailVerificado.style.display = 'none';
        }
      })
      .catch(() => {
        esconderCarregando();
        statusCodigoEmail.textContent = 'Erro ao validar código.';
        statusCodigoEmail.style.color = '#721c24';
        emailVerificado = false;
        areaCodigoEmail.style.display = 'none';
        statusCodigoEmail.textContent = '';
        if (iconeEmailVerificado) iconeEmailVerificado.style.display = 'none';
      });
    });
  }

  if (btnVerificarEmail && cadEmailInput) {
    cadEmailInput.addEventListener('input', function() {
      // Regex simples para e-mail válido
      const emailValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.value.trim());
      btnVerificarEmail.style.display = emailValido ? 'block' : 'none';
      // Ao alterar o e-mail, reseta status de verificação
      emailVerificado = false;
      areaCodigoEmail.style.display = 'none';
      statusCodigoEmail.textContent = '';
      if (iconeEmailVerificado) iconeEmailVerificado.style.display = 'none';
    });
  }

  // Bloquear cadastro se e-mail não for verificado
  formCadastro.addEventListener('submit', function(e) {
    // ... já existe validação de senha, cpf, cep ...
    if (!emailVerificado) {
      mostrarMensagem('Você precisa verificar seu e-mail antes de cadastrar!', false);
      return;
    }
    // ... resto do código ...
  });

  // --- Recuperação de senha ---

  document.getElementById('btnEsqueciSenha').addEventListener('click', function() {
    abrirModalRecuperarSenha();
  });

  function abrirModalRecuperarSenha() {
    document.getElementById('modalRecuperarSenha').style.display = 'flex';
    document.getElementById('recuperarSenhaEtapaCpf').style.display = 'block';
    document.getElementById('recuperarSenhaEtapaEmail').style.display = 'none';
    document.getElementById('recuperarSenhaEtapaCodigo').style.display = 'none';
    document.getElementById('recuperarSenhaEtapaNovaSenha').style.display = 'none';
    document.getElementById('recCpf').value = '';
    document.getElementById('recEmailMasc').textContent = '';
    document.getElementById('recCodigo').value = '';
    document.getElementById('recNovaSenha').value = '';
    document.getElementById('recNovaSenha2').value = '';
    document.getElementById('recStatusCodigo').textContent = '';
    etapaRecSenha = 1;
    recCpfGlobal = '';
  }

  function fecharModalRecuperarSenha() {
    document.getElementById('modalRecuperarSenha').style.display = 'none';
  }
  window.fecharModalRecuperarSenha = fecharModalRecuperarSenha;

  let etapaRecSenha = 1;
  let recCpfGlobal = '';

  // Etapa 1: Buscar e-mail por CPF
  const btnBuscarEmailRec = document.getElementById('btnBuscarEmailRec');
  btnBuscarEmailRec.addEventListener('click', function() {
    const cpf = document.getElementById('recCpf').value.replace(/\D/g, '');
    if (cpf.length !== 11) {
      mostrarMensagem('CPF inválido!', false);
      return;
    }
    mostrarCarregando();
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/recuperar-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf })
    })
    .then(res => res.json())
    .then(data => {
      esconderCarregando();
      if (data.success) {
        document.getElementById('recEmailMasc').textContent = data.email;
        document.getElementById('recuperarSenhaEtapaCpf').style.display = 'none';
        document.getElementById('recuperarSenhaEtapaEmail').style.display = 'block';
        etapaRecSenha = 2;
        recCpfGlobal = cpf;
      } else {
        mostrarMensagem(data.error || 'E-mail não encontrado!', false);
      }
    })
    .catch(() => {
      esconderCarregando();
      mostrarMensagem('Erro ao buscar e-mail!', false);
    });
  });

  // Etapa 2: Enviar código de verificação
  const btnEnviarCodigoRec = document.getElementById('btnEnviarCodigoRec');
  btnEnviarCodigoRec.addEventListener('click', function() {
    if (!recCpfGlobal) return;
    mostrarCarregando();
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/enviar-codigo-recuperacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: recCpfGlobal })
    })
    .then(res => res.json())
    .then(data => {
      esconderCarregando();
      if (data.success) {
        document.getElementById('recuperarSenhaEtapaEmail').style.display = 'none';
        document.getElementById('recuperarSenhaEtapaCodigo').style.display = 'block';
        etapaRecSenha = 3;
        document.getElementById('recStatusCodigo').textContent = 'Código enviado!';
        document.getElementById('recStatusCodigo').style.color = '#218838';
      } else {
        mostrarMensagem(data.error || 'Erro ao enviar código!', false);
      }
    })
    .catch(() => {
      esconderCarregando();
      mostrarMensagem('Erro ao enviar código!', false);
    });
  });

  // Etapa 3: Validar código
  const btnValidarCodigoRec = document.getElementById('btnValidarCodigoRec');
  btnValidarCodigoRec.addEventListener('click', function() {
    const codigo = document.getElementById('recCodigo').value.trim();
    if (!codigo || codigo.length !== 6) {
      document.getElementById('recStatusCodigo').textContent = 'Digite o código de 6 dígitos.';
      document.getElementById('recStatusCodigo').style.color = '#721c24';
      return;
    }
    // Não valida no backend ainda, só na troca de senha
    document.getElementById('recuperarSenhaEtapaCodigo').style.display = 'none';
    document.getElementById('recuperarSenhaEtapaNovaSenha').style.display = 'block';
    etapaRecSenha = 4;
  });

  // Etapa 4: Trocar senha
  const btnTrocarSenhaRec = document.getElementById('btnTrocarSenhaRec');
  btnTrocarSenhaRec.addEventListener('click', function() {
    const novaSenha = document.getElementById('recNovaSenha').value;
    const novaSenha2 = document.getElementById('recNovaSenha2').value;
    const codigo = document.getElementById('recCodigo').value.trim();
    if (!novaSenha || !novaSenha2) {
      mostrarMensagem('Preencha os campos de senha!', false);
      return;
    }
    if (novaSenha !== novaSenha2) {
      mostrarMensagem('As senhas não coincidem!', false);
      return;
    }
    if (!recCpfGlobal || !codigo) {
      mostrarMensagem('Dados incompletos!', false);
      return;
    }
    mostrarCarregando();
    fetch('https://chegarprimeiro-sem-cor.onrender.com/api/trocar-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: recCpfGlobal, codigo, novaSenha })
    })
    .then(res => res.json())
    .then(data => {
      esconderCarregando();
      if (data.success) {
        mostrarMensagem('Senha alterada com sucesso! Faça login com a nova senha.');
        fecharModalRecuperarSenha();
        mostrarLogin();
      } else {
        mostrarMensagem(data.error || 'Erro ao trocar senha!', false);
      }
    })
    .catch(() => {
      esconderCarregando();
      mostrarMensagem('Erro ao trocar senha!', false);
    });
  });

  window.showTab = showTab;
});

function mostrarMensagem(msg, sucesso = true) {
  let div = document.getElementById('mensagemFeedback');
  if (!div) {
    div = document.createElement('div');
    div.id = 'mensagemFeedback';
    div.style.position = 'fixed';
    div.style.top = '20px';
    div.style.left = '50%';
    div.style.transform = 'translateX(-50%)';
    div.style.zIndex = '9999';
    div.style.padding = '14px 24px';
    div.style.borderRadius = '8px';
    div.style.fontWeight = 'bold';
    div.style.fontSize = '1.1em';
    div.style.boxShadow = '0 2px 8px #0002';
    document.body.appendChild(div);
  }
  div.innerHTML = msg;
  if (sucesso) {
    div.style.background = '#d4edda';
    div.style.color = '#155724';
    div.style.border = '1px solid #c3e6cb';
  } else {
    div.style.background = '#f8d7da';
    div.style.color = '#721c24';
    div.style.border = '1px solid #f5c6cb';
  }
  div.style.display = 'block';
  setTimeout(() => { div.style.display = 'none'; }, 6000);
}
window.mostrarMensagem = mostrarMensagem;

// Converte data para horário de Brasília
function formatarDataBrasilia(data) {
  if (!data) return '-';
  let d;
  if (data instanceof Date) {
    d = data;
  } else if (typeof data === 'string') {
    let dataStr = data;
    // Se já tiver 'Z' ou for ISO, não adiciona outro
    if (!dataStr.endsWith('Z') && !dataStr.includes('+')) dataStr += 'Z';
    d = new Date(dataStr);
  } else {
    return '-';
  }
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
} 