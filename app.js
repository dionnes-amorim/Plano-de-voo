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
   NORMALIZAÇÃO
========================================================= */

function normalizarTexto(texto){

  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .trim();

}



/* =========================================================
   IDENTIFICAR UNIDADE
========================================================= */

function identificarUnidade(texto){


  const linhas =
    texto
    .replace(/\r/g,'')
    .split('\n')
    .map(x=>x.trim())
    .filter(Boolean);



  for(let i=0;i<linhas.length;i++){


    let atual =
      normalizarTexto(linhas[i]);



    let procurar =
      atual;



    /*
      Caso:

      FILIAL

      USINA MANDU

    */

    if(
      atual === 'FILIAL' ||
      atual === 'UNIDADE' ||
      atual === 'GESTORA'
    ){

      procurar =
        normalizarTexto(
          linhas[i+1] || ''
        );

    }



    for(
      const chave of Object.keys(CONFIG_UNIDADES)
    ){

      if(
        procurar.includes(chave)
      ){

        return {

          chave,

          ...CONFIG_UNIDADES[chave]

        };

      }

    }

  }



  /*
    Busca geral

    Caso venha:
    USINA MANDU
  */


  const completo =
    normalizarTexto(texto);



  for(
    const chave of Object.keys(CONFIG_UNIDADES)
  ){

    if(
      completo.includes(chave)
    ){

      return {

        chave,

        ...CONFIG_UNIDADES[chave]

      };

    }

  }



  return null;

}



/* =========================================================
   NÚMEROS BRASILEIROS
========================================================= */

function numeroBR(valor){


  if(
    valor === null ||
    valor === undefined
  ){

    return null;

  }



  let texto =
    String(valor)
    .trim()
    .replace(/[^\d.,-]/g,'');



  if(!texto){

    return null;

  }



  /*
    1.657,50
  */

  if(
    texto.includes('.') &&
    texto.includes(',')
  ){

    texto =
      texto
      .replace(/\./g,'')
      .replace(',','.');

  }


  /*
    1.657
  */

  else if(
    /^\d{1,3}(\.\d{3})+$/.test(texto)
  ){

    texto =
      texto.replace(/\./g,'');

  }


  /*
    14,3
  */

  else {

    texto =
      texto.replace(',','.');

  }



  const numero =
    Number(texto);



  return Number.isFinite(numero)
    ? numero
    : null;

}



/* =========================================================
   FORMATAR NÚMEROS
========================================================= */

function formatarNumero(
  numero,
  casas=0
){

  if(
    numero === null ||
    numero === undefined ||
    Number.isNaN(Number(numero))
  ){

    return '-';

  }



  return Number(numero)
    .toLocaleString(
      'pt-BR',
      {
        minimumFractionDigits:casas,
        maximumFractionDigits:casas
      }
    );

}



/* =========================================================
   PARSER DA TABELA HORA A HORA
========================================================= */


