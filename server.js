/* =========================================================
   COA | PLANO DE VOO CTT
   SERVER
========================================================= */

require('dotenv').config();

const express =
  require('express');

const path =
  require('path');

const helmet =
  require('helmet');

const {
  fileURLToPath
} = require('url');


/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const app =
  express();


const PORT =
  process.env.PORT || 3000;


const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  '';


const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.8-flash';


/*
  Quantidade padrão de toneladas por conjunto.

  Padrão COA/CTT utilizado na análise:
  70 t/conjunto.
*/

const TONELADAS_POR_CONJUNTO =
  Number(
    process.env.TONELADAS_POR_CONJUNTO || 70
  );


/*
  Referência operacional de zona de risco.

  Pode ser alterada no Render:
  ESTOQUE_RISCO_CONJ=7
*/

const ESTOQUE_RISCO_CONJ =
  Number(
    process.env.ESTOQUE_RISCO_CONJ || 7
  );


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);


app.use(
  express.json({
    limit: '1mb'
  })
);


app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb'
  })
);


app.use(
  express.static(
    __dirname,
    {
      maxAge: '1h'
    }
  )
);


/* =========================================================
   UTILITÁRIOS
========================================================= */

function numeroSeguro(valor) {

  const numero =
    Number(valor);

  if (
    !Number.isFinite(numero)
  ) {

    return null;

  }

  return numero;

}


function textoSeguro(
  valor,
  limite = 20000
) {

  if (
    valor === undefined ||
    valor === null
  ) {

    return '';

  }

  return String(valor)
    .replace(/\u0000/g, '')
    .trim()
    .slice(
      0,
      limite
    );

}


function horaNumero(hora) {

  const match =
    String(hora || '')
      .match(
        /^(\d{1,2}):/
      );

  if (!match) {
    return null;
  }

  return Number(
    match[1]
  );

}


function horaFormatada() {

  return new Date()
    .toLocaleTimeString(
      'pt-BR',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );

}


/* =========================================================
   HORA RELATIVA
========================================================= */

function horaRelativa(
  hora,
  horaAtual
) {

  let distancia =
    (
      hora -
      horaAtual +
      24
    ) % 24;


  if (
    distancia > 12
  ) {

    distancia -= 24;

  }


  return distancia;

}


/* =========================================================
   NORMALIZAR POTENCIAL
========================================================= */

function normalizarPotencial(
  lista
) {

  if (
    !Array.isArray(lista)
  ) {

    return [];

  }


  return lista

    .map(
      item => ({

        hora:
          textoSeguro(
            item?.hora,
            20
          ),

        horaNumero:
          numeroSeguro(
            item?.horaNumero
          ),

        potencial:
          numeroSeguro(
            item?.potencial
          ),

        moagem:
          numeroSeguro(
            item?.moagem
          ),

        nominal:
          numeroSeguro(
            item?.nominal
          )

      })
    )

    .filter(
      item =>
        item.hora &&
        item.horaNumero !== null &&
        item.potencial !== null &&
        item.moagem !== null
    );

}


/* =========================================================
   CÁLCULOS
========================================================= */

