require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TON_POR_CONJ = 70;
const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-flash-lite-latest'
];

const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilho: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR DUPLO', difusores: 2, min: 600, gatilho: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilho: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilho: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilho: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

function textoSeguro(v,l=15000){ return String(v||'').trim().slice(0,l); }
function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function horaNumero(h){ const m=String(h||'').match(/\d{1,2}/); if(!m) return null; const n=Number(m[0]); return n>=0&&n<=23?n:null; }
function horaFmt(h){ const n=horaNumero(h); return n==null?'--':`${String(n).padStart(2,'0')}:00`; }
function horaRelativa(h,ha){ let d=(h-ha+24)%24; if(d>12) d-=24; return d; }
function numeroBR(v){ 
  if(v==null||v==='') return null; 
  let t=String(v).trim().replace(/[^\d.,-]/g,''); 
  if(!t) return null; 
  if(t.includes('.')&&t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); 
  else if(t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); 
  else if(/^\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,''); // 1.000 = 1000
  else if(/\.\d{3}$/.test(t)) {
    const p=t.split('.');
    if(p[p.length-1].length===3) t=t.replace(/\./g,'');
  }
  const n=Number(t); 
  return Number.isFinite(n)?n:null; 
}

function identificarUnidade(texto){
  const n=normalizarTexto(texto);
  for(const k of Object.keys(CONFIG_UNIDADES)){ if(n.includes(k)) return {chave:k,...CONFIG_UNIDADES[k]}; }
  if(n.includes('UIM')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
  if(n.includes('UICA')) return {chave:'CRUZ ALTA',...CONFIG_UNIDADES['CRUZ ALTA']};
  if(n.includes('UISJ')) return {chave:'SAO JOSE',...CONFIG_UNIDADES['SAO JOSE']};
  if(n.includes('UIV')||n.includes('VERTENTE')) return {chave:'VERTENTE',...CONFIG_UNIDADES['VERTENTE']};
  if(n.includes('UIT')||n.includes('TANABI')) return {chave:'TANABI',...CONFIG_UNIDADES['TANABI']};
  return {chave:'TANABI',...CONFIG_UNIDADES['TANABI']};
}

function normalizarPotencial(lista, nominal){
  return (lista||[]).map(i=>{
    const hora=horaNumero(i.hora?? i.horaNumero);
    const pot=numeroBR(i.potencial??i.entrada)?? Number(i.potencial??i.entrada);
    const moag=numeroBR(i.moagem??i.saida)?? Number(i.moagem??i.saida);
    if(hora==null||!Number.isFinite(pot)) return null;
    return {hora, potencial:pot, moagem: Number.isFinite(moag)?moag:nominal};
  }).filter(Boolean).sort((a,b)=>a.hora-b.hora);
}

function calcularCenario(dados, unidade){
  const potencial=normalizarPotencial(dados.potencial, unidade.nominal);
  const est=dados.estoque||{};
  const atual=Number(est.atual)||0;
  const h1=Number(est.h1||atual); const h2=Number(est.h2||h1); const h3=Number(est.h3||h2);
  const moagemAtual = numeroBR(dados.moagemAtual)?? 0;
  const potFut = dados.potencialFuturo || {};
  const potF1 = numeroBR(potFut.h1); const potF2 = numeroBR(potFut.h2); const potF3 = numeroBR(potFut.h3);
  const temFuturo = potF1!=null || potF2!=null || potF3!=null;
  const usinaParada = moagemAtual === 0;
  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();

  // CORRECAO PRINCIPAL: usa ultimas linhas coladas, nao relogio do PC
  const historicoReal = potencial.slice(-5);
  const historico3h = potencial.slice(-3);

  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const futuroBase=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,14);
  
  let futuro=[];
  if(temFuturo){
    const baseHora=horaAtual;
    if(potF1!=null) futuro.push({hora:(baseHora+1)%24, potencial:potF1, moagem:usinaParada?0:moagemAtual});
    if(potF2!=null) futuro.push({hora:(baseHora+2)%24, potencial:potF2, moagem:usinaParada?0:moagemAtual});
    if(potF3!=null) futuro.push({hora:(baseHora+3)%24, potencial:potF3, moagem:usinaParada?0:moagemAtual});
    futuro=futuro.concat(futuroBase.filter(r=>!futuro.some(f=>f.hora===r.hora)).slice(0,10));
  } else { futuro=futuroBase.map(r=>({...r, moagem:usinaParada?0:moagemAtual})); }
  
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaVoltaIdeal=null, estoqueNaVolta=0;
  const projecao=[];
  for(const row of futuro){
    const saldo=usinaParada? row.potencial : (row.potencial-row.moagem);
    estoqueProj+=saldo/TON_POR_CONJ;
    const estoqueSeguro = Math.max(0, estoqueProj);
    projecao.push({hora:row.hora, horaFormatada:horaFmt(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueSeguro});
    if(estoqueSeguro<menorEstoque){ menorEstoque=estoqueSeguro; horaMenor=row.hora; }
    if(!usinaParada && primeiraHoraRisco==null && estoqueSeguro < unidade.gatilho) primeiraHoraRisco=row.hora;
    if(usinaParada && horaVoltaIdeal==null){ const meta=unidade.gatilho+10; if(estoqueSeguro>=meta){ horaVoltaIdeal=row.hora; estoqueNaVolta=estoqueSeguro; } }
  }
  const mediaHistPot=historico3h.length?historico3h.reduce((t,r)=>t+r.potencial,0)/historico3h.length:0;
  const mediaHistMoag=historico3h.length?historico3h.reduce((t,r)=>t+r.moagem,0)/historico3h.length:moagemAtual;
  const mediasFut=[potF1,potF2,potF3].filter(v=>v!=null);
  const mediaFuturoPot=mediasFut.length? mediasFut.reduce((a,b)=>a+b,0)/mediasFut.length : 0;
  const saldoFuturo=usinaParada? mediaFuturoPot : (mediaFuturoPot-moagemAtual);
  return {usinaParada, unidade, horaAtual, moagemAtual, potencialFuturo:{h1:potF1,h2:potF2,h3:potF3, media:mediaFuturoPot, temFuturo, saldoFuturo}, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag}, historico:historicoReal, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco}, retorno:{horaVoltaIdeal, estoqueNaVolta, metaRetorno:unidade.gatilho+10}};
}

