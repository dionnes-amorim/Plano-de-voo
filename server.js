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

  return Number.isFinite(number) ? number : null;
}

function toText(value, maxLength = 3000) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().slice(0, maxLength);
}

function percent(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value);
}

/* =========================================================
   NORMALIZAÇÃO DOS DADOS
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

    observacoes: toText(body.observacoes, 5000)
  };
}

/* =========================================================
   CÁLCULO DOS INDICADORES
========================================================= */

function calculateMetrics(data) {
  const metrics = {
    gapMoagemNominal: null,
    gapEntregaMoagem: null,
    coberturaNominal: null,
    saldoEstoque: null,
    variacaoEstoqueProjetado: null,
    risco: "SEM CLASSIFICAÇÃO",
    principaisSinais: []
  };

  if (
    data.moagemAtual !== null &&
    data.moagemNominal !== null
  ) {
    metrics.gapMoagemNominal =
      data.moagemAtual - data.moagemNominal;
  }

  if (
    data.entregaMedia !== null &&
    data.moagemAtual !== null
  ) {
    metrics.gapEntregaMoagem =
      data.entregaMedia - data.moagemAtual;
  }

  if (
    data.entregaMedia !== null &&
    data.moagemNominal !== null &&
    data.moagemNominal > 0
  ) {
    metrics.coberturaNominal =
      (data.entregaMedia / data.moagemNominal) * 100;
  }

  if (
    data.estoqueAtual !== null &&
    data.estoqueMinimo !== null
  ) {
    metrics.saldoEstoque =
      data.estoqueAtual - data.estoqueMinimo;
  }

  if (
    data.estoqueProjetado !== null &&
    data.estoqueAtual !== null
  ) {
    metrics.variacaoEstoqueProjetado =
      data.estoqueProjetado - data.estoqueAtual;
  }

  const sinais = [];

  if (
    metrics.gapMoagemNominal !== null &&
    metrics.gapMoagemNominal > 0
  ) {
    sinais.push(
      "Moagem acima da referência nominal."
    );
  }

  if (
    metrics.gapEntregaMoagem !== null &&
    metrics.gapEntregaMoagem < 0
  ) {
    sinais.push(
      "Entrega abaixo da moagem atual, pressionando o estoque."
    );
  }

  if (
    metrics.saldoEstoque !== null &&
    metrics.saldoEstoque <= 0
  ) {
    sinais.push(
      "Estoque atual dentro ou abaixo da zona mínima informada."
    );
  } else if (
    metrics.saldoEstoque !== null &&
    metrics.saldoEstoque <= 2
  ) {
    sinais.push(
      "Estoque próximo da zona mínima."
    );
  }

  const indisponibilidades = [
    {
      nome: "Colhedoras próprias",
      media: data.colhedorasMedia,
      pico: data.colhedorasPico
    },
    {
      nome: "Trações",
      media: data.tracoesMedia,
      pico: data.tracoesPico
    },
    {
      nome: "Cavalos",
      media: data.cavalosMedia,
      pico: data.cavalosPico
    }
  ];

  indisponibilidades.forEach((item) => {
    if (item.media !== null && item.media >= 15) {
      sinais.push(
        `${item.nome} com indisponibilidade média relevante (${item.media}%).`
      );
    }

    if (item.pico !== null && item.pico >= 25) {
      sinais.push(
        `${item.nome} apresentou pico elevado de indisponibilidade (${item.pico}%).`
      );
    }
  });

  metrics.principaisSinais = sinais;

  /* -------------------------------------------------------
     CLASSIFICAÇÃO DE RISCO
  ------------------------------------------------------- */

  let risco = "ESTÁVEL";

  const estoqueCritico =
    metrics.saldoEstoque !== null &&
    metrics.saldoEstoque <= 0;

  const estoqueAltoRisco =
    metrics.saldoEstoque !== null &&
    metrics.saldoEstoque <= 2;

  const entregaAbaixoMoagem =
    metrics.gapEntregaMoagem !== null &&
    metrics.gapEntregaMoagem < 0;

  const moagemAcimaNominal =
    metrics.gapMoagemNominal !== null &&
    metrics.gapMoagemNominal > 0;

  const picoIndisponibilidadeAlto =
    indisponibilidades.some(
      (item) =>
        item.pico !== null &&
        item.pico >= 25
    );

  if (estoqueCritico) {
    risco = "CRÍTICO";
  } else if (
    estoqueAltoRisco &&
    entregaAbaixoMoagem
  ) {
    risco = "ALTO";
  } else if (
    entregaAbaixoMoagem &&
    moagemAcimaNominal
  ) {
    risco = "ALTO";
  } else if (
    entregaAbaixoMoagem ||
    estoqueAltoRisco ||
    picoIndisponibilidadeAlto
  ) {
    risco = "ATENÇÃO";
  }

  metrics.risco = risco;

  return metrics;
}

