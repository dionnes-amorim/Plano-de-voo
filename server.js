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
function textoSeguro(v,l=10000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
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
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,4);
  const futuro=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:unidade.nominal;
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaQueda=null;
  const projecao=[]; let deficitAcumulado=0;
  for(const row of futuro){
    const saldo=row.potencial-row.moagem; deficitAcumulado+=saldo; estoqueProj+=saldo/TONELADAS_POR_CONJUNTO;
    projecao.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj, deficitAcumulado});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
    if(horaQueda==null && row.potencial < row.moagem*0.9) horaQueda=row.hora;
  }
  return {unidade, horaAtual, estoque:{h3,h2,h1,atual, variacao:atual-h3}, medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag}, historico, projecaoEstoque:projecao, risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda, deficitAcumulado}, moagemSugerida: Math.round(mediaHistMoag)};
}

function normalizarPublicacaoIA(texto){
  return String(texto||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/```(?:text|markdown)?/gi,'').replace(/```/g,'').replace(/^#{1,6}\s*/gm,'').replace(/\*{2,}/g,'*').replace(/\n{3,}/g,'\n\n').trim();
}
function obterConfigPensamento(modelo, nivel){
  if(modelo.includes('3.8')||modelo.includes('flash-latest')) return { thinkingConfig:{ thinkingLevel: nivel||'high' } };
  if(modelo.includes('2.5')) return { thinkingConfig:{ thinkingBudget: nivel==='high'?4096:2048 } };
  return {};
}
function extrairTextoGemini(data){
  const partes=data?.candidates?.[0]?.content?.parts||[];
  return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim();
}
async function chamarIA(prompt, options={}){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  let ultimoErro='Erro IA';
  for(const modelo of GEMINI_MODELS){
    const controller=new AbortController();
    let timeout=null;
    try{
      console.log(`[IA] Tentando ${modelo}`);
      timeout=setTimeout(()=>controller.abort(), options.timeoutMs||45000);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const generationConfig={ temperature: options.temperature??0.28, maxOutputTokens: options.maxOutputTokens||8000,...obterConfigPensamento(modelo, options.thinkingLevel||'high') };
      const response=await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig}), signal:controller.signal });
      const raw=await response.text();
      if(!raw) throw new Error('vazio');
      const data=JSON.parse(raw);
      if(!response.ok){ const d=data?.error?.message||raw.slice(0,600); ultimoErro=`${modelo} ${response.status}: ${d}`; console.error(ultimoErro); if([400,401,403].includes(response.status)) throw new Error(ultimoErro); continue; }
      const texto=extrairTextoGemini(data);
      if(!texto) continue;
      console.log(`[IA] SUCESSO ${modelo} ${texto.length} chars`);
      return { texto: normalizarPublicacaoIA(texto), modelo };
    }catch(e){ ultimoErro=e.name==='AbortError'?`Timeout ${modelo}`:e.message; console.error(`[IA] Falha ${modelo}: ${ultimoErro}`); continue; }
    finally{ if(timeout) clearTimeout(timeout); }
  }
  throw new Error(ultimoErro);
}

