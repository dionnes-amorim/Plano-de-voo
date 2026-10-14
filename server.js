require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();

// RENDER OBRIGA 10000 + 0.0.0.0
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash'; // CORRIGIDO

const TONELADAS_POR_CONJUNTO = Number(process.env.TONELADAS_POR_CONJUNTO || 70);
const ESTOQUE_RISCO_CONJ = Number(process.env.ESTOQUE_RISCO_CONJ || 7);

/* =========================================================
   CADASTRO OFICIAL DAS UNIDADES
   ========================================================= */
const UNIDADES = {
  'MANDU': { nome: 'Mandu', nominal: 917 },
  'CRUZ ALTA': { nome: 'Cruz Alta', nominal: 900 },
  'SAO JOSE': { nome: 'São José', nominal: 750 },
  'VERTENTE': { nome: 'Vertente', nominal: 500 },
  'TANABI': { nome: 'Tanabi', nominal: 710 }
};

/* =========================================================
   MIDDLEWARES
   ========================================================= */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(__dirname));

/* =========================================================
   UTILITÁRIOS
   ========================================================= */
function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero)? numero : fallback;
}
function textoSeguro(valor, limite = 30000) {
  return String(valor || '').trim().slice(0, limite);
}
function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}
function horaNumero(hora) {
  if (hora === null || hora === undefined) return null;
  const texto = String(hora).trim();
  const match = texto.match(/\d{1,2}/);
  if (!match) return null;
  const numero = Number(match[0]);
  if (!Number.isFinite(numero) || numero < 0 || numero > 23) return null;
  return numero;
}
function horaFormatada(hora) {
  const numero = horaNumero(hora);
  if (numero === null) return '--';
  return `${String(numero).padStart(2, '0')}:00`;
}
function horaRelativa(hora, horaAtual) {
  if (!Number.isFinite(hora) ||!Number.isFinite(horaAtual)) return null;
  let diferenca = (hora - horaAtual + 24) % 24;
  if (diferenca > 12) diferenca -= 24;
  return diferenca;
}

/* =========================================================
   IDENTIFICAÇÃO DA UNIDADE
   ========================================================= */
function identificarUnidade(texto) {
  const original = textoSeguro(texto, 30000);
  if (!original) return null;
  const linhas = original.split(/\r?\n/);
  const linhasPrioritarias = linhas.filter(linha => /FILIAL|GESTORA|UNIDADE/i.test(linha));
  const trechosParaPesquisar = [...linhasPrioritarias, original];
  for (const trecho of trechosParaPesquisar) {
    const linha = normalizarTexto(trecho);
    for (const chave of Object.keys(UNIDADES)) {
      if (linha.includes(chave)) {
        return { chave, nome: UNIDADES[chave].nome, nominal: UNIDADES[chave].nominal };
      }
    }
  }
  return null;
}

/* =========================================================
   NORMALIZAÇÃO DA ANÁLISE DE POTENCIAL
   ========================================================= */
function normalizarPotencial(lista, nominalOficial) {
  if (!Array.isArray(lista)) return [];
  return lista.map((item) => {
      const hora = horaNumero(item?.hora?? item?.horario?? item?.horaNumero);
      const potencial = numeroSeguro(item?.potencial?? item?.producao?? item?.produção?? item?.valor, NaN);
      const moagem = numeroSeguro(item?.moagem?? item?.moagemNominal?? nominalOficial, nominalOficial);
      if (hora === null ||!Number.isFinite(potencial)) return null;
      return { hora, horaNumero: hora, potencial, moagem, nominal: nominalOficial };
    }).filter(Boolean).sort((a, b) => a.hora - b.hora);
}

/* =========================================================
   CÁLCULO DO CENÁRIO
   ========================================================= */
