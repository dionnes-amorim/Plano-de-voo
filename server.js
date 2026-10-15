require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const TONELADAS_POR_CONJUNTO = Number(process.env.TONELADAS_POR_CONJUNTO || 70);

/* =========================================================
   CADASTRO OFICIAL CORRIGIDO - VOCÊ PEDIU
   ========================================================= */
const UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 }, // SÓ REDUZ ABAIXO DE 4
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(__dirname));

function numeroSeguro(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function textoSeguro(v,l=30000){ return String(v||'').trim().slice(0,l); }
function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function horaNumero(h){ if(h==null) return null; const m=String(h).trim().match(/\d{1,2}/); if(!m) return null; const n=Number(m[0]); return (n>=0&&n<=23)?n:null; }
function horaFormatada(h){ const n=horaNumero(h); return n==null?'--':`${String(n).padStart(2,'0')}:00`; }
function horaRelativa(h,ha){ if(!Number.isFinite(h)||!Number.isFinite(ha)) return null; let d=(h-ha+24)%24; if(d>12) d-=24; return d; }

function identificarUnidade(texto){
  const orig=textoSeguro(texto,30000); if(!orig) return null;
  const linhas=orig.split(/\r?\n/);
  const prior=linhas.filter(l=>/FILIAL|GESTORA|UNIDADE|UIM|UICA|UISJ|UIV|UIT/i.test(l));
  const busca=[...prior, orig];
  for(const trecho of busca){
    const linha=normalizarTexto(trecho);
    for(const chave of Object.keys(UNIDADES)){ if(linha.includes(chave)) return {chave,...UNIDADES[chave]}; }
    if(linha.includes('UIM')) return {chave:'MANDU',...UNIDADES['MANDU']};
    if(linha.includes('UICA')) return {chave:'CRUZ ALTA',...UNIDADES['CRUZ ALTA']};
    if(linha.includes('UISJ')) return {chave:'SAO JOSE',...UNIDADES['SAO JOSE']};
    if(linha.includes('UIV')||linha.includes('VER')) return {chave:'VERTENTE',...UNIDADES['VERTENTE']};
    if(linha.includes('UIT')) return {chave:'TANABI',...UNIDADES['TANABI']};
  }
  return null;
}

function normalizarPotencial(lista, nominal){
  if(!Array.isArray(lista)) return [];
  return lista.map(item=>{
    const hora=horaNumero(item?.hora??item?.horario??item?.horaNumero);
    const potencial=numeroSeguro(item?.potencial??item?.producao??item?.valor, NaN);
    const moagem=numeroSeguro(item?.moagem??item?.moagemNominal??nominal, nominal);
    if(hora==null||!Number.isFinite(potencial)) return null;
    return {hora, horaNumero:hora, potencial, moagem, nominal};
  }).filter(Boolean).sort((a,b)=>a.hora-b.hora);
}

function calcularCenario(dados, unidade){
  const potencial=normalizarPotencial(dados.potencial, unidade.nominal);
  const estoque=dados.estoque||{};
  const estoqueAtual=numeroSeguro(estoque.atual,0);
  const h1=numeroSeguro(estoque.h1, estoqueAtual);
  const h2=numeroSeguro(estoque.h2, h1);
  const h3=numeroSeguro(estoque.h3, h2);
  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();

  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,3).sort((a,b)=>a.relativo-b.relativo);
  const futuro=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);

  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:unidade.nominal;

  const variacaoEstoque=estoqueAtual - h3;
  let tendencia='ESTÁVEL'; if(variacaoEstoque>0.2) tendencia='SUBINDO'; else if(variacaoEstoque<-0.2) tendencia='CAINDO';

  let estoqueProj=estoqueAtual, menorEstoque=estoqueAtual, horaMenor=horaAtual, primeiraHoraRisco=null, horaQueda=null, horaZera=null;
  const projecaoEstoque=[];
  const janelasRecuperacao=[];

  for(const row of futuro){
    const saldo=row.potencial - row.moagem;
    estoqueProj+=saldo / TONELADAS_POR_CONJUNTO;
    projecaoEstoque.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
    if(horaQueda==null && row.potencial < row.moagem*0.95) horaQueda=row.hora;
    if(horaZera==null && estoqueProj<=1) horaZera=row.hora;
    if(row.potencial > row.moagem + 50) janelasRecuperacao.push(horaFormatada(row.hora));
  }

  const mediaFutPot=futuro.length?futuro.reduce((t,r)=>t+r.potencial,0)/futuro.length:0;
  const mediaFutMoag=futuro.length?futuro.reduce((t,r)=>t+r.moagem,0)/futuro.length:unidade.nominal;

  // LÓGICA DE MOAGEM GRADUAL 50-100t/h
  let moagemSugerida=Math.round(mediaHistMoag);
  if(estoqueAtual < unidade.gatilhoReducao){
    const recuo=Math.min(100, Math.max(50, Math.round((unidade.gatilhoReducao - estoqueAtual)*20)));
    moagemSugerida=Math.max(unidade.min, moagemSugerida - recuo);
  } else if(estoqueAtual < unidade.gatilhoReducao+3 && (mediaHistPot - mediaHistMoag) < -100){
    moagemSugerida=Math.max(unidade.min, Math.round(mediaHistMoag)-50);
  } else if(mediaHistMoag > unidade.nominal){
    moagemSugerida=unidade.nominal;
  } else if(estoqueAtual>=12 && (mediaHistPot - mediaHistMoag) > 150){
    moagemSugerida=Math.min(unidade.nominal, Math.round(mediaHistMoag)+50);
  }

  return {
    unidade, horaAtual, estoque:{h3,h2,h1,atual:estoqueAtual, variacao:variacaoEstoque, tendencia},
    medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag, futuroPotencial:mediaFutPot, futuroMoagem:mediaFutMoag, saldoFuturo:mediaFutPot-mediaFutMoag},
    historico: historico.map(r=>({hora:r.hora, potencial:r.potencial, moagem:r.moagem, saldo:r.potencial-r.moagem})),
    projecaoEstoque, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda, horaZera, janelasRecuperacao},
    moagemSugerida, parametros:{toneladasPorConjunto:TONELADAS_POR_CONJUNTO, estoqueRiscoConj:unidade.gatilhoReducao}
  };
}

