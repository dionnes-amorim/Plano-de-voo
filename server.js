require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "250kb" }));

app.use(express.static(__dirname));

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Limite de análises atingido. Aguarde alguns segundos e tente novamente."
  }
});

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number)? number : null;
}

function toText(value, maxLength = 3000) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().slice(0, maxLength);
}

function percent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toNumber(value);
}

/* =========================================================
   NORMALIZAÇÃO DOS DADOS - INTEGRADO
========================================================= */

function normalizePayload(body) {
  return {
    unidade: toText(body.unidade, 100),
    dataHora: toText(body.dataHora, 100),
    turno: toText(body.turno, 100),

    moagemAtual: toNumber(body.moagemAtual),
    moagemNominal: toNumber(body.moagemNominal),
    entregaMedia: toNumber(body.entregaMedia),
    janelaEntrega: toText(body.janelaEntrega, 100),

    estoqueAtual: toNumber(body.estoqueAtual),
    estoqueMinimo: toNumber(body.estoqueMinimo),
    estoqueProjetado: toNumber(body.estoqueProjetado),
    horaEstoqueCritico: toText(body.horaEstoqueCritico, 100),

    moagemContingencia: toNumber(body.moagemContingencia),

    colhedorasMedia: percent(body.colhedorasMedia),
    colhedorasPeriodo: toText(body.colhedorasPeriodo, 100),
    colhedorasPico: percent(body.colhedorasPico),
    colhedorasHoraPico: toText(body.colhedorasHoraPico, 100),

    tracoesMedia: percent(body.tracoesMedia),
    tracoesPeriodo: toText(body.tracoesPeriodo, 100),
    tracoesPico: percent(body.tracoesPico),
    tracoesHoraPico: toText(body.tracoesHoraPico, 100),

    cavalosMedia: percent(body.cavalosMedia),
    cavalosPeriodo: toText(body.cavalosPeriodo, 100),
    cavalosPico: percent(body.cavalosPico),
    cavalosHoraPico: toText(body.cavalosHoraPico, 100),

    tipoProblema: toText(body.tipoProblema, 100),

    ofensores: toText(body.ofensores, 5000),
    eventos: toText(body.eventos, 5000),

    ciclo: toText(body.ciclo, 3000),
    trocasTurno: toText(body.trocasTurno, 2000),

    tercForn: toText(body.tercForn, 3000),

    acoesCOA: toText(body.acoesCOA, 5000),
    prioridadeAlocacao: toText(body.prioridadeAlocacao, 3000),
    sinergia: toText(body.sinergia, 3000),

    observacoes: toText(body.observacoes, 5000),

    // === NOVO - HISTÓRICO INTEGRADO 3H ===
    h19_20_entrada: toNumber(body.h19_20_entrada),
    h19_20_moagem: toNumber(body.h19_20_moagem),
    h19_20_estoque: toNumber(body.h19_20_estoque),

    h20_21_entrada: toNumber(body.h20_21_entrada),
    h20_21_moagem: toNumber(body.h20_21_moagem),
    h20_21_estoque: toNumber(body.h20_21_estoque),

    h21_22_entrada: toNumber(body.h21_22_entrada),
    h21_22_moagem: toNumber(body.h21_22_moagem),
    h21_22_estoque: toNumber(body.h21_22_estoque),

    // === NOVO - PROJEÇÃO 12H ===
    potencial12h: toNumber(body.potencial12h),
    metaMoagem12h: toNumber(body.metaMoagem12h),
    moagemDesejada: toNumber(body.moagemDesejada),
    potencialFrentes: toText(body.potencialFrentes, 3000)
  };
}

/* =========================================================
   CÁLCULO DOS INDICADORES - COM TENDÊNCIA
========================================================= */