/* =========================================================
   PROMPT DO PLANO DE VOO
========================================================= */

function buildPrompt(data, metrics) {
  return `
Você é um especialista sênior em CTT Agroindustrial e Controle de Operações Agrícolas (COA), atuando em uma operação de cana-de-açúcar da Tereos.

Sua função é analisar os dados operacionais abaixo e produzir um "Plano de Voo" gerencial, com linguagem semelhante à utilizada em uma comunicação real de COA para gerência.

O objetivo não é apenas repetir os números.

Você deve interpretar:

- moagem;
- moagem nominal;
- entrega das frentes;
- estoque de conjuntos carregados;
- tendência do estoque;
- disponibilidade mecânica;
- colhedoras;
- trações;
- cavalos;
- ciclo de transporte;
- ofensores;
- manutenção;
- mudanças de frente;
- interdições;
- troca de turno;
- terceiros e fornecedores;
- ações de sinergia;
- ações já realizadas pelo COA;
- necessidade de alocação;
- risco de redução ou parada da moagem;
- caminho para retorno à moagem nominal.

=========================================================
DADOS DO CENÁRIO
=========================================================

Unidade:
${data.unidade || "Não informado"}

Data/hora:
${data.dataHora || "Não informado"}

Turno:
${data.turno || "Não informado"}

Tipo de problema predominante:
${data.tipoProblema || "Não informado"}

---------------------------------------------------------
MOAGEM E ENTREGA
---------------------------------------------------------

Moagem atual:
${data.moagemAtual ?? "Não informado"} t/h

Moagem nominal:
${data.moagemNominal ?? "Não informado"} t/h

Entrega média:
${data.entregaMedia ?? "Não informado"} t/h

Janela utilizada para entrega:
${data.janelaEntrega || "Não informado"}

---------------------------------------------------------
ESTOQUE
---------------------------------------------------------

Estoque atual:
${data.estoqueAtual ?? "Não informado"} conjuntos

Estoque mínimo / zona de risco:
${data.estoqueMinimo ?? "Não informado"} conjuntos

Estoque projetado:
${data.estoqueProjetado ?? "Não informado"} conjuntos

Horário estimado de atingir estoque crítico:
${data.horaEstoqueCritico || "Não informado"}

Moagem de contingência:
${data.moagemContingencia ?? "Não informado"} t/h

---------------------------------------------------------
DISPONIBILIDADE - COLHEDORAS PRÓPRIAS
---------------------------------------------------------

Média de indisponibilidade:
${data.colhedorasMedia ?? "Não informado"}%

Período:
${data.colhedorasPeriodo || "Não informado"}

Pico:
${data.colhedorasPico ?? "Não informado"}%

Horário do pico:
${data.colhedorasHoraPico || "Não informado"}

---------------------------------------------------------
DISPONIBILIDADE - TRAÇÕES
---------------------------------------------------------

Média de indisponibilidade:
${data.tracoesMedia ?? "Não informado"}%

Período:
${data.tracoesPeriodo || "Não informado"}

Pico:
${data.tracoesPico ?? "Não informado"}%

Horário do pico:
${data.tracoesHoraPico || "Não informado"}

---------------------------------------------------------
DISPONIBILIDADE - CAVALOS
---------------------------------------------------------

Média de indisponibilidade:
${data.cavalosMedia ?? "Não informado"}%

Período:
${data.cavalosPeriodo || "Não informado"}

Pico:
${data.cavalosPico ?? "Não informado"}%

Horário do pico:
${data.cavalosHoraPico || "Não informado"}

---------------------------------------------------------
OFENSORES / FRENTES / EVENTOS
---------------------------------------------------------

${data.ofensores || "Nenhum ofensor informado."}

---------------------------------------------------------
EVENTOS OPERACIONAIS
---------------------------------------------------------

${data.eventos || "Nenhum evento informado."}

---------------------------------------------------------
CICLO DE TRANSPORTE
---------------------------------------------------------

${data.ciclo || "Não informado."}

---------------------------------------------------------
TROCAS DE TURNO
---------------------------------------------------------

${data.trocasTurno || "Não informado."}

---------------------------------------------------------
TERCEIROS / FORNECEDORES
---------------------------------------------------------

${data.tercForn || "Não informado."}

---------------------------------------------------------
AÇÕES JÁ REALIZADAS PELO COA
---------------------------------------------------------

${data.acoesCOA || "Nenhuma ação informada."}

---------------------------------------------------------
PRIORIDADE DE ALOCAÇÃO
---------------------------------------------------------

${data.prioridadeAlocacao || "Não informado."}

---------------------------------------------------------
SINERGIA ENTRE UNIDADES
---------------------------------------------------------

${data.sinergia || "Não informado."}

---------------------------------------------------------
OBSERVAÇÕES
---------------------------------------------------------

${data.observacoes || "Nenhuma observação adicional."}

=========================================================
INDICADORES CALCULADOS PELO SISTEMA
=========================================================

Gap entre moagem atual e nominal:
${metrics.gapMoagemNominal ?? "Não calculado"} t/h

Gap entre entrega e moagem:
${metrics.gapEntregaMoagem ?? "Não calculado"} t/h

Cobertura da entrega sobre a moagem nominal:
${
  metrics.coberturaNominal !== null
    ? metrics.coberturaNominal.toFixed(1)
    : "Não calculado"
}%

Saldo do estoque em relação ao mínimo:
${metrics.saldoEstoque ?? "Não calculado"} conjuntos

Variação do estoque projetado:
${metrics.variacaoEstoqueProjetado ?? "Não calculado"} conjuntos

Classificação preliminar:
${metrics.risco}

Principais sinais identificados:
${
  metrics.principaisSinais.length
    ? metrics.principaisSinais.join("\n- ")
    : "Nenhum sinal automático relevante."
}

=========================================================
REGRAS DE ANÁLISE
=========================================================

1. NÃO INVENTE números, horários, frentes ou eventos.

2. Utilize somente as informações fornecidas.

3. Se alguma informação estiver ausente, não invente uma conclusão específica. Faça uma recomendação condicional.

4. Não trate a classificação automática de risco como verdade absoluta. Utilize os números e o contexto operacional para validar a situação.

5. Diferencie claramente:
   - moagem;
   - entrega;
   - estoque;
   - disponibilidade;
   - ciclo;
   - causa;
   - consequência;
   - ação.

6. Quando a entrega estiver abaixo da moagem, explique que existe consumo do estoque e que a sustentação da moagem dependerá da recuperação da entrega/ciclo.

7. Quando a moagem estiver acima da nominal, avalie se existe sustentação operacional ou se é necessário reduzir para preservar o estoque.

8. Quando o estoque estiver próximo ou abaixo da zona de risco, destaque isso claramente.

9. Se houver indisponibilidade relevante de colhedoras, trações ou cavalos, explique como isso impacta a entrega e o ciclo.

10. Se houver troca de frente, interdição, mudança de área ou mudança de turno, considere o tempo de estabilização do ciclo.

11. Não trate uma simples mudança de frente como recuperação imediata. Considere que a nova frente precisa carregar, iniciar o ciclo e colocar viagens no sistema.

12. Se houver sinergia entre unidades, considere a sinergia como mecanismo de recuperação de entrega, mas não invente capacidade que não foi informada.

13. Se houver ações já realizadas pelo COA, incorpore essas ações ao plano.

14. Priorize sempre:
   - manter o ciclo;
   - recuperar entrega;
   - preservar estoque;
   - reduzir risco de quebra;
   - retornar à moagem nominal com segurança.

15. Não utilize linguagem excessivamente acadêmica.

16. Não escreva como uma IA.

17. Não use frases genéricas como:
   "é importante monitorar constantemente"
   sem explicar exatamente o que deve ser monitorado e por quê.

18. Não faça tabela.

19. Não coloque emojis.

20. O texto deve parecer uma comunicação real de COA para uma gerência operacional.

=========================================================
FORMATO DA RESPOSTA
=========================================================

Produza exatamente nesta estrutura:

PLANO DE VOO — [UNIDADE]

CENÁRIO ATUAL

Faça uma análise objetiva da moagem atual, nominal, entrega e principal comportamento operacional.

PONTOS CRÍTICOS

Explique os principais ofensores, indisponibilidades, eventos ou problemas de ciclo. Relacione causa e efeito.

ESTOQUE E RISCO OPERACIONAL

Explique o comportamento do estoque, se existe risco de redução/parada e qual variável precisa ser recuperada para sustentar a moagem.

PLANO DE AÇÃO

Apresente ações práticas e específicas, priorizando alocação, recuperação de ciclo, retorno de equipamentos, mudança de frente, sinergia ou qualquer outra ação informada.

TENDÊNCIA

Finalize explicando o cenário esperado.

Se os dados permitirem recuperação:
explique o que precisa ser garantido para retornar à nominal.

Se os dados indicarem risco:
explique qual condição precisa ser revertida para evitar nova redução.

Mantenha o texto entre aproximadamente 350 e 650 palavras, podendo ser menor quando o cenário for simples.

Se houver informação muito relevante, priorize qualidade da análise em vez de preencher espaço.
`;
}