/* =========================================================
   PROMPT NOVO - PADRÃO GESTÃO WHATS QUE VOCÊ MANDOU
   ========================================================= */
function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios, 8000) || 'Sem comentários adicionais da operação.';
  const tabelaOriginal=textoSeguro(dados.tabelaOriginal, 15000);

  const histTxt=calculos.historico.map(r=>`${horaFormatada(r.hora)}: ${r.potencial.toFixed(0)}/${r.moagem.toFixed(0)} saldo ${r.saldo>=0?'+':''}${r.saldo.toFixed(0)}t`).join('\n');
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: Ent ${r.potencial.toFixed(0)} / Moag ${r.moagem.toFixed(0)} | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Estoque proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');

  return `
Você é o COA - CTT sênior. Gere um COMUNICADO para WhatsApp da gestão no padrão abaixo. Use dados REAIS, não invente.

UNIDADE: ${unidade.nome} (${unidade.sigla}) - Tipo ${unidade.tipo} - Nominal ${unidade.nominal} t/h (máxima) - Mínimo operacional ${unidade.min} t/h ${unidade.difusores?`(${unidade.difusores}x ${unidade.minPorDifusor} t/h)`:''} - Gatilho de redução <${unidade.gatilhoReducao} conjuntos (na Vertente <4, nas demais <12).

ESTOQUE: Atual ${calculos.estoque.atual} conj | H-1 ${calculos.estoque.h1} | H-2 ${calculos.estoque.h2} | H-3 ${calculos.estoque.h3} | Tendência ${calculos.estoque.tendencia} variação ${calculos.estoque.variacao.toFixed(1)} conj
MÉDIAS 3h: Ent ${calculos.medias.historicoPotencial.toFixed(0)} t/h / Moag ${calculos.medias.historicoMoagem.toFixed(0)} t/h | Saldo ${calculos.medias.saldoHistorico.toFixed(0)}t
MOAGEM SUGERIDA (gradual 50-100t/h): ${calculos.moagemSugerida} t/h - nominal é TETO, só mantém nominal se cenário sustenta, sempre focar voltar para nominal o mais rápido possível.

PROJEÇÃO:
${projTxt}
Menor estoque projetado: ${calculos.risco.menorEstoque.toFixed(1)} conj às ${horaFormatada(calculos.risco.horaMenorEstoque)} | Risco gatilho ${unidade.gatilhoReducao} conj às ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco'} | Queda entrega a partir de ${calculos.risco.horaQueda!=null?horaFormatada(calculos.risco.horaQueda):'--'} | Janelas recuperação: ${calculos.risco.janelasRecuperacao.join(', ')||'nenhuma'}

HISTÓRICO:
${histTxt}

COMENTÁRIOS DA OPERAÇÃO (frentes, quebras, troca turno): ${comentarios}

MODELO OBRIGATÓRIO PARA COPIAR E COLAR NO WHATS (use EXATAMENTE esse estilo, texto maior, assertivo, compare estoque):

*Comunicado ${unidade.sigla}*

No momento, a moagem da ${unidade.sigla} está liberada para nominal, porém a média das últimas 3 horas está em 999 t/h. Diante disso, foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta.

Atualmente, está sendo realizada mudança parcial das frentes 501, 505, 506 e 542. A mudança da F506 está próxima e, posteriormente, após à troca de turno, será realizada mudança também da F503.

Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal, evitando uma redução ainda maior, visto que a partir das 19:00 a tendência é de queda na entrega.

Como pode ser observado no gráfico acima, o pátio contabiliza no momento 11 conjuntos carregados, com tendência de nova redução nas próximas horas, gerando risco iminente de redução de moagem até as 21:00.

Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem nominal, mesmo operando com o pátio em nível baixo.

Outro fator crítico para a quebra de ciclo será a troca de turno do transporte, prevista uma para às 18:00 e 21:00 de hoje, e outra 06:00 do dia 10/05. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções.

REGRAS PARA GERAR O TEXTO NOVO:
1. Nominal é MÁXIMA, não obrigatória. Se cenário não sustenta, sugere redução gradual 50-100t/h até estabilizar. Se estoque <${unidade.gatilhoReducao} (UIV <4), reduz. Se não, mantém.
2. Sempre sugerir retorno para nominal o mais rápido possível em passos de 50-100t/h quando pátio >${unidade.gatilhoReducao+2} e entrada > ${Math.round(unidade.nominal*0.85)} t/h.
3. Dar sugestões práticas: acelerar mudança de frentes, verificar quebra de colhedora, trator transbordo, caminhão, tempo de ciclo, alinhar troca de turno.
4. Incluir no texto: média 3h, estoque atual e tendência, horário de risco, horário de queda, janelas de recuperação.
5. Não escreva "redução é último caso". Deixe análise técnica consultar.
6. Use dados reais enviados. Se comentário citar frentes, use no texto.
7. Retorne APENAS o comunicado pronto para WhatsApp, sem explicações.

TABELA ORIGINAL PARA CONFERÊNCIA:
${tabelaOriginal}
`.trim();
}

