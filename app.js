/* =========================================================
   COA | PLANO DE VOO CTT
   FRONTEND
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


/* =========================================================
   RELÓGIO
========================================================= */

function atualizarRelogio() {

  const agora = new Date();

  const hora =
    String(agora.getHours()).padStart(2, '0');

  const minuto =
    String(agora.getMinutes()).padStart(2, '0');

  $('currentClock').textContent =
    `${hora}:${minuto}`;

}


/* =========================================================
   HORÁRIOS DO ESTOQUE
========================================================= */

function atualizarLabelsEstoque() {

  const agora = new Date();

  const horaAtual =
    agora.getHours();

  const h1 =
    (horaAtual - 3 + 24) % 24;

  const h2 =
    (horaAtual - 2 + 24) % 24;

  const h3 =
    (horaAtual - 1 + 24) % 24;

  $('stockLabel1').textContent =
    `${String(h1).padStart(2, '0')}h`;

  $('stockLabel2').textContent =
    `${String(h2).padStart(2, '0')}h`;

  $('stockLabel3').textContent =
    `${String(h3).padStart(2, '0')}h`;

  $('stockLabelCurrent').textContent =
    `${String(horaAtual).padStart(2, '0')}h • ATUAL`;

}


/* =========================================================
   STATUS DO SISTEMA
========================================================= */

async function verificarSistema() {

  const status =
    $('systemStatus');

  try {

    const resposta =
      await fetch('/api/health');

    if (!resposta.ok) {
      throw new Error();
    }

    const dados =
      await resposta.json();

    status.textContent =
      dados.gemini
        ? '● Sistema online'
        : '● Sistema online • IA não configurada';

    status.className =
      dados.gemini
        ? 'status online'
        : 'status warning';

  } catch (error) {

    status.textContent =
      '● Sistema indisponível';

    status.className =
      'status offline';

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

  /*
    1.250  -> 1250
    500,5  -> 500.5
    1,250  -> 1250
  */

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

  let parte =
    linha.slice(posicaoInicial);

  /*
    Retira palavras e unidades que possam aparecer
    antes dos números.
  */

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
      linha
        .normalize('NFD')
        .replace(
          /[\u0300-\u036f]/g,
          ''
        )
        .toLowerCase();

    for (const padrao of padroes) {

      if (
        normalizada.includes(padrao)
      ) {

        return {
          linha,
          posicao:
            normalizada.indexOf(padrao)
            + padrao.length
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
      error: 'Cole a tabela de potencial.'
    };
  }


  const linhas =
    texto
      .replace(/\r/g, '')
      .split('\n')
      .map(
        linha => linha.trim()
      )
      .filter(Boolean);


  /*
    Procura a linha de cabeçalho
    que contenha várias horas.
  */

  let linhaCabecalho = null;

  for (const linha of linhas) {

    const horas =
      extrairHorasLinha(linha);

    if (horas.length >= 3) {

      linhaCabecalho = linha;

      break;

    }

  }


  if (!linhaCabecalho) {

    return {
      rows: [],
      error:
        'Não consegui identificar as horas da tabela. Cole a tabela completa do Análise de Potencial.'
    };

  }


  const horas =
    extrairHorasLinha(
      linhaCabecalho
    );


  /*
    Ritmo de colheita / potencial.
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
    Ritmo industrial / moagem.
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
    Moagem nominal.
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
      error:
        'Não encontrei a linha "Ritmo Colheita" / "Potencial" na tabela.'
    };

  }


  if (!linhaMoagem) {

    return {
      rows: [],
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


  const nominal =
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

      nominal:
        nominal[i] ??
        null

    });

  }


  return {
    rows,
    error: null
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
    $('potentialPreview');

  const status =
    $('tableStatus');


  if (!parsedPotential.length) {

    preview.classList.add(
      'hidden'
    );

    status.textContent =
      'Aguardando tabela...';

    status.className =
      'table-status';

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


  status.textContent =
    `✓ ${parsedPotential.length} horários identificados • `
    + `${futuro.length} horários de projeção encontrados`;

  status.className =
    'table-status success';


  let html = `
    <div class="preview-title">
      Projeção identificada
    </div>

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
        Histórico identificado:
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


  preview.innerHTML =
    html;

  preview.classList.remove(
    'hidden'
  );

}


/* =========================================================
   INPUT DA TABELA
========================================================= */

$('tabelaPotencial')
  .addEventListener(
    'input',
    function() {

      const resultado =
        interpretarTabela(
          this.value
        );

      if (resultado.error) {

        parsedPotential = [];

        $('tableStatus').textContent =
          resultado.error;

        $('tableStatus').className =
          'table-status error';

        $('potentialPreview')
          .classList
          .add('hidden');

        return;

      }


      parsedPotential =
        resultado.rows;

      renderizarPreview();

    }
  );


/* =========================================================
   VOZ
========================================================= */

function configurarReconhecimento() {

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


  if (!SpeechRecognition) {

    $('voiceButton').disabled =
      true;

    $('voiceText').textContent =
      'Voz não disponível neste navegador';

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

      $('voiceButton')
        .classList
        .add('recording');

      $('voiceIcon').textContent =
        '⏹️';

      $('voiceText').textContent =
        'Ouvindo...';

      $('voiceStatus').textContent =
        'Fale normalmente.';

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

          textoFinal += texto;

        } else {

          textoParcial += texto;

        }

      }


      const textarea =
        $('comentarios');


      if (textoFinal) {

        const atual =
          textarea.value.trim();

        textarea.value =
          atual
            ? `${atual} ${textoFinal.trim()}`
            : textoFinal.trim();

      }


      if (textoParcial) {

        $('voiceStatus').textContent =
          `Ouvindo: ${textoParcial}`;

      }

    };


  recognition.onerror =
    function(event) {

      listening = false;

      $('voiceStatus').textContent =
        `Não foi possível reconhecer a fala: ${event.error}`;

    };


  recognition.onend =
    function() {

      listening = false;

      $('voiceButton')
        .classList
        .remove('recording');

      $('voiceIcon').textContent =
        '🎙️';

      $('voiceText').textContent =
        'Falar comentário';

      if (
        $('voiceStatus')
          .textContent
          .startsWith('Ouvindo')
      ) {

        $('voiceStatus').textContent =
          '';

      }

    };

}


$('voiceButton')
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

        console.error(
          error
        );

      }

    }
  );


