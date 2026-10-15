require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TONELADAS_POR_CONJUNTO = 70;

// MODELOS QUE FUNCIONAM - IGUAL SEU OUTRO SISTEMA
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

// UNIDADES UNIFICADAS - IGUAL APP.JS + SERVER.JS
const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function textoSeguro(v,l=10000){ return String(v||'').replace(/\u0000/g,'').trim().slice(0,l); }
function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function horaNumero(h){ const m=String(h||'').match(/\d{1,2}/); if(!m) return null; const n=Number(m[0]); return n>=0&&n<=23?n:null; }
function horaFormatada(h){ const n=horaNumero(h); return n==null?'--':`${String(n).padStart(2,'0')}:00`; }
function horaRelativa(h,ha){ let d=(h-ha+24)%24; if(d>12) d-=24; return d; }
function numeroBR(v){ if(v==null) return null; let t=String(v).trim().replace(/[^\d.,-]/g,''); if(!t) return null; if(t.includes('.')&&t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); else if(t.includes(',')) t=t.replace(',','.'); const n=Number(t); return Number.isFinite(n)?n:null; }

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
  let horaAtual=horaNumero(dados.horaAtual); if(horaAtual==null) horaAtual=new Date().getHours();
  const comRel=potencial.map(r=>({...r, relativo:horaRelativa(r.hora, horaAtual)}));
  const historico=comRel.filter(r=>r.relativo!=null&&r.relativo<0).sort((a,b)=>b.relativo-a.relativo).slice(0,4);
  const futuro=comRel.filter(r=>r.relativo!=null&&r.relativo>=0).sort((a,b)=>a.relativo-b.relativo).slice(0,12);
  const mediaHistPot=historico.length?historico.reduce((t,r)=>t+r.potencial,0)/historico.length:0;
  const mediaHistMoag=historico.length?historico.reduce((t,r)=>t+r.moagem,0)/historico.length:unidade.nominal;
  let estoqueProj=atual, menorEstoque=atual, horaMenor=horaAtual, primeiraHoraRisco=null, horaQueda=null;
  const projecao=[];
  for(const row of futuro){
    const saldo=row.potencial-row.moagem; estoqueProj+=saldo/TONELADAS_POR_CONJUNTO;
    projecao.push({hora:row.hora, horaFormatada:horaFormatada(row.hora), potencial:row.potencial, moagem:row.moagem, saldoToneladas:saldo, estoqueProjetado:estoqueProj});
    if(estoqueProj<menorEstoque){ menorEstoque=estoqueProj; horaMenor=row.hora; }
    if(primeiraHoraRisco==null && estoqueProj < unidade.gatilhoReducao) primeiraHoraRisco=row.hora;
    if(horaQueda==null && row.potencial < row.moagem*0.9) horaQueda=row.hora;
  }
  return {
    unidade, horaAtual,
    estoque:{h3,h2,h1,atual, variacao:atual-h3},
    medias:{historicoPotencial:mediaHistPot, historicoMoagem:mediaHistMoag, saldoHistorico:mediaHistPot-mediaHistMoag},
    historico, projecaoEstoque:projecao,
    risco:{menorEstoque, horaMenorEstoque:horaMenor, primeiraHoraRisco, horaQueda, deficit: mediaHistMoag - mediaHistPot},
    moagemSugerida: Math.round(mediaHistMoag)
  };
}

