require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const TONELADAS_POR_CONJUNTO = Number(
  process.env.TONELADAS_POR_CONJUNTO || 70
);

const ESTOQUE_RISCO_CONJ = Number(
  process.env.ESTOQUE_RISCO_CONJ || 7
);

/* =========================================================
   CADASTRO OFICIAL DAS UNIDADES
   ========================================================= */

const UNIDADES = {
  'MANDU': {
    nome: 'Mandu',
    nominal: 917
  },

  'CRUZ ALTA': {
    nome: 'Cruz Alta',
    nominal: 900
  },

  'SAO JOSE': {
    nome: 'São José',
    nominal: 750
  },

  'VERTENTE': {
    nome: 'Vertente',
    nominal: 500
  },

  'TANABI': {
    nome: 'Tanabi',
    nominal: 710
  }
};


/* =========================================================
   MIDDLEWARES
   ========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(__dirname));


/* =========================================================
   UTILITÁRIOS
   ========================================================= */

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);

  return Number.isFinite(numero)
    ? numero
    : fallback;
}


function textoSeguro(valor, limite = 30000) {
  return String(valor || '')
    .trim()
    .slice(0, limite);
}


function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}


function horaNumero(hora) {
  if (hora === null || hora === undefined) {
    return null;
  }

  const texto = String(hora).trim();

  const match = texto.match(/\d{1,2}/);

  if (!match) {
    return null;
  }

  const numero = Number(match[0]);

  if (!Number.isFinite(numero)) {
    return null;
  }

  if (numero < 0 || numero > 23) {
    return null;
  }

  return numero;
}


function horaFormatada(hora) {
  const numero = horaNumero(hora);

  if (numero === null) {
    return '--';
  }

  return `${String(numero).padStart(2, '0')}:00`;
}


function horaRelativa(hora, horaAtual) {
  if (
    !Number.isFinite(hora) ||
    !Number.isFinite(horaAtual)
  ) {
    return null;
  }

  let diferenca = (hora - horaAtual + 24) % 24;

  if (diferenca > 12) {
    diferenca -= 24;
  }

  return diferenca;
}


/* =========================================================
   IDENTIFICAÇÃO DA UNIDADE
   ========================================================= */

function identificarUnidade(texto) {
  const original = textoSeguro(texto, 30000);

  if (!original) {
    return null;
  }

  const linhas = original.split(/\r?\n/);

  /*
   * Primeiro procura nas linhas que normalmente carregam
   * a informação de filial / gestora / unidade.
   */
  const linhasPrioritarias = linhas.filter(linha =>
    /FILIAL|GESTORA|UNIDADE/i.test(linha)
  );

  /*
   * Depois utiliza todo o conteúdo como segunda tentativa.
   */
  const trechosParaPesquisar = [
    ...linhasPrioritarias,
    original
  ];

  for (const trecho of trechosParaPesquisar) {
    const linha = normalizarTexto(trecho);

    for (const chave of Object.keys(UNIDADES)) {
      if (linha.includes(chave)) {
        return {
          chave,
          nome: UNIDADES[chave].nome,
          nominal: UNIDADES[chave].nominal
        };
      }
    }
  }

  return null;
}


/* =========================================================
   NORMALIZAÇÃO DA ANÁLISE DE POTENCIAL
   ========================================================= */

