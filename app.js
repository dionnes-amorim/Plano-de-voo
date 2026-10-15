/* =========================================================
   COA | PLANO DE VOO CTT - FRONTEND 100% LOCAL
   VERSÃO ANALÍTICA E GRADUAL CORRIGIDA - GERÊNCIA
========================================================= */

/* CONFIG DAS UNIDADES - MINIMOS REAIS */
const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, difusores: 2, minPorDifusor: 300, minTotal: 600, min1Difusor: 300 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, difusores: 2, minPorDifusor: 300, minTotal: 600, min1Difusor: 300 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, difusores: 1, minPorDifusor: 550, minTotal: 550, min1Difusor: 550 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, difusores: 1, minPorDifusor: 400, minTotal: 400, min1Difusor: 400 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, difusores: 1, minPorDifusor: 500, minTotal: 500, min1Difusor: 500 }
};

const $ = (id) => document.getElementById(id);

let parsedPotential = [];
let recognition = null;
let listening = false;
let lastAnalysisText = '';
let unidadeDetectada = null;

function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function identificarUnidade(texto) {
  const normalizado = normalizarTexto(texto);
  for (const chave of Object.keys(CONFIG_UNIDADES)) {
    if (normalizado.includes(chave)) return { chave,...CONFIG_UNIDADES[chave] };
  }
  if (normalizado.includes('UIM')) return { chave: 'MANDU',...CONFIG_UNIDADES['MANDU'] };
  if (normalizado.includes('UICA')) return { chave: 'CRUZ ALTA',...CONFIG_UNIDADES['CRUZ ALTA'] };
  if (normalizado.includes('UISJ')) return { chave: 'SAO JOSE',...CONFIG_UNIDADES['SAO JOSE'] };
  if (normalizado.includes('UIV')) return { chave: 'VERTENTE',...CONFIG_UNIDADES['VERTENTE'] };
  if (normalizado.includes('UIT')) return { chave: 'TANABI',...CONFIG_UNIDADES['TANABI'] };
  return { chave: 'MANDU',...CONFIG_UNIDADES['MANDU'] };
}

