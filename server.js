require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TON_POR_CONJ = 70;
const GEMINI_MODELS = ['gemini-2.5-flash','gemini-flash-latest','gemini-2.0-flash'];

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
function numeroBR(v){ if(v==null||v==='') return null; let t=String(v).trim().replace(/[^\d.,-]/g,''); if(!t) return null; if(t.includes('.')&&t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); else if(t.includes(',')) t=t.replace(',','.'); const n=Number(t); return Number.isFinite(n)?n:null; }

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

// PARSER NOVO QUE VOLTOU A FUNCIONAR - LÊ TABELA TANABI HORA A HORA TRANSPORTE
function parseTabelaTransporte(texto){
  if(!texto||texto.length<20) return null;
  const linhas=texto.split('\n');
  let dados=[];
  for(let line of linhas){
    let t=line.trim(); if(!t) continue;
    let lower=t.toLowerCase();
    if(lower.includes('hora')&&lower.includes('máquinas')) continue;
    if(lower.startsWith('total')) continue;
    if(lower.includes('safra')||lower.includes('filial')||lower.includes('tipo')||lower.includes('data')||lower.includes('controlada')) continue;

    // Pega hora formato 00 - 01, 08 - 09, 15 - 16
    const hm=t.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
    if(!hm) continue;
    const horaIni=Number(hm[1]);
    if(horaIni<0||horaIni>23) continue;

    // Extrai todos números, tratando vírgula BR
    // O formato é: Máquinas Tratores Restrição Cota Despacho Cam.Nec Cam.Aloc Saída Cam Peso Estim Entrada Cam Entrada(t) Saída(t)
    // Os 2 últimos são ENTRADA e SAÍDA que importam
    const rawNums = t.match(/[\d.,]+/g);
    if(!rawNums||rawNums.length<3) continue;

    // Converte BR
    const nums=rawNums.map(s=>{
      let v=s.trim();
      if(v.includes(',')&&v.includes('.')){
        // 1.234,56 -> 1234.56
        return Number(v.replace(/\./g,'').replace(',','.'));
      } else if(v.includes(',')){
        // 0,1 -> 0.1
        return Number(v.replace(',','.'));
      } else {
        return Number(v);
      }
    }).filter(n=>Number.isFinite(n));

    if(nums.length<2) continue;

    // Últimos 2 números são Entrada(t) e Saída(t) conforme print
    const entrada=nums[nums.length-2];
    const saida=nums[nums.length-1];

    // Valida - até se for 0 é válido, mas filtra lixo muito alto
    if(entrada>=0&&entrada<10000&&saida>=0&&saida<10000){
      dados.push({
        hora: `${String(horaIni).padStart(2,'0')} - ${String((horaIni+1)%24).padStart(2,'0')}`,
        horaNumero: horaIni,
        entrada: entrada,
        saida: saida,
        potencial: entrada,
        moagem: saida
      });
    }
  }
  if(dados.length<3) return null;
  return {dados};
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
  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,6);
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
    projecao.push({hora:row.hora, horaFormatada:horaFmt(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(!usinaParada && primeiraHoraRisco==null && estoqueProj < unidade.gatilho) primeiraHoraRisco=row.hora;
    if(usinaParada && horaVoltaIdeal==null){ const meta=unidade.gatilho+10; if(estoqueProj>=meta){ horaVoltaIdeal=row.hora; estoqueNaVolta=estoqueProj; } }
  }
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:moagemAtual;
  const mediasFut=[potF1,potF2,potF3].filter(v=>v!=null);
  const mediaFuturoPot=mediasFut.length? mediasFut.reduce((a,b)=>a+b,0)/mediasFut.length : 0;
  const saldoFuturo=usinaParada? mediaFuturoPot : (mediaFuturoPot-moagemAtual);
  return {usinaParada, unidade, horaAtual, moagemAtual, potencialFuturo:{h1:potF1,h2:potF2,h3:potF3, media:mediaFuturoPot, temFuturo, saldoFuturo}, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag}, historico, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco}, retorno:{horaVoltaIdeal, estoqueNaVolta, metaRetorno:unidade.gatilho+10}};
}