function calcularCenario(dados, unidade) {
  const potencial = normalizarPotencial(dados.potencial, unidade.nominal);
  const estoque = dados.estoque || {};
  const estoqueAtual = numeroSeguro(estoque.atual, 0);
  const h1 = numeroSeguro(estoque.h1, estoqueAtual);
  const h2 = numeroSeguro(estoque.h2, h1);
  const h3 = numeroSeguro(estoque.h3, h2);
  let horaAtual = horaNumero(dados.horaAtual);
  if (horaAtual === null) horaAtual = new Date().getHours();

  const dadosComRelacao = potencial.map(row => ({...row, relativo: horaRelativa(row.hora, horaAtual) }));
  const historico = dadosComRelacao.filter(row => row.relativo!== null && row.relativo < 0).sort((a, b) => b.relativo - a.relativo).slice(0, 3).sort((a, b) => a.relativo - b.relativo);
  const futuro = dadosComRelacao.filter(row => row.relativo!== null && row.relativo >= 0).sort((a, b) => a.relativo - b.relativo).slice(0, 12);
  const atual = potencial.find(row => row.hora === horaAtual) || futuro[0] || null;

  const mediaHistoricoPotencial = historico.length > 0? historico.reduce((t, r) => t + r.potencial, 0) / historico.length : 0;
  const mediaHistoricoMoagem = historico.length > 0? historico.reduce((t, r) => t + r.moagem, 0) / historico.length : unidade.nominal;
  const saldoHistorico = mediaHistoricoPotencial - mediaHistoricoMoagem;

  const estoqueHistorico = [h3, h2, h1, estoqueAtual];
  const variacaoEstoque = estoqueAtual - h3;
  let tendenciaEstoque = 'ESTÁVEL';
  if (variacaoEstoque > 0.2) tendenciaEstoque = 'SUBINDO';
  else if (variacaoEstoque < -0.2) tendenciaEstoque = 'CAINDO';

  let estoqueProjetado = estoqueAtual;
  const projecaoEstoque = [];
  let menorEstoque = estoqueAtual;
  let horaMenorEstoque = horaAtual;
  let primeiraHoraRisco = null;

  for (const row of futuro) {
    const saldoToneladas = row.potencial - row.moagem;
    const variacaoConjuntos = saldoToneladas / TONELADAS_POR_CONJUNTO;
    estoqueProjetado += variacaoConjuntos;
    const utilizacaoNominal = unidade.nominal > 0? (row.moagem / unidade.nominal) * 100 : 0;
    const disponibilidadePercentual = unidade.nominal > 0? (row.potencial / unidade.nominal) * 100 : 0;
    projecaoEstoque.push({
      hora: row.hora, horaFormatada: horaFormatada(row.hora), potencial: row.potencial, moagem: row.moagem,
      nominal: unidade.nominal, utilizacaoNominal, disponibilidadePercentual, saldoToneladas, variacaoConjuntos, estoqueProjetado
    });
    if (estoqueProjetado < menorEstoque) { menorEstoque = estoqueProjetado; horaMenorEstoque = row.hora; }
    if (primeiraHoraRisco === null && estoqueProjetado <= ESTOQUE_RISCO_CONJ) primeiraHoraRisco = row.hora;
  }

  let horaRecuperacao = null;
  if (primeiraHoraRisco!== null) {
    const pontoRisco = projecaoEstoque.find(row => row.hora === primeiraHoraRisco);
    if (pontoRisco) {
      for (const row of projecaoEstoque) {
        if (row.hora > pontoRisco.hora && row.estoqueProjetado > pontoRisco.estoqueProjetado) { horaRecuperacao = row.hora; break; }
      }
    }
  }

  const mediaFuturaPotencial = futuro.length > 0? futuro.reduce((t, r) => t + r.potencial, 0) / futuro.length : 0;
  const mediaFuturaMoagem = futuro.length > 0? futuro.reduce((t, r) => t + r.moagem, 0) / futuro.length : unidade.nominal;
  const saldoFuturo = mediaFuturaPotencial - mediaFuturaMoagem;

  let maiorDeficit = null;
  for (const row of futuro) {
    const deficit = row.moagem - row.potencial;
    if (!maiorDeficit || deficit > maiorDeficit.deficit) maiorDeficit = { hora: row.hora, deficit };
  }

  let moagemSeguraMedia = mediaFuturaPotencial;
  if (futuro.length > 0) {
    const estoqueDisponivelAcimaDoRisco = Math.max(estoqueAtual - ESTOQUE_RISCO_CONJ, 0);
    const toneladasDisponiveis = estoqueDisponivelAcimaDoRisco * TONELADAS_POR_CONJUNTO;
    const reforcoPorHora = toneladasDisponiveis / futuro.length;
    moagemSeguraMedia = mediaFuturaPotencial + reforcoPorHora;
  }
  moagemSeguraMedia = Math.min(moagemSeguraMedia, unidade.nominal);

  let classificacao = 'ESTÁVEL';
  if (menorEstoque <= 4) classificacao = 'CRÍTICO';
  else if (menorEstoque <= 7) classificacao = 'RISCO';
  else if (menorEstoque <= 9) classificacao = 'ATENÇÃO';

  return {
    unidade: { chave: unidade.chave, nome: unidade.nome, nominal: unidade.nominal },
    horaAtual,
    estoque: { h3, h2, h1, atual: estoqueAtual, historico: estoqueHistorico, variacao: variacaoEstoque, tendencia: tendenciaEstoque },
    atual: atual? { hora: atual.hora, potencial: atual.potencial, moagem: atual.moagem, nominal: unidade.nominal } : null,
    historico: historico.map(row => ({ hora: row.hora, potencial: row.potencial, moagem: row.moagem, saldo: row.potencial - row.moagem })),
    medias: { historicoPotencial: mediaHistoricoPotencial, historicoMoagem: mediaHistoricoMoagem, saldoHistorico, futuroPotencial: mediaFuturaPotencial, futuroMoagem: mediaFuturaMoagem, saldoFuturo },
    projecaoEstoque,
    risco: { classificacao, menorEstoque, horaMenorEstoque, primeiraHoraRisco, horaRecuperacao },
    moagemSeguraMedia,
    maiorDeficit,
    parametros: { toneladasPorConjunto: TONELADAS_POR_CONJUNTO, estoqueRiscoConj: ESTOQUE_RISCO_CONJ, nominalOficial: unidade.nominal }
  };
}