function numeroBR(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = String(valor).trim().replace(/[^\d.,-]/g, '');
  if (!texto) return null;
  if (texto.includes('.') && texto.includes(',')) texto = texto.replace(/\./g,'').replace(',','.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g,'');
  else if (texto.includes(',')) texto = texto.replace(',','.');
  const n = Number(texto); return Number.isFinite(n)? n : null;
}

function formatarNumero(numero, casas = 0) {
  if (numero === null || numero === undefined || isNaN(Number(numero))) return '-';
  return Number(numero).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function atualizarLabelsEstoque() {
  const h = new Date().getHours();
  const fmt = v => String((v+24)%24).padStart(2,'0')+'h';
  if ($('stockLabel1'))$('stockLabel1').textContent = fmt(h-3)+' - 3h';
  if ($('stockLabel2'))$('stockLabel2').textContent = fmt(h-2)+' - 2h';
  if ($('stockLabel3'))$('stockLabel3').textContent = fmt(h-1)+' - 1h';
  if ($('stockLabel4'))$('stockLabel4').textContent = fmt(h)+' • ATUAL';
}
atualizarLabelsEstoque();
setInterval(atualizarLabelsEstoque, 60000);

function interpretarTabela(texto) {
  if (!texto ||!texto.trim()) return { rows:[], unidade: null, error:'Cole a tabela de potencial.' };
  if (window.__parsePotential) {
    try {
      const p = window.__parsePotential(texto);
      if (p && p.dados && p.dados.length) {
        const unidade = identificarUnidade(texto);
        const rows = p.dados.map(d => ({
          hora: d.hora,
          horaNumero: Number(String(d.hora).split(':')[0] || String(d.hora).split('-')[0]),
          potencial: d.entrada, moagem: d.saida, entrada: d.entrada, saida: d.saida,
          maquinas: d.maquinas, despacho: d.despacho, nominal: unidade.nominal
        }));
        return { rows, unidade, nominal: unidade.nominal, parsedMandu: p, error: null };
      }
    } catch(e) {}
  }
  const unidade = identificarUnidade(texto);
  const linhas = texto.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  const rows = [];
  for (const linha of linhas) {
    const m = linha.match(/(\d{1,2})\s*-\s*(\d{1,2})/); if (!m) continue;
    const nums = linha.match(/[\d.,]+/g) || []; if (nums.length < 4) continue;
    const entrada = numeroBR(nums[nums.length-2]); const saida = numeroBR(nums[nums.length-1]);
    if (entrada === null || saida === null) continue;
    rows.push({ hora: `${String(Number(m[1])).padStart(2,'0')}:00`, horaNumero: Number(m[1]), potencial: entrada, moagem: saida, entrada, saida, nominal: unidade.nominal });
  }
  if (rows.length >= 3) return { rows, unidade, nominal: unidade.nominal, error: null };
  return { rows:[], unidade, error:'Não consegui identificar o formato.' };
}

function horaRelativa(hora, atual){ let d=(hora-atual+24)%24; if(d>12) d-=24; return d; }
function selecionarHistorico(rows){
  const atual = new Date().getHours();
  return rows.map(r=>({...r, distancia: horaRelativa(r.horaNumero, atual)})).filter(r=>r.distancia<0).sort((a,b)=>b.distancia-a.distancia).slice(0,3).sort((a,b)=>a.distancia-b.distancia);
}
function selecionarProjecao(rows){
  const atual = new Date().getHours();
  return rows.map(r=>({...r, distancia: horaRelativa(r.horaNumero, atual)})).filter(r=>r.distancia>=0).sort((a,b)=>a.distancia-b.distancia).slice(0,12);
}

function renderizarPreview(){
  const preview = $('previewArea'); const content =$('previewContent'); const badge = $('previewBadge'); const status =$('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando tabela...'; return; }
  const futuro = selecionarProjecao(parsedPotential);
  const historico = selecionarHistorico(parsedPotential);
  if(status){ status.textContent=`✓ ${parsedPotential.length} horários`; status.className='input-status success'; }
  if(badge) badge.textContent = unidadeDetectada? unidadeDetectada.nome.toUpperCase() : 'IDENTIFICADA';
  let html=''; if(unidadeDetectada) html+=`<div style="margin-bottom:10px"><strong>${unidadeDetectada.nome} (${unidadeDetectada.sigla})</strong> • Nominal ${formatarNumero(unidadeDetectada.nominal)} t/h • Mín ${formatarNumero(unidadeDetectada.minTotal)} t/h (${unidadeDetectada.difusores}x${unidadeDetectada.minPorDifusor})</div>`;
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">';
  futuro.forEach(r=>{ html+=`<div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:8px"><strong>${r.hora}</strong><br><span style="font-size:11px">Ent ${Math.round(r.potencial)} / Moag ${Math.round(r.moagem)}</span></div>`; });
  html+='</div>';
  if(historico.length) html+=`<div style="margin-top:10px;font-size:11px"><strong>Histórico 3h:</strong> ${historico.map(r=>`${r.hora} → ${Math.round(r.potencial)}/${Math.round(r.moagem)}`).join(' • ')}</div>`;
  if(content) content.innerHTML=html; if(preview) preview.classList.remove('hidden');
}

const potentialInputEl = $('potentialInput');
if(potentialInputEl){
  potentialInputEl.addEventListener('input', function(){
    const resultado = interpretarTabela(this.value);
    if(resultado.error){ parsedPotential=[]; unidadeDetectada=resultado.unidade||null; if($('potentialStatus')){ $('potentialStatus').textContent=resultado.error; $('potentialStatus').className='input-status error'; } if($('previewArea'))$('previewArea').classList.add('hidden'); return; }
    parsedPotential = resultado.rows; unidadeDetectada = resultado.unidade; renderizarPreview();
  });
}

function configurarReconhecimento(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ if($('micButton'))$('micButton').disabled = true; return; }
  recognition = new SR(); recognition.lang = 'pt-BR'; recognition.continuous = true; recognition.interimResults = true;
  recognition.onstart = () => { listening = true; if($('micButton'))$('micButton').classList.add('recording'); if($('voiceStatus'))$('voiceStatus').textContent = 'Ouvindo...'; };
  recognition.onresult = (e) => {
    let finalTranscript = '';
    for(let i = e.resultIndex; i < e.results.length; i++){ if(e.results[i].isFinal) finalTranscript += e.results[i][0].transcript; }
    const ta = $('comments'); if(ta && finalTranscript){ ta.value = ta.value.trim()? ta.value.trim()+' '+finalTranscript.trim() : finalTranscript.trim(); }
  };
  recognition.onend = () => { listening = false; if($('micButton'))$('micButton').classList.remove('recording'); if($('voiceStatus'))$('voiceStatus').textContent = 'Clique no microfone para ditar.'; };
}
configurarReconhecimento();
if($('micButton')) {$('micButton').addEventListener('click', () => { if(!recognition) return; if(listening) recognition.stop(); else try{recognition.start();}catch(e){} }); }

function montarDados(){
  const inputEl = $('potentialInput'); if(!inputEl) throw new Error('Campo de tabela não encontrado.');
  const tabela = inputEl.value.trim(); if(!tabela) throw new Error('Cole a Análise de Potencial.');
  const resultado = interpretarTabela(tabela); if(resultado.error) throw new Error(resultado.error);
  parsedPotential = resultado.rows; unidadeDetectada = resultado.unidade || identificarUnidade(tabela);
  const eAtual =$('stockCurrent')?.value; if(eAtual===''||eAtual==null) throw new Error('Informe o estoque atual.');
  return { tabelaOriginal: tabela, unidade: unidadeDetectada, nominal: unidadeDetectada.nominal, potencial: parsedPotential, parsedMandu: resultado.parsedMandu, estoque: {h3:Number($('stock1')?.value||0), h2:Number($('stock2')?.value||0), h1:Number($('stock3')?.value||0), atual:Number(eAtual)}, comentarios: $('comments')?$('comments').value.trim() : '' };
}

async function gerarPlanoVoo(){
  const botao=$('generateButton'); const textoBotao=$('generateText'); const icone=$('generateIcon');
  try{
    const dados = montarDados();
    if(botao) botao.disabled=true; if(textoBotao) textoBotao.textContent='GERANDO PLANO GERÊNCIA...'; if(icone) icone.textContent='⏳';
    if($('errorArea'))$('errorArea').classList.add('hidden'); if($('loadingArea'))$('loadingArea').classList.remove('hidden'); if($('resultArea'))$('resultArea').classList.add('hidden');
    await new Promise(r => setTimeout(r, 150));

    let entradaTotal, saidaTotal, ultimas3Entrada, ultimas3Saida, saldo3;
    if(dados.parsedMandu){ entradaTotal=dados.parsedMandu.entradaTotal; saidaTotal=dados.parsedMandu.saidaTotal; ultimas3Entrada=dados.parsedMandu.ultimas3Entrada; ultimas3Saida=dados.parsedMandu.ultimas3Saida; saldo3=dados.parsedMandu.saldo3; }
    else { const hist = selecionarHistorico(dados.potencial); const us = hist.length? hist : dados.potencial.slice(-3); ultimas3Entrada = us.reduce((a,b)=>a+(b.entrada||0),0); ultimas3Saida = us.reduce((a,b)=>a+(b.saida||0),0); saldo3 = ultimas3Entrada - ultimas3Saida; entradaTotal = dados.potencial.reduce((a,b)=>a+(b.entrada||0),0); saidaTotal = dados.potencial.reduce((a,b)=>a+(b.saida||0),0); }

    const mediaEnt = ultimas3Entrada/3; const mediaSai = ultimas3Saida/3; const estoqueAtual = dados.estoque.atual; const estoqueTon = estoqueAtual * 70;
    const uni = dados.unidade; const nominal = uni.nominal; const minTotal = uni.minTotal; const minPorDif = uni.minPorDifusor; const numDif = uni.difusores;
    const proj = selecionarProjecao(dados.potencial);
    let estoqueSim = estoqueAtual; let menorEstoque = estoqueAtual; let horaMenor = new Date().getHours(); let horaCritica = null; let horaZera = null;
    const projDetalhada = [];
    for(const r of proj){ const saldo = r.entrada - r.saida; estoqueSim += saldo/70; projDetalhada.push({hora:r.hora, horaNum:r.horaNumero, entrada:r.entrada, saida:r.saida, saldo, estoqueProj:estoqueSim}); if(estoqueSim<menorEstoque){menorEstoque=estoqueSim; horaMenor=r.horaNumero;} if(horaCritica==null && estoqueSim<=7) horaCritica=r.horaNumero; if(horaZera==null && estoqueSim<=0) horaZera=r.horaNumero; }

    const fmtH = (h) => String((h+24)%24).padStart(2,'0')+':00';
    const agoraH = new Date().getHours();
    let nivel='ESTÁVEL', moagemSugerida = Math.round(mediaSai), planoReducao='';

    if(saldo3 < -400 || estoqueAtual <= 5){
      nivel='CRÍTICO - REDUÇÃO É ÚLTIMO CASO';
      moagemSugerida = Math.max(minTotal, Math.round(mediaSai - 100));
      planoReducao = `→ ${fmtH(agoraH)} até ${horaCritica!=null?fmtH(horaCritica):fmtH(agoraH+2)}: TENTAR MANTER ${Math.round(mediaSai)} t/h ACELERANDO CORTE. Se não reagir, REDUZIR GRADUAL para ${moagemSugerida} t/h (recuo 100t/h)\n→ Se estoque <7 conj: Reduzir para MÍNIMO OPERACIONAL ${minTotal} t/h (${numDif}x${minPorDif})\n→ ÚLTIMO CASO ABSOLUTO: Desligar 1 difusor → ${uni.min1Difusor} t/h. Só se estoque ≤2 conj\n→ RETORNO: Quando estoque ≥10 conj E entrada > ${Math.round(mediaSai+30)} t/h por 2h, voltar para ${Math.round(mediaSai)} t/h e depois escalonar +50t/h por hora até nominal ${nominal} t/h`;
    } else if(saldo3 < -150 || estoqueAtual <= 8){
      nivel='ATENÇÃO / QUEDA';
      moagemSugerida = Math.max(minTotal, Math.round(mediaSai - 50));
      planoReducao = `→ Próximas 2h: Manter ${Math.round(mediaSai)} t/h e acelerar entrada para > ${Math.round(mediaSai+30)} t/h\n→ Se saldo continuar negativo: Reduzir gradual 50t/h para ${moagemSugerida} t/h\n→ NÃO ir para mínimo ${minTotal} t/h agora\n→ RETORNO: Quando saldo 3h ficar positivo por 2h seguidas, escalonar +50t/h até ${nominal} t/h`;
    } else if(saldo3 > 150){
      nivel='RECUPERAÇÃO';
      moagemSugerida = Math.min(nominal, Math.round(mediaSai + 50));
      planoReducao = `→ Cenário favorável. Elevar gradual de ${Math.round(mediaSai)} para ${moagemSugerida} t/h\n→ Janelas de recuperação: ${projDetalhada.filter(p=>p.entrada>p.saida).map(p=>p.hora).join(', ')||'avaliar'}\n→ RETORNO AO NOMINAL: Já pode buscar ${nominal} t/h se entrada sustentar > ${nominal-50} t/h`;
    } else {
      nivel='ESTÁVEL';
      planoReducao = `→ Manter ${Math.round(mediaSai)} t/h nas próximas ${projDetalhada.length}h\n→ RETORNO: Buscar ${nominal} t/h em passos de 50t/h`;
    }

    const autonomiaAtual = (estoqueTon / (mediaSai||nominal)).toFixed(1);
    const autonomiaMin = (estoqueTon / minTotal).toFixed(1);

    lastAnalysisText =
`*PLANO DE VOO — ${uni.sigla} ${uni.nome.toUpperCase()} — ${nivel}*
Nominal ${nominal} t/h | Mínimo ${minTotal} t/h (${numDif}x ${minPorDif}) | Último caso 1 difusor ${uni.min1Difusor} t/h

*SITUAÇÃO ATUAL - ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}*
Estoque: ${estoqueAtual} conj (${estoqueTon.toFixed(0)}t) | Autonomia ${autonomiaAtual}h a ${Math.round(mediaSai)} t/h | ${autonomiaMin}h no mínimo
Últimas 3h: Ent ${ultimas3Entrada.toFixed(0)}t / Saída ${ultimas3Saida.toFixed(0)}t | Saldo ${saldo3.toFixed(0)}t
Média 3h: Ent ${mediaEnt.toFixed(0)} t/h / Moag ${mediaSai.toFixed(0)} t/h | Dia: Ent ${entradaTotal.toFixed(0)}t / Saída ${saidaTotal.toFixed(0)}t

*PROJEÇÃO HORA A HORA*
${projDetalhada.map(p=>`${p.hora} | Ent ${p.entrada.toFixed(0)} / Moag ${p.saida.toFixed(0)} | Saldo ${p.saldo>=0?'+':''}${p.saldo.toFixed(0)} | Estoque proj ${p.estoqueProj.toFixed(1)} conj ${p.estoqueProj<=7?'⚠':''}`).join('\n')}
→ Menor estoque: ${menorEstoque.toFixed(1)} conj às ${fmtH(horaMenor)}
${horaCritica!=null?`→ Risco ≤7 conj às ${fmtH(horaCritica)}`: '→ Sem risco ≤7 conj no horizonte'}
${horaZera!=null?`→ RISCO DE ZERAR às ${fmtH(horaZera)}`: ''}

*PLANO DE AÇÃO - REDUÇÃO É ÚLTIMO CASO*
${planoReducao}

*GATILHOS GERÊNCIA*
- Se estoque ≥12 conj por 2h: Liberar nominal ${nominal} t/h
- Se 8-10 conj: Manter ${moagemSugerida} t/h
- Se ≤7 conj: Reduzir para ${Math.max(minTotal, moagemSugerida-50)} t/h + acionar liderança
- Se ≤4 conj: Mínimo ${minTotal} t/h
- Se ≤2 conj: ÚLTIMO CASO ${uni.min1Difusor} t/h

${dados.comentarios?`*OBS OPERACIONAL:* ${dados.comentarios}\n`:''}
`;

    if($('kpiStock'))$('kpiStock').textContent=`${estoqueAtual} (${estoqueTon.toFixed(0)}t)`;
    if($('kpiTrend')){ const tend=estoqueAtual - dados.estoque.h1; $('kpiTrend').textContent=`${tend>=0?'+':''}${formatarNumero(tend,1)}`; $('kpiTrend').className=`kpi-value ${tend<0?'danger':'positive'}`;}
    if($('kpiSafeMoagem'))$('kpiSafeMoagem').textContent=formatarNumero(moagemSugerida);
    if($('kpiRiskHour'))$('kpiRiskHour').textContent=horaCritica!=null?fmtH(horaCritica):nivel;
    if($('resultStatus'))$('resultStatus').textContent=`${uni.sigla} • Nom ${formatarNumero(nominal)} • Mín ${minTotal} • ${nivel} • Aut ${autonomiaAtual}h`;
    if($('analysisText'))$('analysisText').textContent=lastAnalysisText;
    if($('calculationContent'))$('calculationContent').innerHTML=`Ent ${mediaEnt.toFixed(0)} / Sai ${mediaSai.toFixed(0)} | Saldo 3h ${saldo3.toFixed(0)}t | Menor proj ${menorEstoque.toFixed(1)} conj às ${fmtH(horaMenor)}`;

    if($('resultArea')){ $('resultArea').classList.remove('hidden'); window.scrollTo({top:$('resultArea').offsetTop-20,behavior:'smooth'}); }

  }catch(err){
    console.error(err); if($('errorMessage'))$('errorMessage').textContent=err.message; if($('errorArea'))$('errorArea').classList.remove('hidden');
  }finally{
    if(botao) botao.disabled=false; if(textoBotao) textoBotao.textContent='GERAR PLANO DE VOO'; if(icone) icone.textContent='→'; if($('loadingArea'))$('loadingArea').classList.add('hidden');
  }
}

if($('generateButton'))$('generateButton').addEventListener('click', gerarPlanoVoo);
if($('copyButton'))$('copyButton').addEventListener('click', async function(){ if(!lastAnalysisText) return; try{await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado'; setTimeout(()=>this.textContent=o,1500);}catch(e){}});
if($('clearButton'))$('clearButton').addEventListener('click', function(){
  if($('potentialInput'))$('potentialInput').value='';
  ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{ if($(id))$(id).value=''; });
  parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null;
  if($('previewArea'))$('previewArea').classList.add('hidden');
  if($('potentialStatus'))$('potentialStatus').textContent='';
  if($('resultArea'))$('resultArea').classList.add('hidden');
  if($('errorArea'))$('errorArea').classList.add('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
});
