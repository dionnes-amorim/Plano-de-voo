require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TON_POR_CONJ = 70;

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite'
];

const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilho: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR DUPLO', difusores: 2, min: 600, gatilho: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilho: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilho: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilho: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));

function textoSeguro(v,l=12000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
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
  const moagemAtual = numeroBR(dados.moagemAtual)?? 0; // 0 = parada
  const potFut = dados.potencialFuturo || {};
  const potF1 = numeroBR(potFut.h1); const potF2 = numeroBR(potFut.h2); const potF3 = numeroBR(potFut.h3);
  const temFuturo = potF1!=null || potF2!=null || potF3!=null;
  const usinaParada = moagemAtual === 0;

  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();
  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,4);
  const futuroBase=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);

  let futuro = [];
  if(temFuturo){
    const baseHora = horaAtual;
    if(potF1!=null) futuro.push({hora:(baseHora+1)%24, potencial:potF1, moagem:usinaParada?0:moagemAtual});
    if(potF2!=null) futuro.push({hora:(baseHora+2)%24, potencial:potF2, moagem:usinaParada?0:moagemAtual});
    if(potF3!=null) futuro.push({hora:(baseHora+3)%24, potencial:potF3, moagem:usinaParada?0:moagemAtual});
    futuro = futuro.concat(futuroBase.filter(r=>!futuro.some(f=>f.hora===r.hora)).slice(0,9));
  } else {
    futuro = futuroBase.map(r=>({...r, moagem:usinaParada?0:moagemAtual}));
  }

  // Se usina parada, a projeção é só ganho de estoque
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaVoltaIdeal=null, estoqueNaVolta=0;
  const projecao=[];
  for(let i=0;i<futuro.length;i++){
    const row=futuro[i];
    const saldo = usinaParada? row.potencial : (row.potencial - row.moagem);
    estoqueProj+=saldo/TON_POR_CONJ;
    projecao.push({hora:row.hora, horaFormatada:horaFmt(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(!usinaParada && primeiraHoraRisco==null && estoqueProj < unidade.gatilho) primeiraHoraRisco=row.hora;
    // Para usina parada: melhor horário pra voltar é quando atinge gatilho + margem de segurança
    if(usinaParada && horaVoltaIdeal==null){
      const metaRetorno = unidade.gatilho + 8; // precisa ter pelo menos 8 conjuntos acima do gatilho pra voltar seguro
      if(estoqueProj >= metaRetorno){
        horaVoltaIdeal=row.hora;
        estoqueNaVolta=estoqueProj;
      }
    }
  }

  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:moagemAtual;
  const mediasFut=[potF1,potF2,potF3].filter(v=>v!=null);
  const mediaFuturoPot=mediasFut.length? mediasFut.reduce((a,b)=>a+b,0)/mediasFut.length : 0;
  const saldoFuturo=usinaParada? mediaFuturoPot : (mediaFuturoPot - moagemAtual);

  return {
    usinaParada,
    unidade, horaAtual, moagemAtual,
    potencialFuturo:{h1:potF1,h2:potF2,h3:potF3, media:mediaFuturoPot, temFuturo, saldoFuturo},
    estoque:{h3,h2,h1,atual, variacao:atual-h3, tendencia: atual>h1? 'subindo' : atual<h1? 'caindo' : 'estável'},
    medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag},
    historico, projecaoEstoque:projecao,
    risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco},
    retorno:{horaVoltaIdeal, estoqueNaVolta, metaRetorno: unidade.gatilho+8},
  };
}