function extrairTextoGemini(data){ const partes=data?.candidates?.[0]?.content?.parts||[]; return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim(); }
async function chamarIA(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='';
  for(const modelo of GEMINI_MODELS){
    try{
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.28, maxOutputTokens:10000}}), signal:AbortSignal.timeout(50000)});
      const raw=await resp.text(); const data=JSON.parse(raw);
      if(!resp.ok){ ultimoErro=data?.error?.message||raw.slice(0,500); continue; }
      const texto=extrairTextoGemini(data); if(!texto) continue;
      return {texto:texto.replace(/```/g,'').trim(), modelo};
    }catch(e){ ultimoErro=e.message; continue; }
  }
  throw new Error('Falha IA: '+ultimoErro);
}

const EXEMPLOS_TODOS = `
COLEÇÃO COMPLETA DE COMUNICADOS REAIS PARA COPIAR O PADRÃO EXATAMENTE - FORMAL TÉCNICO:

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
No momento, a moagem da unidade está formalizada em 920 t/h, com o pátio contabilizando 16 conjuntos carregados. Entretanto, a média de entrega das últimas 3 horas está em 845 t/h, indicando uma tendência de redução do estoque nas próximas horas.
O principal fator que impacta a operação é a indisponibilidade mecânica das colhedoras próprias, que apresentou média de 19% entre 18:00 e 21:00. Além disso, as Frentes 507 e 516 estão em processo de mudança, reduzindo temporariamente o potencial produtivo da unidade.
A Frente 521 também apresenta déficit de aproximadamente 180 toneladas em relação à sua cota prevista, em função de paradas operacionais registradas ao longo do turno.
Conforme demonstrado no gráfico acima, caso a moagem seja mantida em 920 t/h, o pátio pode atingir níveis críticos durante a madrugada. Dessa forma, estamos avaliando junto à indústria um ajuste temporário para 850 t/h até a recomposição das frentes em mudança.
Seguimos monitorando a operação em tempo real e revisaremos o cenário conforme a evolução da manutenção e das mudanças de área.

EXEMPLO 8 - Comunicado UIM - para retorno de moagem:
Em análise do cenário operacional da unidade, o pátio contabiliza atualmente 32 conjuntos carregados, volume suficiente para suportar a retomada das operações industriais.
Ao longo do período em que a moagem permaneceu paralisada, as frentes de colheita mantiveram a produção, possibilitando a formação de estoque estratégico no pátio. Neste momento, a unidade apresenta potencial de entrega próximo de 780 t/h, com as principais frentes operando dentro da normalidade.
Em alinhamento com a supervisão da unidade e equipe industrial, está programada a liberação da moagem para às 14h00, com ritmo inicial de 700 t/h, visando garantir uma retomada segura e equilibrada entre consumo industrial e disponibilidade agrícola.
Conforme demonstrado no gráfico acima, mesmo após o início da moagem, o estoque deverá permanecer em nível confortável durante as próximas horas, permitindo acompanhar a estabilização da unidade sem risco imediato de desabastecimento.
Caso as condições operacionais se mantenham conforme o planejado e a entrega agrícola permaneça acima de 750 t/h, poderemos avaliar novos incrementos de moagem ao longo do turno, aproximando gradativamente a operação da capacidade desejada.
Seguimos acompanhando o cenário junto às equipes agrícola e industrial para garantir o melhor sincronismo entre a retomada da moagem e a disponibilidade de matéria-prima da unidade.

EXEMPLO 9 - Comunicado VER:
Em análise das condições atuais da operação, a moagem da unidade poderá ser elevada gradativamente para 420 t/h a partir das 13:00, acompanhando a recuperação da disponibilidade agrícola.
As Frentes 241 e 245 já estão operando normalmente, enquanto a Frente 252 encontra-se em fase final de manutenção e deverá retornar à operação nas próximas horas.
O principal limitador neste momento é a baixa disponibilidade de equipamentos de apoio, especialmente tratores de apoio e transbordos, que reduziram a capacidade de escoamento da produção durante o período da manhã.
De acordo com as projeções apresentadas no gráfico acima, a retomada da Frente 252 deverá elevar o potencial da unidade para aproximadamente 520 t/h, permitindo maior estabilidade entre produção agrícola e consumo industrial.
Permanecemos alinhados com as equipes agrícola e industrial para garantir o melhor aproveitamento da capacidade operacional disponível e otimizar o abastecimento da moagem ao longo do turno.

EXEMPLO 10 - Comunicado UIT
No momento, a moagem da unidade está formalizada em 740 t/h, com o pátio contabilizando 17 conjuntos carregados. Entretanto, a média de entrega das últimas 3 horas encontra-se em 685 t/h, indicando redução gradativa do estoque.
O principal impacto na operação é a indisponibilidade mecânica de colhedoras próprias, que apresentou média de 15% entre 13:00 e 18:00. Além disso, a F327 encontra-se em processo de mudança, enquanto a F331 opera com apenas uma máquina devido à manutenção corretiva em andamento.
A F315 também apresenta déficit acumulado de aproximadamente 140 toneladas em relação à sua cota prevista para o turno.
Conforme demonstrado no gráfico acima, caso a moagem seja mantida no ritmo atual, o pátio poderá atingir níveis críticos durante a próxima troca de turno. Seguimos avaliando junto à indústria a necessidade de ajuste temporário da moagem para preservar a estabilidade operacional da unidade.

EXEMPLO 11 - Comunicado UICA
A moagem da unidade encontra-se em 880 t/h, com o pátio contabilizando 21 conjuntos carregados. Entretanto, observamos tendência de redução nas próximas horas devido à queda de produtividade das frentes agrícolas.
O principal ponto de atenção é a indisponibilidade de colhedoras próprias, que atingiu 24% entre 20:00 e 22:00, impactando diretamente as frentes 73 e 81.
Além disso, a F79 iniciou mudança de área no início da noite, enquanto a F72 opera em ritmo reduzido devido às condições de tráfego interno.
Com base nas projeções atuais, a chegada prevista para as próximas duas horas está em aproximadamente 1.500 toneladas, valor inferior à necessidade para sustentar a moagem atual. Caso o cenário permaneça inalterado, existe possibilidade de redução da moagem após às 00h00.
Seguimos monitorando a recuperação das frentes e alinhando as ações junto à supervisão para minimizar impactos ao abastecimento industrial.

EXEMPLO 12 - Comunicado UIM
No momento, a moagem da unidade está ajustada em 800 t/h e o pátio contabiliza 13 conjuntos carregados.
As Frentes 504 e 518 apresentaram paradas ao longo do turno devido à indisponibilidade mecânica de colhedoras, que registrou média de 17% entre 09:00 e 15:00. Além disso, a F509 encontra-se em processo de mudança para uma nova área de colheita.
Como consequência desses impactos, a média de saída de campo das últimas três horas ficou em 742 t/h.
Conforme demonstrado no gráfico acima, o estoque da unidade tende a permanecer estável até o final do turno. Entretanto, caso ocorram novas manutenções não programadas, poderá ser necessário revisar o ritmo de moagem para preservar os níveis mínimos de segurança do pátio.
Seguimos acompanhando o cenário juntamente com a supervisão operacional da unidade.

EXEMPLO 13 - Comunicado VER
Em análise das condições operacionais da unidade, a moagem permanece em 380 t/h, com potencial agrícola atual próximo de 420 t/h.
A Frente 248 retornou à operação durante a madrugada após manutenção na colhedora principal, contribuindo para a recuperação gradual da produção agrícola.
Além disso, a Frente 250 concluiu sua mudança de área e iniciou colheita em novo talhão com expectativa de aumento de produtividade ao longo do dia.
Conforme demonstrado no gráfico acima, existe potencial para elevação da moagem para aproximadamente 450 t/h nas próximas horas, desde que o ritmo atual de entrega seja mantido.
Seguimos alinhados com a indústria para avaliar o melhor momento para implementação desse aumento de moagem.

EXEMPLO 14 - Comunicado UISJ
Neste momento, a unidade conta com 22 conjuntos carregados e 6 frentes em operação, apresentando potencial de entrega próximo de 520 t/h.
As condições climáticas melhoraram ao longo da madrugada, permitindo a retomada das frentes anteriormente paralisadas devido ao excesso de umidade nas áreas.
A Frente 04 finalizou sua mudança e já opera normalmente, contribuindo diretamente para o aumento do potencial produtivo da unidade.
Diante da recuperação observada nas últimas horas, a moagem poderá ser elevada gradativamente ao longo da manhã, dependendo da confirmação das entregas previstas.
Seguimos monitorando as condições das áreas e mantendo alinhamento constante entre operação agrícola e industrial.

EXEMPLO 15 - Comunicado UIM
A moagem da unidade está liberada para 950 t/h, enquanto o pátio contabiliza atualmente 19 conjuntos carregados.
Ao longo do turno, a disponibilidade dos equipamentos próprios apresentou melhora significativa, reduzindo o índice de indisponibilidade das colhedoras para 8%.
As Frentes 501, 513 e 520 operam conforme planejado e vêm apresentando desempenho acima da média prevista para o horário.
Com projeção de chegada superior a 2.000 toneladas nas próximas duas horas, o estoque da unidade tende a permanecer saudável mesmo operando próximo da capacidade nominal.
Seguimos acompanhando o desempenho operacional para avaliar a manutenção da moagem no patamar atual.

EXEMPLO 16 - Comunicado UIT
No momento, a moagem da unidade encontra-se em 690 t/h e o pátio contabiliza 11 conjuntos carregados.
A principal restrição operacional está concentrada na F322, que permanece paralisada devido à manutenção corretiva em duas colhedoras próprias.
Além disso, a F334 iniciou mudança completa de área durante o período da tarde, reduzindo o potencial de entrega da unidade para aproximadamente 620 t/h.
Conforme demonstrado no gráfico acima, existe déficit estimado de 180 toneladas para as próximas duas horas em relação à moagem programada.
Diante desse cenário, seguimos avaliando junto à indústria possíveis ajustes operacionais para preservar o abastecimento da unidade.

EXEMPLO 17 - Comunicado UICA
A moagem da unidade permanece em 920 t/h, com o pátio registrando 26 conjuntos carregados neste momento.
Durante as últimas horas houve recuperação significativa das frentes agrícolas após a liberação das colhedoras que estavam em manutenção corretiva.
As Frentes 75 e 80 retomaram sua capacidade plena de operação, elevando o potencial agrícola da unidade para aproximadamente 980 t/h.
Conforme apresentado no gráfico acima, a tendência é de crescimento gradual do estoque durante a madrugada. Dessa forma, existe possibilidade de manutenção da moagem atual sem riscos de desabastecimento.
Seguimos acompanhando o cenário junto à supervisão da unidade.

EXEMPLO 18 - Comunicado UIM - Retorno de Moagem
Em análise do cenário operacional, o pátio contabiliza atualmente 28 conjuntos carregados, após período de formação de estoque decorrente da paralisação industrial.
As frentes agrícolas mantiveram produção consistente ao longo das últimas horas, registrando média de saída de campo próxima de 860 t/h.
Diante da recuperação do estoque e da disponibilidade operacional da indústria, está prevista a retomada da moagem às 18h00 com ritmo inicial de 750 t/h.
Conforme demonstrado no gráfico acima, mesmo após o reinício das operações, o estoque deverá se manter em patamar confortável durante todo o período noturno.
Caso o desempenho das frentes permaneça conforme esperado, novos incrementos de moagem poderão ser avaliados após às 22h00.
Seguimos acompanhando o cenário em conjunto com as equipes agrícola e industrial.

EXEMPLO 19 - Comunicado VER
No momento, a unidade opera com moagem de 430 t/h e apresenta 16 conjuntos carregados disponíveis no pátio.
A Frente 246 encontra-se operando normalmente após liberação da manutenção, enquanto a Frente 251 apresenta desempenho acima do planejado para o período.
Com base no potencial atual das frentes, estimamos capacidade de produção próxima de 500 t/h ao longo das próximas horas.
As projeções indicam tendência de estabilidade do estoque, possibilitando avaliar um aumento gradual da moagem conforme disponibilidade da indústria.
Seguimos monitorando o comportamento operacional das frentes e alinhando as ações necessárias para garantir o melhor equilíbrio entre entrega agrícola e consumo industrial.
`;

function montarPrompt(dados, calc, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observações adicionais de campo.';
  const projTxt=calc.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Pátio ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');
  const situacao = calc.usinaParada? `USINA PARADA - MOAGEM ZERO - Pátio ${calc.estoque.atual} conj - Potencial futuro ${calc.potencialFuturo.media.toFixed(0)} t/h - Melhor volta ${calc.retorno.horaVoltaIdeal!=null?horaFmt(calc.retorno.horaVoltaIdeal):'a calcular'} com ${calc.retorno.estoqueNaVolta.toFixed(1)} conj` : `Moagem atual ${calc.moagemAtual} t/h - Pátio ${calc.estoque.atual} conj - Entrada média histórica ${calc.medias.historicoPotencial.toFixed(0)} t/h - Potencial futuro ${calc.potencialFuturo.media.toFixed(0)} t/h - Saldo futuro ${calc.potencialFuturo.saldoFuturo>=0?'+':''}${calc.potencialFuturo.saldoFuturo.toFixed(0)} t/h - Menor pátio proj ${calc.risco.menorEstoque.toFixed(1)} conj às ${horaFmt(calc.risco.horaMenorEstoque)} - Risco gatilho ${calc.risco.primeiraHoraRisco!=null?horaFmt(calc.risco.primeiraHoraRisco):'sem risco'}`;

  return `
Você é analista sênior COA CTT Plano de Voo. Escreva comunicado FORMAL, TÉCNICO, GRANDE, IGUAL AOS EXEMPLOS REAIS.

UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal ${unidade.nominal} t/h / Mín ${unidade.min} t/h / Gatilho <${unidade.gatilho} conj
HORA: ${horaFmt(calc.horaAtual)}
SITUAÇÃO: ${situacao}

PROJEÇÃO HORA A HORA (use esses números exatos):
${projTxt}

HISTÓRICO:
${calc.historico.map(r=>`${horaFmt(r.hora)}: Entrada ${r.potencial.toFixed(0)} / Saída ${r.moagem.toFixed(0)}`).join('\n')}

OBSERVAÇÃO CAMPO:
${comentarios}

REGRAS PARA ESCREVER IGUAL AOS EXEMPLOS - OBRIGATÓRIO:
- Comece: *Comunicado ${unidade.sigla} - ${horaFmt(calc.horaAtual)}*
- 1º parágrafo: De momento, a moagem da unidade está formalizada em ${calc.moagemAtual} t/h, com um pátio contabilizando ${calc.estoque.atual} conjuntos. Entretanto, média de entrada das últimas 3h está em ${calc.medias.historicoPotencial.toFixed(0)} t/h. Se parada: Usina parada no momento, pátio contabilizando ${calc.estoque.atual} conjuntos.
- 2º: Motivo técnico (indisponibilidade %, frentes em mudança, chuva, solo úmido, manutenção)
- 3º: Projeção futura usando potencial futuro informado (${calc.potencialFuturo.media.toFixed(0)} t/h) - se ganha ou perde pátio
- 4º: Risco com horário exato para reduzir/aumentar/voltar, usando gatilho, mas sem usar a palavra gatilho ${unidade.gatilho} conj
- 5º: Como melhora e alinhamento CTT/indústria/transporte
- 6º: Seguimos acompanhando hora a hora - COA CTT
- Texto formal, técnico, 5-7 parágrafos, grande e detalhado
- Dê horários exatos: reduzir para X t/h às HH:00, aumentar para nominal às HH:00, voltar às HH:00

EXEMPLOS PARA COPIAR:
${EXEMPLOS_TODOS}

Retorne APENAS comunicado final.
`.trim();
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
    console.log(`[PLANO-VOO] ${unidade.sigla} Moagem:${calculos.moagemAtual} Pátio:${dados.estoque.atual} Hist ${calculos.historico.length}h Fut:${calculos.potencialFuturo.media.toFixed(0)}`);
    const resultado=await chamarIA(prompt);
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, unidade, calculos, modelo:resultado.modelo, usinaParada:calculos.usinaParada});
  }catch(e){ console.error('[ERRO]', e.message); return res.status(500).json({error:e.message}); }
});
app.listen(PORT,'0.0.0.0',()=>{ console.log(`PLANO DE VOO CTT FORMAL - PARSER TANABI CORRIGIDO - PORTA ${PORT}`); });