// EXEMPLOS REAIS COMO PADRÃO
const EXEMPLOS_PADRAO = `
EXEMPLO UIT - ANALÍTICO COM INDISPONIBILIDADE:
*Comunicado UIT*
De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 664 t/h.
O principal motivo da baixa entrega é a indisponibilidade mecânica das colhedoras próprias, que apresentou média de 16% entre 10:00 e 16:00, impactando diretamente a produtividade das frentes.
Além da indisponibilidade, ao decorrer do dia ocorreram as mudanças das frentes 325 e 330. De momento, a F329 está em processo de mudança, todas sendo frentes próprias. Já as F312 e F400 apresentam déficit de entrega devido à manutenção das colhedoras, sendo que, durante o dia, a F400 também permaneceu paralisada por um período devido à chuva na área.
Com a mudança da F329, o potencial atual das frentes está abaixo de 660 t/h. Conforme demonstrado no gráfico acima, há risco de redução da moagem nas próximas horas, visto que temos um déficit de aproximadamente 200 toneladas de entrega em relação à moagem prevista para as próximas duas horas.

EXEMPLO UIM - REDUÇÃO E DÉFICIT POR FRENTE:
*Comunicado UIM*
No momento, a moagem da unidade está reduzida para 850 t/h, devido à indisponibilidade de colhedoras e transbordos próprios, além da baixa entrega das F511 e F514. O pátio está contabilizando 12 conjuntos carregados.
O principal ponto de atenção da unidade é a indisponibilidade mecânica dos equipamentos próprios, que apresentou média de 18% entre 16:00 e 18:00, com pico de 32% nas colhedoras próprias entre 19:00 e 20:00.
Além das manutenções próprias, a F514 está com déficit de 200 toneladas em relação à cota projetada para a moagem, enquanto a F511 apresenta déficit de 152 toneladas.
Conforme apresentado no gráfico acima, o pátio tende a apresentar uma queda brusca caso mantenhamos a moagem em 850 t/h. Dessa forma, o ideal neste momento é ajustarmos a moagem para 750 t/h, considerando que a média de saída de campo das últimas duas horas está em apenas 661 t/h.

EXEMPLO UICA - QUEDA DE ESTOQUE E TROCA TURNO:
*Comunicado UICA*
A moagem da unidade está liberada para 900 t/h. Entretanto, o pátio, que contabilizava 22 conjuntos às 20:00, está com 18 conjuntos neste momento e tende a cair mais nas próximas horas.
O principal motivo para a queda do estoque é a indisponibilidade mecânica de colhedoras próprias, que atingiu média de 21,6% entre 19:00 e 21:00, com 03 máquinas de duas linhas em manutenção.
Além da indisponibilidade de colhedoras, a F74 está em processo de mudança, enquanto a F78 está finalizando a área para realizar a mudança, impactando ainda mais o potencial de entrega da unidade.
No momento, o potencial de entrega está em aproximadamente 800 t/h, com uma chegada prevista de 750 toneladas até às 22:00. Caso essa chegada se confirme, o pátio poderá chegar a aproximadamente 14 conjuntos carregados.
Diante desses pontos, caso a indisponibilidade permaneça elevada, existe risco de redução da moagem entre 22:30 e 23:30, próximo à troca de turno.

EXEMPLO UISJ - CHUVA E LIBERAÇÃO:
*Comunicado UISJ*
No momento, estamos com 18 conjuntos carregados e 5 frentes em operação, com potencial de entrega de aproximadamente 400 t/h.
A Frente 03 está finalizando a mudança para a área de reforma. As demais frentes encontram-se paralisadas devido à chuva/solo úmido, com nova avaliação das áreas prevista para ocorrer após as 10h00.
Com a liberação da Frente 03, estimamos uma melhoria no potencial de entrega, atingindo entre 450 a 480 t/h a partir das 06h30, conforme demonstrado no gráfico acima.
Em alinhamento com o Supervisor Gilberto e a Cotur, foi definido o início da moagem com a mínima de 500 t para às 06:00

EXEMPLO VER - PREVISÃO FUTURA:
*VER*
Em análise das condições das frentes de colheita e considerando a disponibilidade da indústria, temos a previsão de liberação da moagem na VER em aproximadamente 350 t/h por volta das 09h00.
A partir das 09h00, com a liberação da frente 247, a capacidade de produção agrícola deverá se elevar para aproximadamente 450 t/h.
Considerando que a indústria necessita de cerca de 3 horas para estabelecer as condições necessárias para retomada da moagem, já estamos em contato para antecipar os preparativos e garantir o melhor sincronismo entre a disponibilidade agrícola e industrial.
`;