/* =========================================================
   PROMPT GEMINI
   ========================================================= */
function montarPrompt(dados, calculos, unidade) {
  const tabelaOriginal = textoSeguro(dados.tabelaOriginal, 30000);
  const comentarios = textoSeguro(dados.comentarios, 8000);
  const historicoTexto = calculos.historico.length > 0? calculos.historico.map(row => `${horaFormatada(row.hora)} | potencial ${row.potencial} t/h | moagem ${row.moagem} t/h | saldo ${row.saldo >= 0? '+' : ''}${row.saldo.toFixed(0)} t/h`).join('\n') : 'Sem histórico suficiente.';
  const projecaoTexto = calculos.projecaoEstoque.length > 0? calculos.projecaoEstoque.map(row => `${row.horaFormatada} | potencial ${row.potencial} t/h | moagem ${row.moagem} t/h | ${row.disponibilidadePercentual.toFixed(1)}% do nominal | estoque projetado ${row.estoqueProjetado.toFixed(1)} conjuntos`).join('\n') : 'Sem projeção disponível.';

  return `Você é um analista sênior de operações agrícolas e CTT. Sua função é transformar a análise de potencial de produção em um PLANO DE VOO operacional.
Escreva em pt-BR, técnico, direto, pronto para WhatsApp. Não invente frota, clima ou máquinas.

UNIDADE: ${unidade.nome} - Nominal oficial ${unidade.nominal} t/h
Hora análise: ${horaFormatada(calculos.horaAtual)}
Estoque: ${calculos.estoque.atual.toFixed(1)} conj | H-1 ${calculos.estoque.h1.toFixed(1)} | H-2 ${calculos.estoque.h2.toFixed(1)} | H-3 ${calculos.estoque.h3.toFixed(1)} | Tendência ${calculos.estoque.tendencia} | Variação ${calculos.estoque.variacao.toFixed(1)}

HISTÓRICO:
${historicoTexto}
Média pot ${calculos.medias.historicoPotencial.toFixed(0)} t/h | Média moag ${calculos.medias.historicoMoagem.toFixed(0)} t/h | Saldo ${calculos.medias.saldoHistorico.toFixed(0)} t/h

PROJEÇÃO:
${projecaoTexto}
Média futura pot ${calculos.medias.futuroPotencial.toFixed(0)} t/h | moag ${calculos.medias.futuroMoagem.toFixed(0)} t/h | Saldo ${calculos.medias.saldoFuturo.toFixed(0)} t/h

RISCO: ${calculos.risco.classificacao} | Menor estoque ${calculos.risco.menorEstoque.toFixed(1)} conj às ${horaFormatada(calculos.risco.horaMenorEstoque)} | Risco às ${calculos.risco.primeiraHoraRisco!== null? horaFormatada(calculos.risco.primeiraHoraRisco) : 'Não entra em risco'} | Recuperação ${calculos.risco.horaRecuperacao!== null? horaFormatada(calculos.risco.horaRecuperacao) : 'Não identificada'} | Maior déficit ${calculos.maiorDeficit? `${calculos.maiorDeficit.deficit.toFixed(0)} t/h às ${horaFormatada(calculos.maiorDeficit.hora)}` : 'N/A'}

MOAGEM SEGURA: ${calculos.moagemSeguraMedia.toFixed(0)} t/h | Nominal ${unidade.nominal} t/h

COMENTÁRIOS: ${comentarios || 'Nenhum'}
TABELA ORIGINAL: ${tabelaOriginal}

FORMATO OBRIGATÓRIO:
*PLANO DE VOO — ${unidade.nome}*
*Situação atual* - explique potencial vs moagem vs estoque
*Projeção* - comportamento estoque + horário crítico
*Ponto de atenção* - risco e causa
*Moagem segura* - faixa/referência
*Plano de ação* - o que fazer
*Perspectiva* - próximos passos
Use *negrito* padrão WhatsApp.`;
}