function extrairTextoGemini(data){ const partes=data?.candidates?.[0]?.content?.parts||[]; return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim(); }
async function chamarIA(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='';
  for(const modelo of GEMINI_MODELS){
    try{
      console.log(`[IA] Tentando ${modelo}`);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.35, maxOutputTokens:9000}}), signal:AbortSignal.timeout(45000)});
      const raw=await resp.text(); const data=JSON.parse(raw);
      if(!resp.ok){ ultimoErro=data?.error?.message||raw.slice(0,400); continue; }
      const texto=extrairTextoGemini(data); if(!texto) continue;
      return {texto: texto.replace(/```/g,'').trim(), modelo};
    }catch(e){ ultimoErro=e.message; continue; }
  }
  throw new Error('Falha IA: '+ultimoErro);
}

const EXEMPLOS_REAIS = `
PADRÃO DE ESCRITA QUE QUEREMOS - COPIE ESSE JEITO:

1 - UIT: De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos. Entretanto, média de entrada últimas 3h está em apenas 664 t/h. Motivo: indisponibilidade mecânica colhedoras próprias 16% entre 10:00 e 16:00. Frentes 325 e 330 em mudança, F329 em mudança, F312 e F400 com pouca cana por manutenção e chuva. Potencial atual abaixo de 660 t/h. Risco de ter que reduzir moagem nas próximas horas, perdendo umas 200t em relação ao que tá moendo. Ideal é segurar.

2 - UIM: Moagem reduzida para 850 t/h, indisponibilidade de colhedoras e transbordos, baixa entrega F511 e F514. Pátio 12 conj. Indisponibilidade 18% entre 16:00 e 18:00 pico 32% 19-20h. F514 entregando 200t a menos, F511 152t a menos. Pátio tende a cair forte se manter 850 t/h. Ideal ajustar para 750 t/h, média de chegada do campo nas últimas 2h foi só 661 t/h. Conforme manutenção entrar em linha e ciclo alto, podemos aumentar depois das 03:00.

3 - UICA: Moagem liberada 900 t/h. Pátio que tinha 22 às 20:00 está 18 agora e tende cair. Motivo indisponibilidade 21,6% 19-21h 3 máquinas 2 linhas em manutenção. F74 em mudança, F78 finalizando área pra mudança. Potencial entrega 800 t/h, chegada prevista 750t até 22:00, pátio pode chegar 14 conj. Risco de ter que reduzir entre 22:30 e 23:30 bem na troca de turno.

4 - UISJ: 18 conj 5 frentes potencial 400 t/h. Frente 03 finalizando mudança reforma. Demais frentes paradas por chuva e solo úmido, avaliação depois das 10h. Liberação Frente 03 melhora potencial pra 450 a 480 t/h a partir 06h30. Alinhado com Supervisor Gilberto e Cotur início moagem mínima 500t às 06:00

5 - VER: Previsão liberação moagem VER 350 t/h por volta 09h00. A partir 09h00 liberação frente 247 capacidade 450 t/h. Indústria necessita 3h pra estabelecer condições de retomada, já em contato pra antecipar preparativos e sincronismo.

REGRAS DE OURO DA CTT:
- CCT: Corte, Carregamento e Transporte. Se falta caminhão no pátio, falta no campo. Se colhedora quebra, não tem cana.
- Troca de turno 07h e 19h sempre derruba entrega 30min depois (8h30 e 20h30 é horário crítico). Transporte escalonado ajuda.
- Frente em mudança = 2 a 4 horas sem entrega. Chuva isolada = solo úmido = máquina atolada.
- Moagem não pode ficar abaixo do mínimo senão perde eficiência e tem que parar.
- Pátio abaixo de 12 conj (ou 4 no VERTENTE) = gatilho pra reduzir moagem.
`;

function montarPrompt(dados, calc, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observação adicional.';
  const projTxt=calc.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Pátio proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');

  const situacaoParada = calc.usinaParada? `
  SITUAÇÃO ESPECIAL: USINA PARADA - MOAGEM ZERO
  Usina está parada agora. Pátio atual ${calc.estoque.atual} conj.
  Potencial futuro informado: ${calc.potencialFuturo.h1??'-'} / ${calc.potencialFuturo.h2??'-'} / ${calc.potencialFuturo.h3??'-'} t/h (média ${calc.potencialFuturo.media.toFixed(0)} t/h)
  Projeção de ganho de pátio: ${calc.projecaoEstoque.map(p=>`${p.horaFormatada}=${p.estoqueProjetado.toFixed(1)} conj`).join(' | ')}
  Melhor horário calculado para voltar: ${calc.retorno.horaVoltaIdeal!=null?horaFmt(calc.retorno.horaVoltaIdeal)+` com ${calc.retorno.estoqueNaVolta.toFixed(1)} conj (meta segura ${calc.retorno.metaRetorno} conj)`: 'ainda não atinge pátio seguro nas próximas 12h, precisa aguardar mais cana'}
  VOCÊ PRECISA DIZER EXATAMENTE QUE HORAS VOLTA A MOER, COM QUANTO DE PÁTIO, E COM QUANTO DE MOAGEM VOLTA (ex: voltar às 09:00 com 500t/h, depois sobe pra 750t/h nominal às 12:00 quando pátio estabilizar).
  ` : `
  SITUAÇÃO NORMAL: USINA MOENDO
  Moagem atual alinhada: ${calc.moagemAtual} t/h
  Pátio: ${calc.estoque.atual} conj (${calc.estoque.tendencia}, H-3 ${calc.estoque.h3} -> H-1 ${calc.estoque.h1})
  Potencial futuro que o usuário imagina: +1h ${calc.potencialFuturo.h1??'-'} / +2h ${calc.potencialFuturo.h2??'-'} / +3h ${calc.potencialFuturo.h3??'-'} t/h (média ${calc.potencialFuturo.media.toFixed(0)} t/h)
  Saldo futuro vs moagem atual: ${calc.potencialFuturo.saldoFuturo>=0?'+':''}${calc.potencialFuturo.saldoFuturo.toFixed(0)} t/h => ${calc.potencialFuturo.saldoFuturo>0?'VAI GANHAR PÁTIO':'VAI PERDER PÁTIO'}
  Menor pátio projetado: ${calc.risco.menorEstoque.toFixed(1)} conj às ${horaFmt(calc.risco.horaMenorEstoque)}
  Gatilho redução: ${calc.risco.primeiraHoraRisco!=null?horaFmt(calc.risco.primeiraHoraRisco):'sem risco nas próximas 12h'}
  `;

  return `
Você é coordenador de CTT / COA - Plano de Voo. Escreve comunicado que vai pra diretoria no WhatsApp. Linguagem simples, direta, de campo, mas com análise top de quem entende de logística CCT.

UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal ${unidade.nominal} t/h / Mínimo ${unidade.min} t/h / Gatilho reduzir ${unidade.gatilho} conj
HORA ATUAL: ${horaFmt(calc.horaAtual)}
${situacaoParada}

PROJEÇÃO HORA A HORA (use esses números, não invente):
${projTxt}

HISTÓRICO últimas 4h:
${calc.historico.map(r=>`${horaFmt(r.hora)}: Entrou ${r.potencial.toFixed(0)} / Moído ${r.moagem.toFixed(0)}`).join('\n')}

OBSERVAÇÃO DE CAMPO (por que tá assim e como melhora):
${comentarios}

COMO ESCREVER O COMUNICADO - OBRIGATÓRIO:

- Comece com *Comunicado ${unidade.sigla} - ${horaFmt(calc.horaAtual)}*

- Se usina parada (0 t/h):
  1º parágrafo: "Usina parada no momento, pátio com ${calc.estoque.atual} conjuntos. Potencial futuro de ${calc.potencialFuturo.media.toFixed(0)} t/h nas próximas 3h."
  2º: Por que parou (use observação)
  3º: Quando volta - DÊ HORA EXATA: "Melhor janela pra voltar é às ${calc.retorno.horaVoltaIdeal!=null?horaFmt(calc.retorno.horaVoltaIdeal):'XX:00'} com ${calc.retorno.estoqueNaVolta?calc.retorno.estoqueNaVolta.toFixed(1):'pátio seguro'} conjuntos, voltando com ${unidade.min} t/h e subindo pra nominal ${unidade.nominal} t/h às YY:00 quando estabilizar"
  4º: Alinhamento CTT/indústria/transporte

- Se usina moendo:
  1º: "De momento, moagem formalizada em ${calc.moagemAtual} t/h, pátio com ${calc.estoque.atual} conj (${calc.estoque.tendencia}). Média entrada últimas 3h ${calc.medias.historicoPotencial.toFixed(0)} t/h."
  2º: Motivo da baixa ou alta (frente em mudança, quebra, chuva, troca turno 07h/19h)
  3º: O que vai acontecer nas próximas horas USANDO O POTENCIAL FUTURO QUE O USUÁRIO COLOCOU: "Considerando potencial previsto de ${calc.potencialFuturo.media.toFixed(0)} t/h vs moagem atual ${calc.moagemAtual} t/h, ${calc.potencialFuturo.saldoFuturo>0?'vamos ganhar pátio, indo pra '+calc.risco.menorEstoque.toFixed(0)+' conj':'vamos perder pátio, podendo chegar a '+calc.risco.menorEstoque.toFixed(0)+' conj'}"
  4º: Recomendação prática: "Precisa reduzir para ${Math.round(unidade.min*1.1)} t/h às ${calc.risco.primeiraHoraRisco!=null?horaFmt(calc.risco.primeiraHoraRisco):'XX:00'} e segurar até ${horaFmt((calc.horaAtual+3)%24)}, depois pode voltar pra nominal ${unidade.nominal} t/h às YY:00" OU "Pode aumentar pra ${unidade.nominal} t/h às ${horaFmt((calc.horaAtual+2)%24)} porque pátio vai pra ${calc.projecaoEstoque[2]?.estoqueProjetado.toFixed(0)??''} conj"
  5º: Como melhora baseado na observação

- Use palavras simples: "pátio segurando", "chegada boa", "frente parada por chuva", "máquina quebrada", "troca de turno derruba", "precisa segurar moagem", "pode subir"

- NÃO use palavras: déficit, superávit, formal, mitigar, sinergia
- NÃO invente números que não estão na projeção
- Dê horários exatos pra aumentar, reduzir, voltar
- Fale de troca de turno 07h e 19h que é crítico na CTT
- Finalize: "Seguimos acompanhando hora a hora - COA CTT"

EXEMPLOS PRA COPIAR O JEITO:
${EXEMPLOS_REAIS}

Retorne APENAS o comunicado final pronto pra copiar no WhatsApp.
`.trim();
}

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/health', (req,res)=> res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS}));

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)||!dados.potencial.length) return res.status(400).json({error:'Cole a tabela de potencial - sem ela não tem análise.'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'Informe estoque atual.'});
    if(dados.moagemAtual==null||dados.moagemAtual==='') return res.status(400).json({error:'Informe moagem atual. Se usina parada, coloque 0.'});

    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);

    console.log(`[PLANO-VOO] ${unidade.sigla} Moagem:${calculos.moagemAtual} Pátio:${dados.estoque.atual} Fut:${calculos.potencialFuturo.media.toFixed(0)} Parada:${calculos.usinaParada}`);

    const resultado=await chamarIA(prompt);

    return res.json({
      ok:true,
      texto:resultado.texto,
      comunicado:resultado.texto,
      unidade,
      calculos,
      modelo:resultado.modelo,
      usinaParada: calculos.usinaParada,
      retorno: calculos.retorno
    });
  }catch(e){
    console.error('[ERRO PLANO-VOO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT,'0.0.0.0',()=>{ console.log(`PLANO DE VOO CTT TOP - ZERO TRATADO - PORTA ${PORT}`); });