async function chamarGemini(prompt){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(), 60000);
  try{
    const resp=await fetch(url,{method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY}, body:JSON.stringify({contents:[{role:'user', parts:[{text:prompt}]}], generationConfig:{temperature:0.3, maxOutputTokens:5000}}), signal:controller.signal});
    const txt=await resp.text(); if(!resp.ok) throw new Error(`Gemini ${resp.status}: ${txt.slice(0,800)}`);
    const json=JSON.parse(txt); const out=json?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n').trim(); if(!out) throw new Error('Gemini vazio'); return out;
  } finally{ clearTimeout(timeout); }
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, model:GEMINI_MODEL, unidades:UNIDADES, time:new Date().toISOString()}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    // Aceita tanto formato novo (unidade objeto) quanto antigo (potencial array)
    let potencial = dados.potencial;
    if(!potencial && dados.tabelaOriginal && typeof window==='undefined'){
      // fallback se vier só tabela, mas aqui não temos parser, então exige potencial já parseado pelo front
      // o front já manda potencial
    }
    if(!Array.isArray(dados.potencial) &&!Array.isArray(potencial)){
      // Se o front mandou no novo formato (payloadIA), converte
      if(dados.projecao && Array.isArray(dados.projecao)){
        potencial = dados.projecao.map(p=>({hora:p.horaNumero??p.hora, potencial:p.entrada??p.potencial, moagem:p.saida??p.moagem}));
      } else {
        return res.status(400).json({error:'Potencial não enviado. Envie dados.potencial como array.'});
      }
    }
    if(!dados.estoque || dados.estoque.atual==null) return res.status(400).json({error:'Estoque atual não informado.'});

    const unidade=identificarUnidade(dados.tabelaOriginal || dados.unidade?.nome || dados.unidade?.sigla || '');
    if(!unidade) return res.status(400).json({error:'Unidade não identificada. Envie tabela com Mandu, Cruz Alta, São José, Vertente ou Tanabi.'});

    // Se payload veio no formato novo do app.js, adapta
    const dadosAdaptados = {
      tabelaOriginal: dados.tabelaOriginal || `${unidade.nome} ${unidade.sigla}`,
      comentarios: dados.comentarios || '',
      potencial: potencial || dados.potencial,
      estoque: dados.estoque,
      horaAtual: dados.horaAtual
    };

    const calculos=calcularCenario(dadosAdaptados, unidade);
    const prompt=montarPrompt(dadosAdaptados, calculos, unidade);
    const resposta=await chamarGemini(prompt);

    return res.json({ok:true, texto: resposta, comunicado: resposta, unidade, calculos, modelo:GEMINI_MODEL});
  }catch(err){
    console.error('Erro /api/plano-voo:', err.message);
    return res.status(500).json({error: err.message||'Erro interno'});
  }
});

app.use('/api', (req,res)=>{ res.status(404).json({error:'Endpoint não encontrado.'}); });
app.use((err,req,res,next)=>{ console.error(err); if(res.headersSent) return next(err); res.status(500).json({error:'Erro interno'}); });

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`\n PLANO DE VOO - CTT - PORTA ${PORT} - MODELO ${GEMINI_MODEL}`);
  Object.values(UNIDADES).forEach(u=>console.log(` - ${u.sigla} ${u.nome}: Nom ${u.nominal} / Min ${u.min} / Gatilho <${u.gatilhoReducao} - ${u.tipo}`));
});