function calculateMetrics(data) {
  const metrics = {
    gapMoagemNominal: null,
    gapEntregaMoagem: null,
    coberturaNominal: null,
    saldoEstoque: null,
    variacaoEstoqueProjetado: null,
    risco: "SEM CLASSIFICAÇÃO",
    principaisSinais: [],

    // NOVOS
    entrada3h: null,
    moagem3h: null,
    saldo3h: null,
    tendenciaEstoque: null,
    gapFuturo12h: null,
    horasAteCritico: null
  };

  if (data.moagemAtual!== null && data.moagemNominal!== null) {
    metrics.gapMoagemNominal = data.moagemAtual - data.moagemNominal;
  }

  if (data.entregaMedia!== null && data.moagemAtual!== null) {
    metrics.gapEntregaMoagem = data.entregaMedia - data.moagemAtual;
  }

  if (data.entregaMedia!== null && data.moagemNominal!== null && data.moagemNominal > 0) {
    metrics.coberturaNominal = (data.entregaMedia / data.moagemNominal) * 100;
  }

  if (data.estoqueAtual!== null && data.estoqueMinimo!== null) {
    metrics.saldoEstoque = data.estoqueAtual - data.estoqueMinimo;
  }

  if (data.estoqueProjetado!== null && data.estoqueAtual!== null) {
    metrics.variacaoEstoqueProjetado = data.estoqueProjetado - data.estoqueAtual;
  }

  // === CÁLCULOS INTEGRADOS ===
  const entradas = [data.h19_20_entrada, data.h20_21_entrada, data.h21_22_entrada].filter(v => v!== null);
  const moagens = [data.h19_20_moagem, data.h20_21_moagem, data.h21_22_moagem].filter(v => v!== null);

  if (entradas.length > 0) {
    metrics.entrada3h = entradas.reduce((a, b) => a + b, 0);
  }
  if (moagens.length > 0) {
    metrics.moagem3h = moagens.reduce((a, b) => a + b, 0);
  }
  if (metrics.entrada3h!== null && metrics.moagem3h!== null) {
    metrics.saldo3h = metrics.entrada3h - metrics.moagem3h;
  }

  if (data.h19_20_estoque!== null && data.h21_22_estoque!== null) {
    metrics.tendenciaEstoque = data.h21_22_estoque - data.h19_20_estoque;
  }

  if (data.potencial12h!== null && data.metaMoagem12h!== null) {
    metrics.gapFuturo12h = data.potencial12h - data.metaMoagem12h;
  }

  // Estimativa de horas até crítico se continuar caindo
  if (metrics.saldo3h!== null && metrics.saldo3h < 0 && data.estoqueAtual!== null && data.estoqueMinimo!== null) {
    const consumoHora = Math.abs(metrics.saldo3h) / (entradas.length || 3);
    if (consumoHora > 0) {
      const toneladasPorConjunto = 30; // média de conjunto
      const estoqueTon = data.estoqueAtual * toneladasPorConjunto;
      const minimoTon = data.estoqueMinimo * toneladasPorConjunto;
      const saldoTon = estoqueTon - minimoTon;
      metrics.horasAteCritico = saldoTon / consumoHora;
    }
  }

  const sinais = [];

  if (metrics.gapMoagemNominal!== null && metrics.gapMoagemNominal > 0) {
    sinais.push("Moagem acima da referência nominal.");
  }
  if (metrics.gapEntregaMoagem!== null && metrics.gapEntregaMoagem < 0) {
    sinais.push("Entrega abaixo da moagem atual, pressionando o estoque.");
  }
  if (metrics.saldoEstoque!== null && metrics.saldoEstoque <= 0) {
    sinais.push("Estoque atual dentro ou abaixo da zona mínima informada.");
  } else if (metrics.saldoEstoque!== null && metrics.saldoEstoque <= 2) {
    sinais.push("Estoque próximo da zona mínima.");
  }
  if (metrics.saldo3h!== null && metrics.saldo3h < 0) {
    sinais.push(`Nas últimas 3h houve déficit de ${Math.abs(metrics.saldo3h)}t (entrou menos que moeu).`);
  }
  if (metrics.tendenciaEstoque!== null && metrics.tendenciaEstoque < 0) {
    sinais.push(`Tendência de queda de estoque de ${Math.abs(metrics.tendenciaEstoque)} conj. nas últimas 3h.`);
  }
  if (metrics.gapFuturo12h!== null && metrics.gapFuturo12h < 0) {
    sinais.push(`Projeção 12h indica déficit de ${Math.abs(metrics.gapFuturo12h)}t entre potencial e meta.`);
  }

  const indisponibilidades = [
    { nome: "Colhedoras próprias", media: data.colhedorasMedia, pico: data.colhedorasPico },
    { nome: "Trações", media: data.tracoesMedia, pico: data.tracoesPico },
    { nome: "Cavalos", media: data.cavalosMedia, pico: data.cavalosPico }
  ];

  indisponibilidades.forEach((item) => {
    if (item.media!== null && item.media >= 15) {
      sinais.push(`${item.nome} com indisponibilidade média relevante (${item.media}%).`);
    }
    if (item.pico!== null && item.pico >= 25) {
      sinais.push(`${item.nome} apresentou pico elevado de indisponibilidade (${item.pico}%).`);
    }
  });

  metrics.principaisSinais = sinais;

  let risco = "ESTÁVEL";
  const estoqueCritico = metrics.saldoEstoque!== null && metrics.saldoEstoque <= 0;
  const estoqueAltoRisco = metrics.saldoEstoque!== null && metrics.saldoEstoque <= 2;
  const entregaAbaixoMoagem = metrics.gapEntregaMoagem!== null && metrics.gapEntregaMoagem < 0;
  const moagemAcimaNominal = metrics.gapMoagemNominal!== null && metrics.gapMoagemNominal > 0;
  const picoIndisponibilidadeAlto = indisponibilidades.some(item => item.pico!== null && item.pico >= 25);
  const projecaoNegativa = metrics.gapFuturo12h!== null && metrics.gapFuturo12h < -500;

  if (estoqueCritico || projecaoNegativa) {
    risco = "CRÍTICO";
  } else if (estoqueAltoRisco && entregaAbaixoMoagem) {
    risco = "ALTO";
  } else if (entregaAbaixoMoagem && moagemAcimaNominal) {
    risco = "ALTO";
  } else if (entregaAbaixoMoagem || estoqueAltoRisco || picoIndisponibilidadeAlto || metrics.saldo3h < 0) {
    risco = "ATENÇÃO";
  }

  metrics.risco = risco;
  return metrics;
}

