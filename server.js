require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TONELADAS_POR_CONJUNTO = 70;

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

function textoSeguro(v,l=10000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function horaNumero(h){ const m=String(h||'').match(/\d{1,2}/); if(!m) return null; const n=Number(m[0]); return n>=0&&n<=23?n:null; }
function horaFormatada(h){ const n=horaNumero(h); return n==null?'--':`${String(n).padStart(2,'0')}:00`; }
function horaRelativa(h,ha){ let d=(h-ha+24)%24; if(d>12) d-=24; return d; }
function numeroBR(v){ if(v==null||v==='') return null; let t=String(v).trim().replace(/[^\d.,-]/g,''); if(!t) return null; if(t.includes('.')&&t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); else if(t.includes(',')) t=t.replace(',','.'); const n=Number(t); return Number.isFinite(n)?n:null; }
function identificarUnidade(texto){
  const n=normalizarTexto(texto);
  for(const k of Object.keys(CONFIG_UNIDADES)){ if(n.includes(k)) return {chave:k,...CONFIG_UNIDADES[k]}; }
  if(n.includes('UIM')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
  if(n.includes('UICA')) return {chave:'CRUZ ALTA',...CONFIG_UNIDADES['CRUZ ALTA']};
  if(n.includes('UISJ')) return {chave:'SAO JOSE',...CONFIG_UNIDADES['SAO JOSE']};
  if(n.includes('UIV')||n.includes('VERTENTE')||n.includes('VER')) return {chave:'VERTENTE',...CONFIG_UNIDADES['VERTENTE']};
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
  const moagemAlinhada = numeroBR(dados.moagemAtual)?? unidade.nominal;
  const potFut = dados.potencialFuturo || {};
  const potF1 = numeroBR(potFut.h1); const potF2 = numeroBR(potFut.h2); const potF3 = numeroBR(potFut.h3);
  const temFuturo = potF1!=null || potF2!=null || potF3!=null;

  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();
  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,4);
  const futuroBase=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:moagemAlinhada;

  // Monta projeção futura considerando o potencial que o usuário colocou para as próximas 3h
  let futuro = [];
  if(temFuturo){
    const baseHora = horaAtual;
    if(potF1!=null) futuro.push({hora:(baseHora+1)%24, potencial:potF1, moagem:moagemAlinhada});
    if(potF2!=null) futuro.push({hora:(baseHora+2)%24, potencial:potF2, moagem:moagemAlinhada});
    if(potF3!=null) futuro.push({hora:(baseHora+3)%24, potencial:potF3, moagem:moagemAlinhada});
    // Completa com base da tabela após 3h
    futuro = futuro.concat(futuroBase.filter(r=>!futuro.some(f=>f.hora===r.hora)).slice(0,9));
  } else {
    futuro = futuroBase;
  }

  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null;
  const projecao=[];
  for(const row of futuro){
    const saldo=row.potencial-row.moagem; estoqueProj+=saldo/TONELADAS_POR_CONJUNTO;
    projecao.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
  }

  const mediaFuturoPot = temFuturo? [potF1,potF2,potF3].filter(v=>v!=null).reduce((a,b)=>a+b,0) / [potF1,potF2,potF3].filter(v=>v!=null).length : 0;
  const saldoFuturo = temFuturo? mediaFuturoPot - moagemAlinhada : 0;

  return {
    unidade, horaAtual, moagemAlinhada, potencialFuturo:{h1:potF1,h2:potF2,h3:potF3, media:mediaFuturoPot, temFuturo, saldoFuturo},
    estoque:{h3,h2,h1,atual, variacao:atual-h3},
    medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag},
    historico, projecaoEstoque:projecao,
    risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, deficit: moagemAlinhada - mediaHistPot},
    moagemSugerida: Math.round(moagemAlinhada)
  };
}

