/* =========================================================
   COA | PLANO DE VOO CTT
   FRONTEND
========================================================= */


/* =========================================================
   CONFIGURAÇÃO DAS UNIDADES
========================================================= */

const CONFIG_UNIDADES = {

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
   UTILITÁRIO DOM
========================================================= */

const $ = (id) =>
  document.getElementById(id);


/* =========================================================
   ESTADO
========================================================= */

let parsedPotential = [];

let recognition = null;
let listening = false;

let lastAnalysisText = '';

let unidadeDetectada = null;


/* =========================================================
   NORMALIZAÇÃO DE TEXTO
========================================================= */

function normalizarTexto(texto) {

  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

}


/* =========================================================
   IDENTIFICAR UNIDADE
========================================================= */

function identificarUnidade(texto) {

  const normalizado =
    normalizarTexto(texto);


  /*
    Primeiro procura explicitamente por:
    FILIAL
    GESTORA
    UNIDADE
  */

  const linhas =
    texto
      .replace(/\r/g, '')
      .split('\n')
      .map(linha => linha.trim())
      .filter(Boolean);


  for (const linha of linhas) {

    const linhaNormalizada =
      normalizarTexto(linha);


    const ehIdentificacao =
      linhaNormalizada.includes('FILIAL') ||
      linhaNormalizada.includes('GESTORA') ||
      linhaNormalizada.includes('UNIDADE');


    if (!ehIdentificacao) {
      continue;
    }


    for (const chave of Object.keys(CONFIG_UNIDADES)) {

      if (
        linhaNormalizada.includes(chave)
      ) {

        return {
          chave,
          ...CONFIG_UNIDADES[chave]
        };

      }

    }

  }


  /*
    Caso não encontre na linha de FILIAL/GESTORA,
    procura pelo nome da unidade em todo o texto.
  */

  for (const chave of Object.keys(CONFIG_UNIDADES)) {

    if (
      normalizado.includes(chave)
    ) {

      return {
        chave,
        ...CONFIG_UNIDADES[chave]
      };

    }

  }


  return null;

}


/* =========================================================
   RELÓGIO
========================================================= */

function atualizarRelogio() {

  /*
    O HTML atual não possui relógio.
    Mantemos a função sem gerar erro.
  */

}


/* =========================================================
   HORÁRIOS DO ESTOQUE
========================================================= */

function atualizarLabelsEstoque() {

  const agora =
    new Date();

  const horaAtual =
    agora.getHours();


  const h1 =
    (horaAtual - 3 + 24) % 24;

  const h2 =
    (horaAtual - 2 + 24) % 24;

  const h3 =
    (horaAtual - 1 + 24) % 24;


  if ($('stockLabel1')) {

    $('stockLabel1').textContent =
      `${String(h1).padStart(2, '0')}h`;

  }


  if ($('stockLabel2')) {

    $('stockLabel2').textContent =
      `${String(h2).padStart(2, '0')}h`;

  }


  if ($('stockLabel3')) {

    $('stockLabel3').textContent =
      `${String(h3).padStart(2, '0')}h`;

  }


  if ($('stockLabel4')) {

    $('stockLabel4').textContent =
      `${String(horaAtual).padStart(2, '0')}h • ATUAL`;

  }

}


/* =========================================================
   STATUS DO SISTEMA
========================================================= */

async function verificarSistema() {

  /*
    O HTML atual não possui indicador de sistema.
    A função é mantida para compatibilidade.
  */

  try {

    const resposta =
      await fetch('/api/health');


    if (!resposta.ok) {
      return;
    }


    await resposta.json();

  } catch (error) {

    console.warn(
      'Não foi possível verificar o status do sistema.',
      error
    );

  }

}


/* =========================================================
   CONVERSÃO DE NÚMEROS BRASILEIROS
========================================================= */

function numeroBR(valor) {

  if (
    valor === null ||
    valor === undefined
  ) {

    return null;

  }


  let texto =
    String(valor)
      .trim()
      .replace(/[^\d.,-]/g, '');


  if (!texto) {
    return null;
  }


  if (
    texto.includes('.') &&
    texto.includes(',')
  ) {

    texto =
      texto
        .replace(/\./g, '')
        .replace(',', '.');

  } else if (
    /^\d{1,3}(\.\d{3})+$/.test(texto)
  ) {

    texto =
      texto.replace(/\./g, '');

  } else if (
    /^\d{1,3}(,\d{3})+$/.test(texto)
  ) {

    texto =
      texto.replace(/,/g, '');

  } else {

    texto =
      texto.replace(',', '.');

  }


  const numero =
    Number(texto);


  return Number.isFinite(numero)
    ? numero
    : null;

}


/* =========================================================
   EXTRAIR HORAS
========================================================= */

function extrairHorasLinha(texto) {

  const encontrados =
    texto.match(
      /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g
    ) || [];


  return [
    ...new Set(encontrados)
  ];

}


/* =========================================================
   CONVERTER HORA
========================================================= */

function horaNumero(hora) {

  if (!hora) {
    return null;
  }


  const match =
    String(hora)
      .match(/^(\d{1,2}):/);


  if (!match) {
    return null;
  }


  return Number(match[1]);

}


/* =========================================================
   DISTÂNCIA DA HORA ATUAL
========================================================= */

function horaRelativa(
  hora,
  horaAtual
) {

  let distancia =
    (hora - horaAtual + 24) % 24;


  if (distancia > 12) {
    distancia -= 24;
  }


  return distancia;

}


/* =========================================================
   VALORES DE UMA LINHA
========================================================= */

function extrairValoresLinha(
  linha,
  posicaoInicial
) {

  const parte =
    linha.slice(posicaoInicial);


  const encontrados =
    parte.match(
      /-?\d+(?:[.,]\d+)?/g
    ) || [];


  return encontrados
    .map(numeroBR)
    .filter(
      valor =>
        valor !== null
    );

}


/* =========================================================
   ENCONTRAR LINHA POR PADRÕES
========================================================= */

function encontrarLinha(
  linhas,
  padroes
) {

  for (const linha of linhas) {

    const normalizada =
      normalizarTexto(linha);


    for (const padrao of padroes) {

      if (
        normalizada.includes(
          normalizarTexto(padrao)
        )
      ) {

        return {

          linha,

          posicao:
            normalizada.indexOf(
              normalizarTexto(padrao)
            )
            + normalizarTexto(padrao).length

        };

      }

    }

  }


  return null;

}


/* =========================================================
   PARSER DA TABELA DE POTENCIAL
========================================================= */

function interpretarTabela(texto) {

  if (!texto.trim()) {

    return {

      rows: [],

      error:
        'Cole a tabela de potencial.'

    };

  }


  const linhas =
    texto
      .replace(/\r/g, '')
      .split('\n')
      .map(
        linha =>
          linha.trim()
      )
      .filter(Boolean);


  /*
    IDENTIFICA UNIDADE
  */

  const unidade =
    identificarUnidade(texto);


  /*
    PROCURA CABEÇALHO DE HORAS
  */

  let linhaCabecalho = null;


  for (const linha of linhas) {

    const horas =
      extrairHorasLinha(linha);


    if (horas.length >= 3) {

      linhaCabecalho =
        linha;

      break;

    }

  }


  if (!linhaCabecalho) {

    return {

      rows: [],

      unidade,

      error:
        'Não consegui identificar as horas da tabela. Cole a tabela completa do Análise de Potencial.'

    };

  }


  const horas =
    extrairHorasLinha(
      linhaCabecalho
    );


  /*
    RITMO DE COLHEITA / POTENCIAL
  */

  const linhaPotencial =
    encontrarLinha(
      linhas,
      [
        'ritmo colheita',
        'ritmo agrícola',
        'ritmo agricola',
        'potencial agrícola',
        'potencial agricola',
        'potencial produção',
        'potencial producao'
      ]
    );


  /*
    RITMO INDUSTRIAL
  */

  const linhaMoagem =
    encontrarLinha(
      linhas,
      [
        'ritmo industrial',
        'ritmo moagem',
        'industrial (t/h)',
        'industrial t/h'
      ]
    );


  /*
    MOAGEM NOMINAL
  */

  const linhaNominal =
    encontrarLinha(
      linhas,
      [
        'nominal ind',
        'nominal industrial'
      ]
    );


  if (!linhaPotencial) {

    return {

      rows: [],

      unidade,

      error:
        'Não encontrei a linha "Ritmo Colheita" / "Potencial" na tabela.'

    };

  }


  if (!linhaMoagem) {

    return {

      rows: [],

      unidade,

      error:
        'Não encontrei a linha "Ritmo Industrial" na tabela.'

    };

  }


  const potencial =
    extrairValoresLinha(
      linhaPotencial.linha,
      linhaPotencial.posicao
    );


  const moagem =
    extrairValoresLinha(
      linhaMoagem.linha,
      linhaMoagem.posicao
    );


  const nominalTabela =
    linhaNominal
      ? extrairValoresLinha(
          linhaNominal.linha,
          linhaNominal.posicao
        )
      : [];


  const quantidade =
    Math.min(
      horas.length,
      potencial.length,
      moagem.length
    );


  const rows = [];


  for (
    let i = 0;
    i < quantidade;
    i++
  ) {

    rows.push({

      hora:
        horas[i],

      horaNumero:
        horaNumero(
          horas[i]
        ),

      potencial:
        potencial[i],

      moagem:
        moagem[i],

      nominalTabela:
        nominalTabela[i] ??
        null

    });

  }


  /*
    NOMINAL OFICIAL DA UNIDADE
  */

  const nominalOficial =
    unidade
      ? unidade.nominal
      : null;


  /*
    Acrescenta a nominal oficial
    em cada registro.
  */

  rows.forEach(row => {

    row.nominal =
      nominalOficial ??
      row.nominalTabela ??
      null;

  });


  return {

    rows,

    unidade,

    nominal:
      nominalOficial,

    error:
      null

  };

}


/* =========================================================
   HORA ATUAL
========================================================= */

function getHoraAtual() {

  return new Date().getHours();

}


/* =========================================================
   SELECIONAR HISTÓRICO
========================================================= */

function selecionarHistorico(rows) {

  const atual =
    getHoraAtual();


  const historico =
    rows

      .map(row => ({

        ...row,

        distancia:
          horaRelativa(
            row.horaNumero,
            atual
          )

      }))

      .filter(
        row =>
          row.distancia < 0
      )

      .sort(
        (a, b) =>
          b.distancia -
          a.distancia
      );


  return historico

    .slice(0, 3)

    .sort(
      (a, b) =>
        a.distancia -
        b.distancia
    );

}


/* =========================================================
   SELECIONAR PRÓXIMAS 12H
========================================================= */

function selecionarProjecao(rows) {

  const atual =
    getHoraAtual();


  return rows

    .map(row => ({

      ...row,

      distancia:
        horaRelativa(
          row.horaNumero,
          atual
        )

    }))

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

}


/* =========================================================
   RENDER PREVIEW
========================================================= */

function renderizarPreview() {

  const preview =
    $('previewArea');

  const content =
    $('previewContent');

  const badge =
    $('previewBadge');

  const status =
    $('potentialStatus');


  if (!parsedPotential.length) {

    if (preview) {
      preview.classList.add('hidden');
    }

    if (status) {
      status.textContent =
        'Aguardando tabela...';
    }

    return;

  }


  const historico =
    selecionarHistorico(
      parsedPotential
    );


  const futuro =
    selecionarProjecao(
      parsedPotential
    );


  if (status) {

    status.textContent =
      `✓ ${parsedPotential.length} horários identificados`;

    status.className =
      'input-status success';

  }


  if (badge) {

    badge.textContent =
      unidadeDetectada
        ? unidadeDetectada.nome.toUpperCase()
        : 'IDENTIFICADA';

  }


  let html = '';


  if (unidadeDetectada) {

    html += `
      <div class="preview-unit">
        <strong>Unidade:</strong>
        ${unidadeDetectada.nome}
        <span>•</span>
        <strong>Nominal:</strong>
        ${formatarNumero(unidadeDetectada.nominal)} t/h
      </div>
    `;

  } else {

    html += `
      <div class="preview-unit warning">
        Unidade não identificada na tabela.
      </div>
    `;

  }


  html += `
    <div class="preview-grid">
  `;


  futuro.forEach(row => {

    html += `
      <div class="preview-item">

        <strong>
          ${row.hora}
        </strong>

        <span>
          Potencial:
          ${Math.round(row.potencial)} t/h
        </span>

        <span>
          Moagem:
          ${Math.round(row.moagem)} t/h
        </span>

      </div>
    `;

  });


  html += `
    </div>
  `;


  if (historico.length) {

    html += `
      <div class="preview-history">
        <strong>Histórico:</strong>
        ${historico
          .map(
            row =>
              `${row.hora} → ${Math.round(row.potencial)} / ${Math.round(row.moagem)} t/h`
          )
          .join(' • ')
        }
      </div>
    `;

  }


  if (content) {

    content.innerHTML =
      html;

  }


  if (preview) {

    preview.classList.remove(
      'hidden'
    );

  }

}


/* =========================================================
   INPUT DA TABELA
========================================================= */

if ($('potentialInput')) {

  $('potentialInput')
    .addEventListener(
      'input',
      function() {

        const resultado =
          interpretarTabela(
            this.value
          );


        if (resultado.error) {

          parsedPotential = [];

          unidadeDetectada =
            resultado.unidade || null;


          if ($('potentialStatus')) {

            $('potentialStatus').textContent =
              resultado.error;

            $('potentialStatus').className =
              'input-status error';

          }


          if ($('previewArea')) {

            $('previewArea')
              .classList
              .add('hidden');

          }

          return;

        }


        parsedPotential =
          resultado.rows;


        unidadeDetectada =
          resultado.unidade || null;


        renderizarPreview();

      }
    );

}


/* =========================================================
   VOZ
========================================================= */

function configurarReconhecimento() {

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


  if (!SpeechRecognition) {

    if ($('micButton')) {
      $('micButton').disabled = true;
    }

    if ($('voiceSupport')) {

      $('voiceSupport').textContent =
        'Voz não disponível neste navegador.';

    }

    return;

  }


  recognition =
    new SpeechRecognition();


  recognition.lang =
    'pt-BR';

  recognition.continuous =
    false;

  recognition.interimResults =
    true;

  recognition.maxAlternatives =
    1;


  recognition.onstart =
    function() {

      listening = true;


      if ($('micButton')) {

        $('micButton')
          .classList
          .add('recording');

      }


      if ($('voiceStatus')) {

        $('voiceStatus').textContent =
          'Ouvindo...';

      }

    };


  recognition.onresult =
    function(event) {

      let textoFinal =
        '';

      let textoParcial =
        '';


      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {

        const texto =
          event.results[i][0]
            .transcript;


        if (
          event.results[i].isFinal
        ) {

          textoFinal +=
            texto;

        } else {

          textoParcial +=
            texto;

        }

      }


      const textarea =
        $('comments');


      if (
        textarea &&
        textoFinal
      ) {

        const atual =
          textarea.value.trim();


        textarea.value =
          atual
            ? `${atual} ${textoFinal.trim()}`
            : textoFinal.trim();

      }


      if (
        $('voiceStatus') &&
        textoParcial
      ) {

        $('voiceStatus').textContent =
          `Ouvindo: ${textoParcial}`;

      }

    };


  recognition.onerror =
    function(event) {

      listening = false;


      if ($('voiceStatus')) {

        $('voiceStatus').textContent =
          `Não foi possível reconhecer a fala: ${event.error}`;

      }

    };


  recognition.onend =
    function() {

      listening = false;


      if ($('micButton')) {

        $('micButton')
          .classList
          .remove('recording');

      }


      if ($('voiceStatus')) {

        $('voiceStatus').textContent =
          'Clique no microfone para ditar.';

      }

    };

}


/* =========================================================
   BOTÃO VOZ
========================================================= */

if ($('micButton')) {

  $('micButton')
    .addEventListener(
      'click',
      function() {

        if (!recognition) {

          alert(
            'O reconhecimento de voz não está disponível neste navegador. Use Chrome ou Edge e permita o acesso ao microfone.'
          );

          return;

        }


        if (listening) {

          recognition.stop();

          return;

        }


        try {

          recognition.start();

        } catch (error) {

          console.error(error);

        }

      }
    );

}


/* =========================================================
   MONTAR DADOS
========================================================= */

function montarDados() {

  const tabela =
    $('potentialInput').value.trim();


  if (!tabela) {

    throw new Error(
      'Cole a Análise de Potencial de Produção.'
    );

  }


  const resultado =
    interpretarTabela(
      tabela
    );


  if (resultado.error) {

    throw new Error(
      resultado.error
    );

  }


  parsedPotential =
    resultado.rows;


  unidadeDetectada =
    resultado.unidade || null;


  /*
    Sem unidade identificada,
    não permitimos gerar o plano.
  */

  if (!unidadeDetectada) {

    throw new Error(
      'Não consegui identificar a filial/unidade na Análise de Potencial de Produção. Verifique se o campo "Filial", "Gestora" ou a identificação da unidade está presente no conteúdo copiado.'
    );

  }


  const estoque1 =
    Number(
      $('stock1').value
    );


  const estoque2 =
    Number(
      $('stock2').value
    );


  const estoque3 =
    Number(
      $('stock3').value
    );


  const estoqueAtual =
    Number(
      $('stockCurrent').value
    );


  if (
    !Number.isFinite(estoque1) ||
    !Number.isFinite(estoque2) ||
    !Number.isFinite(estoque3) ||
    !Number.isFinite(estoqueAtual)
  ) {

    throw new Error(
      'Informe os estoques das últimas três horas e o estoque atual.'
    );

  }


  const agora =
    new Date();


  return {

    dataHora:
      agora.toISOString(),

    horaAtual:
      agora.getHours(),

    tabelaOriginal:
      tabela,


    /*
      NOVO:
      identificação da unidade
    */

    unidade: {

      chave:
        unidadeDetectada.chave,

      nome:
        unidadeDetectada.nome,

      nominal:
        unidadeDetectada.nominal

    },


    /*
      Mantemos também a nominal
      diretamente no payload.
    */

    nominal:
      unidadeDetectada.nominal,


    potencial:
      parsedPotential,


    estoque: {

      h3:
        estoque1,

      h2:
        estoque2,

      h1:
        estoque3,

      atual:
        estoqueAtual

    },


    comentarios:
      $('comments')
        ? $('comments').value.trim()
        : ''

  };

}


/* =========================================================
   FORMATAR NÚMEROS
========================================================= */

function formatarNumero(
  numero,
  casas = 0
) {

  if (
    numero === null ||
    numero === undefined ||
    Number.isNaN(Number(numero))
  ) {

    return '-';

  }


  return Number(numero)
    .toLocaleString(
      'pt-BR',
      {
        minimumFractionDigits:
          casas,

        maximumFractionDigits:
          casas

      }
    );

}


/* =========================================================
   RENDER KPI
========================================================= */

function renderizarKPIs(
  calculos
) {

  if (!calculos) {
    return;
  }


  const kpiStock =
    $('kpiStock');

  const kpiTrend =
    $('kpiTrend');

  const kpiTrendDetail =
    $('kpiTrendDetail');

  const kpiSafeMoagem =
    $('kpiSafeMoagem');

  const kpiRiskHour =
    $('kpiRiskHour');


  if (kpiStock) {

    kpiStock.textContent =
      formatarNumero(
        calculos.estoqueAtual
      );

  }


  if (kpiTrend) {

    const tendencia =
      Number(
        calculos.tendenciaEstoque
      );


    kpiTrend.textContent =
      Number.isFinite(tendencia)
        ? `${tendencia >= 0 ? '+' : ''}${formatarNumero(tendencia, 1)}`
        : '—';


    kpiTrend.className =
      `kpi-value ${
        tendencia < 0
          ? 'danger'
          : 'positive'
      }`;

  }


  if (kpiTrendDetail) {

    kpiTrendDetail.textContent =
      'conj./h';

  }


  if (kpiSafeMoagem) {

    kpiSafeMoagem.textContent =
      formatarNumero(
        calculos.moagemSeguraMedia
      );

  }


  if (kpiRiskHour) {

    kpiRiskHour.textContent =
      calculos.horaRisco ||
      calculos.pontoAtencao ||
      '—';

  }

}


/* =========================================================
   RENDER STATUS DA UNIDADE
========================================================= */

function renderizarStatusResultado(
  resultado
) {

  const status =
    $('resultStatus');


  if (!status) {
    return;
  }


  const unidade =
    resultado.unidade ||
    unidadeDetectada;


  if (!unidade) {

    status.textContent =
      'Unidade não identificada.';

    return;

  }


  const nome =
    typeof unidade === 'string'
      ? unidade
      : unidade.nome;


  const nominal =
    resultado.nominal ||
    unidade.nominal;


  status.textContent =
    `${nome} • Nominal ${formatarNumero(nominal)} t/h`;

}


/* =========================================================
   GERAR PLANO DE VOO
========================================================= */

async function gerarPlanoVoo() {

  const botao =
    $('generateButton');

  const textoBotao =
    $('generateText');

  const icone =
    $('generateIcon');


  try {

    const dados =
      montarDados();


    if (botao) {
      botao.disabled = true;
    }


    if (textoBotao) {

      textoBotao.textContent =
        'ANALISANDO CENÁRIO...';

    }


    if (icone) {

      icone.textContent =
        '⏳';

    }


    if ($('errorArea')) {

      $('errorArea')
        .classList
        .add('hidden');

    }


    if ($('loadingArea')) {

      $('loadingArea')
        .classList
        .remove('hidden');

    }


    if ($('resultArea')) {

      $('resultArea')
        .classList
        .add('hidden');

    }


    const resposta =
      await fetch(
        '/api/plano-voo',
        {

          method:
            'POST',

          headers: {

            'Content-Type':
              'application/json'

          },

          body:
            JSON.stringify(
              dados
            )

        }
      );


    let resultado =
      null;


    try {

      resultado =
        await resposta.json();

    } catch (_) {

      resultado = {};

    }


    if (!resposta.ok) {

      throw new Error(
        resultado.error ||
        `Erro HTTP ${resposta.status}`
      );

    }


    lastAnalysisText =
      resultado.planoVoo ||
      'A IA não retornou um Plano de Voo.';


    renderizarKPIs(
      resultado.calculos || {}
    );


    if ($('analysisText')) {

      $('analysisText').textContent =
        lastAnalysisText;

    }


    renderizarStatusResultado(
      resultado
    );


    /*
      Informações adicionais no resultado,
      caso o backend retorne.
    */

    if (
      resultado.unidade &&
      typeof resultado.unidade === 'string'
    ) {

      unidadeDetectada = {

        nome:
          resultado.unidade,

        nominal:
          resultado.nominal ||
          null

      };

    }


    if ($('resultArea')) {

      $('resultArea')
        .classList
        .remove('hidden');

    }


    window.scrollTo({

      top:
        $('resultArea')
          ? $('resultArea').offsetTop - 20
          : 0,

      behavior:
        'smooth'

    });


  } catch (error) {

    console.error(
      'Erro ao gerar Plano de Voo:',
      error
    );


    if ($('errorMessage')) {

      $('errorMessage').textContent =
        error.message ||
        'Erro ao gerar o Plano de Voo.';

    }


    if ($('errorArea')) {

      $('errorArea')
        .classList
        .remove('hidden');

    }

  } finally {

    if (botao) {

      botao.disabled =
        false;

    }


    if (textoBotao) {

      textoBotao.textContent =
        'GERAR PLANO DE VOO';

    }


    if (icone) {

      icone.textContent =
        '✦';

    }


    if ($('loadingArea')) {

      $('loadingArea')
        .classList
        .add('hidden');

    }

  }

}


/* =========================================================
   BOTÃO GERAR
========================================================= */

if ($('generateButton')) {

  $('generateButton')
    .addEventListener(
      'click',
      gerarPlanoVoo
    );

}


/* =========================================================
   COPIAR ANÁLISE
========================================================= */

if ($('copyButton')) {

  $('copyButton')
    .addEventListener(
      'click',
      async function() {

        if (!lastAnalysisText) {
          return;
        }


        try {

          await navigator.clipboard.writeText(
            lastAnalysisText
          );


          const original =
            this.textContent;


          this.textContent =
            '✓ Copiado';


          setTimeout(
            () => {

              this.textContent =
                original;

            },
            1500
          );


        } catch (error) {

          alert(
            'Não foi possível copiar automaticamente.'
          );

        }

      }
    );

}


/* =========================================================
   LIMPAR
========================================================= */

if ($('clearButton')) {

  $('clearButton')
    .addEventListener(
      'click',
      function() {

        if ($('potentialInput')) {

          $('potentialInput').value =
            '';

        }


        if ($('stock1')) {
          $('stock1').value = '';
        }

        if ($('stock2')) {
          $('stock2').value = '';
        }

        if ($('stock3')) {
          $('stock3').value = '';
        }

        if ($('stockCurrent')) {
          $('stockCurrent').value = '';
        }

        if ($('comments')) {
          $('comments').value = '';
        }


        parsedPotential =
          [];

        lastAnalysisText =
          '';

        unidadeDetectada =
          null;


        if ($('previewArea')) {

          $('previewArea')
            .classList
            .add('hidden');

        }


        if ($('potentialStatus')) {

          $('potentialStatus').textContent =
            '';

        }


        if ($('resultArea')) {

          $('resultArea')
            .classList
            .add('hidden');

        }


        if ($('errorArea')) {

          $('errorArea')
            .classList
            .add('hidden');

        }


        window.scrollTo({

          top: 0,

          behavior:
            'smooth'

        });

      }
    );

}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

atualizarRelogio();

atualizarLabelsEstoque();

configurarReconhecimento();

verificarSistema();


setInterval(
  atualizarRelogio,
  1000
);


setInterval(
  atualizarLabelsEstoque,
  60000
);