/* =========================================================
   MONTAR DADOS
========================================================= */

function montarDados() {

  const tabela =
    $('tabelaPotencial').value.trim();


  if (!tabela) {

    throw new Error(
      'Cole a Análise de Potencial de Produção.'
    );

  }


  const resultado =
    interpretarTabela(
      tabela
    );


  if (
    resultado.error
  ) {

    throw new Error(
      resultado.error
    );

  }


  parsedPotential =
    resultado.rows;


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
      $('comentarios')
        .value
        .trim()

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

  const grid =
    $('kpiGrid');


  const itens = [

    {
      titulo:
        'Estoque atual',

      valor:
        `${formatarNumero(calculos.estoqueAtual)} conj.`,

      classe:
        calculos.estoqueAtual <= 7
          ? 'danger'
          : ''

    },


    {
      titulo:
        'Tendência últimas 3h',

      valor:
        `${calculos.tendenciaEstoque >= 0 ? '+' : ''}${formatarNumero(calculos.tendenciaEstoque, 1)} conj./h`,

      classe:
        calculos.tendenciaEstoque < 0
          ? 'danger'
          : 'positive'

    },


    {
      titulo:
        'Menor estoque projetado',

      valor:
        `${formatarNumero(calculos.menorEstoqueProjetado, 1)} conj.`,

      classe:
        calculos.menorEstoqueProjetado <= 7
          ? 'danger'
          : ''

    },


    {
      titulo:
        'Moagem segura média',

      valor:
        `${formatarNumero(calculos.moagemSeguraMedia)} t/h`,

      classe:
        ''

    }

  ];


  grid.innerHTML =
    itens
      .map(
        item => `
          <div class="kpi ${item.classe}">

            <span>
              ${item.titulo}
            </span>

            <strong>
              ${item.valor}
            </strong>

          </div>
        `
      )
      .join('');

}


/* =========================================================
   ANALISAR
========================================================= */

async function gerarPlanoVoo() {

  const botao =
    $('analyzeButton');

  const textoBotao =
    $('buttonText');

  const loader =
    $('buttonLoader');

  const erro =
    $('errorBox');


  erro.classList.add(
    'hidden'
  );


  try {

    const dados =
      montarDados();


    botao.disabled =
      true;

    textoBotao.textContent =
      'ANALISANDO CENÁRIO...';

    loader.classList.remove(
      'hidden'
    );


    $('resultSection')
      .classList
      .add('hidden');


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
      resultado.calculos
    );


    $('analysisOutput')
      .textContent =
      lastAnalysisText;


    $('resultSub').textContent =
      `${resultado.unidade || 'CTT'} • `
      + `${resultado.horaAnalise || '--:--'}`;


    $('generationInfo').textContent =
      `Análise gerada em ${resultado.horaAnalise || '--:--'} • `
      + `${resultado.modelo || 'Gemini'}`;


    $('resultSection')
      .classList
      .remove('hidden');


    window.scrollTo({
      top:
        $('resultSection')
          .offsetTop
        - 20,

      behavior:
        'smooth'
    });


  } catch (error) {

    erro.textContent =
      error.message ||
      'Erro ao gerar o Plano de Voo.';

    erro.classList.remove(
      'hidden'
    );

  } finally {

    botao.disabled =
      false;

    textoBotao.textContent =
      'GERAR PLANO DE VOO';

    loader.classList.add(
      'hidden'
    );

  }

}


/* =========================================================
   BOTÃO ANALISAR
========================================================= */

$('analyzeButton')
  .addEventListener(
    'click',
    gerarPlanoVoo
  );


/* =========================================================
   COPIAR
========================================================= */

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


/* =========================================================
   LIMPAR
========================================================= */

$('clearButton')
  .addEventListener(
    'click',
    function() {

      $('tabelaPotencial').value =
        '';

      $('stock1').value =
        '';

      $('stock2').value =
        '';

      $('stock3').value =
        '';

      $('stockCurrent').value =
        '';

      $('comentarios').value =
        '';

      parsedPotential =
        [];

      lastAnalysisText =
        '';

      $('potentialPreview')
        .classList
        .add('hidden');

      $('tableStatus').textContent =
        'Aguardando tabela...';

      $('tableStatus').className =
        'table-status';

      $('resultSection')
        .classList
        .add('hidden');

      $('errorBox')
        .classList
        .add('hidden');

      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });

    }
  );


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