function normalizarPublicacaoIA(texto){ return String(texto||'').replace(/\r\n/g,'\n').replace(/```(?:text|markdown)?/gi,'').replace(/```/g,'').trim(); }
function obterConfigPensamento(modelo){ if(modelo.includes('3.8')||modelo.includes('flash-latest')) return { thinkingConfig:{ thinkingLevel:'high' } }; if(modelo.includes('2.5')) return { thinkingConfig:{ thinkingBudget:4096 } }; return {}; }
function extrairTextoGemini(data){ const partes=data?.candidates?.[0]?.content?.parts||[]; return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim(); }
async function chamarIA(prompt, options={}){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='Erro IA';
  for(const modelo of GEMINI_MODELS){
    const controller=new AbortController(); let timeout=null;
    try{
      console.log(`[IA] ${modelo}`);
      timeout=setTimeout(()=>controller.abort(), options.timeoutMs||45000);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const generationConfig={ temperature:0.28, maxOutputTokens:8000,...obterConfigPensamento(modelo) };
      const response=await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig}), signal:controller.signal });
      const raw=await response.text(); const data=JSON.parse(raw);
      if(!response.ok){ ultimoErro=`${modelo} ${response.status}: ${data?.error?.message||raw.slice(0,500)}`; if([400,401,403].includes(response.status)) throw new Error(ultimoErro); continue; }
      const texto=extrairTextoGemini(data); if(!texto) continue;
      return { texto: normalizarPublicacaoIA(texto), modelo };
    }catch(e){ ultimoErro=e.message; continue; } finally{ if(timeout) clearTimeout(timeout); }
  }
  throw new Error(ultimoErro);
}

const EXEMPLOS_PADRAO = `
EXEMPLO UIT: De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos. Entretanto, média de entrada últimas 3h está em apenas 664 t/h. Motivo: indisponibilidade mecânica colhedoras próprias 16% entre 10:00 e 16:00. Frentes 325 e 330 em mudança, F329 em mudança, F312 e F400 déficit por manutenção e chuva. Potencial atual abaixo de 660 t/h. Risco redução moagem próximas horas, déficit 200t em relação à moagem prevista 2h.

EXEMPLO UIM: Moagem reduzida para 850 t/h, indisponibilidade colhedoras e transbordos próprios, baixa entrega F511 e F514. Pátio 12 conj. Indisponibilidade 18% entre 16:00 e 18:00 pico 32% 19-20h. F514 déficit 200t, F511 déficit 152t. Pátio tende queda brusca se manter 850 t/h. Ideal ajustar para 750 t/h, média saída campo últimas 2h apenas 661 t/h. Conforme manutenção entrar em linha ciclo alto podemos aumentar após 03:00.

EXEMPLO UICA: Moagem liberada 900 t/h. Pátio que tinha 22 às 20:00 está 18 agora e tende cair. Motivo indisponibilidade 21,6% 19-21h 3 máquinas 2 linhas manutenção. F74 em mudança, F78 finalizando área p/ mudança. Potencial entrega 800 t/h, chegada prevista 750t até 22:00, pátio pode chegar 14 conj. Risco redução entre 22:30 e 23:30 próximo troca turno.

EXEMPLO UISJ: 18 conj 5 frentes potencial 400 t/h. Frente 03 finalizando mudança reforma. Demais frentes paralisadas chuva/solo úmido avaliação após 10h. Liberação Frente 03 melhoria potencial 450 a 480 t/h a partir 06h30. Alinhamento Supervisor Gilberto e Cotur início moagem mínima 500t às 06:00

EXEMPLO VER: Previsão liberação moagem VER 350 t/h por volta 09h00. A partir 09h00 liberação frente 247 capacidade 450 t/h. Indústria necessita 3h p/ estabelecer condições retomada, já em contato antecipar preparativos sincronismo.
`;

