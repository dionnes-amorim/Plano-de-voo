require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const TONELADAS_POR_CONJUNTO = 70;

const UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

function numeroSeguro(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function textoSeguro(v,l=30000){ return String(v||'').trim().slice(0,l); }
function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function horaNumero(h){ const m=String(h||'').match(/\d{1,2}/); if(!m) return null; const n=Number(m[0]); return n>=0&&n<=23?n:null; }
function horaFormatada(h){ const n=horaNumero(h); return n==null?'--':`${String(n).padStart(2,'0')}:00`; }
function horaRelativa(h,ha){ let d=(h-ha+24)%24; if(d>12) d-=24; return d; }

function identificarUnidade(texto){
  const n=normalizarTexto(texto);
  for(const k of Object.keys(UNIDADES)){ if(n.includes(k)) return {chave:k,...UNIDADES[k]}; }
  if(n.includes('UIM')) return {chave:'MANDU',...UNIDADES['MANDU']};
  if(n.includes('UICA')) return {chave:'CRUZ ALTA',...UNIDADES['CRUZ ALTA']};
  if(n.includes('UISJ')) return {chave:'SAO JOSE',...UNIDADES['SAO JOSE']};
  if(n.includes('UIV')||n.includes('VER')) return {chave:'VERTENTE',...UNIDADES['VERTENTE']};
  if(n.includes('UIT')) return {chave:'TANABI',...UNIDADES['TANABI']};
  return null;
}
function normalizarPotencial(lista, nominal){
  return (lista||[]).map(i=>{
    const hora=horaNumero(i.hora); const pot=numeroSeguro(i.potencial??i.entrada, NaN); const moag=numeroSeguro(i.moagem??i.saida, nominal);
    if(hora==null||!Number.isFinite(pot)) return null; return {hora, potencial:pot, moagem:moag};
  }).filter(Boolean).sort((a,b)=>a.hora-b.hora);
}
function calcularCenario(dados, unidade){
  const potencial=normalizarPotencial(dados.potencial, unidade.nominal);
  const est=dados.estoque||{}; const atual=numeroSeguro(est.atual,0); const h1=numeroSeguro(est.h1,atual); const h2=numeroSeguro(est.h2,h1); const h3=numeroSeguro(est.h3,h2);
  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();
  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,3);
  const futuro=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:unidade.nominal;
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaQueda=null;
  const projecao=[]; const janelas=[];
  for(const row of futuro){
    const saldo=row.potencial-row.moagem; estoqueProj+=saldo/TONELADAS_POR_CONJUNTO;
    projecao.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
    if(horaQueda==null && row.potencial < row.moagem*0.95) horaQueda=row.hora;
    if(row.potencial > row.moagem + 50) janelas.push(horaFormatada(row.hora));
  }
  let moagemSugerida=Math.round(mediaHistMoag);
  if(atual < unidade.gatilhoReducao){ const recuo=Math.min(100, Math.max(50, Math.round((unidade.gatilhoReducao-atual)*20))); moagemSugerida=Math.max(unidade.min, moagemSugerida-recuo); }
  else if(atual < unidade.gatilhoReducao+3 && (mediaHistPot-mediaHistMoag)<-100){ moagemSugerida=Math.max(unidade.min, Math.round(mediaHistMoag)-50); }
  else if(mediaHistMoag>unidade.nominal){ moagemSugerida=unidade.nominal; }
  else if(atual>=12 && (mediaHistPot-mediaHistMoag)>150){ moagemSugerida=Math.min(unidade.nominal, Math.round(mediaHistMoag)+50); }
  return {unidade, horaAtual, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag}, historico, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda, janelasRecuperacao:janelas}, moagemSugerida};
}

