import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    service: "COA Plano de Voo",
    geminiConfigured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL
  });

});


/* =========================================================
   CÁLCULOS OPERACIONAIS
========================================================= */

function number(value) {

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;

}


function calculateScenario(data) {

  const nominal =
    number(data.nominal);

  const milling =
    number(data.milling);

  const delivery =
    number(data.delivery);

  const production =
    number(data.frontProd);

  const stock =
    number(data.stock);

  const density =
    number(data.density) || 70;

  const minStock =
    number(data.minStock);

  const maxStock =
    number(data.maxStock);

  /*
   * Saldo de entrada/saída do pátio.
   *
   * Positivo = estoque tende a cair.
   * Negativo = estoque tende a subir.
   */
  const stockDeltaPerHour =
    delivery - milling;


  /*
   * Estoque em toneladas.
   */
  const stockTons =
    stock * density;


  /*
   * Diferença moagem x entrega.
   */
  const millingDeliveryGap =
    milling - delivery;


  /*
   * Diferença moagem x produção.
   */
  const millingProductionGap =
    milling - production;


  /*
   * Tempo teórico até consumir todo o estoque,
   * considerando o ritmo atual de moagem e sem entrada.
   */
  const fullStockMinutes =
    milling > 0
      ? (stockTons / milling) * 60
      : 0;


  /*
   * Quantos conjuntos/h o estoque perde ou ganha.
   */
  const stockChangeSetsPerHour =
    density > 0
      ? stockDeltaPerHour / density
      : 0;


  /*
   * Estoque mínimo em toneladas.
   */
  const minStockTons =
    minStock * density;


  /*
   * Margem até estoque mínimo.
   */
  const marginToMinimum =
    stockTons - minStockTons;


  /*
   * Classificação básica.
   */
  let risk = "ESTÁVEL";

  if (
    stock <= minStock ||
    millingDeliveryGap >= 100
  ) {

    risk = "ATENÇÃO";

  }

  if (
    stock <= Math.max(4, minStock - 2) ||
    millingDeliveryGap >= 180
  ) {

    risk = "CRÍTICO";

  }


  /*
   * Se produção está abaixo da moagem,
   * o campo não está sustentando o ritmo industrial.
   */
  const fieldBelowMilling =
    production < milling;


  /*
   * Se entrega está abaixo da moagem,
   * o pátio está sendo consumido.
   */
  const stockBeingConsumed =
    delivery < milling;


  return {

    nominal,
    milling,
    delivery,
    production,
    stock,
    density,
    minStock,
    maxStock,

    stockTons,

    millingDeliveryGap,

    millingProductionGap,

    stockDeltaPerHour,

    stockChangeSetsPerHour,

    fullStockMinutes,

    minStockTons,

    marginToMinimum,

    fieldBelowMilling,

    stockBeingConsumed,

    risk

  };

}


/* =========================================================
   PROMPT DO PLANO DE VOO
========================================================= */

