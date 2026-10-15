require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TON_POR_CONJ = 70;

const GEMINI_MODELS = ['gemini-2.5-flash','gemini-flash-latest','gemini-2.0-flash','gemini-2.5-flash-lite'];

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

function textoSeguro(v,l=15000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
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
  if(n.includes('UIT')) return {chave:'TANABI',...CONFIG_UNIDADES['TANABI']};
  return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
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

  let futuro = [];
  if(temFuturo){
    const baseHora = horaAtual;
    if(potF1!=null) futuro.push({hora:(baseHora+1)%24, potencial:potF1, moagem:usinaParada?0:moagemAtual});
    if(potF2!=null) futuro.push({hora:(baseHora+2)%24, potencial:potF2, moagem:usinaParada?0:moagemAtual});
    if(potF3!=null) futuro.push({hora:(baseHora+3)%24, potencial:potF3, moagem:usinaParada?0:moagemAtual});
    futuro = futuro.concat(futuroBase.filter(r=>!futuro.some(f=>f.hora===r.hora)).slice(0,10));
  } else {
    futuro = futuroBase.map(r=>({...r, moagem:usinaParada?0:moagemAtual}));
  }

  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaVoltaIdeal=null, estoqueNaVolta=0;
  const projecao=[];
  for(const row of futuro){
    const saldo = usinaParada? row.potencial : (row.potencial - row.moagem);
    estoqueProj+=saldo/TON_POR_CONJ;
    projecao.push({hora:row.hora, horaFormatada:horaFmt(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(!usinaParada && primeiraHoraRisco==null && estoqueProj < unidade.gatilho) primeiraHoraRisco=row.hora;
    if(usinaParada && horaVoltaIdeal==null){
      const meta = unidade.gatilho + 10;
      if(estoqueProj >= meta){ horaVoltaIdeal=row.hora; estoqueNaVolta=estoqueProj; }
    }
  }

  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:moagemAtual;
  const mediasFut=[potF1,potF2,potF3].filter(v=>v!=null);
  const mediaFuturoPot=mediasFut.length? mediasFut.reduce((a,b)=>a+b,0)/mediasFut.length : 0;
  const saldoFuturo=usinaParada? mediaFuturoPot : (mediaFuturoPot - moagemAtual);

  return {
    usinaParada, unidade, horaAtual, moagemAtual,
    potencialFuturo:{h1:potF1,h2:potF2,h3:potF3, media:mediaFuturoPot, temFuturo, saldoFuturo},
    estoque:{h3,h2,h1,atual, variacao:atual-h3},
    medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag},
    historico, projecaoEstoque:projecao,
    risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco},
    retorno:{horaVoltaIdeal, estoqueNaVolta, metaRetorno: unidade.gatilho+10},
  };
}

function extrairTextoGemini(data){ const partes=data?.candidates?.[0]?.content?.parts||[]; return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim(); }
async function chamarIA(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='';
  for(const modelo of GEMINI_MODELS){
    try{
      console.log(`[IA] ${modelo}`);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.28, maxOutputTokens:10000}}), signal:AbortSignal.timeout(50000)});
      const raw=await resp.text(); const data=JSON.parse(raw);
      if(!resp.ok){ ultimoErro=data?.error?.message||raw.slice(0,500); continue; }
      const texto=extrairTextoGemini(data); if(!texto) continue;
      return {texto: texto.replace(/```/g,'').trim(), modelo};
    }catch(e){ ultimoErro=e.message; continue; }
  }
  throw new Error('Falha IA: '+ultimoErro);
}

const EXEMPLOS_TODOS = `
COLEÇÃO COMPLETA DE COMUNICADOS REAIS PARA COPIAR O PADRÃO EXATAMENTE - ANALISE E COPIE O ESTILO:

EXEMPLO 1 - UIT PARADA/MOAGEM BAIXA:
De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos. Entretanto, média de entrada das últimas 3h está em apenas 664 t/h. Motivo: indisponibilidade mecânica de colhedoras próprias 16% entre 10:00 e 16:00. Frentes 325 e 330 em processo de mudança, F329 em processo de mudança, F312 e F400 com déficit por manutenção e chuva. Potencial atual abaixo de 660 t/h. Risco de redução de moagem nas próximas horas, apresentando déficit de 200t em relação à moagem prevista nas próximas 2h. Seguimos acompanhando.

EXEMPLO 2 - UIM REDUÇÃO:
Moagem reduzida para 850 t/h, indisponibilidade de colhedoras e transbordos próprios, baixa entrega das frentes F511 e F514. Pátio com 12 conjuntos. Indisponibilidade de 18% entre 16:00 e 18:00 com pico de 32% entre 19:00 e 20:00. F514 com déficit de 200t, F511 com déficit de 152t. Pátio tende a queda brusca se mantiver 850 t/h. Ideal ajustar para 750 t/h, média de saída de campo das últimas 2h apenas 661 t/h. Conforme manutenção entrar em linha e ciclo alto, podemos aumentar após 03:00. Seguimos acompanhando hora a hora.

EXEMPLO 3 - UICA RISCO TROCA TURNO:
Moagem liberada 900 t/h. Pátio que tinha 22 conjuntos às 20:00 está com 18 agora e tende a cair. Motivo indisponibilidade de 21,6% entre 19:00 e 21:00 com 3 máquinas de duas linhas em manutenção. F74 em processo de mudança, F78 finalizando área para mudança. Potencial de entrega de 800 t/h, chegada prevista de 750t até 22:00, pátio pode chegar a 14 conjuntos. Risco de redução entre 22:30 e 23:30 no próximo horário de troca de turno. Seguimos acompanhando.

EXEMPLO 4 - UISJ CHUVA:
Unidade com 18 conjuntos, 5 frentes com potencial de 400 t/h. Frente 03 finalizando mudança de área para reforma. Demais frentes paralisadas por chuva e solo úmido com avaliação após 10h. Liberação da Frente 03 com melhoria de potencial de 450 a 480 t/h a partir de 06h30. Alinhamento com Supervisor Gilberto e Cotur para início de moagem mínima de 500t às 06:00. Seguimos acompanhando.

EXEMPLO 5 - VERTENTE LIBERAÇÃO:
Previsão de liberação de moagem VER 350 t/h por volta de 09h00. A partir de 09h00 liberação da frente 247 com capacidade de 450 t/h. Indústria necessita de 3h para estabelecer condições de retomada, já em contato para antecipar preparativos e sincronismo com CTT.

EXEMPLO 6 - UICA DETALHADO:
Moagem liberada em 900 t/h, pátio contabilizando 19 conjuntos às 21:00 com tendência de queda para 15 conjuntos até 23:00 considerando potencial de entrada de 780 t/h vs saída de 900 t/h. Motivo: frente F74 em mudança, F78 com finalização de área, indisponibilidade de colhedoras de 22% entre 19:00 e 22:00. Conforme frentes entrarem em regime após 00:00, potencial deve retomar para 880 t/h possibilitando retorno para nominal 900 t/h por volta de 01:00. Risco de redução para 800 t/h entre 23:00 e 00:00 caso pátio atinja 14 conjuntos.

EXEMPLO 7 - UIT AUMENTO:
Moagem formalizada em 650 t/h com pátio de 22 conjuntos. Média de entrada últimas 3h de 820 t/h vs saída de 650 t/h, saldo positivo de 170t/h, tendência de ganho de pátio para 26 conjuntos até 10:00. Frente 325 liberada, F330 já em regime, F329 finalizando mudança com liberação prevista 08:00 com potencial adicional de 120 t/h. Condição favorável para aumento de moagem para 710 t/h nominal a partir de 09:00 e avaliação de 750 t/h após 11:00 conforme comportamento do pátio. Seguimos acompanhando.

EXEMPLO 8 - USINA PARADA ZERO:
Usina parada no momento, pátio com 8 conjuntos. Moagem zero desde 05:00 por falta de cana devido chuva generalizada e frentes em mudança. Potencial futuro previsto de 450 t/h a partir de 08:00 com liberação de frentes 247 e 251. Projeção de ganho de pátio para 12 conjuntos até 09:00 e 16 conjuntos até 11:00. Melhor janela para retomada às 09:00 com 500 t/h mínimo, subindo para nominal 750 t/h por volta de 11:30 quando pátio atingir 15 conjuntos. Alinhado com indústria e CTT para preparativos de retomada.
`;

function montarPrompt(dados, calc, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observações adicionais de campo.';
  const projTxt=calc.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Pátio projetado ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');

  const situacao = calc.usinaParada? `
  >>> USINA PARADA - MOAGEM ATUAL ZERO <<<
  Pátio atual: ${calc.estoque.atual} conj (H-3 ${calc.estoque.h3} / H-2 ${calc.estoque.h2} / H-1 ${calc.estoque.h1})
  Potencial futuro informado pelo usuário (o que ele imagina que vai entrar): +1h ${calc.potencialFuturo.h1??'-'} t/h | +2h ${calc.potencialFuturo.h2??'-'} t/h | +3h ${calc.potencialFuturo.h3??'-'} t/h | Média ${calc.potencialFuturo.media.toFixed(0)} t/h
  Projeção de formação de pátio parada: ${calc.projecaoEstoque.map(p=>`${p.horaFormatada}=${p.estoqueProjetado.toFixed(1)} conj`).join(' -> ')}
  Melhor horário para voltar calculado: ${calc.retorno.horaVoltaIdeal!=null?horaFmt(calc.retorno.horaVoltaIdeal)+` com ${calc.retorno.estoqueNaVolta.toFixed(1)} conj (meta segurança ${calc.retorno.metaRetorno} conj)`:`Ainda não atinge pátio seguro de ${calc.retorno.metaRetorno} conj nas próximas 12h`}
  ` : `
  >>> USINA MOENDO <<<
  Moagem atual alinhada (SAÍDA real formalizada): ${calc.moagemAtual} t/h
  Pátio atual: ${calc.estoque.atual} conj (H-3 ${calc.estoque.h3} -> H-2 ${calc.estoque.h2} -> H-1 ${calc.estoque.h1} -> Atual ${calc.estoque.atual}) Variação ${calc.estoque.variacao.toFixed(1)} conj
  Média histórica entrada últimas 3-4h: ${calc.medias.historicoPotencial.toFixed(0)} t/h vs moagem ${calc.medias.historicoMoagem.toFixed(0)} t/h
  Potencial futuro informado (ENTRADA que usuário projeta): +1h ${calc.potencialFuturo.h1??'-'} / +2h ${calc.potencialFuturo.h2??'-'} / +3h ${calc.potencialFuturo.h3??'-'} | Média futura ${calc.potencialFuturo.media.toFixed(0)} t/h
  Saldo futuro (entrada futura - saída atual): ${calc.potencialFuturo.saldoFuturo>=0?'+':''}${calc.potencialFuturo.saldoFuturo.toFixed(0)} t/h => ${calc.potencialFuturo.saldoFuturo>0?'TENDÊNCIA GANHO DE PÁTIO':'TENDÊNCIA PERDA DE PÁTIO'}
  Menor pátio projetado: ${calc.risco.menorEstoque.toFixed(1)} conj às ${horaFmt(calc.risco.horaMenorEstoque)}
  Primeira hora de risco gatilho <${unidade.gatilho} conj: ${calc.risco.primeiraHoraRisco!=null?horaFmt(calc.risco.primeiraHoraRisco):'sem risco nas próximas 12h'}
  `;

  return `
Você é analista sênior de CTT - COA - Plano de Voo - Usina de cana. Escreva comunicado FORMAL, TÉCNICO, DETALHADO, grande, igual aos exemplos reais.

UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal ${unidade.nominal} t/h / Mínimo ${unidade.min} t/h / Gatilho redução <${unidade.gatilho} conj
HORA ATUAL: ${horaFmt(calc.horaAtual)}
${situacao}

PROJEÇÃO HORA A HORA (use exatamente esses números, não invente):
${projTxt}

HISTÓRICO REAL:
${calc.historico.map(r=>`${horaFmt(r.hora)}: Entrada ${r.potencial.toFixed(0)} t/h / Moagem ${r.moagem.toFixed(0)} t/h`).join('\n')}

OBSERVAÇÃO DE CAMPO INFORMADA:
${comentarios}

INSTRUÇÃO DE ESCRITA - COPIE FIELMENTE O PADRÃO DOS EXEMPLOS:

1. Comece exatamente: *Comunicado ${unidade.sigla} - ${horaFmt(calc.horaAtual)}*

2. Primeiro parágrafo OBRIGATÓRIO: "De momento, a moagem da unidade está formalizada em ${calc.moagemAtual} t/h, com um pátio contabilizando ${calc.estoque.atual} conjuntos. Entretanto, média de entrada das últimas 3h está em ${calc.medias.historicoPotencial.toFixed(0)} t/h." Se moagem zero, diga "Usina parada no momento, pátio contabilizando ${calc.estoque.atual} conjuntos, sem moagem desde HH:00."

3. Segundo parágrafo: motivo detalhado usando a observação (indisponibilidade %, frentes em mudança FXXX, chuva, solo úmido, manutenção, troca de turno 07h e 19h)

4. Terceiro parágrafo: PROJEÇÃO FUTURA usando potencial futuro que usuário colocou. Se tem potencial futuro: "Considerando potencial previsto de ${calc.potencialFuturo.media.toFixed(0)} t/h para as próximas 3h vs moagem atual de ${calc.moagemAtual} t/h, com saldo de ${calc.potencialFuturo.saldoFuturo>=0?'+':''}${calc.potencialFuturo.saldoFuturo.toFixed(0)}t/h, projeção de pátio para ${calc.projecaoEstoque[2]?.estoqueProjetado.toFixed(1)??''} conjuntos às ${calc.projecaoEstoque[2]?.horaFormatada??''}"

5. Quarto parágrafo: risco e janela crítica - "Risco de redução de moagem para ${Math.round(unidade.min*1.1)} t/h entre ${calc.risco.primeiraHoraRisco!=null?horaFmt(calc.risco.primeiraHoraRisco):'XX:00'} e YY:00 caso pátio atinja ${unidade.gatilho} conjuntos" OU "Condição favorável para aumento para ${unidade.nominal} t/h a partir de ${horaFmt((calc.horaAtual+2)%24)}" OU se parada "Melhor janela para retomada às ${calc.retorno.horaVoltaIdeal!=null?horaFmt(calc.retorno.horaVoltaIdeal):'XX:00'} com ${calc.retorno.estoqueNaVolta?calc.retorno.estoqueNaVolta.toFixed(1):'XX'} conjuntos, iniciando com ${unidade.min} t/h e evoluindo para nominal ${unidade.nominal} t/h por volta de ${horaFmt((calc.horaAtual+4)%24)}"

6. Quinto parágrafo: como melhora e alinhamentos (Supervisor, COA, CTT, indústria)

7. Use linguagem formal técnica: "formalizada", "contabilizando", "indisponibilidade mecânica", "processo de mudança", "finalizando área", "paralisadas por chuva", "troca de turno", "ciclo alto", "entrar em linha"

8. Texto grande, 5 a 7 parágrafos, bem detalhado

9. Finalize: "Seguimos acompanhando hora a hora - COA CTT"

10. NÃO use gírias, NÃO use gatinho, NÃO invente número fora da projeção

EXEMPLOS COMPLETOS PARA COPIAR O PADRÃO:
${EXEMPLOS_TODOS}

Retorne APENAS o comunicado final formal.
`.trim();
}

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/health', (req,res)=> res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS}));

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)||!dados.potencial.length) return res.status(400).json({error:'Cole a tela de Análise de Potencial de Produção - sem ela não gera análise.'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'Informe estoque atual.'});
    if(dados.moagemAtual==null||dados.moagemAtual==='') return res.status(400).json({error:'Informe moagem atual. Se parada, coloque 0.'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    console.log(`[PLANO-VOO FORMAL] ${unidade.sigla} Moagem:${calculos.moagemAtual} Pátio:${dados.estoque.atual} Fut:${calculos.potencialFuturo.media.toFixed(0)} Parada:${calculos.usinaParada}`);
    const resultado=await chamarIA(prompt);
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, unidade, calculos, modelo:resultado.modelo, usinaParada:calculos.usinaParada});
  }catch(e){
    console.error('[ERRO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT,'0.0.0.0',()=>{ console.log(`PLANO DE VOO CTT FORMAL TÉCNICO TOP - PORTA ${PORT}`); });