function calcularCenario(
  dados
) {

  const potencial =
    normalizarPotencial(
      dados.potencial
    );


  const estoque =
    dados.estoque || {};


  const estoqueH3 =
    numeroSeguro(
      estoque.h3
    );

  const estoqueH2 =
    numeroSeguro(
      estoque.h2
    );

  const estoqueH1 =
    numeroSeguro(
      estoque.h1
    );

  const estoqueAtual =
    numeroSeguro(
      estoque.atual
    );


  const horaAtual =
    numeroSeguro(
      dados.horaAtual
    ) ??
    new Date().getHours();


  /*
    Histórico:
    pegamos os três horários anteriores
    à hora atual.
  */

  const historico =
    potencial

      .map(
        row => ({
          ...row,

          distancia:
            horaRelativa(
              row.horaNumero,
              horaAtual
            )
        })
      )

      .filter(
        row =>
          row.distancia < 0
      )

      .sort(
        (a, b) =>
          b.distancia -
          a.distancia
      )

      .slice(0, 3)

      .sort(
        (a, b) =>
          a.distancia -
          b.distancia
      );


  /*
    Projeção:
    hora atual em diante,
    próximas 12 horas.
  */

  const futuro =
    potencial

      .map(
        row => ({
          ...row,

          distancia:
            horaRelativa(
              row.horaNumero,
              horaAtual
            )
        })
      )

      .filter(
        row =>
          row.distancia >= 0
      )

      .sort(
        (a, b) =>
          a.distancia -
          b.distancia
      )

      .slice(0, 12);


  /*
    Histórico quantitativo.
  */

  const mediaPotencialHistorico =
    historico.length
      ? historico.reduce(
          (
            soma,
            row
          ) =>
            soma +
            row.potencial,
          0
        ) / historico.length
      : null;


  const mediaMoagemHistorico =
    historico.length
      ? historico.reduce(
          (
            soma,
            row
          ) =>
            soma +
            row.moagem,
          0
        ) / historico.length
      : null;


  const saldoHistoricoTph =
    (
      mediaPotencialHistorico !== null &&
      mediaMoagemHistorico !== null
    )
      ? mediaPotencialHistorico -
        mediaMoagemHistorico
      : null;


  /*
    Tendência de estoque:
    quatro pontos de estoque.
  */

  const estoquePontos = [
    estoqueH3,
    estoqueH2,
    estoqueH1,
    estoqueAtual
  ].filter(
    value =>
      value !== null
  );


  let tendenciaEstoque =
    null;


  if (
    estoquePontos.length >= 2
  ) {

    tendenciaEstoque =
      (
        estoquePontos[
          estoquePontos.length - 1
        ] -
        estoquePontos[0]
      ) /
      (
        estoquePontos.length - 1
      );

  }


  /*
    Projeção do estoque.
  */

  let estoqueProjetado =
    estoqueAtual;


  const projecaoEstoque = [];


  for (
    const row of futuro
  ) {

    const saldoToneladas =
      row.potencial -
      row.moagem;


    const variacaoConjuntos =
      saldoToneladas /
      TONELADAS_POR_CONJUNTO;


    estoqueProjetado +=
      variacaoConjuntos;


    projecaoEstoque.push({

      hora:
        row.hora,

      potencial:
        row.potencial,

      moagem:
        row.moagem,

      nominal:
        row.nominal,

      saldoToneladas,

      variacaoConjuntos,

      estoqueProjetado

    });

  }


  /*
    Menor estoque futuro.
  */

  let menorEstoqueProjetado =
    estoqueAtual;


  let horaMenorEstoque =
    'Agora';


  for (
    const row of projecaoEstoque
  ) {

    if (
      row.estoqueProjetado <
      menorEstoqueProjetado
    ) {

      menorEstoqueProjetado =
        row.estoqueProjetado;

      horaMenorEstoque =
        row.hora;

    }

  }


  /*
    Primeiro momento em zona de risco.
  */

  const primeiroRisco =
    projecaoEstoque.find(
      row =>
        row.estoqueProjetado <=
        ESTOQUE_RISCO_CONJ
    );


  /*
    Momento de recuperação.
  */

  const menorIndice =
    projecaoEstoque.length
      ? projecaoEstoque
          .reduce(
            (
              menor,
              row,
              indice,
              array
            ) =>
              row.estoqueProjetado <
              array[menor].estoqueProjetado
                ? indice
                : menor,
            0
          )
      : -1;


  let horaRecuperacao =
    null;


  if (
    menorIndice >= 0
  ) {

    for (
      let i = menorIndice + 1;
      i < projecaoEstoque.length;
      i++
    ) {

      if (
        projecaoEstoque[i]
          .estoqueProjetado >
        projecaoEstoque[i - 1]
          .estoqueProjetado
      ) {

        horaRecuperacao =
          projecaoEstoque[i]
            .hora;

        break;

      }

    }

  }


  /*
    Média futura.
  */

  const mediaPotencialFuturo =
    futuro.length
      ? futuro.reduce(
          (
            soma,
            row
          ) =>
            soma +
            row.potencial,
          0
        ) /
        futuro.length
      : null;


  const mediaMoagemFutura =
    futuro.length
      ? futuro.reduce(
          (
            soma,
            row
          ) =>
            soma +
            row.moagem,
          0
        ) /
        futuro.length
      : null;


  /*
    Moagem média sustentável para terminar
    a projeção na zona de risco.
  */

  let moagemSeguraMedia =
    null;


  if (
    mediaPotencialFuturo !== null &&
    futuro.length &&
    estoqueAtual !== null
  ) {

    moagemSeguraMedia =
      mediaPotencialFuturo +
      (
        (
          estoqueAtual -
          ESTOQUE_RISCO_CONJ
        ) *
        TONELADAS_POR_CONJUNTO
      ) /
      futuro.length;

  }


  /*
    Maior déficit futuro entre potencial e moagem.
  */

  let maiorDeficit =
    null;


  for (
    const row of futuro
  ) {

    const deficit =
      row.moagem -
      row.potencial;


    if (
      maiorDeficit === null ||
      deficit > maiorDeficit.valor
    ) {

      maiorDeficit = {

        hora:
          row.hora,

        valor:
          deficit

      };

    }

  }


  /*
    Classificação simples do cenário.
  */

  let classificacao =
    'ESTÁVEL';


  if (
    menorEstoqueProjetado <= 4
  ) {

    classificacao =
      'CRÍTICO';

  } else if (
    menorEstoqueProjetado <=
    ESTOQUE_RISCO_CONJ
  ) {

    classificacao =
      'RISCO';

  } else if (
    menorEstoqueProjetado <= 9
  ) {

    classificacao =
      'ATENÇÃO';

  }


  return {

    estoqueAtual,

    estoqueH3,
    estoqueH2,
    estoqueH1,

    tendenciaEstoque,

    historico,

    futuro,

    projecaoEstoque,

    mediaPotencialHistorico,
    mediaMoagemHistorico,

    saldoHistoricoTph,

    mediaPotencialFuturo,
    mediaMoagemFutura,

    moagemSeguraMedia,

    menorEstoqueProjetado,

    horaMenorEstoque,

    primeiroRisco:
      primeiroRisco || null,

    horaRecuperacao,

    maiorDeficit,

    classificacao,

    estoqueRisco:
      ESTOQUE_RISCO_CONJ,

    toneladasPorConjunto:
      TONELADAS_POR_CONJUNTO

  };

}