function normalizarPublicacaoIA(texto){
  return String(texto||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/```(?:text|markdown)?/gi,'').replace(/```/g,'').replace(/^#{1,6}\s*/gm,'').replace(/\*{2,}/g,'*').replace(/\n{3,}/g,'\n\n').trim();
}
function obterConfigPensamento(modelo, nivel){
  if(modelo.includes('3.8')||modelo.includes('flash-latest')) return { thinkingConfig:{ thinkingLevel: nivel||'high' } };
  if(modelo.includes('2.5')) return { thinkingConfig:{ thinkingBudget: 4096 } };
  return {};
}
function extrairTextoGemini(data){
  const partes=data?.candidates?.[0]?.content?.parts||[];
  return partes.filter(p=>p&&typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('\n').trim();
}
async function chamarIA(prompt, options={}){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada no Render > Environment');
  let ultimoErro='Erro IA';
  for(const modelo of GEMINI_MODELS){
    const controller=new AbortController();
    let timeout=null;
    try{
      console.log(`[IA] Tentando ${modelo}`);
      timeout=setTimeout(()=>controller.abort(), options.timeoutMs||45000);
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const generationConfig={ temperature:0.28, maxOutputTokens: options.maxOutputTokens||8000,...obterConfigPensamento(modelo, options.thinkingLevel||'high') };
      const response=await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig}), signal:controller.signal });
      const raw=await response.text();
      if(!raw) throw new Error('vazio');
      const data=JSON.parse(raw);
      if(!response.ok){ ultimoErro=`${modelo} ${response.status}: ${data?.error?.message||raw.slice(0,600)}`; console.error(ultimoErro); if([400,401,403].includes(response.status)) throw new Error(ultimoErro); continue; }
      const texto=extrairTextoGemini(data);
      if(!texto) continue;
      console.log(`[IA] SUCESSO ${modelo} ${texto.length} chars`);
      return { texto: normalizarPublicacaoIA(texto), modelo };
    }catch(e){ ultimoErro=e.name==='AbortError'?`Timeout ${modelo}`:e.message; console.error(`[IA] Falha ${modelo}: ${ultimoErro}`); continue; }
    finally{ if(timeout) clearTimeout(timeout); }
  }
  throw new Error(ultimoErro);
}

const EXEMPLOS_PADRAO = `
EXEMPLO UIT:
*Comunicado UIT*
De momento, a moagem da unidade está formalizada em 710 t/h, com um pátio contabilizando 14 conjuntos carregados. Entretanto, a média de entrada das últimas 3 horas está em apenas 664 t/h.
O principal motivo da baixa entrega é a indisponibilidade mecânica das colhedoras próprias, que apresentou média de 16% entre 10:00 e 16:00, impactando diretamente a produtividade das frentes.
Além da indisponibilidade, ao decorrer do dia ocorreram as mudanças das frentes 325 e 330. De momento, a F329 está em processo de mudança, todas sendo frentes próprias. Já as F312 e F400 apresentam déficit de entrega devido à manutenção das colhedoras, sendo que, durante o dia, a F400 também permaneceu paralisada por um período devido à chuva na área.
Com a mudança da F329, o potencial atual das frentes está abaixo de 660 t/h. Conforme demonstrado no gráfico acima, há risco de redução da moagem nas próximas horas, visto que temos um déficit de aproximadamente 200 toneladas de entrega em relação à moagem prevista para as próximas duas horas.
Seguimos acompanhando o cenário hora a hora e, em conjunto com a supervisão da unidade, iremos realizar os ajustes necessários conforme a evolução da operação.

EXEMPLO UIM:
*Comunicado UIM*
No momento, a moagem da unidade está reduzida para 850 t/h, devido à indisponibilidade de colhedoras e transbordos próprios, além da baixa entrega das F511 e F514. O pátio está contabilizando 12 conjuntos carregados.
O principal ponto de atenção da unidade é a indisponibilidade mecânica dos equipamentos próprios, que apresentou média de 18% entre 16:00 e 18:00, com pico de 32% nas colhedoras próprias entre 19:00 e 20:00.
Além das manutenções próprias, a F514 está com déficit de 200 toneladas em relação à cota projetada para a moagem, enquanto a F511 apresenta déficit de 152 toneladas.
Conforme apresentado no gráfico acima, o pátio tende a apresentar uma queda brusca caso mantenhamos a moagem em 850 t/h. Dessa forma, o ideal neste momento é ajustarmos a moagem para 750 t/h, considerando que a média de saída de campo das últimas duas horas está em apenas 661 t/h, o que deve resultar em uma chegada de cana mais baixa nas próximas duas horas.
Conforme o cenário de manutenção de colhedoras entrar em linha, devido ao ciclo alto, podemos analisar um aumento da moagem após às 03:00.
Seguimos acompanhando o cenário hora a hora e, caso a indisponibilidade das colhedoras permaneça elevada, poderá ser necessária uma nova redução da moagem para a rotação mínima da unidade.

EXEMPLO UICA:
*Comunicado UICA*
A moagem da unidade está liberada para 900 t/h. Entretanto, o pátio, que contabilizava 22 conjuntos às 20:00, está com 18 conjuntos neste momento e tende a cair mais nas próximas horas.
O principal motivo para a queda do estoque é a indisponibilidade mecânica de colhedoras próprias, que atingiu média de 21,6% entre 19:00 e 21:00, com 03 máquinas de duas linhas em manutenção.
Além da indisponibilidade de colhedoras, a F74 está em processo de mudança, enquanto a F78 está finalizando a área para realizar a mudança, impactando ainda mais o potencial de entrega da unidade.
No momento, o potencial de entrega está em aproximadamente 800 t/h, com uma chegada prevista de 750 toneladas até às 22:00. Caso essa chegada se confirme, o pátio poderá chegar a aproximadamente 14 conjuntos carregados.
Diante desses pontos, caso a indisponibilidade permaneça elevada, existe risco de redução da moagem entre 22:30 e 23:30, próximo à troca de turno.
Seguimos acompanhando o cenário da unidade junto a supervisão da unidade e reforçando o alinhamento com a indústria, buscando manter a moagem o mais próximo possível das 900 t/h.

EXEMPLO UISJ:
*Comunicado UISJ*
No momento, estamos com 18 conjuntos carregados e 5 frentes em operação, com potencial de entrega de aproximadamente 400 t/h.
A Frente 03 está finalizando a mudança para a área de reforma. As demais frentes encontram-se paralisadas devido à chuva/solo úmido, com nova avaliação das áreas prevista para ocorrer após as 10h00.
Com a liberação da Frente 03, estimamos uma melhoria no potencial de entrega, atingindo entre 450 a 480 t/h a partir das 06h30, conforme demonstrado no gráfico acima.
Em alinhamento com o Supervisor Gilberto e a Cotur, foi definido o início da moagem com a mínima de 500 t para ás 06:00

EXEMPLO VER:
*VER*
Em análise das condições das frentes de colheita e considerando a disponibilidade da indústria, temos a previsão de liberação da moagem na VER em aproximadamente 350 t/h por volta das 09h00.
A partir das 09h00, com a liberação da frente 247, a capacidade de produção agrícola deverá se elevar para aproximadamente 450 t/h.
Considerando que a indústria necessita de cerca de 3 horas para estabelecer as condições necessárias para retomada da moagem, já estamos em contato para antecipar os preparativos e garantir o melhor sincronismo entre a disponibilidade agrícola e industrial.
`;