/* =========================================================
   CHAMADA GEMINI
========================================================= */

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY não configurada no ambiente."
    );
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const body = {
    systemInstruction: {
      parts: [
        {
          text: `
Você é o motor de análise operacional do COA.
Sua especialidade é CTT Agroindustrial, logística de cana,
moagem, ciclo de transporte, estoque e planejamento operacional.

Sempre priorize precisão, causalidade operacional e clareza gerencial.
`
        }
      ]
    },

    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],

    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 3000
    }
  };

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify(body)
      });

      const json = await response.json();

      if (!response.ok) {
        const message =
          json?.error?.message ||
          `Erro HTTP ${response.status}`;

        const error = new Error(message);
        error.status = response.status;

        throw error;
      }

      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim();

      if (!text) {
        throw new Error(
          "A Gemini não retornou conteúdo de análise."
        );
      }

      return text;

    } catch (error) {
      lastError = error;

      const retryable =
        error.status === 429 ||
        error.status >= 500;

      if (!retryable || attempt === 2) {
        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 1200)
      );
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
    service: "COA Plano de Voo CTT",
    model: GEMINI_MODEL,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   ANALISAR CENÁRIO
========================================================= */

app.post(
  "/api/analyze",
  analyzeLimiter,
  async (req, res) => {
    try {
      const data = normalizePayload(req.body);

      if (!data.unidade) {
        return res.status(400).json({
          error: "Informe a unidade."
        });
      }

      if (
        data.moagemAtual === null ||
        data.moagemNominal === null
      ) {
        return res.status(400).json({
          error:
            "Informe a moagem atual e a moagem nominal."
        });
      }

      const metrics = calculateMetrics(data);

      const prompt = buildPrompt(
        data,
        metrics
      );

      const analysis =
        await callGemini(prompt);

      return res.json({
        success: true,
        model: GEMINI_MODEL,
        metrics,
        analysis,
        generatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error(
        "Erro na análise:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Não foi possível gerar o Plano de Voo."
      });
    }
  }
);

/* =========================================================
   FALLBACK
========================================================= */

app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/api/")
  ) {
    return res.sendFile(
      path.join(__dirname, "index.html")
    );
  }

  next();
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log("");
  console.log("==========================================");
  console.log(" COA | PLANO DE VOO CTT");
  console.log("==========================================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Modelo Gemini: ${GEMINI_MODEL}`);
  console.log(
    `Gemini configurada: ${Boolean(GEMINI_API_KEY)}`
  );
  console.log("==========================================");
  console.log("");
});
