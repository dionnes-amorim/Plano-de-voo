require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const TONELADAS_POR_CONJUNTO = Number(process.env.TONELADAS_POR_CONJUNTO || 70);

const UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
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
  const historico=comRel.filter(r=>r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,3);
  const futuro=comRel.filter(r=>r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:unidade.nominal;
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaQueda=null;
  const projecao=[];
  for(const row of futuro){
    const saldo=row.potencial-row.moagem; estoqueProj+=saldo/TONELADAS_POR_CONJUNTO;
    projecao.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
    if(horaQueda==null && row.potencial < row.moagem*0.95) horaQueda=row.hora;
  }
  let moagemSugerida=Math.round(mediaHistMoag);
  if(atual < unidade.gatilhoReducao){ const recuo=Math.min(100, Math.max(50, Math.round((unidade.gatilhoReducao-atual)*20))); moagemSugerida=Math.max(unidade.min, moagemSugerida-recuo); }
  else if(atual < unidade.gatilhoReducao+3 && (mediaHistPot-mediaHistMoag)<-100){ moagemSugerida=Math.max(unidade.min, Math.round(mediaHistMoag)-50); }
  else if(mediaHistMoag>unidade.nominal){ moagemSugerida=unidade.nominal; }
  else if(atual>=12 && (mediaHistPot-mediaHistMoag)>150){ moagemSugerida=Math.min(unidade.nominal, Math.round(mediaHistMoag)+50); }

  return {unidade, horaAtual, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag}, historico, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda}, moagemSugerida};
}
function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Acompanhamento de frentes e quebras.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: Ent ${r.potencial.toFixed(0)} / Moag ${r.moagem.toFixed(0)} | Estoque ${r.estoqueProjetado.toFixed(1)}`).join('\n');
  return `Você é COA - CTT sênior. Gere COMUNICADO para WhatsApp da gestão no modelo abaixo com DADOS REAIS.

UNIDADE: ${unidade.nome} (${unidade.sigla}) ${unidade.tipo} Nominal ${unidade.nominal} t/h MAXIMA Mín ${unidade.min} t/h Gatilho <${unidade.gatilhoReducao} conj (VERTENTE <4, demais <12)
ESTOQUE: ${calculos.estoque.atual} conj atual (H-3 ${calculos.estoque.h3} H-2 ${calculos.estoque.h2} H-1 ${calculos.estoque.h1}) variação ${calculos.estoque.variacao.toFixed(1)}
MÉDIA 3h: Ent ${calculos.medias.historicoPotencial.toFixed(0)} Moag ${calculos.medias.historicoMoagem.toFixed(0)} Saldo ${calculos.medias.saldoHistorico.toFixed(0)}t
MOAGEM SUGERIDA GRADUAL 50-100t/h: ${calculos.moagemSugerida} t/h - Nominal é TETO, só mantém nominal se cenário sustenta.
PROJEÇÃO:
${projTxt}
Menor estoque ${calculos.risco.menorEstoque.toFixed(1)} às ${horaFormatada(calculos.risco.horaMenorEstoque)} Risco gatilho ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco'} Queda a partir de ${calculos.risco.horaQueda!=null?horaFormatada(calculos.risco.horaQueda):'--'}
COMENTÁRIOS OPERAÇÃO: ${comentarios}

MODELO OBRIGATÓRIO (texto maior, assertivo, com sugestões de frente, quebra colhedora, tração):

*Comunicado ${unidade.sigla}*

No momento, a moagem da ${unidade.sigla} está liberada para nominal, porém a média das últimas 3 horas está em 999 t/h. Diante disso, foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta.

Atualmente, está sendo realizada mudança parcial das frentes 501, 505, 506 e 542. A mudança da F506 está próxima e, posteriormente, após à troca de turno, será realizada mudança também da F503.

Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal, evitando uma redução ainda maior, visto que a partir das 19:00 a tendência é de queda na entrega.

Como pode ser observado no gráfico acima, o pátio contabiliza no momento 11 conjuntos carregados, com tendência de nova redução nas próximas horas, gerando risco iminente de redução de moagem até as 21:00.

Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem nominal, mesmo operando com o pátio em nível baixo.

Outro fator crítico para a quebra de ciclo será a troca de turno do transporte, prevista uma para às 18:00 e 21:00 de hoje, e outra 06:00 do dia 10/05. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções.

REGRAS: Ajuste gradual 50-100t/h até estabilizar, sempre focar voltar para nominal o mais rápido possível, dar sugestão como melhorar (mudança frente, quebra colhedora, tração). Retorne APENAS comunicado pronto.`;
}
async function chamarGemini(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const resp=await fetch(url,{method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY}, body:JSON.stringify({contents:[{role:'user', parts:[{text:prompt}]}], generationConfig:{temperature:0.3, maxOutputTokens:5000}})});
  const txt=await resp.text(); if(!resp.ok) throw new Error(`Gemini ${resp.status}: ${txt.slice(0,500)}`); const json=JSON.parse(txt); const out=json?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n').trim(); if(!out) throw new Error('Gemini vazio'); return out;
}
app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, model:GEMINI_MODEL, unidades:UNIDADES}); });
app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    console.log('Payload recebido:', JSON.stringify(dados).slice(0,500));
    if(!Array.isArray(dados.potencial)) return res.status(400).json({error:'potencial array não enviado'});
    if(dados.estoque?.atual==null) return res.status(400).json({error:'estoque atual não informado'});
    const unidade=identificarUnidade(dados.tabelaOriginal||''); if(!unidade) return res.status(400).json({error:'unidade não identificada'});
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    console.log('Chamando Gemini...');
    const texto=await chamarGemini(prompt);
    console.log('Gemini OK');
    return res.json({ok:true, texto, planoVoo:texto, comunicado:texto, unidade, calculos, modelo:GEMINI_MODEL});
  }catch(e){ console.error('Erro /api/plano-voo', e.message); return res.status(500).json({error:e.message}); }
});
app.listen(PORT, '0.0.0.0', ()=>{ console.log(`Servidor ${PORT} modelo ${GEMINI_MODEL}`); Object.values(UNIDADES).forEach(u=>console.log(`${u.sigla} ${u.nome} Nom ${u.nominal} Min ${u.min} Gatilho <${u.gatilhoReducao}`)); });