function montarPrompt(dados, calculos, unidade){
  const comentarios=textoSeguro(dados.comentarios,8000)||'Sem observações adicionais.';
  const projTxt=calculos.projecaoEstoque.map(r=>`${r.horaFormatada}: ENTRADA ${r.potencial.toFixed(0)} t/h (potencial frentes) / SAÍDA ${r.moagem.toFixed(0)} t/h (moagem) | Saldo ${r.saldoToneladas>=0?'+':''}${r.saldoToneladas.toFixed(0)}t | Estoque proj ${r.estoqueProjetado.toFixed(1)} conj`).join('\n');
  const histTxt=calculos.historico.map(r=>`${horaFormatada(r.hora)}: Entrada ${r.potencial.toFixed(0)} / Moagem ${r.moagem.toFixed(0)}`).join('\n');

  return `
Você é analista sênior CTT Plano de Voo. Escreva EXATAMENTE no padrão analítico dos exemplos reais.

DADOS:
UNIDADE: ${unidade.nome} (${unidade.sigla}) - ${unidade.tipo} - Nominal MÁXIMA ${unidade.nominal} t/h / Mínima ${unidade.min} t/h / Gatilho <${unidade.gatilhoReducao} conj
PÁTIO: Atual ${calculos.estoque.atual} conj (H-3 ${calculos.estoque.h3} / H-2 ${calculos.estoque.h2} / H-1 ${calculos.estoque.h1}) Variação ${calculos.estoque.variacao.toFixed(1)} conj
MÉDIA 3-4h: Entrada ${calculos.medias.historicoPotencial.toFixed(0)} t/h / Saída Moagem ${calculos.medias.historicoMoagem.toFixed(0)} t/h / Saldo ${calculos.medias.saldoHistorico.toFixed(0)}t/h / Déficit atual ${calculos.risco.deficit.toFixed(0)}t/h
PROJEÇÃO:
${projTxt}
Menor estoque projetado ${calculos.risco.menorEstoque.toFixed(1)} conj às ${horaFormatada(calculos.risco.horaMenorEstoque)} | Risco gatilho ${calculos.risco.primeiraHoraRisco!=null?horaFormatada(calculos.risco.primeiraHoraRisco):'sem risco 12h'} | Queda a partir ${calculos.risco.horaQueda!=null?horaFormatada(calculos.risco.horaQueda):'--'}
HISTÓRICO:
${histTxt}
OBSERVAÇÃO ADICIONAL (USE PARA EXPLICAR MOTIVO E COMO MELHORA - FRENTE EM MUDANÇA, QUEBRA COLHEDORA, CHUVA, TROCA TURNO):
${comentarios}

INSTRUÇÕES DE ESCRITA - COPIE O ESTILO DOS EXEMPLOS - SEJA MUITO MAIS ANALÍTICO:
1. Comece *Comunicado ${unidade.sigla}*
2. Parágrafo 1: moagem atual (SAÍDA) + pátio atual + média entrada 3h
3. Parágrafo 2: MOTIVO da baixa/alta entrega usando observação adicional. Se tiver indisponibilidade mecânica informe % e horário. Se tiver mudança de frente informe número. Se tiver chuva informe.
4. Parágrafo 3: PROJEÇÃO FUTURA com déficit em toneladas: "déficit de aproximadamente 200 toneladas em relação à moagem" + para onde pátio vai: "pátio poderá chegar a 14 conjuntos"
5. Parágrafo 4: RISCO e TROCA DE TURNO: "risco de redução entre 22:30 e 23:30 próximo à troca de turno"
6. Parágrafo 5: COMO MELHORA com base na observação: "Com liberação da Frente 03 estimamos melhoria para 450 a 480 t/h a partir das 06h30" ou "Conforme manutenção entrar em linha podemos analisar aumento após 03:00"
7. Finalize com "Seguimos acompanhando hora a hora..."
8. Não invente frentes. Use só o que está na observação.
9. Mínimo 5 parágrafos, técnico, pronto WhatsApp gestão, com números reais.

EXEMPLOS PARA COPIAR ESTILO:
${EXEMPLOS_PADRAO}
Retorne APENAS comunicado final.
`.trim();
}