/* =========================================================
   PROMPT DO GEMINI
========================================================= */

function montarPrompt(
  dados,
  calculos
) {

  const comentarios =
    textoSeguro(
      dados.comentarios,
      10000
    );


  const historicoTexto =
    calculos.historico.length

      ? calculos.historico
          .map(
            row =>
              `${row.hora}: potencial/entrada ${row.potencial} t/h | moagem ${row.moagem} t/h`
          )
          .join('\n')

      : 'Não identificado na tabela.';


  const estoqueTexto = [

    `H-3: ${calculos.estoqueH3 ?? 'não informado'} conjuntos`,

    `H-2: ${calculos.estoqueH2 ?? 'não informado'} conjuntos`,

    `H-1: ${calculos.estoqueH1 ?? 'não informado'} conjuntos`,

    `Atual: ${calculos.estoqueAtual ?? 'não informado'} conjuntos`

  ].join('\n');


  const futuroTexto =
    calculos.projecaoEstoque.length

      ? calculos.projecaoEstoque
          .map(
            row =>
              `${row.hora}: potencial ${Math.round(row.potencial)} t/h | moagem planejada ${Math.round(row.moagem)} t/h | saldo ${row.saldoToneladas >= 0 ? '+' : ''}${Math.round(row.saldoToneladas)} t/h | estoque projetado ${row.estoqueProjetado.toFixed(1)} conjuntos`
          )
          .join('\n')

      : 'Não foi possível montar a projeção.';


  return `

Você é o responsável por elaborar o PLANO DE VOO operacional do COA para uma operação de CTT Agroindustrial da Tereos.

Sua análise deve seguir o padrão de raciocínio utilizado pelo COA em acompanhamento de moagem, entrega, estoque, ciclo e disponibilidade.

O objetivo NÃO é simplesmente resumir os números.

Você deve interpretar a tendência passada, o cenário atual e principalmente a projeção futura.

==================================================
REGRAS FUNDAMENTAIS
==================================================

1. Utilize somente os dados fornecidos.
2. Não invente causas.
3. Não invente frentes.
4. Não invente horários.
5. Não invente indisponibilidade.
6. Não invente ações já realizadas.
7. Se uma ação for recomendação, trate como recomendação.
8. Diferencie claramente fato, projeção e recomendação.
9. Não considere o estoque atual isoladamente.
10. Analise a tendência das últimas três horas.
11. Compare potencial/entrada contra moagem.
12. Analise a velocidade de consumo ou recomposição do estoque.
13. Analise toda a projeção futura disponível.
14. Identifique exatamente em qual horário o cenário começa a ficar crítico ou entra em risco.
15. Identifique quando existe recuperação do estoque.
16. Informe uma referência de moagem segura quando os dados permitirem.
17. Se a moagem planejada estiver acima do potencial por várias horas, explique o impacto.
18. Se o potencial estiver acima da moagem, avalie a possibilidade de recomposição do estoque.
19. Não recomende redução automaticamente apenas porque o estoque está baixo. Considere a tendência futura.
20. Não recomende aumento apenas porque existe potencial. Considere estoque e sustentação.
21. Se os dados não forem suficientes para afirmar alguma coisa, diga isso.
22. Use linguagem de operação agroindustrial.
23. O texto deve parecer escrito por um analista experiente do COA, e não por uma IA genérica.
24. Seja técnico, claro, direto e explicativo.
25. O texto será utilizado em comunicação gerencial/WhatsApp.

==================================================
DADOS DO CENÁRIO
==================================================

Hora da análise:
${horaFormatada()}

Hora operacional atual:
${dados.horaAtual}h

Estoque:
${estoqueTexto}

==================================================
HISTÓRICO DAS ÚLTIMAS HORAS
==================================================

${historicoTexto}

Média histórica de potencial/entrada:
${calculos.mediaPotencialHistorico !== null
  ? Math.round(calculos.mediaPotencialHistorico) + ' t/h'
  : 'não calculada'}

Média histórica de moagem:
${calculos.mediaMoagemHistorico !== null
  ? Math.round(calculos.mediaMoagemHistorico) + ' t/h'
  : 'não calculada'}

Saldo médio histórico:
${calculos.saldoHistoricoTph !== null
  ? (calculos.saldoHistoricoTph >= 0 ? '+' : '') +
    Math.round(calculos.saldoHistoricoTph) +
    ' t/h'
  : 'não calculado'}

Tendência de estoque:
${calculos.tendenciaEstoque !== null
  ? (calculos.tendenciaEstoque >= 0 ? '+' : '') +
    calculos.tendenciaEstoque.toFixed(1) +
    ' conjuntos/h'
  : 'não calculada'}

==================================================
PROJEÇÃO DAS PRÓXIMAS HORAS
==================================================

${futuroTexto}

Média de potencial futuro:
${calculos.mediaPotencialFuturo !== null
  ? Math.round(calculos.mediaPotencialFuturo) + ' t/h'
  : 'não calculada'}

Média de moagem futura:
${calculos.mediaMoagemFutura !== null
  ? Math.round(calculos.mediaMoagemFutura) + ' t/h'
  : 'não calculada'}

Menor estoque projetado:
${calculos.menorEstoqueProjetado.toFixed(1)} conjuntos

Horário do menor estoque:
${calculos.horaMenorEstoque}

Primeiro momento em zona de risco:
${
  calculos.primeiroRisco
    ? calculos.primeiroRisco.hora
    : 'não entra na zona de risco durante a projeção'
}

Momento de recuperação:
${
  calculos.horaRecuperacao ||
  'não identificado'
}

Moagem média segura estimada:
${
  calculos.moagemSeguraMedia !== null
    ? Math.round(calculos.moagemSeguraMedia) + ' t/h'
    : 'não calculada'
}

Maior déficit futuro potencial x moagem:
${
  calculos.maiorDeficit
    ? `${Math.round(calculos.maiorDeficit.valor)} t/h às ${calculos.maiorDeficit.hora}`
    : 'não calculado'
}

Referência de zona de risco:
${calculos.estoqueRisco} conjuntos

Conversão utilizada:
${calculos.toneladasPorConjunto} t/conjunto

==================================================
COMENTÁRIOS OPERACIONAIS
==================================================

${
  comentarios ||
  'Nenhum comentário operacional informado.'
}

==================================================
ANÁLISE SOLICITADA
==================================================

Faça uma análise completa considerando:

A) O que aconteceu nas últimas três horas.

Explique se o estoque está subindo, caindo ou estabilizando e por quê.

B) Situação atual.

Explique se a moagem atual está compatível com a entrada/potencial observados e se existe margem operacional.

C) Próximas horas.

Analise hora a hora a projeção.

D) Momento de atenção.

Informe o horário em que o cenário começa a exigir intervenção, se houver.

E) Moagem segura.

Informe uma referência de moagem sustentável, quando os dados permitirem.

Não trate esse número como uma ordem automática. Explique a lógica.

F) Recuperação.

Se existir momento em que o estoque começa a recompor, informe horário e condição.

G) Ações.

Indique o que deve ser tratado para preservar a moagem e evitar perda de estoque.

H) Cenário final.

Explique objetivamente o que acontece se nada mudar e o que precisa acontecer para manter ou recuperar a moagem.

==================================================
FORMATO DA RESPOSTA
==================================================

Retorne um texto pronto para WhatsApp.

Use exatamente esta estrutura:

*PLANO DE VOO — [UNIDADE IDENTIFICADA OU CTT]*

*Situação atual*
Texto explicando o comportamento atual e as últimas horas.

*Projeção*
Texto explicando a evolução das próximas horas e o comportamento esperado do estoque.

*Ponto de atenção*
Informe o horário, o risco e a causa quantitativa do risco.

*Moagem segura*
Informe a referência calculada e explique como ela se relaciona com o potencial e o estoque.

*Plano de ação*
Texto objetivo com as prioridades operacionais.

*Perspectiva*
Conclua informando o que precisa acontecer para manter, reduzir ou retomar a moagem.

Não utilize tabelas na resposta.

Não utilize blocos de código.

Não escreva frases genéricas como "é importante monitorar".

Explique exatamente o que deve ser acompanhado e em qual momento.

Não diga que uma ação foi realizada se isso não estiver nos comentários.

Se precisar sugerir uma ação, utilize "SUGESTÃO:".

Tamanho aproximado:
400 a 700 palavras.

==================================================
TABELA ORIGINAL
==================================================

${textoSeguro(
  dados.tabelaOriginal,
  30000
)}

`;

}