/* PROMPT GESTÃO */
function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Acompanhamento de frentes e quebras.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: Ent ${r.potencial.toFixed(0)} / Moag ${r.moagem.toFixed(0)} | Estoque ${r.estoqueProjetado.toFixed(1)}`).join('\n');
  return `Gere COMUNICADO WhatsApp gestão padrão: UNIDADE ${unidade.sigla} ${unidade.tipo} Nom ${unidade.nominal} Min ${unidade.min} Gatilho <${unidade.gatilhoReducao} Estoque ${calculos.estoque.atual} conj Media 3h Ent ${calculos.medias.historicoPotencial.toFixed(0)} Moag ${calculos.medias.historicoMoagem.toFixed(0)} Saldo ${calculos.medias.saldoHistorico.toFixed(0)} Moagem sugerida ${calculos.moagemSugerida} Projeção ${projTxt} Menor estoque ${calculos.risco.menorEstoque.toFixed(1)} às ${horaFormatada(calculos.risco.horaMenorEstoque)} Risco ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco'} Comentários: ${comentarios} Use modelo: *Comunicado UIM* No momento, a moagem da UIM está liberada para nominal, porém a média das últimas 3 horas está em 999 t/h... Atualmente, está sendo realizada mudança parcial das frentes... Com base nos pontos... necessidade de manter moagem próximo nominal... a partir das 19:00 tendência queda... pátio contabiliza 11 conjuntos... risco iminente redução até 21:00... contato supervisão... troca turno transporte 18:00 e 21:00... Ajuste gradual 50-100t/h sempre voltar nominal. Retorne APENAS comunicado.`;
}

/* FALLBACK LOCAL SE GEMINI CAIR - TEXTO COMPLEXO */
function gerarComunicadoLocalFallback(dados, calculos, unidade){
  const fmtH=h=>String((h+24)%24).padStart(2,'0')+':00';
  const estoque=calculos.estoque;
  const saldo=calculos.medias.saldoHistorico;
  const projDet=calculos.projecaoEstoque;
  const horaQueda=calculos.risco.horaQueda!=null?fmtH(calculos.risco.horaQueda):'19:00';
  const horaRisco=calculos.risco.primeiraHoraRisco!=null?fmtH(calculos.risco.primeiraHoraRisco):'21:00';
  const comentarios=dados.comentarios||'está sendo realizada mudança parcial das frentes conforme programação operacional. Estamos em acompanhamento das frentes de corte, com atenção para quebras de colhedoras, transbordos e caminhões.';
  const tendencia=saldo<0?'nova redução':'estabilização';
  const janelas=calculos.risco.janelasRecuperacao.join(', ')||'avaliar próximas horas';

  return `*Comunicado ${unidade.sigla}*

No momento, a moagem da ${unidade.sigla} está liberada para ${calculos.moagemSugerida} t/h (nominal máxima ${unidade.nominal} t/h / mínimo operacional ${unidade.min} t/h - ${unidade.tipo}${unidade.difusores?` ${unidade.difusores}x${unidade.minPorDifusor}`:''}), porém a média das últimas 3 horas está em ${calculos.medias.historicoMoagem.toFixed(0)} t/h, com entrada média de ${calculos.medias.historicoPotencial.toFixed(0)} t/h e saldo de ${saldo.toFixed(0)}t no período. Diante disso, ${calculos.medias.historicoMoagem>unidade.nominal?'foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta':'foi avaliado cenário para manter a moagem o mais próximo possível da nominal, com ajuste gradual de 50 a 100 t/h até estabilizar entrega com estoque'}.

Análise de pátio: O pátio saiu de ${estoque.h3} conj (3h atrás) para ${estoque.h2} conj (2h atrás), depois para ${estoque.h1} conj (1h atrás) e agora contabiliza ${estoque.atual} conj, representando variação de ${(estoque.atual-estoque.h3).toFixed(1)} conj nas últimas 3h. Acumulado do dia com entrada e saída conforme projeção, mantendo tendência de ${tendencia}.

Atualmente, ${comentarios}

Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal de ${unidade.nominal} t/h, evitando uma redução ainda maior, visto que a partir das ${horaQueda} a projeção indica entrada de ${projDet.find(p=>p.hora==calculos.risco.horaQueda)?.potencial.toFixed(0)||'-'} t/h abaixo da moagem.

Como pode ser observado no gráfico acima, o pátio contabiliza no momento ${estoque.atual} conjuntos carregados, com tendência de ${tendencia} nas próximas horas, ${calculos.risco.primeiraHoraRisco!=null?`gerando risco iminente de atingir o gatilho de ${unidade.gatilhoReducao} conj e necessidade de redução de moagem até as ${horaRisco}.`:`com menor nível projetado de ${calculos.risco.menorEstoque.toFixed(1)} conj às ${fmtH(calculos.risco.horaMenorEstoque)}.`} Janelas de recuperação identificadas: ${janelas} - oportunidade para elevar +50 t/h.

Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem nominal, mesmo operando com o pátio em nível baixo. Sugestões para melhorar o cenário:
- Acelerar mudança de frentes com maior rendimento e menor distância média
- Verificar quebras de colhedoras e transbordos que estão impactando a entrega
- Priorizar transporte próprio e checagem de tempo de ciclo dos caminhões
- Alinhar troca de turno do transporte (18h / 21h / 06h) para evitar quebra de ciclo

Outro fator crítico para a quebra de ciclo será a troca de turno do transporte e da colheita. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções graduais de 50 a 100 t/h até estabilizar em ${unidade.min} t/h (mínimo da ${unidade.sigla}) e só retornando para nominal após recuperação do pátio acima de ${unidade.gatilhoReducao+2} conjuntos.

*Projeção hora a hora:*
${projDet.map(p=>`${p.horaFormatada}: Ent ${p.potencial.toFixed(0)} / Moag ${p.moagem.toFixed(0)} | Saldo ${p.saldoToneladas>=0?'+':''}${p.saldoToneladas.toFixed(0)}t | Estoque proj ${p.estoqueProjetado.toFixed(1)} conj ${p.estoqueProjetado<unidade.gatilhoReducao?'⚠ ABAIXO GATILHO':''}`).join('\n')}`;
}

