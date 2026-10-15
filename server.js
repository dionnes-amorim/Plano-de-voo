require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TONELADAS_POR_CONJUNTO = 70;

// MODELOS IGUAIS AO SEU SISTEMA QUE FUNCIONA - NUNCA DÁ 503
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

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
function textoSeguro(v,l=30000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
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
  if(n.includes('UIV')||n.includes('VERTENTE')) return {chave:'VERTENTE',...UNIDADES['VERTENTE']};
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
  return {unidade, horaAtual, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag}, historico, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda, janelasRecuperacao:janelas}, moagemSugerida};
}

function normalizarPublicacaoIA(texto){
  return String(texto||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/```(?:text|markdown|md)?/gi,'').replace(/```/g,'').replace(/^#{1,6}\s*/gm,'').replace(/\*{2,}/g,'*').replace(/^={3,}.*$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}

function obterConfigPensamento(modelo, nivel){
  if(modelo.includes('3.8')||modelo.includes('flash-latest')){
    return { thinkingConfig:{ thinkingLevel: nivel||'medium' } };
  }
  if(modelo.includes('2.5')){
    const budget=nivel==='high'?4096:nivel==='low'?1024:2048;
    return { thinkingConfig:{ thinkingBudget: budget } };
  }
  return {};
}

function extrairTextoGemini(data){
  const partes=data?.candidates?.[0]?.content?.parts||[];
  const textos=partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text);
  return textos.join('\n').trim();
}

async function chamarIA(prompt, options={}){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada no Render.');
  const maxOutputTokens=options.maxOutputTokens||5000;
  const timeoutMs=options.timeoutMs||45000;
  const thinkingLevel=options.thinkingLevel||'medium';
  let ultimoErro='Erro desconhecido na IA.';
  for(const modelo of GEMINI_MODELS){
    const controller=new AbortController();
    let timeout=null;
    try{
      console.log(`[IA] Tentando modelo: ${modelo}`);
      timeout=setTimeout(()=>controller.abort(), timeoutMs);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const generationConfig={
        temperature: options.temperature??0.3,
        maxOutputTokens,
       ...obterConfigPensamento(modelo, thinkingLevel)
      };
      const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig }),
        signal:controller.signal
      });
      console.log(`[IA] HTTP ${modelo} ${response.status}`);
      const raw=await response.text();
      if(!raw) throw new Error(`Gemini ${modelo} retornou vazio`);
      let data; try{ data=JSON.parse(raw); }catch{ throw new Error(`Gemini ${modelo} JSON inválido`); }
      if(!response.ok){
        const detalhe=data?.error?.message||raw.slice(0,800);
        ultimoErro=`Gemini ${modelo} HTTP ${response.status}: ${detalhe}`;
        console.error(ultimoErro);
        if([400,401,403].includes(response.status)) throw new Error(ultimoErro);
        continue;
      }
      const resposta=extrairTextoGemini(data);
      if(!resposta){ ultimoErro=`Gemini ${modelo} sem texto`; continue; }
      console.log(`[IA] SUCESSO ${modelo} ${resposta.length} chars`);
      return { texto: normalizarPublicacaoIA(resposta), modelo };
    }catch(error){
      ultimoErro=error.name==='AbortError'?`Timeout ${timeoutMs/1000}s no modelo ${modelo}`:(error.message||'Erro IA');
      console.error(`[IA] Falha ${modelo}:`, ultimoErro);
      if(String(ultimoErro).includes('HTTP 400')||String(ultimoErro).includes('HTTP 401')||String(ultimoErro).includes('HTTP 403')) throw new Error(ultimoErro);
      continue;
    }finally{ if(timeout) clearTimeout(timeout); }
  }
  throw new Error(ultimoErro);
}