/* =========================================================
   GEMINI
========================================================= */

async function chamarGemini(
  prompt
) {

  if (
    !GEMINI_API_KEY
  ) {

    throw new Error(
      'GEMINI_API_KEY não configurada no Render.'
    );

  }


  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent`;


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      90000
    );


  try {

    const resposta =
      await fetch(
        url,
        {

          method:
            'POST',

          headers: {

            'Content-Type':
              'application/json',

            'x-goog-api-key':
              GEMINI_API_KEY

          },

          body:
            JSON.stringify({

              contents: [

                {

                  role:
                    'user',

                  parts: [

                    {
                      text:
                        prompt
                    }

                  ]

                }

              ],

              generationConfig: {

                temperature:
                  0.25,

                maxOutputTokens:
                  5000

              }

            }),

          signal:
            controller.signal

        }
      );


    const texto =
      await resposta.text();


    let dados =
      null;


    try {

      dados =
        JSON.parse(
          texto
        );

    } catch (_) {

      throw new Error(
        'Resposta inválida da Gemini.'
      );

    }


    if (
      !resposta.ok
    ) {

      const detalhe =
        dados?.error?.message ||
        `Gemini HTTP ${resposta.status}`;

      throw new Error(
        detalhe
      );

    }


    const partes =
      dados?.candidates?.[0]
        ?.content
        ?.parts || [];


    const resultado =
      partes

        .map(
          part =>
            typeof part?.text === 'string'
              ? part.text
              : ''
        )

        .join('')

        .trim();


    if (!resultado) {

      throw new Error(
        'A Gemini não retornou uma análise.'
      );

    }


    return resultado;

  } finally {

    clearTimeout(
      timeout
    );

  }

}


/* =========================================================
   NORMALIZAR RESPOSTA
========================================================= */

function normalizarResposta(
  texto
) {

  return String(
    texto || ''
  )

    .replace(
      /```(?:text|markdown|md)?/gi,
      ''
    )

    .replace(
      /```/g,
      ''
    )

    .replace(
      /\n{3,}/g,
      '\n\n'
    )

    .trim();

}


/* =========================================================
   HOME
========================================================= */

app.get(
  '/',
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );

  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',
  (
    req,
    res
  ) => {

    res.json({

      ok:
        true,

      gemini:
        Boolean(
          GEMINI_API_KEY
        ),

      modelo:
        GEMINI_MODEL,

      hora:
        horaFormatada()

    });

  }
);


/* =========================================================
   PLANO DE VOO
========================================================= */

app.post(
  '/api/plano-voo',
  async (
    req,
    res
  ) => {

    try {

      const dados =
        req.body || {};


      /*
        Validação básica.
      */

      if (
        !Array.isArray(
          dados.potencial
        ) ||
        !dados.potencial.length
      ) {

        return res
          .status(400)
          .json({

            error:
              'A tabela de potencial não foi interpretada.'

          });

      }


      if (
        !dados.estoque ||
        numeroSeguro(
          dados.estoque.atual
        ) === null
      ) {

        return res
          .status(400)
          .json({

            error:
              'Informe o estoque atual.'

          });

      }


      /*
        Cálculos determinísticos.
      */

      const calculos =
        calcularCenario(
          dados
        );


      /*
        Monta prompt.
      */

      const prompt =
        montarPrompt(
          dados,
          calculos
        );


      /*
        Gemini.
      */

      const resposta =
        await chamarGemini(
          prompt
        );


      const planoVoo =
        normalizarResposta(
          resposta
        );


      /*
        Tenta identificar unidade
        no início da tabela.

        Exemplo:
        VER | Estoque...
      */

      let unidade =
        'CTT';


      const primeiraLinha =
        textoSeguro(
          dados.tabelaOriginal,
          1000
        )
        .split('\n')[0];


      if (
        primeiraLinha.includes('|')
      ) {

        unidade =
          primeiraLinha
            .split('|')[0]
            .trim()
            .slice(
              0,
              40
            );

      }


      return res.json({

        ok:
          true,

        unidade,

        horaAnalise:
          horaFormatada(),

        modelo:
          GEMINI_MODEL,

        planoVoo,

        calculos

      });

    } catch (error) {

      console.error(
        'ERRO PLANO DE VOO:',
        error
      );


      return res
        .status(500)
        .json({

          error:
            error?.message ||
            'Erro ao gerar Plano de Voo.'

        });

    }

  }
);


/* =========================================================
   404
========================================================= */

app.use(
  '/api',
  (
    req,
    res
  ) => {

    res
      .status(404)
      .json({

        error:
          'Rota da API não encontrada.'

      });

  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      '=========================================='
    );

    console.log(
      'COA | PLANO DE VOO CTT'
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      `Gemini: ${
        GEMINI_API_KEY
          ? 'CONFIGURADO'
          : 'NÃO CONFIGURADO'
      }`
    );

    console.log(
      `Modelo: ${GEMINI_MODEL}`
    );

    console.log(
      `Ton/conjunto: ${TONELADAS_POR_CONJUNTO}`
    );

    console.log(
      `Estoque risco: ${ESTOQUE_RISCO_CONJ}`
    );

    console.log(
      '=========================================='
    );

  }
);