function interpretarTabela(texto){



  if(
    !texto ||
    !texto.trim()
  ){

    return {

      rows:[],

      error:
      'Cole a tabela de potencial.'

    };

  }




  const linhas =
    texto
    .replace(/\r/g,'')
    .split('\n')
    .map(x=>x.trim())
    .filter(Boolean);



  const unidade =
    identificarUnidade(texto);




  /*
    Procura:

    00 - 01
    01 - 02

  */

  const linhasHora =
    linhas.filter(
      linha =>
      /^\d{2}\s*-\s*\d{2}/.test(linha)
    );




  if(!linhasHora.length){

    return {

      rows:[],

      unidade,

      error:
      'Não encontrei horários da tabela.'

    };

  }




  const rows=[];



  linhasHora.forEach(linha=>{


    let colunas =
      linha.split(/\t+/);



    /*
      Quando cola sem TAB
    */

    if(
      colunas.length < 8
    ){

      colunas =
        linha.split(/\s+/);

    }



    if(
      colunas.length < 6
    ){

      return;

    }




    rows.push({


      hora:
        colunas[0],



      horaNumero:
        Number(
          colunas[0].substring(0,2)
        ),



      maquinas:
        numeroBR(colunas[1]),



      tratores:
        numeroBR(colunas[2]),



      restricao:
        numeroBR(colunas[3]),



      cota:
        numeroBR(colunas[4]),



      potencial:
        numeroBR(colunas[1]),



      moagem:
        numeroBR(colunas[5]),



      despacho:
        numeroBR(colunas[5]),



      camNec:
        numeroBR(colunas[6]),



      camAloc:
        numeroBR(colunas[7]),



      saidaCam:
        numeroBR(colunas[8]),



      peso:
        numeroBR(colunas[9])



    });


  });




  if(!rows.length){

    return {

      rows:[],

      unidade,

      error:
      'Não consegui ler os dados da tabela.'

    };

  }




  rows.forEach(row=>{


    row.nominal =
      unidade
      ? unidade.nominal
      : null;


  });




  return {


    rows,


    unidade,


    nominal:
      unidade
      ? unidade.nominal
      : null,


    error:null


  };


}
Essa é a base corrigida.

   /* =========================================================
   RELÓGIO
========================================================= */

function atualizarRelogio(){

  /*
    Mantido para compatibilidade
  */

}



/* =========================================================
   HORÁRIOS DO ESTOQUE
========================================================= */

function atualizarLabelsEstoque(){


  const agora =
    new Date();


  const hora =
    agora.getHours();



  const h1 =
    (hora - 3 + 24) % 24;


  const h2 =
    (hora - 2 + 24) % 24;


  const h3 =
    (hora - 1 + 24) % 24;



  if($('stockLabel1')){

    $('stockLabel1').textContent =
      `${String(h1).padStart(2,'0')}h`;

  }


  if($('stockLabel2')){

    $('stockLabel2').textContent =
      `${String(h2).padStart(2,'0')}h`;

  }


  if($('stockLabel3')){

    $('stockLabel3').textContent =
      `${String(h3).padStart(2,'0')}h`;

  }


  if($('stockLabel4')){

    $('stockLabel4').textContent =
      `${String(hora).padStart(2,'0')}h • ATUAL`;

  }


}



/* =========================================================
   HORA ATUAL
========================================================= */

function getHoraAtual(){

  return new Date().getHours();

}



/* =========================================================
   DISTÂNCIA ENTRE HORAS
========================================================= */

function horaRelativa(
  hora,
  atual
){

  let distancia =
    (hora - atual + 24) % 24;



  if(distancia > 12){

    distancia -= 24;

  }



  return distancia;

}



/* =========================================================
   HISTÓRICO ÚLTIMAS HORAS
========================================================= */

