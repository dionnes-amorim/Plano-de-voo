/* =========================================================
   COA | PLANO DE VOO CTT
   FRONTEND CORRIGIDO
========================================================= */


/* =========================================================
   CONFIGURAÇÃO DAS UNIDADES
========================================================= */

const CONFIG_UNIDADES = {

    "MANDU": {
        nome: "Mandu",
        nominal: 917
    },

    "CRUZ ALTA": {
        nome: "Cruz Alta",
        nominal: 900
    },

    "SAO JOSE": {
        nome: "São José",
        nominal: 750
    },

    "VERTENTE": {
        nome: "Vertente",
        nominal: 500
    },

    "TANABI": {
        nome: "Tanabi",
        nominal: 710
    }

};



/* =========================================================
   DOM
========================================================= */

const $ = id =>
    document.getElementById(id);



/* =========================================================
   ESTADO GLOBAL
========================================================= */

let parsedPotential = [];

let unidadeDetectada = null;

let recognition = null;

let listening = false;

let lastAnalysisText = "";



/* =========================================================
   NORMALIZA TEXTO
========================================================= */

function normalizarTexto(texto) {

    return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"")
        .toUpperCase()
        .trim();

}



/* =========================================================
   IDENTIFICAR UNIDADE
========================================================= */

function identificarUnidade(texto){

    const normalizado =
        normalizarTexto(texto);



    for(const chave of Object.keys(CONFIG_UNIDADES)){

        if(normalizado.includes(chave)){

            return {
                chave,
                ...CONFIG_UNIDADES[chave]
            };

        }

    }


    return null;

}



/* =========================================================
   NÚMERO BR
========================================================= */

function numeroBR(valor){

    if(valor === null || valor === undefined){
        return null;
    }


    let texto =
        String(valor)
        .replace(/[^\d,.-]/g,"")
        .trim();


    if(!texto){
        return null;
    }



    if(texto.includes(".") && texto.includes(",")){

        texto =
            texto
            .replace(/\./g,"")
            .replace(",", ".");

    }

    else{

        texto =
            texto.replace(",", ".");

    }



    const numero =
        Number(texto);


    return Number.isFinite(numero)
        ? numero
        : null;

}



/* =========================================================
   EXTRAIR HORAS
   ACEITA:
   15:00
   15h
   15
========================================================= */

function extrairHorasLinha(linha){

    let horas = [];


    const padraoCompleto =
        linha.match(
            /\b([01]?\d|2[0-3])[:h][0-5]?\d?\b/gi
        );


    if(padraoCompleto){

        horas.push(
            ...padraoCompleto.map(h=>{

                let valor =
                    h.replace("h",":");

                if(!valor.includes(":")){
                    valor += ":00";
                }

                return valor;

            })
        );

    }



    if(horas.length >= 3){

        return [...new Set(horas)];

    }



    const somenteHoras =
        linha.match(
            /\b([01]?\d|2[0-3])h\b/gi
        );


    if(somenteHoras){

        horas.push(
            ...somenteHoras.map(
                h =>
                h.replace("h",":00")
            )
        );

    }



    return [...new Set(horas)];

}



/* =========================================================
   HORA PARA NÚMERO
========================================================= */

function horaNumero(hora){

    if(!hora){
        return null;
    }


    const numero =
        String(hora)
        .match(/^(\d{1,2})/);


    return numero
        ? Number(numero[1])
        : null;

}



/* =========================================================
   LOCALIZAR LINHA
========================================================= */

function encontrarLinha(linhas,padroes){

    for(const linha of linhas){

        const normalizada =
            normalizarTexto(linha);



        for(const p of padroes){

            const busca =
                normalizarTexto(p);



            if(normalizada.includes(busca)){


                return {

                    linha,

                    posicao:
                        linha.toUpperCase()
                        .indexOf(
                            busca
                        )
                        +
                        busca.length

                };

            }

        }

    }


    return null;

}



/* =========================================================
   EXTRAIR NÚMEROS DA LINHA
========================================================= */

function extrairValoresLinha(linha,posicao){

    const trecho =
        linha.substring(posicao);



    const valores =
        trecho.match(
            /-?\d+(?:[.,]\d+)?/g
        )
        || [];



    return valores
        .map(numeroBR)
        .filter(
            v=>v!==null
        );

}