function buildPrompt(data, calc) {

  return `
Você é um Analista Sênior de Operações do COA/CTT
em uma operação agroindustrial de cana-de-açúcar.

Você conhece profundamente:

- CTT;
- colheita mecanizada;
- transporte de cana;
- ciclo de caminhões;
- cavalos e carretas;
- alocação;
- disponibilidade mecânica;
- produção de frentes;
- moagem;
- entrega agrícola;
- estoque de cana;
- palhada;
- mudanças de frente;
- interdições de trajeto;
- trocas de turno;
- sinergia entre unidades;
- fornecedores;
- terceiros;
- planejamento operacional.

Sua tarefa é produzir um PLANO DE VOO GERENCIAL
com base exclusivamente nos dados fornecidos.

=========================================================
PADRÃO DE ESCRITA
=========================================================

O texto deve seguir o estilo operacional abaixo:

- Claro.
- Direto.
- Explicativo.
- Técnico na medida certa.
- Natural.
- Linguagem de gerente/operação.
- Sem parecer texto produzido por IA.
- Sem excesso de formalidade.
- Sem excesso de tópicos.
- Sem frases genéricas.
- Sem repetir os mesmos números várias vezes.

A lógica da análise deve ser:

CAUSA
↓
REFLEXO NA PRODUÇÃO/CICLO
↓
IMPACTO NO ESTOQUE
↓
RISCO PARA MOAGEM
↓
AÇÃO DO COA
↓
CENÁRIO ESPERADO

=========================================================
REGRA FUNDAMENTAL
=========================================================

NÃO INVENTE informações.

Não invente:

- horários;
- frentes;
- toneladas;
- disponibilidade;
- ciclos;
- quantidade de caminhões;
- quantidade de cavalos;
- tempos;
- eventos;
- capacidade produtiva.

Se uma informação não foi fornecida,
não utilize.

Pode realizar cálculos matemáticos simples
com os números fornecidos.

=========================================================
INTERPRETAÇÃO OPERACIONAL
=========================================================

Quando a moagem estiver acima da entrega:

Explique que existe consumo de estoque.

Quando a entrega estiver acima da moagem:

Explique que existe tendência de recuperação do estoque.

Quando a produção das frentes estiver abaixo da moagem:

Relacione isso à capacidade real de abastecimento da indústria.

Quando houver indisponibilidade de colhedoras:

Relacione diretamente à perda de capacidade produtiva
das frentes.

Quando houver indisponibilidade de cavalos/trações:

Relacione à quebra ou instabilidade do ciclo.

Quando houver mudança de frente:

Considere que existe um período de transição
até estabilização do ciclo.

Quando houver interdição:

Relacione ao impacto no tempo de ciclo e na entrega.

Quando houver terceiros/fornecedores com déficit:

Relacione isso à oferta total da unidade.

Quando houver sinergia:

Destaque a ação realizada e seu objetivo operacional.

Quando houver troca de turno:

Avalie o risco de quebra de ciclo durante a transição.

=========================================================
ESTOQUE
=========================================================

Considere:

1 conjunto = densidade informada pelo usuário.

Não trate o estoque isoladamente.

Relacione sempre:

estoque
+
moagem
+
entrega
+
produção
+
tendência.

Se o estoque estiver baixo, mas as frentes estiverem
recuperando produção e o ciclo estiver normalizando,
não afirmar automaticamente que haverá redução.

Se o estoque estiver baixo e a produção/entrega continuar
abaixo da moagem, destacar o risco.

=========================================================
ESTRUTURA FINAL
=========================================================

Escreva:

PLANO DE VOO – [UNIDADE]

1º PARÁGRAFO:
Cenário atual da moagem, entrega, produção e estoque.

2º PARÁGRAFO:
Principais ofensores e como eles impactaram a operação.

3º PARÁGRAFO:
Reflexo no estoque e risco para a moagem.

PLANO DE AÇÃO

Descrever as ações já realizadas pelo COA e,
depois, as ações necessárias para recuperação.

CENÁRIO ESPERADO

Explicar o que precisa acontecer para manter,
recuperar ou sustentar a moagem.

FECHAMENTO

Uma conclusão curta e gerencial.

=========================================================
IMPORTANTE
=========================================================

Não escreva:

"Conforme mostra o gráfico"

porque nenhum gráfico foi enviado.

Não explique que você é uma IA.

Não explique seu raciocínio interno.

Entregue somente o Plano de Voo.

=========================================================
DADOS DA OPERAÇÃO
=========================================================

UNIDADE:
${data.unit || "Não informada"}

DATA:
${data.date || "Não informada"}

MOAGEM NOMINAL:
${data.nominal || 0} t/h

MOAGEM ATUAL/MÉDIA:
${data.milling || 0} t/h

ENTREGA MÉDIA DAS FRENTES:
${data.delivery || 0} t/h

PRODUÇÃO ATUAL DAS FRENTES:
${data.frontProd || 0} t/h

ESTOQUE:
${data.stock || 0} conjuntos

DENSIDADE:
${data.density || 70} t/conjunto

ESTOQUE MÍNIMO:
${data.minStock || 0} conjuntos

ESTOQUE MÁXIMO:
${data.maxStock || 0} conjuntos

HORIZONTE:
${data.horizon || 12} horas

=========================================================
CÁLCULOS DO SISTEMA
=========================================================

ESTOQUE EM TONELADAS:
${calc.stockTons.toFixed(1)} t

GAP MOAGEM - ENTREGA:
${calc.millingDeliveryGap.toFixed(1)} t/h

GAP MOAGEM - PRODUÇÃO:
${calc.millingProductionGap.toFixed(1)} t/h

VARIAÇÃO DO ESTOQUE:
${calc.stockDeltaPerHour.toFixed(1)} t/h

VARIAÇÃO DO ESTOQUE EM CONJUNTOS/H:
${calc.stockChangeSetsPerHour.toFixed(2)} conjuntos/h

ESTOQUE MÍNIMO EM TONELADAS:
${calc.minStockTons.toFixed(1)} t

MARGEM ATÉ ESTOQUE MÍNIMO:
${calc.marginToMinimum.toFixed(1)} t

AUTONOMIA TEÓRICA DO ESTOQUE:
${calc.fullStockMinutes.toFixed(0)} minutos

STATUS PRELIMINAR:
${calc.risk}

=========================================================
COLHEDORAS PRÓPRIAS
=========================================================

MÉDIA DE INDISPONIBILIDADE:
${data.harvAvg || 0}%

PERÍODO:
${data.harvPeriod || "Não informado"}

PICO:
${data.harvPeak || 0}%

HORÁRIO DO PICO:
${data.harvPeakTime || "Não informado"}

=========================================================
TRAÇÕES / CAVALOS
=========================================================

MÉDIA DE INDISPONIBILIDADE:
${data.tractionAvg || 0}%

PERÍODO:
${data.tractionPeriod || "Não informado"}

PICO:
${data.tractionPeak || 0}%

HORÁRIO DO PICO:
${data.tractionPeakTime || "Não informado"}

FALTA DE CAVALOS:
${data.horsesMissing || 0}

SEM MOTORISTA:
${data.noDrivers || 0}

EM MANUTENÇÃO:
${data.horsesMaint || 0}

=========================================================
DÉFICITS
=========================================================

PRÓPRIAS:
${data.ownDeficit || 0} t

TERCEIROS:
${data.thirdDeficit || 0} t

FORNECEDORES:
${data.supplierDeficit || 0} t

=========================================================
EVENTOS DAS FRENTES
=========================================================

${data.frontEvents || "Não informado"}

=========================================================
TRANSPORTE / TROCAS DE TURNO
=========================================================

${data.transportEvents || "Não informado"}

=========================================================
SINERGIA / AÇÕES DO COA
=========================================================

${data.synergy || "Não informado"}

=========================================================
OUTRAS OBSERVAÇÕES
=========================================================

${data.notes || "Não informado"}

=========================================================
POSSÍVEL HORÁRIO DE REDUÇÃO
=========================================================

${data.riskHour || "Não informado"}

=========================================================
`;

}