const MODELOS_FALLBACK = [
  GEMINI_MODEL,
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest'
].filter((v,i,a)=>a.indexOf(v)===i);

async function chamarUmModelo(prompt, modelo){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  try{
    console.log(`[IA] Tentando ${modelo}`);
    const resp=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},
      body:JSON.stringify({contents:[{role:'user', parts:[{text:prompt}]}], generationConfig:{temperature:0.3, maxOutputTokens:5000}})
    });
    const txt=await resp.text();
    if(!resp.ok){
      console.warn(`[IA] Falha ${modelo} ${resp.status}`);
      return {ok:false};
    }
    const json=JSON.parse(txt);
    const out=json?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n').trim();
    if(!out) return {ok:false};
    console.log(`[IA] OK ${modelo}`);
    return {ok:true, texto:out, modelo};
  }catch(e){
    console.warn(`[IA] Erro ${modelo} ${e.message}`);
    return {ok:false};
  }
}

async function chamarGeminiComFallback(prompt){
  if(!GEMINI_API_KEY){
    console.warn('[IA] Sem GEMINI_API_KEY, usando fallback local');
    return {ok:false, fallback:true};
  }
  for(const modelo of MODELOS_FALLBACK){
    const r=await chamarUmModelo(prompt, modelo);
    if(r.ok) return r;
    await new Promise(res=>setTimeout(res, 600));
  }
  return {ok:false, fallback:true};
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:MODELOS_FALLBACK, unidades:UNIDADES}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)) return res.status(400).json({error:'potencial array não enviado'});
    if(dados.estoque?.atual==null) return res.status(400).json({error:'estoque atual não informado'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    if(!unidade) return res.status(400).json({error:'unidade não identificada'});

    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);

    const iaResult = await chamarGeminiComFallback(prompt);

    let textoFinal;
    let origem = 'GEMINI';

    if(iaResult.ok){
      textoFinal = iaResult.texto;
      origem = `GEMINI ${iaResult.modelo}`;
    } else {
      console.log('[IA] Todos modelos falharam, usando fallback local complexo');
      textoFinal = gerarComunicadoLocalFallback(dados, calculos, unidade);
      origem = 'LOCAL FALLBACK (Gemini em alta demanda)';
    }

    return res.json({ok:true, texto:textoFinal, planoVoo:textoFinal, comunicado:textoFinal, unidade, calculos, modelo:origem});

  }catch(e){
    console.error('[ERRO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`\n=== PLANO DE VOO CTT PORTA ${PORT} ===`);
  Object.values(UNIDADES).forEach(u=>console.log(` ${u.sigla} ${u.nome} Nom ${u.nominal} Min ${u.min} Gatilho <${u.gatilhoReducao}`));
  console.log(`Modelos: ${MODELOS_FALLBACK.join(' -> ')}`);
  console.log('Fallback local ATIVADO se Gemini 503\n');
});