function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observações adicionais.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Estoque proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');
  const potFutTxt = calculos.potencialFuturo.temFuturo? `POTENCIAL FUTURO INFORMADO PELO USUÁRIO (PRÓXIMAS 3H): +1h (${horaFormatada((calculos.horaAtual+1)%24)}) ${calculos.potencialFuturo.h1??'-'} t/h | +2h (${horaFormatada((calculos.horaAtual+2)%24)}) ${calculos.potencialFuturo.h2??'-'} t/h | +3h (${horaFormatada((calculos.horaAtual+3)%24)}) ${calculos.potencialFuturo.h3??'-'} t/h | Média futura ${calculos.potencialFuturo.media.toFixed(0)} t/h | Saldo futuro vs moagem atual: ${calculos.potencialFuturo.saldoFuturo>=0?'+':''}${calculos.potencialFuturo.saldoFuturo.toFixed(0)}t/h => ${calculos.potencialFuturo.saldoFuturo>=0?'TENDÊNCIA GANHO DE ESTOQUE, POSSÍVEL AUMENTO DE MOAGEM':'TENDÊNCIA PERDA DE ESTOQUE, RISCO REDUÇÃO MOAGEM'}` : 'POTENCIAL FUTURO NÃO INFORMADO - usar apenas histórico';

  return `
Você é analista sênior CTT Plano de Voo. Escreva EXATAMENTE no padrão analítico dos exemplos.

DADOS OPERACIONAIS ATUAIS:
UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal ${unidade.nominal} t/h / Mín ${unidade.min} t/h / Gatilho <${unidade.gatilhoReducao} conj
MOAGEM ATUAL ALINHADA (SAÍDA REAL): ${calculos.moagemAlinhada} t/h - ESSA É A MOAGEM QUE ESTÁ FORMALIZADA AGORA
PÁTIO: Atual ${calculos.estoque.atual} conj (H-3 ${calculos.estoque.h3} / H-2 ${calculos.estoque.h2} / H-1 ${calculos.estoque.h1}) Variação ${calculos.estoque.variacao.toFixed(1)}
MÉDIA HISTÓRICA 3-4h: Entrada ${calculos.medias.historicoPotencial.toFixed(0)} t/h / Saída ${calculos.medias.historicoMoagem.toFixed(0)} t/h / Saldo ${calculos.medias.saldoHistorico.toFixed(0)}t/h
${potFutTxt}
MENOR ESTOQUE PROJETADO: ${calculos.risco.menorEstoque.toFixed(1)} conj às ${horaFormatada(calculos.risco.horaMenorEstoque)} | Risco gatilho: ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco 12h'}

PROJEÇÃO HORA A HORA CONSIDERANDO MOAGEM ATUAL + POTENCIAL FUTURO:
${projTxt}

HISTÓRICO:
${calculos.historico.map(r=>`${horaFormatada(r.hora)}: Entrada ${r.potencial.toFixed(0)} / Moagem ${r.moagem.toFixed(0)}`).join('\n')}

OBSERVAÇÃO ADICIONAL (MOTIVO E COMO MELHORA):
${comentarios}

REGRAS DE ESCRITA - COPIE ESTILO DOS EXEMPLOS + NOVAS INFORMAÇÕES:
1. Comece *Comunicado ${unidade.sigla}*
2. Parágrafo 1: "De momento, a moagem da unidade está formalizada em ${calculos.moagemAlinhada} t/h, com pátio contabilizando ${calculos.estoque.atual} conjuntos. Entretanto, média de entrada últimas 3h está em ${calculos.medias.historicoPotencial.toFixed(0)} t/h." SEMPRE use a moagem atual alinhada que o usuário informou.
3. Parágrafo 2: Motivo da baixa/alta usando observação adicional (indisponibilidade %, frentes em mudança, chuva, déficit por frente)
4. Parágrafo 3: PROJEÇÃO FUTURA USANDO O POTENCIAL FUTURO QUE O USUÁRIO COLOCOU. Se ele colocou potencial futuro maior que moagem atual, diga: "Considerando potencial previsto de ${calculos.potencialFuturo.media.toFixed(0)} t/h para próximas 3h vs moagem atual de ${calculos.moagemAlinhada} t/h, temos saldo positivo de ${calculos.potencialFuturo.saldoFuturo.toFixed(0)}t/h, tendência de ganho de estoque para X conjuntos, possibilitando aumento de moagem". Se for menor, diga o contrário e déficit em toneladas.
5. Parágrafo 4: Risco e janela troca turno
6. Parágrafo 5: Como melhora baseado na observação e no potencial futuro
7. Finalize com "Seguimos acompanhando hora a hora..."
8. Muito analítico, 5-6 parágrafos, com números reais de entrada, saída, pátio, déficit.

EXEMPLOS:
${EXEMPLOS_PADRAO}
Retorne APENAS comunicado final.
`.trim();
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)||!dados.potencial.length) return res.status(400).json({error:'potencial array não enviado'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'estoque atual não informado'});
    if(!dados.moagemAtual) return res.status(400).json({error:'moagem atual alinhada não informada'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    console.log(`[REQ] ${unidade.sigla} MoagemAtual ${calculos.moagemAlinhada} Pátio ${dados.estoque.atual} Fut ${calculos.potencialFuturo.media.toFixed(0)}`);
    const resultado=await chamarIA(prompt,{ maxOutputTokens:8000, timeoutMs:50000 });
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, unidade, calculos, modelo:resultado.modelo});
  }catch(e){
    console.error('[ERRO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT, '0.0.0.0', ()=>{ console.log(`PLANO DE VOO CTT UNIFICADO COM MOAGEM ATUAL + POTENCIAL 3H FUTURO - PORTA ${PORT}`); });