function selecionarHistorico(rows){


  const atual =
    getHoraAtual();



  return rows

    .map(row=>({

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
      (a,b)=>
      b.distancia-a.distancia
    )


    .slice(0,3)


    .sort(
      (a,b)=>
      a.distancia-b.distancia
    );


}



/* =========================================================
   PRÓXIMAS HORAS
========================================================= */

function selecionarProjecao(rows){


  const atual =
    getHoraAtual();



  return rows

    .map(row=>({

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
      (a,b)=>
      a.distancia-b.distancia
    )


    .slice(0,12);


}



/* =========================================================
   RENDER PREVIEW
========================================================= */

function renderizarPreview(){


  const preview =
    $('previewArea');


  const content =
    $('previewContent');


  const badge =
    $('previewBadge');


  const status =
    $('potentialStatus');



  if(!parsedPotential.length){

    if(preview){

      preview.classList.add('hidden');

    }


    return;

  }



  const futuro =
    selecionarProjecao(
      parsedPotential
    );


  const historico =
    selecionarHistorico(
      parsedPotential
    );




  if(status){

    status.textContent =
      `✓ ${parsedPotential.length} horários identificados`;

    status.className =
      'input-status';

  }



  if(badge){

    badge.textContent =
      unidadeDetectada
      ? unidadeDetectada.nome.toUpperCase()
      : 'IDENTIFICADA';

  }



  let html = '';



  if(unidadeDetectada){


    html += `

    <div>

      <strong>
        Unidade:
      </strong>

      ${unidadeDetectada.nome}


      <br>


      <strong>
        Nominal:
      </strong>

      ${formatarNumero(
        unidadeDetectada.nominal
      )}
      t/h

    </div>

    `;


  }




  html += `

  <br>

  <strong>
    Próximas horas:
  </strong>

  <br><br>

  `;



  futuro.forEach(row=>{


    html += `

      <div style="
        margin-bottom:8px;
      ">

        <strong>
          ${row.hora}
        </strong>


        |

        Máquina:
        ${formatarNumero(row.maquinas)}
        t


        |

        Despacho:
        ${formatarNumero(row.despacho)}
        t/h


      </div>

    `;


  });





  if(historico.length){


    html += `

      <hr>

      <strong>
        Últimas horas:
      </strong>

      <br>

    `;



    historico.forEach(row=>{


      html += `

      ${row.hora}
      →
      ${formatarNumero(row.despacho)}
      t/h

      <br>

      `;


    });


  }





  if(content){

    content.innerHTML =
      html;

  }



  if(preview){

    preview.classList.remove(
      'hidden'
    );

  }


}



/* =========================================================
   INPUT DA TABELA
========================================================= */

if($('potentialInput')){


  $('potentialInput')
  .addEventListener(
    'input',
    function(){


      const resultado =
        interpretarTabela(
          this.value
        );



      if(resultado.error){


        parsedPotential =
          [];


        unidadeDetectada =
          resultado.unidade || null;



        if($('potentialStatus')){


          $('potentialStatus').textContent =
            resultado.error;


        }



        if($('previewArea')){


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


function configurarReconhecimento(){


  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;



  if(!SpeechRecognition){


    if($('micButton')){

      $('micButton').disabled = true;

    }


    if($('voiceSupport')){

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



  recognition.onstart =
  function(){


    listening = true;



    if($('micButton')){

      $('micButton')
      .classList
      .add('recording');

    }



    if($('voiceStatus')){

      $('voiceStatus').textContent =
      'Ouvindo...';

    }


  };





  recognition.onresult =
  function(event){


    let texto = '';



    for(
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ){

      texto +=
      event.results[i][0]
      .transcript;

    }




    if(
      event.results[0].isFinal &&
      $('comments')
    ){


      const atual =
        $('comments').value.trim();



      $('comments').value =
        atual
        ? `${atual} ${texto}`
        : texto;


    }



  };





  recognition.onerror =
  function(event){


    listening = false;



    if($('voiceStatus')){

      $('voiceStatus').textContent =
      'Erro no reconhecimento de voz.';

    }


  };





  recognition.onend =
  function(){


    listening = false;



    if($('micButton')){


      $('micButton')
      .classList
      .remove('recording');


    }



    if($('voiceStatus')){


      $('voiceStatus').textContent =
      'Clique no microfone para ditar.';


    }


  };


}





if($('micButton')){


  $('micButton')
  .addEventListener(
    'click',
    function(){


      if(!recognition){

        alert(
          'Reconhecimento de voz não disponível.'
        );

        return;

      }



      if(listening){

        recognition.stop();

        return;

      }




      recognition.start();



    }
  );


}





/* =========================================================
   MONTAR DADOS PARA BACKEND
========================================================= */


function montarDados(){



  const tabela =
    $('potentialInput')
    .value
    .trim();



  if(!tabela){


    throw new Error(
      'Cole a Análise de Potencial de Produção.'
    );

  }




  const resultado =
    interpretarTabela(
      tabela
    );




  if(resultado.error){


    throw new Error(
      resultado.error
    );

  }





  parsedPotential =
    resultado.rows;



  unidadeDetectada =
    resultado.unidade;




  if(!unidadeDetectada){


    throw new Error(
      'Não consegui identificar a unidade.'
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





  if(
    !Number.isFinite(estoque1) ||
    !Number.isFinite(estoque2) ||
    !Number.isFinite(estoque3) ||
    !Number.isFinite(estoqueAtual)
  ){


    throw new Error(
      'Informe os estoques das últimas horas e o atual.'
    );


  }






  return {


    dataHora:
      new Date()
      .toISOString(),



    horaAtual:
      getHoraAtual(),



    unidade:{


      chave:
        unidadeDetectada.chave,


      nome:
        unidadeDetectada.nome,


      nominal:
        unidadeDetectada.nominal


    },




    nominal:
      unidadeDetectada.nominal,




    potencial:
      parsedPotential,




    estoque:{


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
   RENDER KPIS
========================================================= */


function renderizarKPIs(calculos){


  if(!calculos){

    return;

  }




  if($('kpiStock')){


    $('kpiStock').textContent =
      formatarNumero(
        calculos.estoqueAtual
      );


  }





  if($('kpiTrend')){


    const valor =
      Number(
        calculos.tendenciaEstoque
      );



    $('kpiTrend').textContent =
      Number.isFinite(valor)
      ? valor.toFixed(1)
      : '-';


  }





  if($('kpiSafeMoagem')){


    $('kpiSafeMoagem').textContent =
      formatarNumero(
        calculos.moagemSeguraMedia
      );


  }





  if($('kpiRiskHour')){


    $('kpiRiskHour').textContent =
      calculos.horaRisco ||
      '-';


  }



}







/* =========================================================
   GERAR PLANO DE VOO
========================================================= */


async function gerarPlanoVoo(){



  const botao =
    $('generateButton');



  try{



    const dados =
      montarDados();





    if(botao){

      botao.disabled = true;

    }




    if($('generateText')){


      $('generateText').textContent =
      'ANALISANDO CENÁRIO...';


    }




    if($('loadingArea')){


      $('loadingArea')
      .classList
      .remove('hidden');


    }





    const resposta =
      await fetch(
        '/api/plano-voo',
        {


          method:'POST',


          headers:{


            'Content-Type':
            'application/json'


          },


          body:
          JSON.stringify(dados)


        }
      );







    const resultado =
      await resposta.json();






    if(!resposta.ok){


      throw new Error(
        resultado.error ||
        'Erro no servidor.'
      );

    }







    lastAnalysisText =
      resultado.planoVoo ||
      '';







    if($('analysisText')){


      $('analysisText').textContent =
      lastAnalysisText;


    }







    renderizarKPIs(
      resultado.calculos
    );








    if($('resultArea')){


      $('resultArea')
      .classList
      .remove('hidden');


    }





  }
  catch(error){



    console.error(error);




    if($('errorMessage')){


      $('errorMessage').textContent =
      error.message;


    }




    if($('errorArea')){


      $('errorArea')
      .classList
      .remove('hidden');


    }


  }
  finally{



    if(botao){

      botao.disabled = false;

    }




    if($('generateText')){


      $('generateText').textContent =
      'GERAR PLANO DE VOO';


    }





    if($('loadingArea')){


      $('loadingArea')
      .classList
      .add('hidden');


    }


  }


}






if($('generateButton')){


  $('generateButton')
  .addEventListener(
    'click',
    gerarPlanoVoo
  );


}

/* =========================================================
   RELÓGIO
========================================================= */

function atualizarRelogio(){

  // Mantido para compatibilidade

}



/* =========================================================
   HORÁRIOS DO ESTOQUE
========================================================= */

function atualizarLabelsEstoque(){


  const agora =
    new Date();


  const hora =
    agora.getHours();



  const h1 =
    (hora - 3 + 24) % 24;


  const h2 =
    (hora - 2 + 24) % 24;


  const h3 =
    (hora - 1 + 24) % 24;



  if($('stockLabel1')){

    $('stockLabel1').textContent =
      `${String(h1).padStart(2,'0')}h`;

  }



  if($('stockLabel2')){

    $('stockLabel2').textContent =
      `${String(h2).padStart(2,'0')}h`;

  }



  if($('stockLabel3')){

    $('stockLabel3').textContent =
      `${String(h3).padStart(2,'0')}h`;

  }



  if($('stockLabel4')){

    $('stockLabel4').textContent =
      `${String(hora).padStart(2,'0')}h • ATUAL`;

  }


}



/* =========================================================
   HORA ATUAL
========================================================= */

function getHoraAtual(){

  return new Date().getHours();

}



/* =========================================================
   DISTÂNCIA HORA
========================================================= */

function horaRelativa(
  hora,
  atual
){

  let distancia =
    (hora - atual + 24) % 24;



  if(distancia > 12){

    distancia -= 24;

  }



  return distancia;

}



/* =========================================================
   HISTÓRICO
========================================================= */

function selecionarHistorico(rows){


  const atual =
    getHoraAtual();



  return rows

  .map(row=>({

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
    (a,b)=>
    b.distancia-a.distancia
  )


  .slice(0,3)


  .sort(
    (a,b)=>
    a.distancia-b.distancia
  );


}



/* =========================================================
   PROJEÇÃO
========================================================= */

function selecionarProjecao(rows){


  const atual =
    getHoraAtual();



  return rows

  .map(row=>({

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
    (a,b)=>
    a.distancia-b.distancia
  )


  .slice(0,12);


}




/* =========================================================
   PREVIEW
========================================================= */

function renderizarPreview(){


  const preview =
    $('previewArea');


  const content =
    $('previewContent');


  const badge =
    $('previewBadge');


  const status =
    $('potentialStatus');



  if(!parsedPotential.length){

    if(preview){

      preview.classList.add('hidden');

    }

    return;

  }




  const futuro =
    selecionarProjecao(
      parsedPotential
    );



  const historico =
    selecionarHistorico(
      parsedPotential
    );





  if(status){

    status.textContent =
      `✓ ${parsedPotential.length} horários identificados`;

    status.className =
      'input-status success';

  }




  if(badge){

    badge.textContent =
      unidadeDetectada
      ? unidadeDetectada.nome.toUpperCase()
      : 'IDENTIFICADA';

  }





  let html = '';




  if(unidadeDetectada){

    html += `

    <div class="preview-unit">

      <strong>
      Unidade:
      </strong>

      ${unidadeDetectada.nome}


      <br>


      <strong>
      Nominal:
      </strong>

      ${formatarNumero(
        unidadeDetectada.nominal
      )}
      t/h


    </div>

    `;

  }






  html += `

  <br>

  <strong>
  Próximas horas:
  </strong>

  <br><br>

  `;





  futuro.forEach(row=>{


    html += `

    <div class="preview-item">


      <strong>
        ${row.hora}
      </strong>


      <br>


      Potencial:
      ${formatarNumero(row.potencial)}
      t/h


      <br>


      Moagem:
      ${formatarNumero(row.moagem)}
      t/h


    </div>


    `;


  });





  if(historico.length){


    html += `

    <hr>

    <strong>
    Histórico:
    </strong>

    <br>

    `;



    historico.forEach(row=>{


      html += `

      ${row.hora}
      →
      ${formatarNumero(row.potencial)}
      /
      ${formatarNumero(row.moagem)}
      t/h

      <br>

      `;


    });


  }





  if(content){

    content.innerHTML =
      html;

  }



  if(preview){

    preview.classList.remove('hidden');

  }



}