function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Acompanhamento de frentes e quebras de colhedoras, transbordos.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: Ent ${r.potencial.toFixed(0)} / Moag ${r.moagem.toFixed(0)} | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Estoque proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');
  const histTxt=calculos.historico.map(r=>`${horaFormatada(r.hora)}: ${r.potencial.toFixed(0)}/${r.moagem.toFixed(0)} saldo ${r.potencial-r.moagem>=0?'+':''}${(r.potencial-r.moagem).toFixed(0)}t`).join('\n');
  return `
Você é analista sênior CTT Plano de Voo.

UNIDADE: ${unidade.nome} (${unidade.sigla}) ${unidade.tipo} Nominal ${unidade.nominal} t/h MAXIMA Mín operacional ${unidade.min} t/h Gatilho redução <${unidade.gatilhoReducao} conj (VERTENTE <4, demais <12)
ESTOQUE: Atual ${calculos.estoque.atual} conj H-3 ${calculos.estoque.h3} H-2 ${calculos.estoque.h2} H-1 ${calculos.estoque.h1} Variação ${calculos.estoque.variacao.toFixed(1)}
MÉDIA 3h: Ent ${calculos.medias.historicoPotencial.toFixed(0)} Moag ${calculos.medias.historicoMoagem.toFixed(0)} Saldo ${calculos.medias.saldoHistorico.toFixed(0)}t
MOAGEM SUGERIDA GRADUAL 50-100t/h: ${calculos.moagemSugerida} t/h - Nominal é TETO, sempre focar voltar para nominal o mais rápido possível com passos +50t/h quando pátio >${unidade.gatilhoReducao+2} e entrada >${Math.round(unidade.nominal*0.85)}
PROJEÇÃO:
${projTxt}
Menor estoque ${calculos.risco.menorEstoque.toFixed(1)} às ${horaFormatada(calculos.risco.horaMenorEstoque)} Risco gatilho ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco'} Queda a partir de ${calculos.risco.horaQueda!=null?horaFormatada(calculos.risco.horaQueda):'--'} Janelas recuperação: ${calculos.risco.janelasRecuperacao.join(', ')||'nenhuma'}
HISTÓRICO:
${histTxt}
COMENTÁRIOS OPERAÇÃO: ${comentarios}

FORMATO OBRIGATÓRIO - USE EXATAMENTE ESSE MODELO MAIOR E ASSERTIVO:

*Comunicado ${unidade.sigla}*

No momento, a moagem da ${unidade.sigla} está liberada para nominal, porém a média das últimas 3 horas está em 999 t/h. Diante disso, foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta.

Atualmente, está sendo realizada mudança parcial das frentes 501, 505, 506 e 542. A mudança da F506 está próxima e, posteriormente, após à troca de turno, será realizada mudança também da F503.

Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal, evitando uma redução ainda maior, visto que a partir das 19:00 a tendência é de queda na entrega.

Como pode ser observado no gráfico acima, o pátio contabiliza no momento 11 conjuntos carregados, com tendência de nova redução nas próximas horas, gerando risco iminente de redução de moagem até as 21:00.

Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem nominal, mesmo operando com o pátio em nível baixo.

Outro fator crítico para a quebra de ciclo será a troca de turno do transporte, prevista uma para às 18:00 e 21:00 de hoje, e outra 06:00 do dia 10/05. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções.

REGRAS:
- Nominal é MÁXIMA, não obrigatória. Se não sustenta, sugira redução gradual 50-100t/h até estabilizar. Se estoque <${unidade.gatilhoReducao} (UIV <4), reduz. Se não, mantém.
- Sempre sugerir retorno para nominal o mais rápido possível.
- Dar sugestões práticas: acelerar mudança frentes, verificar quebra colhedora, transbordo, caminhão, ciclo.
- Use dados reais, inclua média 3h, estoque, horário risco, queda, janelas.
- Use *negrito* simples, pronto WhatsApp.
- Retorne APENAS comunicado.
`.trim();
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS, modelo_principal:GEMINI_MODELS[0], unidades:UNIDADES, time:new Date().toISOString()}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)) return res.status(400).json({error:'potencial array não enviado. Verifique app.js'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'estoque atual não informado'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    if(!unidade) return res.status(400).json({error:'Unidade não identificada. Inclua Mandu, Cruz Alta, São José, Vertente ou Tanabi na tabela.'});
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);

    console.log(`[REQ] ${unidade.sigla} - Estoque ${dados.estoque.atual} - Sugerida ${calculos.moagemSugerida}`);

    const resultado=await chamarIA(prompt,{
      maxOutputTokens:6000,
      timeoutMs:45000,
      thinkingLevel:'high',
      temperature:0.25
    });

    return res.json({
      ok:true,
      texto: resultado.texto,
      planoVoo: resultado.texto,
      comunicado: resultado.texto,
      unidade,
      calculos,
      modelo: resultado.modelo
    });
  }catch(e){
    console.error('[ERRO] /api/plano-voo', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log('');
  console.log('==============================================');
  console.log(` PLANO DE VOO CTT - PORTA ${PORT}`);
  console.log(` Modelo principal: ${GEMINI_MODELS[0]}`);
  console.log(` Fallback: ${GEMINI_MODELS.slice(1).join(', ')}`);
  console.log('==============================================');
  Object.values(UNIDADES).forEach(u=>console.log(` - ${u.sigla} ${u.nome}: Nom ${u.nominal} / Min ${u.min} / Gatilho <${u.gatilhoReducao} - ${u.tipo}`));
  console.log('==============================================\n');
});