app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, gemini:!!GEMINI_API_KEY, modelos:GEMINI_MODELS, modelo_principal:GEMINI_MODELS[0], unidades:CONFIG_UNIDADES, time:new Date().toISOString()}); });

app.post('/api/plano-voo', async (req,res)=>{
  try{
    const dados=req.body||{};
    if(!Array.isArray(dados.potencial)||!dados.potencial.length) return res.status(400).json({error:'potencial array não enviado. Cole a tabela'});
    if(dados.estoque?.atual==null||dados.estoque.atual==='') return res.status(400).json({error:'estoque atual não informado'});
    const unidade=identificarUnidade(dados.tabelaOriginal||'');
    const calculos=calcularCenario(dados, unidade);
    const prompt=montarPrompt(dados, calculos, unidade);
    console.log(`[REQ] ${unidade.sigla} ${unidade.nome} Estoque ${dados.estoque.atual} Entrada média ${calculos.medias.historicoPotencial.toFixed(0)}`);
    const resultado=await chamarIA(prompt,{ maxOutputTokens:8000, timeoutMs:50000, thinkingLevel:'high', temperature:0.28 });
    return res.json({ok:true, texto:resultado.texto, comunicado:resultado.texto, planoVoo:resultado.texto, unidade, calculos, modelo:resultado.modelo});
  }catch(e){
    console.error('[ERRO]', e.message);
    return res.status(500).json({error:e.message});
  }
});

app.use('/api', (req,res)=>{ res.status(404).json({error:'Rota API não encontrada: '+req.originalUrl}); });

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`\n=== PLANO DE VOO CTT UNIFICADO PORTA ${PORT} ===`);
  console.log(`Modelo principal: ${GEMINI_MODELS[0]}`);
  console.log(`Fallback: ${GEMINI_MODELS.slice(1).join(' -> ')}`);
  Object.values(CONFIG_UNIDADES).forEach(u=>console.log(` ${u.sigla} ${u.nome} Nom ${u.nominal} Min ${u.min} Gatilho <${u.gatilhoReducao} ${u.tipo}`));
  console.log('==============================================\n');
});