function normalizarPotencial(lista, nominalOficial) {
  if (!Array.isArray(lista)) {
    return [];
  }

  return lista
    .map((item) => {
      const hora = horaNumero(
        item?.hora ??
        item?.horario ??
        item?.horaNumero
      );

      const potencial = numeroSeguro(
        item?.potencial ??
        item?.producao ??
        item?.produção ??
        item?.valor,
        NaN
      );

      const moagem = numeroSeguro(
        item?.moagem ??
        item?.moagemNominal ??
        nominalOficial,
        nominalOficial
      );

      if (
        hora === null ||
        !Number.isFinite(potencial)
      ) {
        return null;
      }

      return {
        hora,
        horaNumero: hora,
        potencial,
        moagem,
        nominal: nominalOficial
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.hora - b.hora);
}


/* =========================================================
   CÁLCULO DO CENÁRIO
   ========================================================= */

function calcularCenario(dados, unidade) {
  const potencial = normalizarPotencial(
    dados.potencial,
    unidade.nominal
  );

  const estoque = dados.estoque || {};

  const estoqueAtual = numeroSeguro(
    estoque.atual,
    0
  );

  const h1 = numeroSeguro(
    estoque.h1,
    estoqueAtual
  );

  const h2 = numeroSeguro(
    estoque.h2,
    h1
  );

  const h3 = numeroSeguro(
    estoque.h3,
    h2
  );

  let horaAtual = horaNumero(
    dados.horaAtual
  );

  if (horaAtual === null) {
    horaAtual = new Date().getHours();
  }

  /*
   * Ordena a tabela pela distância em relação à hora atual.
   */
  const dadosComRelacao = potencial.map(row => ({
    ...row,
    relativo: horaRelativa(
      row.hora,
      horaAtual
    )
  }));


  /*
   * Histórico:
   * somente horas anteriores à atual.
   */
  const historico = dadosComRelacao
    .filter(row => row.relativo !== null && row.relativo < 0)
    .sort((a, b) => b.relativo - a.relativo)
    .slice(0, 3)
    .sort((a, b) => a.relativo - b.relativo);


  /*
   * Próximas 12 horas.
   */
  const futuro = dadosComRelacao
    .filter(row => row.relativo !== null && row.relativo >= 0)
    .sort((a, b) => a.relativo - b.relativo)
    .slice(0, 12);


  const atual =
    potencial.find(
      row => row.hora === horaAtual
    ) || futuro[0] || null;


  /* =====================================================
     MÉDIAS HISTÓRICAS
     ===================================================== */

  const mediaHistoricoPotencial =
    historico.length > 0
      ? historico.reduce(
          (total, row) => total + row.potencial,
          0
        ) / historico.length
      : 0;


  const mediaHistoricoMoagem =
    historico.length > 0
      ? historico.reduce(
          (total, row) => total + row.moagem,
          0
        ) / historico.length
      : unidade.nominal;


  const saldoHistorico =
    mediaHistoricoPotencial -
    mediaHistoricoMoagem;


  /* =====================================================
     TENDÊNCIA DO ESTOQUE
     ===================================================== */

  const estoqueHistorico = [
    h3,
    h2,
    h1,
    estoqueAtual
  ];

  const variacaoEstoque =
    estoqueAtual - h3;


  let tendenciaEstoque = 'ESTÁVEL';

  if (variacaoEstoque > 0.2) {
    tendenciaEstoque = 'SUBINDO';
  } else if (variacaoEstoque < -0.2) {
    tendenciaEstoque = 'CAINDO';
  }


  /* =====================================================
     PROJEÇÃO DE ESTOQUE
     ===================================================== */

  let estoqueProjetado = estoqueAtual;

  const projecaoEstoque = [];

  let menorEstoque = estoqueAtual;
  let horaMenorEstoque = horaAtual;

  let primeiraHoraRisco = null;

  for (const row of futuro) {
    const saldoToneladas =
      row.potencial - row.moagem;

    const variacaoConjuntos =
      saldoToneladas /
      TONELADAS_POR_CONJUNTO;

    estoqueProjetado += variacaoConjuntos;

    const utilizacaoNominal =
      unidade.nominal > 0
        ? (row.moagem / unidade.nominal) * 100
        : 0;

    const disponibilidadePercentual =
      unidade.nominal > 0
        ? (row.potencial / unidade.nominal) * 100
        : 0;

    projecaoEstoque.push({
      hora: row.hora,
      horaFormatada: horaFormatada(row.hora),
      potencial: row.potencial,
      moagem: row.moagem,
      nominal: unidade.nominal,
      utilizacaoNominal,
      disponibilidadePercentual,
      saldoToneladas,
      variacaoConjuntos,
      estoqueProjetado
    });


    if (estoqueProjetado < menorEstoque) {
      menorEstoque = estoqueProjetado;
      horaMenorEstoque = row.hora;
    }


    if (
      primeiraHoraRisco === null &&
      estoqueProjetado <= ESTOQUE_RISCO_CONJ
    ) {
      primeiraHoraRisco = row.hora;
    }
  }


  /* =====================================================
     RECUPERAÇÃO
     ===================================================== */

  let horaRecuperacao = null;

  if (primeiraHoraRisco !== null) {
    const pontoRisco = projecaoEstoque.find(
      row => row.hora === primeiraHoraRisco
    );

    if (pontoRisco) {
      for (const row of projecaoEstoque) {
        if (
          row.hora > pontoRisco.hora &&
          row.estoqueProjetado >
            pontoRisco.estoqueProjetado
        ) {
          horaRecuperacao = row.hora;
          break;
        }
      }
    }
  }


  /* =====================================================
     MÉDIAS FUTURAS
     ===================================================== */

  const mediaFuturaPotencial =
    futuro.length > 0
      ? futuro.reduce(
          (total, row) => total + row.potencial,
          0
        ) / futuro.length
      : 0;


  const mediaFuturaMoagem =
    futuro.length > 0
      ? futuro.reduce(
          (total, row) => total + row.moagem,
          0
        ) / futuro.length
      : unidade.nominal;


  const saldoFuturo =
    mediaFuturaPotencial -
    mediaFuturaMoagem;


  /* =====================================================
     MAIOR DÉFICIT FUTURO
     ===================================================== */

  let maiorDeficit = null;

  for (const row of futuro) {
    const deficit =
      row.moagem - row.potencial;

    if (
      !maiorDeficit ||
      deficit > maiorDeficit.deficit
    ) {
      maiorDeficit = {
        hora: row.hora,
        deficit
      };
    }
  }


  /* =====================================================
     MOAGEM SEGURA
     ===================================================== */

  let moagemSeguraMedia =
    mediaFuturaPotencial;

  if (futuro.length > 0) {
    const estoqueDisponivelAcimaDoRisco =
      Math.max(
        estoqueAtual - ESTOQUE_RISCO_CONJ,
        0
      );

    const toneladasDisponiveis =
      estoqueDisponivelAcimaDoRisco *
      TONELADAS_POR_CONJUNTO;

    const reforcoPorHora =
      toneladasDisponiveis /
      futuro.length;

    moagemSeguraMedia =
      mediaFuturaPotencial +
      reforcoPorHora;
  }


  /*
   * Limita a moagem segura ao nominal oficial.
   */
  moagemSeguraMedia = Math.min(
    moagemSeguraMedia,
    unidade.nominal
  );


  /* =====================================================
     CLASSIFICAÇÃO
     ===================================================== */

  let classificacao = 'ESTÁVEL';

  if (menorEstoque <= 4) {
    classificacao = 'CRÍTICO';
  } else if (menorEstoque <= 7) {
    classificacao = 'RISCO';
  } else if (menorEstoque <= 9) {
    classificacao = 'ATENÇÃO';
  }


  /* =====================================================
     RETORNO
     ===================================================== */

  return {
    unidade: {
      chave: unidade.chave,
      nome: unidade.nome,
      nominal: unidade.nominal
    },

    horaAtual,

    estoque: {
      h3,
      h2,
      h1,
      atual: estoqueAtual,
      historico: estoqueHistorico,
      variacao: variacaoEstoque,
      tendencia: tendenciaEstoque
    },

    atual: atual
      ? {
          hora: atual.hora,
          potencial: atual.potencial,
          moagem: atual.moagem,
          nominal: unidade.nominal
        }
      : null,

    historico: historico.map(row => ({
      hora: row.hora,
      potencial: row.potencial,
      moagem: row.moagem,
      saldo: row.potencial - row.moagem
    })),

    medias: {
      historicoPotencial: mediaHistoricoPotencial,
      historicoMoagem: mediaHistoricoMoagem,
      saldoHistorico,
      futuroPotencial: mediaFuturaPotencial,
      futuroMoagem: mediaFuturaMoagem,
      saldoFuturo
    },

    projecaoEstoque,

    risco: {
      classificacao,
      menorEstoque,
      horaMenorEstoque,
      primeiraHoraRisco,
      horaRecuperacao
    },

    moagemSeguraMedia,

    maiorDeficit,

    parametros: {
      toneladasPorConjunto: TONELADAS_POR_CONJUNTO,
      estoqueRiscoConj: ESTOQUE_RISCO_CONJ,
      nominalOficial: unidade.nominal
    }
  };
}


/* =========================================================
   PROMPT PARA GEMINI
   ========================================================= */

function montarPrompt(dados, calculos, unidade) {
  const tabelaOriginal = textoSeguro(
    dados.tabelaOriginal,
    30000
  );

  const comentarios = textoSeguro(
    dados.comentarios,
    8000
  );


  const historicoTexto =
    calculos.historico.length > 0
      ? calculos.historico
          .map(row =>
            `${horaFormatada(row.hora)} | potencial ${row.potencial} t/h | moagem ${row.moagem} t/h | saldo ${row.saldo >= 0 ? '+' : ''}${row.saldo.toFixed(0)} t/h`
          )
          .join('\n')
      : 'Sem histórico suficiente.';


  const projecaoTexto =
    calculos.projecaoEstoque.length > 0
      ? calculos.projecaoEstoque
          .map(row =>
            `${row.horaFormatada} | potencial ${row.potencial} t/h | moagem ${row.moagem} t/h | ${row.disponibilidadePercentual.toFixed(1)}% do nominal | estoque projetado ${row.estoqueProjetado.toFixed(1)} conjuntos`
          )
          .join('\n')
      : 'Sem projeção disponível.';


  return `
Você é um analista sênior de operações agrícolas e CTT.

Sua função é transformar a análise de potencial de produção em um PLANO DE VOO operacional para tomada de decisão.

Escreva em português do Brasil.

O texto será utilizado em grupo de gestão/gerência via WhatsApp.

Seja técnico, claro, direto e objetivo.

Não escreva como uma IA.
Não faça introduções genéricas.
Não repita desnecessariamente os números.
Não crie informações que não estejam nos dados.

==================================================
UNIDADE IDENTIFICADA
==================================================

Unidade: ${unidade.nome}
Moagem nominal oficial: ${unidade.nominal} t/h

IMPORTANTE:
O valor de ${unidade.nominal} t/h é o nominal oficial cadastrado no backend para esta unidade.

Utilize esse valor como referência para avaliar utilização da capacidade, potencial, segurança de moagem e risco operacional.

Não substitua o nominal oficial por outro valor encontrado na tabela.

==================================================
CENÁRIO ATUAL
==================================================

Hora da análise: ${horaFormatada(calculos.horaAtual)}

Estoque atual:
${calculos.estoque.atual.toFixed(1)} conjuntos

Estoque H-1:
${calculos.estoque.h1.toFixed(1)} conjuntos

Estoque H-2:
${calculos.estoque.h2.toFixed(1)} conjuntos

Estoque H-3:
${calculos.estoque.h3.toFixed(1)} conjuntos

Tendência do estoque:
${calculos.estoque.tendencia}

Variação H-3 → atual:
${calculos.estoque.variacao.toFixed(1)} conjuntos

==================================================
HISTÓRICO
==================================================

${historicoTexto}

Média histórica de potencial:
${calculos.medias.historicoPotencial.toFixed(0)} t/h

Média histórica de moagem:
${calculos.medias.historicoMoagem.toFixed(0)} t/h

Saldo histórico:
${calculos.medias.saldoHistorico >= 0 ? '+' : ''}${calculos.medias.saldoHistorico.toFixed(0)} t/h

==================================================
PROJEÇÃO DAS PRÓXIMAS HORAS
==================================================

${projecaoTexto}

Média futura de potencial:
${calculos.medias.futuroPotencial.toFixed(0)} t/h

Média futura de moagem:
${calculos.medias.futuroMoagem.toFixed(0)} t/h

Saldo futuro:
${calculos.medias.saldoFuturo >= 0 ? '+' : ''}${calculos.medias.saldoFuturo.toFixed(0)} t/h

==================================================
RISCO OPERACIONAL
==================================================

Classificação:
${calculos.risco.classificacao}

Menor estoque projetado:
${calculos.risco.menorEstoque.toFixed(1)} conjuntos

Horário do menor estoque:
${horaFormatada(calculos.risco.horaMenorEstoque)}

Primeira entrada em zona de risco:
${
  calculos.risco.primeiraHoraRisco !== null
    ? horaFormatada(calculos.risco.primeiraHoraRisco)
    : 'Não entra em risco no horizonte analisado'
}

Recuperação:
${
  calculos.risco.horaRecuperacao !== null
    ? horaFormatada(calculos.risco.horaRecuperacao)
    : 'Não identificada'
}

Maior déficit futuro:
${
  calculos.maiorDeficit
    ? `${calculos.maiorDeficit.deficit.toFixed(0)} t/h às ${horaFormatada(calculos.maiorDeficit.hora)}`
    : 'Não identificado'
}

==================================================
MOAGEM SEGURA
==================================================

Moagem segura média estimada:
${calculos.moagemSeguraMedia.toFixed(0)} t/h

Nominal oficial:
${unidade.nominal} t/h

==================================================
COMENTÁRIOS OPERACIONAIS
==================================================

${comentarios || 'Nenhum comentário adicional informado.'}

==================================================
TABELA ORIGINAL
==================================================

${tabelaOriginal}

==================================================
FORMATO OBRIGATÓRIO DA RESPOSTA
==================================================

Monte a resposta exatamente nesta lógica:

*PLANO DE VOO — ${unidade.nome}*

*Situação atual*
Explique em poucas linhas como está a relação entre potencial, moagem e estoque.

*Projeção*
Mostre o comportamento esperado do estoque nas próximas horas e destaque o horário mais crítico.

*Ponto de atenção*
Explique o principal risco operacional e a causa. Se houver déficit entre potencial e moagem, deixe isso claro.

*Moagem segura*
Informe uma faixa/referência de moagem segura considerando potencial, estoque disponível e nominal oficial da unidade.

*Plano de ação*
Indique objetivamente o que deve ser feito operacionalmente para preservar a moagem e evitar ruptura de estoque.

*Perspectiva*
Finalize com uma visão das próximas horas, indicando se o cenário tende a estabilizar, deteriorar ou recuperar.

REGRAS:
- Não inventar disponibilidade de frota.
- Não inventar quantidade de caminhões.
- Não inventar chuva ou condição climática.
- Não inventar indisponibilidade de máquinas.
- Não inventar causas que não estejam nos dados.
- Pode interpretar tecnicamente os dados, mas diferencie fato de recomendação.
- Priorize causa → efeito → risco → ação.
- Use números relevantes.
- Evite texto excessivamente longo.
- A resposta deve ser pronta para copiar e colar no WhatsApp.
- Use negrito com *asteriscos simples* no padrão WhatsApp.
`;
}


/* =========================================================
   CHAMADA GEMINI
   ========================================================= */

async function chamarGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY não configurada no ambiente.'
    );
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;


  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    90000
  );


  try {
    const response = await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },

      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 5000
        }
      }),

      signal: controller.signal
    });


    const textoResposta =
      await response.text();


    if (!response.ok) {
      throw new Error(
        `Gemini HTTP ${response.status}: ${textoResposta}`
      );
    }


    let json;

    try {
      json = JSON.parse(textoResposta);
    } catch {
      throw new Error(
        'Resposta do Gemini não é um JSON válido.'
      );
    }


    const texto =
      json?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('\n')
        .trim();


    if (!texto) {
      throw new Error(
        'Gemini retornou resposta vazia.'
      );
    }


    return texto;

  } finally {
    clearTimeout(timeout);
  }
}