/* =========================================================
   PARSER PRINCIPAL
========================================================= */

function interpretarTabela(texto){


    if(!texto.trim()){

        return {

            rows:[],

            error:
            "Cole a tabela de potencial."

        };

    }



    const linhas =
        texto
        .replace(/\r/g,"")
        .split("\n")
        .map(l=>l.trim())
        .filter(Boolean);



    const unidade =
        identificarUnidade(texto);



    let cabecalho = null;



    for(const linha of linhas){

        const horas =
            extrairHorasLinha(linha);



        if(horas.length >= 3){

            cabecalho = linha;

            break;

        }

    }



    if(!cabecalho){

        return {

            rows:[],

            unidade,

            error:
            "Não encontrei os horários da tabela."

        };

    }



    const horas =
        extrairHorasLinha(cabecalho);



    const potencialLinha =
        encontrarLinha(
            linhas,
            [
                "RITMO COLHEITA",
                "RITMO DE COLHEITA",
                "RITMO AGRICOLA",
                "RITMO AGRÍCOLA",
                "POTENCIAL AGRICOLA",
                "POTENCIAL PRODUCAO"
            ]
        );



    const industrialLinha =
        encontrarLinha(
            linhas,
            [
                "RITMO INDUSTRIAL",
                "RITMO MOAGEM",
                "MOAGEM",
                "INDUSTRIAL"
            ]
        );

/* =========================================================
   CONTINUAÇÃO PARSER DA TABELA
========================================================= */


    if(!potencialLinha){

        return {

            rows:[],

            unidade,

            error:
            "Não encontrei a linha de Ritmo Colheita ou Potencial."

        };

    }



    if(!industrialLinha){

        return {

            rows:[],

            unidade,

            error:
            "Não encontrei a linha de Ritmo Industrial."

        };

    }



    const valoresPotencial =
        extrairValoresLinha(
            potencialLinha.linha,
            potencialLinha.posicao
        );



    const valoresIndustrial =
        extrairValoresLinha(
            industrialLinha.linha,
            industrialLinha.posicao
        );



    const quantidade =
        Math.min(
            horas.length,
            valoresPotencial.length,
            valoresIndustrial.length
        );



    const rows = [];



    for(let i=0;i<quantidade;i++){


        rows.push({

            hora:
                horas[i],


            horaNumero:
                horaNumero(
                    horas[i]
                ),


            potencial:
                valoresPotencial[i],


            moagem:
                valoresIndustrial[i],


            nominal:
                unidade
                ? unidade.nominal
                : null

        });


    }



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





/* =========================================================
   PREVIEW
========================================================= */


function renderizarPreview(){


    const area =
        $("previewArea");


    const content =
        $("previewContent");


    const badge =
        $("previewBadge");


    const status =
        $("potentialStatus");



    if(!parsedPotential.length){

        if(area)
            area.classList.add("hidden");


        return;

    }



    if(status){

        status.textContent =
            `✓ ${parsedPotential.length} horários identificados`;

    }



    if(badge){

        badge.textContent =
            unidadeDetectada
            ? unidadeDetectada.nome.toUpperCase()
            : "OK";

    }



    let html = "";



    if(unidadeDetectada){

        html += `

        <div>

        <strong>
        Unidade:
        </strong>

        ${unidadeDetectada.nome}

        |

        <strong>
        Nominal:
        </strong>

        ${unidadeDetectada.nominal} t/h

        </div>

        `;

    }



    html += `

    <br>

    <strong>
    Próximos horários:
    </strong>

    <br><br>

    `;



    parsedPotential
    .slice(0,8)
    .forEach(item=>{


        html += `

        <div>

        ${item.hora}

        -

        Potencial:
        ${Math.round(item.potencial)}
        t/h

        |

        Industrial:
        ${Math.round(item.moagem)}
        t/h

        </div>

        `;


    });



    if(content){

        content.innerHTML =
            html;

    }



    if(area){

        area.classList.remove(
            "hidden"
        );

    }


}





/* =========================================================
   INPUT DA TABELA
========================================================= */


if($("potentialInput")){


    $("potentialInput")
    .addEventListener(
        "input",
        function(){


            const resultado =
                interpretarTabela(
                    this.value
                );



            if(resultado.error){


                parsedPotential=[];


                unidadeDetectada =
                    resultado.unidade || null;



                if($("potentialStatus")){

                    $("potentialStatus")
                    .textContent =
                        resultado.error;

                }


                $("previewArea")
                ?.classList
                .add("hidden");


                return;

            }




            parsedPotential =
                resultado.rows;



            unidadeDetectada =
                resultado.unidade;



            renderizarPreview();


        }
    );

}






/* =========================================================
   ESTOQUE
========================================================= */


function atualizarLabelsEstoque(){


    const agora =
        new Date();



    const h =
        agora.getHours();



    const lista = [

        h-3,

        h-2,

        h-1,

        h

    ];



    lista.forEach(
        (valor,index)=>{


            let hora =
                (valor+24)%24;



            const label =
                $("stockLabel"+(index+1));



            if(label){

                label.textContent =
                    `${String(hora)
                    .padStart(2,"0")}h`;

            }


        }
    );



}




/* =========================================================
   MONTAR PAYLOAD PARA API
========================================================= */


function montarDados(){


    const texto =
        $("potentialInput")
        .value
        .trim();



    const tabela =
        interpretarTabela(
            texto
        );



    if(tabela.error){

        throw new Error(
            tabela.error
        );

    }



    if(!tabela.unidade){

        throw new Error(
            "Unidade não identificada."
        );

    }



    const estoqueAtual =
        Number(
            $("stockCurrent").value
        );



    const h3 =
        Number(
            $("stock1").value
        );


    const h2 =
        Number(
            $("stock2").value
        );


    const h1 =
        Number(
            $("stock3").value
        );



    if(
        !Number.isFinite(estoqueAtual) ||
        !Number.isFinite(h3) ||
        !Number.isFinite(h2) ||
        !Number.isFinite(h1)
    ){

        throw new Error(
            "Informe todos os estoques."
        );

    }




    return {


        unidade:

        {

            nome:
                tabela.unidade.nome,


            nominal:
                tabela.unidade.nominal

        },


        nominal:
            tabela.nominal,


        potencial:
            tabela.rows,



        estoque:
        {

            h3,

            h2,

            h1,

            atual:
                estoqueAtual

        },



        comentarios:
            $("comments")
            ?
            $("comments").value
            :
            ""

    };


}

/* =========================================================
   FORMATAR NÚMEROS
========================================================= */


function formatarNumero(valor, casas = 0){

    if(
        valor === null ||
        valor === undefined ||
        isNaN(valor)
    ){

        return "-";

    }


    return Number(valor)
        .toLocaleString(
            "pt-BR",
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


function renderizarKPIs(calculos){


    if(!calculos){
        return;
    }



    if($("kpiStock")){

        $("kpiStock")
        .textContent =
            formatarNumero(
                calculos.estoqueAtual
            );

    }



    if($("kpiTrend")){

        const valor =
            Number(
                calculos.tendenciaEstoque
            );



        $("kpiTrend")
        .textContent =
            Number.isFinite(valor)
            ?
            `${valor > 0 ? "+" : ""}${formatarNumero(valor,1)}`
            :
            "-";

    }



    if($("kpiSafeMoagem")){

        $("kpiSafeMoagem")
        .textContent =
            formatarNumero(
                calculos.moagemSeguraMedia
            );

    }



    if($("kpiRiskHour")){

        $("kpiRiskHour")
        .textContent =
            calculos.horaRisco ||
            "-";

    }


}





/* =========================================================
   STATUS RESULTADO
========================================================= */


function renderizarStatusResultado(resultado){


    if(!$("resultStatus")){
        return;
    }



    if(resultado.unidade){


        const nome =
            typeof resultado.unidade === "string"
            ?
            resultado.unidade
            :
            resultado.unidade.nome;



        $("resultStatus")
        .textContent =
            `${nome} • Plano calculado`;

    }


}







/* =========================================================
   GERAR PLANO DE VOO
========================================================= */


async function gerarPlanoVoo(){


    const botao =
        $("generateButton");


    const texto =
        $("generateText");


    const icone =
        $("generateIcon");



    try{


        const dados =
            montarDados();



        if(botao)
            botao.disabled = true;



        if(texto)
            texto.textContent =
            "ANALISANDO...";



        if(icone)
            icone.textContent =
            "⏳";



        $("loadingArea")
        ?.classList
        .remove("hidden");



        $("resultArea")
        ?.classList
        .add("hidden");



        $("errorArea")
        ?.classList
        .add("hidden");




        const resposta =
            await fetch(
                "/api/plano-voo",
                {

                    method:"POST",

                    headers:
                    {
                        "Content-Type":
                        "application/json"
                    },


                    body:
                    JSON.stringify(
                        dados
                    )

                }
            );





        const resultado =
            await resposta.json();





        if(!resposta.ok){

            throw new Error(
                resultado.error ||
                "Erro ao gerar análise."
            );

        }





        lastAnalysisText =
            resultado.planoVoo ||
            resultado.analise ||
            "Sem retorno da IA.";





        if($("analysisText")){

            $("analysisText")
            .textContent =
                lastAnalysisText;

        }





        renderizarKPIs(
            resultado.calculos
        );



        renderizarStatusResultado(
            resultado
        );



        $("resultArea")
        ?.classList
        .remove("hidden");



        window.scrollTo({

            top:
            $("resultArea")
            ?
            $("resultArea").offsetTop
            :
            0,


            behavior:"smooth"

        });



    }
    catch(error){


        console.error(
            error
        );



        if($("errorMessage")){

            $("errorMessage")
            .textContent =
                error.message;

        }



        $("errorArea")
        ?.classList
        .remove("hidden");



    }
    finally{


        $("loadingArea")
        ?.classList
        .add("hidden");



        if(botao)
            botao.disabled=false;



        if(texto)
            texto.textContent =
            "GERAR PLANO DE VOO";



        if(icone)
            icone.textContent =
            "✦";


    }


}






/* =========================================================
   COPIAR
========================================================= */


if($("copyButton")){


    $("copyButton")
    .addEventListener(
        "click",
        async function(){


            if(!lastAnalysisText)
                return;



            try{


                await navigator.clipboard
                .writeText(
                    lastAnalysisText
                );



                this.textContent =
                    "✓ Copiado";



                setTimeout(
                    ()=>{

                        this.textContent =
                        "Copiar análise";

                    },
                    1500
                );



            }
            catch(e){

                alert(
                    "Não foi possível copiar."
                );

            }


        }
    );

}





/* =========================================================
   LIMPAR
========================================================= */


if($("clearButton")){


    $("clearButton")
    .addEventListener(
        "click",
        ()=>{


            [

                "potentialInput",
                "stock1",
                "stock2",
                "stock3",
                "stockCurrent",
                "comments"

            ]
            .forEach(id=>{

                if($(id))
                    $(id).value="";

            });



            parsedPotential=[];

            unidadeDetectada=null;

            lastAnalysisText="";



            $("previewArea")
            ?.classList
            .add("hidden");



            $("resultArea")
            ?.classList
            .add("hidden");



            $("errorArea")
            ?.classList
            .add("hidden");


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


        if($("voiceSupport")){

            $("voiceSupport")
            .textContent =
            "Reconhecimento de voz não disponível.";

        }


        return;

    }





    recognition =
        new SpeechRecognition();



    recognition.lang =
        "pt-BR";


    recognition.continuous =
        false;


    recognition.interimResults =
        true;






    recognition.onstart =
    ()=>{


        listening=true;



        $("micButton")
        ?.classList
        .add("recording");



        if($("voiceStatus"))

            $("voiceStatus")
            .textContent =
            "Ouvindo...";


    };





    recognition.onresult =
    event=>{


        let texto="";



        for(
            let i=event.resultIndex;
            i<event.results.length;
            i++
        ){


            texto +=
            event.results[i][0]
            .transcript;


        }





        if($("comments")){

            $("comments")
            .value +=
            " " + texto;

        }


    };





    recognition.onend =
    ()=>{


        listening=false;



        $("micButton")
        ?.classList
        .remove("recording");


    };



}






if($("micButton")){


    $("micButton")
    .addEventListener(
        "click",
        ()=>{


            if(!recognition)
                return;



            if(listening){

                recognition.stop();

            }
            else{

                recognition.start();

            }


        }
    );


}







/* =========================================================
   BOTÕES
========================================================= */


if($("generateButton")){


    $("generateButton")
    .addEventListener(
        "click",
        gerarPlanoVoo
    );


}





/* =========================================================
   INICIALIZAÇÃO
========================================================= */


atualizarLabelsEstoque();


configurarReconhecimento();



setInterval(
    atualizarLabelsEstoque,
    60000
);