/* =========================================================
   PROMPT DO PLANO DE VOO - INTEGRADO
========================================================= */

function buildPrompt(data, metrics) {
  return `
Você é um especialista sênior em CTT Agroindustrial e Controle de Operações Agrícolas (COA), atuando em uma operação de cana-de-açúcar da Tereos.

Sua função é analisar os dados operacionais abaixo e produzir um "Plano de Voo" gerencial, com linguagem de comunicação real de COA para gerência.

O objetivo não é apenas repetir os números. Você deve interpretar o histórico, a tendência e a projeção futura.

DADOS DO CENÁRIO


Unidade: ${data.unidade || "Não informado"}
Data/hora: ${data.dataHora || "Não informado"}
Turno: ${data.turno || "Não informado"}
Tipo de problema predominante: ${data.tipoProblema || "Não informado"}

HISTÓRICO INTEGRADO - ÚLTIMAS 3 HORAS (BASE DA TENDÊNCIA)

19h-20h | Entrou: ${data.h19_20_entrada?? "NI"} t | Moído: ${data.h19_20_moagem?? "NI"} t | Estoque fechamento 20h: ${data.h19_20_estoque?? "NI"} conj.
20h-21h | Entrou: ${data.h20_21_entrada?? "NI"} t | Moído: ${data.h20_21_moagem?? "NI"} t | Estoque fechamento 21h: ${data.h20_21_estoque?? "NI"} conj.
21h-22h | Entrou: ${data.h21_22_entrada?? "NI"} t | Moído: ${data.h21_22_moagem?? "NI"} t | Estoque ATUAL 22h: ${data.h21_22_estoque?? "NI"} conj.

Total 3h - Entrou: ${metrics.entrada3h?? "NI"} t | Moído: ${metrics.moagem3h?? "NI"} t | Saldo 3h: ${metrics.saldo3h?? "NI"} t
Tendência de estoque nas últimas 3h: ${metrics.tendenciaEstoque?? "NI"} conj.
Horas estimadas até estoque crítico se manter ritmo: ${metrics.horasAteCritico!== null? metrics.horasAteCritico.toFixed(1) + "h" : "NI"}

MOAGEM E ENTREGA ATUAL

Moagem atual: ${data.moagemAtual?? "Não informado"} t/h
Moagem nominal: ${data.moagemNominal?? "Não informado"} t/h
Entrega média: ${data.entregaMedia?? "Não informado"} t/h
Janela utilizada para entrega: ${data.janelaEntrega || "Não informado"}

ESTOQUE ATUAL

Estoque atual: ${data.estoqueAtual?? "Não informado"} conjuntos
Estoque mínimo / zona de risco: ${data.estoqueMinimo?? "Não informado"} conjuntos
Estoque projetado: ${data.estoqueProjetado?? "Não informado"} conjuntos
Horário estimado de atingir estoque crítico: ${data.horaEstoqueCritico || "Não informado"}
Moagem de contingência: ${data.moagemContingencia?? "Não informado"} t/h

PROJEÇÃO PRÓXIMAS 12H

Potencial de produção das frentes nas próximas 12h: ${data.potencial12h?? "NI"} t
Meta de moagem nas próximas 12h: ${data.metaMoagem12h?? "NI"} t
Gap futuro 12h (Potencial - Meta): ${metrics.gapFuturo12h?? "NI"} t
Moagem desejada (t/h): ${data.moagemDesejada?? "NI"} t/h
Detalhamento por frente: ${data.potencialFrentes || "Não informado"}

DISPONIBILIDADE

Colhedoras - Média: ${data.colhedorasMedia?? "NI"}% | Período: ${data.colhedorasPeriodo || "NI"} | Pico: ${data.colhedorasPico?? "NI"}% | Hora pico: ${data.colhedorasHoraPico || "NI"}
Trações - Média: ${data.tracoesMedia?? "NI"}% | Período: ${data.tracoesPeriodo || "NI"} | Pico: ${data.tracoesPico?? "NI"}% | Hora pico: ${data.tracoesHoraPico || "NI"}
Cavalos - Média: ${data.cavalosMedia?? "NI"}% | Período: ${data.cavalosPeriodo || "NI"} | Pico: ${data.cavalosPico?? "NI"}% | Hora pico: ${data.cavalosHoraPico || "NI"}

OFENSORES / EVENTOS / CICLO

Ofensores: ${data.ofensores || "Nenhum"}
Eventos: ${data.eventos || "Nenhum"}
Ciclo: ${data.ciclo || "Não informado"}
Trocas turno: ${data.trocasTurno || "Não informado"}
Terceiros/Forn: ${data.tercForn || "Não informado"}
Ações COA: ${data.acoesCOA || "Nenhuma"}
Prioridade alocação: ${data.prioridadeAlocacao || "Não informado"}
Sinergia: ${data.sinergia || "Não informado"}
Obs: ${data.observacoes || "Nenhuma"}

INDICADORES CALCULADOS

Gap moagem atual x nominal: ${metrics.gapMoagemNominal?? "NC"} t/h
Gap entrega x moagem: ${metrics.gapEntregaMoagem?? "NC"} t/h
Cobertura entrega/nominal: ${metrics.coberturaNominal!== null? metrics.coberturaNominal.toFixed(1) : "NC"}%
Saldo estoque vs mínimo: ${metrics.saldoEstoque?? "NC"} conj.
Risco: ${metrics.risco}
Sinais: ${metrics.principaisSinais.length? metrics.principaisSinais.join("\n- ") : "Nenhum relevante"}

REGRAS OBRIGATÓRIAS

1. USE OBRIGATORIAMENTE o histórico das últimas 3h para explicar tendência.
2. Se nas últimas 3h entrou menos que moeu, destaque consumo de estoque e calcule ritmo.
3. Cruze saldo 3h com gap futuro 12h para dizer se vai faltar ou sobrar cana.
4. Se gap futuro 12h negativo, diga EXATAMENTE quanto falta e o que fazer: reduzir moagem, pedir sinergia, recuperar colhedora, etc.
5. Se horas até crítico for <4h, alerte como CRÍTICO.
6. Não invente números. Use somente dados fornecidos.
7. Diferencie causa e efeito.
8. Quando moagem acima da nominal e entrega abaixo, diga que precisa reduzir para preservar estoque.
9. Considere tempo de estabilização de nova frente, interdição, troca de turno.
10. Formato obrigatório abaixo, sem tabela, sem emoji, linguagem real de COA.

FORMATO DA RESPOSTA


PLANO DE VOO — [UNIDADE]

CENÁRIO ATUAL
Analise moagem atual, nominal, entrega, comportamento das últimas 3h (o que entrou vs o que moeu e fechamento de estoque).

PONTOS CRÍTICOS
Explique ofensores, indisponibilidades, eventos de ciclo e impacto direto no saldo das últimas 3h.

ESTOQUE E RISCO OPERACIONAL
Explique tendência de estoque nas últimas 3h, horas até crítico, e cruze com projeção 12h (potencial vs meta). Diga se existe risco de redução/parada.

PLANO DE AÇÃO
Ações práticas: alocação, recuperação de ciclo, retorno de equipamentos, mudança de frente, sinergia, redução para contingência. Se gap 12h negativo, diga quanto falta e como cobrir.

TENDÊNCIA
Finalize com cenário esperado: se mantiver ritmo o que acontece, e o que precisa garantir para voltar à nominal ou evitar redução. Use horas reais (19h-22h e próximas 12h).
Texto entre 400 e 700 palavras.
`;
}