function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observações adicionais informadas.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h / SAÍDA (MOAGEM) ${r.moagem.toFixed(0)} t/h | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Estoque proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');
  const histTxt=calculos.historico.map(r=>`${horaFormatada(r.hora)}: Entrada ${r.potencial.toFixed(0)} / Moagem ${r.moagem.toFixed(0)} | Saldo ${r.potencial-r.moagem>=0?'+':''}${(r.potencial-r.moagem).toFixed(0)}t`).join('\n');

  return `
Você é analista sênior CTT Plano de Voo, especialista em escrever comunicados exatamente no padrão dos exemplos reais abaixo.

OBJETIVO: Gerar comunicado no padrão dos exemplos, mas MUITO MAIS ANALÍTICO, DETALHADO e com PROJEÇÃO FUTURA.

DADOS TÉCNICOS DA UNIDADE:
UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal MAXIMA ${unidade.nominal} t/h / Mínima operacional ${unidade.min} t/h / Gatilho redução pátio <${unidade.gatilhoReducao} conj
PÁTIO ATUAL: ${calculos.estoque.atual} conj | H-3: ${calculos.estoque.h3} | H-2: ${calculos.estoque.h2} | H-1: ${calculos.estoque.h1} | Variação 3h: ${calculos.estoque.variacao.toFixed(1)} conj
MÉDIA HISTÓRICA 3-4h: Entrada ${calculos.medias.historicoPotencial.toFixed(0)} t/h | Saída (Moagem) ${calculos.medias.historicoMoagem.toFixed(0)} t/h | Saldo médio ${calculos.medias.saldoHistorico.toFixed(0)} t/h
MENOR ESTOQUE PROJETADO: ${calculos.risco.menorEstoque.toFixed(1)} conj às ${horaFormatada(calculos.risco.horaMenorEstoque)} | Primeira hora risco gatilho: ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco até 12h'} | Déficit acumulado projetado: ${calculos.risco.deficitAcumulado.toFixed(0)}t

PROJEÇÃO HORA A HORA (ENTRADA = POTENCIAL FRENTE, SAÍDA = MOAGEM):
${projTxt}

HISTÓRICO RECENTE (O QUE JÁ ACONTECEU):
${histTxt}

OBSERVAÇÃO ADICIONAL DO CTT (ISSO É O FUTURO - USE PARA DIZER COMO MELHORA, LIBERAÇÃO DE FRENTES, CHUVA, MANUTENÇÃO, TROCA TURNO):
${comentarios}

REGRAS OBRIGATÓRIAS DE ESCRITA - COPIE O ESTILO DOS EXEMPLOS:

1. Comece sempre com "*Comunicado ${unidade.sigla}*" ou "*${unidade.sigla}*" se for VER.
2. Primeiro parágrafo: situação atual da moagem (SAÍDA) + pátio atual + média entrada últimas 3h. Ex: "No momento, a moagem da unidade está formalizada em X t/h, com um pátio contabilizando Y conjuntos. Entretanto, a média de entrada das últimas 3 horas está em apenas Z t/h."
3. Segundo parágrafo: EXPLIQUE O MOTIVO da baixa ou alta entrega usando a observação adicional. Se tiver indisponibilidade mecânica, informe % e horário igual exemplos. Se tiver mudança de frente, informe número da frente. Se tiver chuva, informe. Seja específico: "F511 déficit 152t", "indisponibilidade 16% entre 10:00 e 16:00".
4. Terceiro parágrafo: PROJEÇÃO FUTURA detalhada com base na entrada x saída. Calcule déficit: "déficit de aproximadamente 200 toneladas de entrega em relação à moagem". Diga para onde o pátio vai: "pátio poderá chegar a aproximadamente 14 conjuntos". Use os dados da projeção que te mandei.
5. Quarto parágrafo: RISCO e JANELA DE TROCA DE TURNO. Ex: "risco de redução da moagem entre 22:30 e 23:30, próximo à troca de turno" ou "troca de turno do transporte prevista para 18:00 e 21:00".
6. Quinto parágrafo: COMO MELHORA - Use a observação adicional para dizer como melhora. Ex: "Com a liberação da Frente 03, estimamos melhoria para 450 a 480 t/h a partir das 06h30" ou "Conforme cenário de manutenção entrar em linha, devido ao ciclo alto, podemos analisar aumento após 03:00". SEMPRE trazer solução.
7. Último parágrafo: "Seguimos acompanhando o cenário hora a hora e, em conjunto com a supervisão da unidade, iremos realizar os ajustes necessários" ou similar.
8. NÃO invente números de frente se não tiver na observação. Se a observação tiver "F329 em mudança", use F329.
9. NÃO crave moagem nova se não tiver déficit claro. Sugira de forma analítica: "o ideal neste momento é ajustarmos para X t/h, considerando que média de saída de campo está em Y".
10. Linguagem técnica, operacional, pronta para WhatsApp da diretoria. Use * para negrito quando precisar destacar.
11. Muito mais detalhado que exemplo, mínimo 5 parágrafos, com números reais de entrada, saída, pátio, déficit.

EXEMPLOS REAIS PARA COPIAR ESTILO:
${EXEMPLOS_PADRAO}

Gere APENAS o comunicado final, sem explicações.
`.trim();
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)) return res.status(400).json({error:'potencial array não enviado'});
    if(dados.estoque?.atual==null) return res.status(400).json({error:'estoque atual não informado'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    if(!unidade) return res.status(400).json({error:'unidade não identificada'});
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    const resultado=await chamarIA(prompt,{ maxOutputTokens:8000, timeoutMs:50000, thinkingLevel:'high', temperature:0.28 });
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, unidade, calculos, modelo:resultado.modelo});
  }catch(e){
    console.error('[ERRO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`PLANO DE VOO CTT - ${PORT} - Modelo ${GEMINI_MODELS[0]} - PADRÃO ANALÍTICO 5 EXEMPLOS`);
});