function extrairTextoGemini(data){ const partes=data?.candidates?.[0]?.content?.parts||[]; return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim(); }

async function chamarIA(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='';
  for(const modelo of GEMINI_MODELS){
    try{
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const resp=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contents:[{parts:[{text:prompt}]}],
          generationConfig:{
            temperature: 0.28,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 3500
          }
        }),
        signal:AbortSignal.timeout(60000)
      });
      const raw=await resp.text();
      const data=JSON.parse(raw);
      if(!resp.ok){ ultimoErro=data?.error?.message||raw.slice(0,800); continue; }
      const texto=extrairTextoGemini(data);
      if(!texto || texto.length < 900){ ultimoErro='Texto muito simples/curto, tentando próximo modelo'; continue; }
      return {texto:texto.replace(/```/g,'').trim(), modelo};
    }catch(e){ ultimoErro=e.message; continue; }
  }
  throw new Error('Falha IA: '+ultimoErro);
}

const EXEMPLOS_TODOS = `
COLEÇÃO COMPLETA DE COMUNICADOS REAIS PARA COPIAR O PADRÃO EXATAMENTE - MESMO PADRÃO DE ESCRITA:

EXEMPLO 1 - Comunicado UIT:
De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 664 t/h.
O principal motivo da baixa entrega é a indisponibilidade mecânica das colhedoras próprias, que apresentou média de 16% entre 10:00 e 16:00, impactando diretamente a produtividade das frentes.
Além da indisponibilidade, ao decorrer do dia ocorreram as mudanças das frentes 325 e 330. De momento, a F329 está em processo de mudança, todas sendo frentes próprias. Já as F312 e F400 apresentam déficit de entrega devido à manutenção das colhedoras, sendo que, durante o dia, a F400 também permaneceu paralisada por um período devido à chuva na área.
Com a mudança da F329, o potencial atual das frentes está abaixo de 660 t/h. Conforme demonstrado no gráfico acima, há risco de redução da moagem nas próximas horas, visto que temos um déficit de aproximadamente 200 toneladas de entrega em relação à moagem prevista para as próximas duas horas.
Seguimos acompanhando o cenário hora a hora e, em conjunto com a supervisão da unidade, iremos realizar os ajustes necessários conforme a evolução da operação.

EXEMPLO 2 - Comunicado UIM:
No momento, a moagem da unidade está reduzida para 850 t/h, devido à indisponibilidade de colhedoras e transbordos próprios, além da baixa entrega das F511 e F514. O pátio está contabilizando 12 conjuntos carregados.
O principal ponto de atenção da unidade é a indisponibilidade mecânica dos equipamentos próprios, que apresentou média de 18% entre 16:00 e 18:00, com pico de 32% nas colhedoras próprias entre 19:00 e 20:00.
Além das manutenções próprias, a F514 está com déficit de 200 toneladas em relação à cota projetada para a moagem, enquanto a F511 apresenta déficit de 152 toneladas.
Conforme apresentado no gráfico acima, o pátio tende a apresentar uma queda brusca caso mantenhamos a moagem em 850 t/h. Dessa forma, o ideal neste momento é ajustarmos a moagem para 750 t/h, considerando que a média de saída de campo das últimas duas horas está em apenas 661 t/h, o que deve resultar em uma chegada de cana mais baixa nas próximas duas horas.
Conforme o cenário de manutenção de colhedoras entrar em linha, devido ao ciclo alto, podemos analisar um aumento da moagem após às 03:00.
Seguimos acompanhando o cenário hora a hora e, caso a indisponibilidade das colhedoras permaneça elevada, poderá ser necessária uma nova redução da moagem para a rotação mínima da unidade.

EXEMPLO 3 - Comunicado UICA:
A moagem da unidade está liberada para 900 t/h. Entretanto, o pátio, que contabilizava 22 conjuntos às 20:00, está com 18 conjuntos neste momento e tende a cair mais nas próximas horas.
O principal motivo para a queda do estoque é a indisponibilidade mecânica de colhedoras próprias, que atingiu média de 21,6% entre 19:00 e 21:00, com 03 máquinas de duas linhas em manutenção.
Além da indisponibilidade de colhedoras, a F74 está em processo de mudança, enquanto a F78 está finalizando a área para realizar a mudança, impactando ainda mais o potencial de entrega da unidade.
No momento, o potencial de entrega está em aproximadamente 800 t/h, com uma chegada prevista de 750 toneladas até às 22:00. Caso essa chegada se confirme, o pátio poderá chegar a aproximadamente 14 conjuntos carregados.
Diante desses pontos, caso a indisponibilidade permaneça elevada, existe risco de redução da moagem entre 22:30 e 23:30, próximo à troca de turno.
Seguimos acompanhando o cenário da unidade junto a supervisão da unidade e reforçando o alinhamento com a indústria, buscando manter a moagem o mais próximo possível das 900 t/h.

EXEMPLO 4 - Comunicado UISJ:
No momento, estamos com 18 conjuntos carregados e 5 frentes em operação, com potencial de entrega de aproximadamente 400 t/h.
A Frente 03 está finalizando a mudança para a área de reforma. As demais frentes encontram-se paralisadas devido à chuva/solo úmido, com nova avaliação das áreas prevista para ocorrer após as 10h00.
Com a liberação da Frente 03, estimamos uma melhoria no potencial de entrega, atingindo entre 450 a 480 t/h a partir das 06h30, conforme demonstrado no gráfico acima.
Em alinhamento com o Supervisor Gilberto e a Cotur, foi definido o início da moagem com a mínima de 500 t para ás 06:00

EXEMPLO 5 - Comunicado VER:
Em análise das condições das frentes de colheita e considerando a disponibilidade da indústria, temos a previsão de liberação da moagem na VER em aproximadamente 350 t/h por volta das 09h00.
A partir das 09h00, com a liberação da frente 247, a capacidade de produção agrícola deverá se elevar para aproximadamente 450 t/h.
Considerando que a indústria necessita de cerca de 3 horas para estabelecer as condições necessárias para retomada da moagem, já estamos em contato para antecipar os preparativos e garantir o melhor sincronismo entre a disponibilidade agrícola e industrial.
No gráfico acima demonstramos como esse alinhamento se desenha ao longo das próximas horas, considerando as previsões de produção, estoque e ritmo de moagem.

EXEMPLO 6 - Comunicado UIM:
No momento, a moagem da UIM está liberada para nominal, porém a média das últimas 3 horas está em 999 t/h. Diante disso, foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta.
Atualmente, está sendo realizada mudança parcial das frentes 501, 505, 506 e 542. A mudança da F506 está próxima e, posteriormente, após à troca de turno, será realizada mudança também da F503.
Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal, evitando uma redução ainda maior, visto que a partir das 19:00 a tendência é de queda na entrega.
Como pode ser observado no gráfico acima, o pátio contabiliza no momento 11 conjuntos carregados, com tendência de nova redução nas próximas horas, gerando risco iminente de redução de moagem até as 21:00.
Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem nominal, mesmo operando com o pátio em nível baixo.
Outro fator crítico para a quebra de ciclo será a troca de turno do transporte, prevista uma para às 18:00 e 21:00 de hoje, e outra 06:00 do dia 10/05. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções.

EXEMPLO 7 - Comunicado UIM:
De momento, a moagem da unidade está formalizada em 900 t/h, com um pátio contabilizando 15 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 785 t/h.
O principal motivo da baixa entrega está relacionado à indisponibilidade mecânica de transbordos próprios, que apresentou média de 14% entre 12:00 e 15:00, além de 2 colhedoras em manutenção preventiva. Também tivemos impacto da chuva isolada na F502 e F503.
Além da indisponibilidade, a frente F506 está em processo de mudança para área de reforma, enquanto a F501 apresenta déficit de 180 toneladas em relação à cota projetada devido ao solo úmido.
Conforme apresentado no gráfico acima, mantendo a moagem em 900 t/h o pátio tende a cair para aproximadamente 11 conjuntos até às 23:00. Dessa forma, o ideal seria ajustar a moagem para 800 t/h entre 22:00 e 01:00.
Conforme as frentes entrarem em ciclo e a manutenção dos transbordos entrar em linha após 01:30, poderemos avaliar o retorno para nominal de 917 t/h.
Seguimos acompanhando hora a hora junto à supervisão da unidade.

EXEMPLO 8 - Comunicado UICA:
No momento, a moagem da unidade está reduzida para 850 t/h, devido à baixa entrega das frentes F73 e F76 e à indisponibilidade de caminhões. O pátio está contabilizando 13 conjuntos carregados.
O principal ponto de atenção é a frente F76, que está com baixo rendimento devido à alta impureza vegetal e solo úmido, além da F73 que está em processo de mudança parcial.
A indisponibilidade mecânica de colhedoras atingiu 18,5% entre 13:00 e 16:00, com 2 máquinas paradas em manutenção. Somado a isso, temos 8 caminhões em tempo de troca de turno das 18:00.
Conforme demonstrado no gráfico acima, com o potencial atual de 780 t/h vs moagem de 850 t/h, o pátio deve chegar a 10 conjuntos até às 21:00. Caso esse cenário se confirme, existe risco de nova redução para 750 t/h entre 21:30 e 22:30.
Em alinhamento com a supervisão, a liberação da F74 está prevista para 19:30 com potencial adicional de 90 t/h, o que deve elevar o potencial total para 870 t/h e possibilitar o retorno para 900 t/h por volta das 00:00.

EXEMPLO 9 - Comunicado UIT:
De momento, a moagem da unidade está formalizada em 680 t/h, com um pátio contabilizando 22 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em 790 t/h, apresentando saldo positivo.
O principal motivo do ganho de pátio está relacionado à liberação da frente 326 com alta produtividade e o reinício da frente 331 após mudança concluída às 10:00.
Atualmente, todas as frentes próprias estão em operação com indisponibilidade baixa, de apenas 4% no período. O ciclo de transporte também está ajustado com 6 caminhões alocados acima do necessário.
Conforme apresentado no gráfico acima, o cenário é favorável para aumento de moagem. Com pátio em 22 conjuntos e tendência de chegar a 26 conjuntos até às 16:00, podemos avaliar o aumento para nominal de 710 t/h a partir das 14:00 e posterior avaliação para 750 t/h após 17:00, caso a entrega se mantenha acima de 800 t/h.
Seguimos acompanhando e reforçando o alinhamento com a indústria para garantir o melhor aproveitamento do potencial agrícola.

EXEMPLO 10 - Comunicado UISJ:
No momento, estamos com 9 conjuntos carregados e 4 frentes em operação, com potencial de entrega de aproximadamente 380 t/h. A moagem está formalizada em 550 t/h mínima.
O principal motivo para o baixo potencial é a paralisação das frentes F12 e F15 devido à chuva nas áreas, com avaliação de solo prevista somente após as 14h00. Além disso, a F10 está finalizando a mudança para área de reforma.
A frente F08, que é a única em cana de alta produtividade, está apresentando 25% de impureza devido ao acamamento da cana, reduzindo o rendimento das colhedoras.
Conforme demonstrado no gráfico acima, mantendo a moagem em 550 t/h com entrada de 380 t/h, o pátio tende a zerar até às 18:00. Dessa forma, existe risco iminente de parada da unidade entre 18:00 e 19:00, coincidindo com a troca de turno do transporte.
Em alinhamento com o Supervisor Gilberto, foi definido que após avaliação, e caso validação do trajeto e colheita, a liberação da F12 ocorrerá às 15:00 com potencial de 120 t/h, elevando o total para 500 t/h e permitindo a retomada com 500 t/h mínima por volta das 16:00.

EXEMPLO 11 - Comunicado VER:
Em análise das condições atuais, a moagem da unidade está formalizada em 420 t/h, com pátio contabilizando 6 conjuntos carregados. A média de entrada das últimas 3 horas está em 385 t/h.
O principal ponto de atenção é a frente 251, que está finalizando a área e deve entrar em processo de mudança às 16:00, reduzindo o potencial em aproximadamente 150 t/h. A frente 247 está com baixa produtividade devido à cana de segundo corte com alta palha.
Conforme apresentado no gráfico acima, caso ocorra a mudança da F251 sem a liberação imediata da F253, o potencial deve cair para 320 t/h, gerando déficit de 100 t/h em relação à moagem atual. Com isso, o pátio deve cair para 3 conjuntos até às 19:00, entrando na zona de risco da unidade.
Diante disso, o ideal seria reduzir a moagem para 350 t/h a partir das 16:30 até 19:30, aguardando a liberação da frente 253 prevista para 19:00. Após a liberação, o potencial deve retomar para 450 t/h, possibilitando o aumento para 480 t/h nominal por volta das 20:30.
Seguimos acompanhando junto à supervisão e à indústria.

EXEMPLO 12 - Comunicado UIM:
A moagem da unidade está liberada para 917 t/h nominal. Entretanto, o pátio que contabilizava 18 conjuntos às 08:00 está atualmente com 12 conjuntos e tendência de queda brusca.
O principal motivo é a troca de turno do transporte prevista para 07:00 e 19:00. Conforme histórico, das 08:30 às 10:00 temos queda de aproximadamente 30% na chegada de cana devido à quebra de ciclo dos caminhões.
Somado a isso, a frente F542 está em mudança total e a F505 em mudança parcial, reduzindo o potencial em 220 t/h no período da manhã.
Conforme gráfico acima, o pátio deve atingir 8 conjuntos até às 11:00. Dessa forma, existe risco de redução da moagem para 800 t/h entre 11:00 e 12:00. Conforme o transporte entrar em ciclo após 11:30 e a liberação da F542 prevista para 12:00, o potencial deve voltar para 880 t/h, permitindo o retorno para moagem nominal de 917 t/h por volta das 13:00.
Reforçando alinhamento com CTT para agilizar o alinhamento do ciclo.

EXEMPLO 13 - Comunicado UICA:
De momento, a moagem da unidade está formalizada em 750 t/h, com pátio contabilizando 21 conjuntos carregados. Média de entrada das últimas 3 horas em 920 t/h, com saldo positivo de 170 t/h.
O cenário de ganho de pátio é devido à normalização do ciclo das frentes F71 e F72 após mudança concluída no período da manhã e à baixa indisponibilidade, que está em apenas 3% entre 10:00 e 15:00.
Atualmente temos 4 frentes em cana de alta produtividade com peso estimado acima de 90 toneladas por carga, o que aumenta o potencial de entrega para 920 t/h vs cota de 900 t/h.
Conforme demonstrado no gráfico acima, o pátio tende a chegar a 26 conjuntos até às 18:00 caso mantenhamos 750 t/h. Diante disso, temos condição favorável para aumento de moagem para 850 t/h a partir das 16:00 e retorno para nominal de 900 t/h entre 18:00 e 19:00, antes da troca de turno.
Seguimos acompanhando e já alinhado com a indústria para o aumento gradativo.

EXEMPLO 14 - Comunicado UIT:
No momento, a moagem da unidade está parada, com pátio contabilizando 5 conjuntos carregados. Moagem parada desde às 04:30 devido à falta de cana por chuva em todas as frentes.
O principal motivo da paralisação é o solo úmido. Somente a frente F330 está com condição parcial de colheita, mas com produtividade baixa de 45 t/h.
Em alinhamento com o Supervisor da unidade, a avaliação de solo está prevista para 08:00. Caso o solo apresente condição, a liberação das frentes F322 e F324 ocorrerá a partir das 09:00, elevando o potencial para 350 t/h.
Conforme gráfico acima, considerando o potencial de 350 t/h a partir das 09:00, o pátio deve atingir 10 conjuntos até às 10:30. Dessa forma, a melhor janela para retomada da moagem seria às 10:30 com moagem mínima de 400 t/h, evoluindo para 600 t/h por volta das 13:00 quando o pátio atingir 16 conjuntos, e posterior retorno para nominal de 710 t/h após 15:00.
Já estamos em contato com a indústria para os preparativos de retomada, que necessita de 2 horas para estabelecer as condições.

EXEMPLO 15 - Comunicado UISJ:
No momento, a moagem da unidade está formalizada em 700 t/h, com pátio contabilizando 7 conjuntos carregados. Média de entrada das últimas 3 horas em 580 t/h, abaixo da moagem atual.
O principal ponto de atenção é a frente F14 que está com quebra de colhedora desde às 12:00, com previsão de retorno às 16:00. Além disso, a frente F09 está em processo de mudança e a F11 com baixa produtividade por cana bisada.
A indisponibilidade de transbordos está em 15% entre 13:00 e 15:00, impactando o ciclo de colheita e gerando 6 caminhões em atraso no malhador.
Conforme apresentado no gráfico acima, com déficit de 120 t/h entre entrada e saída, o pátio deve cair para 4 conjuntos até às 17:30, atingindo a zona de risco no estoque da unidade. Caso esse cenário se mantenha, existe risco de redução para 550 t/h mínima entre 17:30 e 18:30.
Conforme a manutenção da colhedora da F14 entrar em linha e a liberação da F09 prevista para 17:00, o potencial deve retomar para 680 t/h, possibilitando o retorno para 700 t/h por volta das 19:00.
Seguimos acompanhando hora a hora.

EXEMPLO 16 - Comunicado VER:
A unidade se encontra com a moagem parada no momento, pátio contabilizando 2 conjuntos carregados. Moagem parada desde às 02:00 por falta de cana e manutenção programada na indústria.
Atualmente temos apenas 2 frentes disponíveis, 245 e 246, ambas em processo de mudança. A liberação da frente 247, que é a principal frente com 60% do potencial da unidade, está prevista para 07:30 com potencial de 280 t/h. Já a frente 248 tem liberação prevista para 09:00 com mais 150 t/h.
Considerando que a indústria informou que necessita de 3 horas para retomada após liberação agrícola, e que o pátio atual é de apenas 2 conjuntos.
Conforme gráfico acima, com entrada de 280 t/h a partir das 07:30, o pátio deve chegar a 6 conjuntos até às 09:30 e a 10 conjuntos até às 11:30 com a entrada da F248. Dessa forma, a melhor janela para retomada seria às 09:30 com 350 t/h mínima e evolução para nominal de 500 t/h por volta das 12:00 quando o pátio estabilizar acima de 12 conjuntos.
Alinhamento já realizado com CTT e indústria para sincronismo.

EXEMPLO 17 - Comunicado UIM:
No momento, a moagem da unidade está reduzida para 850 t/h, devido à indisponibilidade de colhedoras e transbordos próprios, além da baixa entrega das F511 e F514. O pátio está contabilizando 12 conjuntos carregados.
O principal ponto de atenção da unidade é a indisponibilidade mecânica dos equipamentos próprios, que apresentou média de 18% entre 16:00 e 18:00, com pico de 32% nas colhedoras próprias entre 19:00 e 20:00.
Além das manutenções próprias, a F514 está com déficit de 200 toneladas em relação à cota projetada para a moagem, enquanto a F511 apresenta déficit de 152 toneladas.
Conforme apresentado no gráfico acima, o pátio tende a apresentar uma queda brusca caso mantenhamos a moagem em 850 t/h. Dessa forma, o ideal neste momento é ajustarmos a moagem para 750 t/h, considerando que a média de saída de campo das últimas duas horas está em apenas 661 t/h, o que deve resultar em uma chegada de cana mais baixa nas próximas duas horas.
Conforme o cenário de manutenção de colhedoras entrar em linha, devido ao ciclo alto, podemos analisar um aumento da moagem após às 03:00.
Seguimos acompanhando o cenário hora a hora e, caso a indisponibilidade das colhedoras permaneça elevada, poderá ser necessária uma nova redução da moagem para a rotação mínima da unidade.

EXEMPLO 18 - Comunicado UIM
Em análises realizadas, a moagem da unidade está liberada para 917 t/h. Entretanto, a média de entrada das últimas 3 horas está em 780 t/h, enquanto o pátio, que contabilizava 22 conjuntos carregados às 13:00, está atualmente com 10 conjuntos.
O principal motivo da baixa entrega está relacionado à indisponibilidade mecânica das colhedoras próprias, que apresentou média de 27% entre 11:00 e 16:00, além das manutenções de transbordos, que registraram 12% no mesmo período. Também estamos sentindo o reflexo das mudanças das frentes 511 e 506.
Conforme apresentado no gráfico acima, o cenário ideal neste momento seria ajustar a moagem para 750 t/h, visto que temos 10 caminhões em atraso no malhador e nenhuma frente com carga pronta.
Conforme houver melhora nas indisponibilidades e o ciclo das frentes forem alinhados, poderemos avaliar um possível aumento para 800 t/h entre 19:00 e 20:00.
Seguiremos acompanhando o cenário hora a hora, buscando aproveitar o máximo potencial de entrega da unidade.

EXEMPLO 19 - Comunicado UIM:
De momento, a moagem da unidade está formalizada em 850 t/h, com um pátio contabilizando 9 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 620 t/h.
O principal motivo da baixa entrega é a indisponibilidade mecânica de colhedoras próprias, que apresentou média de 22% entre 09:00 e 13:00, com 3 máquinas paradas por quebra de faquinha. Além disso, a F508 está em processo de mudança total desde às 11:00.
Além das manutenções, a frente F511 está com déficit de 210 toneladas em relação à cota devido à cana deitada e com alta impureza, reduzindo o rendimento das colhedoras de 85 t/h para 52 t/h.
Conforme apresentado no gráfico acima, mantendo a moagem em 850 t/h o pátio tende a zerar até às 16:30. Dessa forma, o ideal neste momento é ajustarmos a moagem para 700 t/h a partir das 14:00 até 17:00, aguardando o retorno das colhedoras.
Conforme o cenário de manutenção entrar em linha e a liberação da F508 prevista para 16:30 com potencial de 140 t/h, poderemos avaliar um aumento para 800 t/h por volta das 18:00.

EXEMPLO 20 - Comunicado UICA:
A moagem da unidade está liberada para 900 t/h, porém o pátio que contabilizava 20 conjuntos às 14:00 está atualmente com 13 conjuntos e tendência de queda.
O principal ponto de atenção é a frente F79, que entrou em mudança, e a frente F77 que está paralisada por falta de caminhão no campo. Temos 12 caminhões no pátio aguardando carretas, o que está gerando cargas prontas nas frentes.
A indisponibilidade de transbordos está em 19% entre 14:00 e 16:30, impactando diretamente o ciclo da F79 e F77. O peso médio estimado caiu de 88 toneladas para 62 toneladas por carga.
Conforme gráfico acima, com potencial atual de 720 t/h vs moagem de 900 t/h, o pátio deve chegar a 9 conjuntos até às 18:30, próximo à troca de turno das 19:00. Existe risco de redução para 750 t/h entre 18:30 e 20:00.
Em alinhamento com a supervisão, a liberação da F79 está prevista para 18:00, com potencial adicional de 110 t/h, elevando o total para 830 t/h e permitindo manter a moagem em 800 t/h até 22:00 e retorno para nominal após 23:00 quando o ciclo normalizar.

EXEMPLO 21 - Comunicado UIT:
No momento, a moagem da unidade está formalizada em 710 t/h nominal, com pátio contabilizando 17 conjuntos carregados. Média de entrada das últimas 3 horas em 695 t/h, praticamente equilibrada com a moagem.
O cenário de equilíbrio é devido à frente F333 que já entrou em ciclo 12:00 após mudança concluída, compensando a queda de rendimento da F320 que está em cana de baixa colheitabilidade. A indisponibilidade geral está baixa, em 6% no turno.
Conforme apresentado no gráfico acima, mantendo o equilíbrio entre entrada de 695 t/h e a moagem de 710 t/h, o pátio deve se manter entre 15 e 17 conjuntos até às 20:00, sem risco de redução.
Entretanto, temos como ponto de atenção a troca de turno do transporte das 19:00, que historicamente reduz a chegada em 18% entre 20:00 e 21:00. Caso essa queda se confirme, o pátio poderá chegar a 12 conjuntos por volta das 21:30.
Diante disso, recomendamos manter a moagem em 710 t/h e reforçar o alinhamento com o CTT para garantir o retorno rápido dos caminhões após a troca de turno, buscando manter a moagem nominal durante toda a noite.

EXEMPLO 22 - Comunicado UISJ:
De momento, a moagem da unidade está formalizada em 650 t/h, com pátio contabilizando 14 conjuntos carregados. Média de entrada das últimas 3 horas em 710 t/h, com saldo positivo de 60 t/h.
O principal motivo do ganho de pátio é a liberação da frente F16, com cana de alta produtividade de 110 t/ha e potencial de 180 t/h adicional, além da F13 que retornou de manutenção às 11:00.
Atualmente temos 6 frentes em operação, todas com peso médio acima de 75 toneladas e ciclo de caminhões ajustado com 2 caminhões extras alocados para cobrir a troca de turno das 18:00.
Conforme gráfico acima, com entrada de 710 t/h vs moagem de 650 t/h, o pátio deve chegar a 18 conjuntos até às 17:00. Dessa forma, temos condição favorável para aumento de moagem para 700 t/h a partir das 16:00 e avaliação de 750 t/h nominal entre 19:00 e 20:00, antes da troca de turno.
Seguimos acompanhando e alinhado com a indústria para aumento gradativo, garantindo que o pátio não ultrapasse 20 conjuntos para não perdermos oportunidade de moer mais.

EXEMPLO 23 - Comunicado UIM:
No momento, a moagem da unidade está reduzida para 750 t/h, devido à baixa entrega das frentes F504 e F509. O pátio está contabilizando 8 conjuntos carregados, abaixo da zona de risco no estoque da unidade.
O principal ponto de atenção é a F504, que está com solo úmido devido à chuva de 22mm registrada entre 02:00 e 05:00, impossibilitando a operação das colhedoras. A F509 está em mudança para área de reforma e só deve liberar após 15:00.
A indisponibilidade mecânica está em 24% entre 05:00 e 09:00, com pico de 35% nas colhedoras próprias entre 07:00 e 08:00, reflexo da operação em solo úmido que está gerando embuchamento na operação de colheita.
Conforme demonstrado no gráfico acima, com potencial atual de apenas 580 t/h vs moagem de 750 t/h, o pátio deve chegar a 4 conjuntos até às 13:00. Caso a condição de solo não melhore, existe risco de parada da unidade entre 13:30 e 14:30.
Em alinhamento com a supervisão agrícola, foi definido que a avaliação de solo ocorrerá às 12:00. Caso libere, a F504 deve retornar com potencial de 150 t/h a partir das 13:00, elevando o total para 730 t/h e permitindo manter a moagem em 700 t/h até 18:00. O retorno para nominal de 917 t/h só será possível após 20:00 quando todas as frentes estiverem com o ciclo de caminhões alinhado.
Seguimos acompanhando hora a hora.

EXEMPLO 22 - Comunicado UIM:
De momento, a moagem da unidade está formalizada em 800 t/h, com um pátio contabilizando 11 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 745 t/h.
O principal motivo da baixa entrega é o atraso no retorno de caminhões do pátio para o campo, com 14 caminhões parados no pátio entre 10:00 e 12:00 devido à lentidão no descarregamento. Isso gerou falta de caminhão nas frentes F501 e F502.
Além do gargalo no pátio, a frente F542 está em processo de mudança parcial e a F506 com déficit de 130 toneladas devido à manutenção de 1 colhedora que está em troca de facas.
Conforme apresentado no gráfico acima, mantendo a moagem em 800 t/h com entrada de 745 t/h, o pátio tende a cair para 8 conjuntos até às 15:00. Dessa forma, o ideal seria ajustar para 750 t/h entre 14:30 e 17:00.
Conforme o giro de pátio normalizar e a liberação da F506 prevista para 16:00, o potencial deve retornar para 820 t/h, possibilitando o retorno para 850 t/h por volta das 18:00, antes da troca de turno das 19:00.

EXEMPLO 24 - Comunicado UICA:
No momento, a moagem da unidade está formalizada em 880 t/h, com pátio contabilizando 16 conjuntos carregados. Média de entrada das últimas 3 horas em 865 t/h, praticamente equilibrada.
O ponto de atenção da unidade é a previsão de chuva na região da F75 entre 17:00 e 19:00. Atualmente todas as frentes estão em ciclo e com indisponibilidade baixa de 5% entre 12:00 e 15:00.
A frente F78 que estava em mudança finalizou às 13:30 e já está alinhando seu ciclo com potencial de 145 t/h, compensando a queda de rendimento da F73 que entrou em finalização de área.
Conforme gráfico acima, mantendo moagem em 880 t/h com entrada de 865 t/h, o pátio deve se manter estável entre 14 e 16 conjuntos até às 20:00. Caso a chuva prevista se confirme na F75, existe risco de perda de 120 t/h de potencial entre 18:00 e 21:00, podendo levar o pátio para 11 conjuntos.
Dessa forma, recomendamos manter a moagem em 880 t/h e em caso de chuva, avaliar redução para 800 t/h entre 19:00 e 21:00, com retorno para 900 t/h nominal após 22:00 quando a frente F80 liberar, conforme já alinhado com a supervisão.

EXEMPLO 25 - Comunicado UIT:
De momento, a moagem da unidade está reduzida para 650 t/h, devido à baixa entrega das frentes F312 e F327. O pátio está contabilizando 10 conjuntos carregados.
O principal motivo é a manutenção em 2 colhedoras da F312 que apresentaram quebra de elevador, com previsão de retorno somente às 15:30. A F327 está em cana bisada com alta palha, reduzindo o rendimento para 40 t/h.
A indisponibilidade mecânica atingiu 19% entre 11:00 e 14:00, com pico de 28% entre 12:00 e 13:00.
Conforme demonstrado no gráfico acima, com potencial atual de 580 t/h vs moagem de 650 t/h, o pátio deve chegar a 6 conjuntos até às 17:00. Existe risco de nova redução para 600 t/h mínima entre 17:00 e 18:00, coincidindo com a troca de turno.
Conforme as colhedoras da F312 entrarem em linha e a liberação da frente F335 prevista para 17:00 com potencial de 130 t/h, o potencial total deve subir para 710 t/h, possibilitando o retorno para nominal de 710 t/h por volta das 18:30 e avaliação de 750 t/h após 20:00.

EXEMPLO 26 - Comunicado VER:
De momento, a moagem da unidade está formalizada em 380 t/h, com pátio contabilizando 8 conjuntos carregados. Média de entrada das últimas 3 horas em 420 t/h.
O ganho de pátio está relacionado à frente 252 que está em cana de alta produtividade com média de 95 t por carga e à frente 249 que retornou de manutenção preventiva às 09:00 com potencial adicional de 80 t/h.
Atualmente a indisponibilidade está em apenas 2% e temos 5 caminhões alocados, sendo que o necessário é de 4.
Conforme gráfico acima, com entrada de 420 t/h vs moagem de 380 t/h, o pátio deve chegar a 12 conjuntos até às 16:00. Dessa forma, temos condição favorável para aumento de moagem para 450 t/h a partir das 14:30 e avaliação de 500 t/h nominal entre 17:00 e 18:00.
Seguimos acompanhando junto à supervisão e indústria para garantir o aumento de moagem.

EXEMPLO 27 - Comunicado UISJ:
No momento, a moagem da unidade está formalizada em 600 t/h, com pátio contabilizando 12 conjuntos carregados. Média de entrada das últimas 3 horas em 625 t/h.
O principal ponto de atenção é a frente F17 que está em processo de mudança para área de reforma e deve liberar somente às 18:00. A frente F18 está com baixo rendimento devido à cana acamada e com impureza vegetal de 18%.
A indisponibilidade de colhedoras está em 12% entre 10:00 e 13:00, dentro da meta, porém a F10 está com déficit de 90 toneladas devido ao seu raio maior, pois está colhendo a 28 km da usina.
Conforme apresentado no gráfico acima, mantendo a moagem em 600 t/h com entrada de 625 t/h, o pátio deve se manter entre 12 e 14 conjuntos até às 19:00, sem risco imediato de redução.
Entretanto, com a troca de turno do transporte das 19:00, existe histórico de queda de 22% na chegada entre 20:00 e 21:30. Caso essa queda se confirme, o pátio poderá chegar a 9 conjuntos até às 22:00. Dessa forma, recomendamos manter 600 t/h e avaliar aumento para 700 t/h somente após 22:30 quando alinhar o ciclo dos caminhões e a F17 liberar.
Alinhamento já realizado com Cotur e Supervisor Gilberto.
`;

function montarPrompt(dados, calc, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'';
  const temObs = comentarios && comentarios.trim().length > 5;
  const projTxt=calc.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Pátio ${Math.max(0,Math.round(r.estoqueProjetado))} conj`).join('\n');
  const histTxt=calc.historico.map(r=>`${horaFmt(r.hora)}: Entrada ${r.potencial.toFixed(0)} / Saída ${r.moagem.toFixed(0)}`).join('\n');
  const pAtioMenorInt = Math.max(0, Math.round(calc.risco.menorEstoque));
  const pAtioAtualInt = Math.round(calc.estoque.atual);
  const projecaoZerou = calc.risco.menorEstoque <= 0;

  return `
VOCE E ANALISTA SENIOR COA CTT - TEREOS. ANALISE COMPLEXA COERENTE.

Unidade: ${unidade.nome} (${unidade.sigla}) - Nominal ${unidade.nominal} t/h
Hora Atual: ${horaFmt(calc.horaAtual)}
Moagem: ${calc.moagemAtual} t/h
Patio Atual: ${pAtioAtualInt} conj (variacao ${Math.round(calc.estoque.variacao)} conj)
Media 3h entrada: ${calc.medias.historicoPotencial.toFixed(0)} t/h vs moagem ${calc.moagemAtual} t/h = saldo ${(calc.medias.historicoPotencial - calc.moagemAtual).toFixed(0)} t/h
Futuro medio 3h: ${calc.potencialFuturo.media.toFixed(0)} t/h vs moagem ${calc.moagemAtual} t/h = saldo futuro ${calc.potencialFuturo.saldoFuturo.toFixed(0)} t/h
Menor patio projetado: ${pAtioMenorInt} conj as ${horaFmt(calc.risco.horaMenorEstoque)} ${projecaoZerou ? '(PROJECAO ZEROU - RISCO DE PARADA)' : ''}
Zona de risco interna (NAO CITE NUMERO): ${unidade.gatilho} conj

PROJECAO (PATlO NUNCA NEGATIVO - ZERO SIGNIFICA PARADA):
${projTxt}

HISTORICO RECENTE (CONSIDERE SO ULTIMAS 3 A 5H, IGNORE >6H):
${histTxt}

OBSERVACAO REAL DO CAMPO - UNICA FONTE DE CAUSA. CITE APENAS O QUE ESTIVER AQUI. SE NAO TIVER MANUTENCAO, NAO FALE DE MANUTENCAO. SE NAO TIVER FRENTE, NAO FALE DE FRENTE. NAO EXPLIQUE QUE NAO TEM, APENAS NAO CITE:
${temObs ? comentarios : 'Sem observacao adicional. Analise apenas numeros.'}

=== REGRAS SAGRADAS ===

1. TAMANHO: 1200 a 1800 caracteres.

2. ESTRUTURA 5 PARAGRAFOS + TITULO COM LIGACAO OBRIGATORIA:

LINHA 1: *Comunicado ${unidade.sigla}*

PARAGRAFO 1: Comecar com "De momento, a moagem da unidade esta formalizada em ${calc.moagemAtual} t/h, com um pátio contabilizando ${pAtioAtualInt} conjuntos carregados. Enquanto, a média de entrada das ultimas 3 horas esta em ${calc.medias.historicoPotencial.toFixed(0)} t/h e a moagem em ${calc.moagemAtual} t/h". Se moagem 0, use "No momento, a moagem da unidade esta parada..."

PARAGRAFO 2: Comecar com "O principal motivo da baixa entrega é" OU "O principal ponto de atenção da unidade é". REGRA FIRME: CITE APENAS O QUE ESTA NA OBSERVAÇÃO. Não invente manutenção, não invente maquina, não invente frente. Se observação tem "F329 em mudança", cite. Se tem "16% colhedora", cite. Se observação vazia, fale apenas "variação na entrega entre as frentes" sem inventar motivo. NUNCA diga "como não tem manutenção na observação..." apenas cite o que tem. Segunda frase com "Além da..." s se tiver segunda causa na observação.

PARAGRAFO 3: Comecar com "Conforme apresentado no gráfico acima,". Use media: "com potencial de ${calc.potencialFuturo.media.toFixed(0)} t/h vs moagem de ${calc.moagemAtual} t/h, o pátio tende a chegar a ${pAtioMenorInt} conjuntos até às ${horaFmt(calc.risco.horaMenorEstoque)}". REGRA DO PATIO ZERO: patio nunca pode ser negativo. Se projeção chegar a zero, significa parada da unidade. Então a recomendação de redução tem que vir ANTES de zerar. Quando entrar na zona de risco, ja tem que reduzir a moagem conforme potencial estimado. Ex: "existe risco de reducao para 700 t/h entre 18:00 e 19:00" ou "risco de parada entre 18:00 e 19:00 caso mantenha". Depois solução coerente: "Dessa forma, o ideal é ajustarmos a moagem para X t/h entre HH:00 e HH:00" e "Conforme as frentes entrarem em ciclo ${temObs ? '(se citado na observação, cite manutenção retornando)' : ''}, poderemos avaliar retorno para nominal de ${unidade.nominal} t/h por volta das HH:00". Se solo úmido/chuva na observação, não fale nominal.

PARAGRAFO 4: Apresente uma solução para a observação, caso haja alguma, dizendo que vamos fazer o contrário do que estiver. Se for baixa entrega de frentes, diga que solicitamos uma melhora no rendimento, se for manutenção diga que estamos constantemente em contato com a manutenção da unidade para alinharmos a melhor estratégia de liberação de equipamentos, se for mudança diga que estamos alinhando o ciclo da frente o mais rápido possível quando finalizar mudança para melhorarmos produção, se for tudo pode comentar um pouco de cada, e se for solo úmido só fala que estamos constantemente olhando as oportunidades.

PARAGRAFO 5: "Seguimos acompanhando o cenário hora a hora junto a supervisão da unidade e reforçando o alinhamento com a indústria."

3. NUMEROS: PATIO SEMPRE INTEIRO E NUNCA NEGATIVO. Zero = parada. Use ${pAtioMenorInt} conj.

4. VOCABULARIO PERMITIDO: frente, frentes, estoque, patio, conjuntos carregados, moagem, entrada, saida, potencial, mudanca, indisponibilidade mecanica, colhedora, transbordo, caminhao, troca de turno, quebra de ciclo, deficit, cota, risco, reducao, aumento, nominal, grafico acima, supervisao, industria, CTT, Cotur.

5. VOCABULARIO PROIBIDO: gatilho, frentes de corte, cessamento, h1, h2, h3, precipitacao pluviometrica, regime, escoamento, escoar, volumetria, materia-prima, residual, throughput, lastro, otimizacao, sinergia, premissa, mitigar, performance, suprimento de cana, encharcado, historica, generalizadas, deficit numerico.

6. ZONA DE RISCO: Nao cite numero. Se patio projetado < 14, diga "entra na zona de risco" ou "abaixo da zona de risco". Se >20, nem mencione zona de risco.

7. COERENCIA: Paragrafo 1 ao 5 tem que se ligar. Nao pode falar que perde patio e depois falar que vai subir sem motivo.

8. JANELA: Ultimas 3 a 6h + estoque + futuro 3h. Ignore >7h.

9. SE NO GERAL, POTENCIAL FOR MAIOR QUE MOAGEM MÉDIA E ESTOQUE PROJETAR UMA MALHORA, RECOMENDE AUMENTAR MOAGEM. SE JÁ ESTIVER NA NOMINAL, RECOMENDE MOER ACIMA E SUGIRA O AUMENTO, SEMPRE DE 50 A 100 T/H ATÉ BATER COM O POTENCIAL DE ENTREGA DAS FRENTES.

10. OUTRA COISA, TEM QUE TER COERÊNCIA EM TUDO NA ANÁLISE, SEMPRE DIGA QUE AS PRÓXIMAS HORAS É REFENTE A ANÁLISE EM CIMA DO POTENCIAL, O QUE ACONTECEU É COM BASE NO REALIZADO, AS PRÓXIMAS HORAS É UMA ANÁLISE DE POTENCIAL, NÃO GARANTIDO, MAS NÃO PRECISA FALAR ISSO, APENAS DEIXAR CLARO QUE AS PRÓXIMAS HORAS É DE ACORDO COM O POTENCIAL.
SE A ENTRADA MÉDIA FOR MENOR QUE A MOAGEM FORMALIZADA OU MENOR QUE A MOAGEM REALIZADA, SUGIRA REDUÇÃO SE TIVER NA ZONA DE RISCO NO ESTOQUE. SE MOAGEM REALIZADA ESTIVER ACIMA DA MOAGEM FORMALIZADA E NÃO TIVER NA ZONA DE RISCO, SUGIRA UM AJUSTE DE MOAGEM PARA A FORMALIZADA E NÃO MOER ACIMA PARA EVITAR REDUÇÃO. SE NÃO TIVER JEITO AI TEM QUE REDUZIR MOAGEM MESMO, MAS JÁ BOLE UMA ESTRATÉGIA PARA VOLTAR PARA NOMINAL O QUANTO ANTES, APROVEITANDO CADA GANHO DE ESTOQUE.
SEJA SEMPRE ANALÍTICO E APROVEITE CADA JANELA, A PROJEÇÃO DE CADA HORA FUTURA QUE O ESTOQUE MELHORAR, SUGIRA AUMENTO DE MOAGEM, FALE SEMPRE O NÚMERO QUE FOR AUMENTAR E REDUZIR E A HORA EXATA TAMBÉM DA SUGESTÃO, PARA SER ANALÍTICO AO EXTREMO.

EXEMPLOS SO PARA PALAVREADO:
${EXEMPLOS_TODOS}

INSTRUCAO FINAL: Coerente, sem inventar, sem falar que nao tem observacao. Cite so o que tem na observacao. Se projecao zerar, recomende reducao antes. Retorne APENAS comunicado.
`;
}

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/health', (req,res)=> res.json({ok:true, gemini:!!GEMINI_API_KEY}));
app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)||!dados.potencial.length) return res.status(400).json({error:'Cole a tela de Análise de Potencial - tabela Hora a Hora Transporte'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'Informe estoque atual'});
    if(dados.moagemAtual==null||dados.moagemAtual==='') return res.status(400).json({error:'Informe moagem atual (0 se parada)'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    console.log(`[PLANO-VOO COMPLEXO] ${unidade.sigla} Moagem:${calculos.moagemAtual} Pátio:${dados.estoque.atual} Fut:${calculos.potencialFuturo.media.toFixed(0)} Deficit:${(calculos.medias.historicoPotencial - calculos.moagemAtual).toFixed(0)}`);
    const resultado=await chamarIA(prompt);
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, unidade, calculos, modelo:resultado.modelo, usinaParada:calculos.usinaParada});
  }catch(e){ console.error('[ERRO]', e.message); return res.status(500).json({error:e.message}); }
});
app.listen(PORT,'0.0.0.0',()=>{ console.log(`PLANO DE VOO CTT - ANALISE COMPLEXA ATIVA - PORTA ${PORT}`); });