/* =========================================================
   NORMALIZAÇÃO DA RESPOSTA
   ========================================================= */

function normalizarResposta(texto) {
  return String(texto || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/* =========================================================
   ROTA PRINCIPAL
   ========================================================= */

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,

    gemini: Boolean(GEMINI_API_KEY),

    model: GEMINI_MODEL,

    parametros: {
      toneladasPorConjunto:
        TONELADAS_POR_CONJUNTO,

      estoqueRiscoConj:
        ESTOQUE_RISCO_CONJ
    },

    unidades: UNIDADES,

    time: new Date().toISOString()
  });
});


/* =========================================================
   API — PLANO DE VOO
   ========================================================= */

app.post('/api/plano-voo', async (req, res) => {
  try {
    const dados = req.body || {};


    /* -----------------------------------------------
       VALIDAÇÕES BÁSICAS
       ----------------------------------------------- */

    if (!Array.isArray(dados.potencial)) {
      return res.status(400).json({
        error:
          'A análise de potencial não foi enviada corretamente.'
      });
    }


    if (
      !dados.estoque ||
      dados.estoque.atual === undefined ||
      dados.estoque.atual === null
    ) {
      return res.status(400).json({
        error:
          'O estoque atual não foi informado.'
      });
    }


    /* -----------------------------------------------
       IDENTIFICAÇÃO DA UNIDADE
       ----------------------------------------------- */

    const unidade = identificarUnidade(
      dados.tabelaOriginal
    );


    if (!unidade) {
      return res.status(400).json({
        error:
          'Não foi possível identificar a filial/gestora na Análise de Potencial de Produção. Informe uma análise contendo Mandu, Cruz Alta, São José, Vertente ou Tanabi.'
      });
    }


    /* -----------------------------------------------
       CÁLCULO DO CENÁRIO
       ----------------------------------------------- */

    const calculos =
      calcularCenario(
        dados,
        unidade
      );


    /* -----------------------------------------------
       MONTA PROMPT
       ----------------------------------------------- */

    const prompt =
      montarPrompt(
        dados,
        calculos,
        unidade
      );


    /* -----------------------------------------------
       CHAMA GEMINI
       ----------------------------------------------- */

    const respostaGemini =
      await chamarGemini(prompt);


    const planoVoo =
      normalizarResposta(
        respostaGemini
      );


    /* -----------------------------------------------
       RESPOSTA
       ----------------------------------------------- */

    return res.json({
      ok: true,

      unidade: {
        chave: unidade.chave,
        nome: unidade.nome,
        nominal: unidade.nominal
      },

      horaAnalise:
        horaFormatada(
          calculos.horaAtual
        ),

      modelo: GEMINI_MODEL,

      planoVoo,

      calculos
    });


  } catch (error) {
    console.error(
      'Erro /api/plano-voo:',
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        'Erro interno ao gerar o Plano de Voo.'
    });
  }
});


/* =========================================================
   404 PARA API
   ========================================================= */

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Endpoint não encontrado.'
  });
});


/* =========================================================
   TRATAMENTO DE ERRO GERAL
   ========================================================= */

app.use((error, req, res, next) => {
  console.error(
    'Erro geral:',
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error:
      'Erro interno do servidor.'
  });
});


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(' PLANO DE VOO | CTT AGROINDUSTRIAL');
  console.log('==============================================');
  console.log(` Servidor: http://localhost:${PORT}`);
  console.log(` Gemini: ${GEMINI_API_KEY ? 'OK' : 'NÃO CONFIGURADO'}`);
  console.log(` Modelo: ${GEMINI_MODEL}`);
  console.log(` t/conjunto: ${TONELADAS_POR_CONJUNTO}`);
  console.log(` Estoque risco: ${ESTOQUE_RISCO_CONJ} conjuntos`);
  console.log('----------------------------------------------');
  console.log(' Unidades cadastradas:');

  Object.values(UNIDADES).forEach(unidade => {
    console.log(
      ` - ${unidade.nome}: ${unidade.nominal} t/h`
    );
  });

  console.log('==============================================');
  console.log('');
});