/* =========================================================
   CHAMADA GEMINI
   ========================================================= */
async function chamarGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada no ambiente.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s max

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 4000 }
      }),
      signal: controller.signal
    });
    const textoResposta = await response.text();
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${textoResposta.slice(0, 500)}`);
    let json;
    try { json = JSON.parse(textoResposta); } catch { throw new Error('Resposta do Gemini não é JSON válido.'); }
    const texto = json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim();
    if (!texto) throw new Error('Gemini retornou resposta vazia.');
    return texto;
  } finally { clearTimeout(timeout); }
}

function normalizarResposta(texto) {
  return String(texto || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/* =========================================================
   ROTAS
   ========================================================= */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
    parametros: { toneladasPorConjunto: TONELADAS_POR_CONJUNTO, estoqueRiscoConj: ESTOQUE_RISCO_CONJ },
    unidades: UNIDADES,
    time: new Date().toISOString()
  });
});

app.post('/api/plano-voo', async (req, res) => {
  try {
    const dados = req.body || {};
    if (!Array.isArray(dados.potencial)) return res.status(400).json({ error: 'Análise de potencial não enviada corretamente.' });
    if (!dados.estoque || dados.estoque.atual === undefined || dados.estoque.atual === null || dados.estoque.atual === '') return res.status(400).json({ error: 'O estoque atual não foi informado.' });

    const unidade = identificarUnidade(dados.tabelaOriginal);
    if (!unidade) return res.status(400).json({ error: 'Não foi possível identificar a filial. Informe análise contendo Mandu, Cruz Alta, São José, Vertente ou Tanabi.' });

    const calculos = calcularCenario(dados, unidade);
    const prompt = montarPrompt(dados, calculos, unidade);
    const respostaGemini = await chamarGemini(prompt);
    const planoVoo = normalizarResposta(respostaGemini);

    return res.json({ ok: true, unidade: { chave: unidade.chave, nome: unidade.nome, nominal: unidade.nominal }, horaAnalise: horaFormatada(calculos.horaAtual), modelo: GEMINI_MODEL, planoVoo, calculos });
  } catch (error) {
    console.error('Erro /api/plano-voo:', error.message);
    return res.status(500).json({ error: error?.message || 'Erro interno ao gerar o Plano de Voo.' });
  }
});

app.use('/api', (req, res) => { res.status(404).json({ error: 'Endpoint não encontrado.' }); });

app.use((error, req, res, next) => {
  console.error('Erro geral:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

/* =========================================================
   INICIALIZAÇÃO - CORRIGIDO RENDER
   ========================================================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==============================================');
  console.log(' PLANO DE VOO | CTT AGROINDUSTRIAL');
  console.log('==============================================');
  console.log(` Servidor: http://0.0.0.0:${PORT}`);
  console.log(` Gemini: ${GEMINI_API_KEY? 'OK' : 'NÃO CONFIGURADO'}`);
  console.log(` Modelo: ${GEMINI_MODEL}`);
  console.log(` t/conjunto: ${TONELADAS_POR_CONJUNTO}`);
  console.log(` Estoque risco: ${ESTOQUE_RISCO_CONJ} conjuntos`);
  console.log('----------------------------------------------');
  Object.values(UNIDADES).forEach(u => console.log(` - ${u.nome}: ${u.nominal} t/h`));
  console.log('==============================================');
  console.log('');
});