/* =========================================================
   CHAMADA GEMINI
========================================================= */

app.post("/api/plano-voo", async (req, res) => {

  try {

    if (!GEMINI_API_KEY) {

      return res.status(500).json({

        ok: false,

        error:
          "GEMINI_API_KEY não configurada no servidor."

      });

    }


    const data =
      req.body;


    const calc =
      calculateScenario(data);


    const prompt =
      buildPrompt(
        data,
        calc
      );


    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        GEMINI_MODEL
      )}:generateContent`;


    const response =
      await fetch(
        endpoint,
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              GEMINI_API_KEY

          },

          body:
            JSON.stringify({

              system_instruction: {

                parts: [

                  {

                    text:
                      "Você é um analista sênior de operações agroindustriais. Produza análises objetivas, factuais e gerenciais."

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

                temperature: 0.18,

                maxOutputTokens: 3000

              }

            })

        }

      );


    const result =
      await response.json();


    if (!response.ok) {

      console.error(
        "Gemini error:",
        result
      );


      return res.status(
        response.status
      ).json({

        ok: false,

        error:
          result?.error?.message ||
          "Erro retornado pela Gemini."

      });

    }


    const text =
      result
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part => part.text || ""
        )
        .join("")
        .trim();


    if (!text) {

      return res.status(502).json({

        ok: false,

        error:
          "A Gemini não retornou texto."

      });

    }


    return res.json({

      ok: true,

      text,

      calculations: calc,

      model:
        GEMINI_MODEL

    });

  }

  catch (error) {

    console.error(error);

    return res.status(500).json({

      ok: false,

      error:
        error.message ||
        "Erro interno do servidor."

    });

  }

});


/* =========================================================
   CÁLCULO LOCAL
========================================================= */

app.post("/api/calcular", (req, res) => {

  try {

    const calc =
      calculateScenario(
        req.body
      );


    res.json({

      ok: true,

      calculations: calc

    });

  }

  catch (error) {

    res.status(500).json({

      ok: false,

      error:
        error.message

    });

  }

});


/* =========================================================
   SPA FALLBACK
========================================================= */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});


/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `COA Plano de Voo rodando na porta ${PORT}`
    );

    console.log(
      `Modelo Gemini: ${GEMINI_MODEL}`
    );

    console.log(
      `Gemini configurada: ${Boolean(GEMINI_API_KEY)}`
    );

  }
);