/* =========================================================
   CHAMADA GEMINI
========================================================= */

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada no ambiente.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const body = {
    systemInstruction: {
      parts: [{ text: "Você é o motor de análise operacional do COA. Especialidade é CTT Agroindustrial, logística de cana, moagem, ciclo, estoque e planejamento. Priorize precisão e clareza gerencial." }]
    },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 3000 }
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(body)
      });
      const json = await response.json();
      if (!response.ok) {
        const message = json?.error?.message || `Erro HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      const text = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
      if (!text) throw new Error("A Gemini não retornou conteúdo de análise.");
      return text;
    } catch (error) {
      lastError = error;
      const retryable = error.status === 429 || error.status >= 500;
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError;
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "COA Plano de Voo CTT - Integrado",
    model: GEMINI_MODEL,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   ANALISAR CENÁRIO
========================================================= */

app.post("/api/analyze", analyzeLimiter, async (req, res) => {
  try {
    const data = normalizePayload(req.body);
    if (!data.unidade) return res.status(400).json({ error: "Informe a unidade." });
    if (data.moagemAtual === null || data.moagemNominal === null) {
      return res.status(400).json({ error: "Informe a moagem atual e a moagem nominal." });
    }

    const metrics = calculateMetrics(data);
    const prompt = buildPrompt(data, metrics);
    const analysis = await callGemini(prompt);

    return res.json({
      success: true,
      model: GEMINI_MODEL,
      metrics,
      analysis,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Erro na análise:", error);
    return res.status(500).json({ success: false, error: error?.message || "Não foi possível gerar o Plano de Voo." });
  }
});

/* =========================================================
   FALLBACK
========================================================= */

app.use((req, res, next) => {
  if (req.method === "GET" &&!req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "index.html"));
  }
  next();
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log("");
  console.log("==========================================");
  console.log(" COA | PLANO DE VOO CTT - INTEGRADO 3H + 12H");
  console.log("==========================================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Modelo Gemini: ${GEMINI_MODEL}`);
  console.log(`Gemini configurada: ${Boolean(GEMINI_API_KEY)}`);
  console.log("==========================================");
  console.log("");
});
