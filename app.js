/* =========================================================
   COA | PLANO DE VOO CTT - FRONTEND 100% LOCAL
   VERSÃO CORRIGIDA FINAL - SEM API / SEM IA
========================================================= */

/* CONFIG DAS UNIDADES */
const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', nominal: 917 },
  'CRUZ ALTA': { nome: 'Cruz Alta', nominal: 900 },
  'SAO JOSE': { nome: 'São José', nominal: 750 },
  'VERTENTE': { nome: 'Vertente', nominal: 500 },
  'TANABI': { nome: 'Tanabi', nominal: 710 }
};

const $ = (id) => document.getElementById(id);

let parsedPotential = [];
let recognition = null;
let listening = false;
let lastAnalysisText = '';
let unidadeDetectada = null;

/* NORMALIZAR */
function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

/* IDENTIFICAR UNIDADE */
function identificarUnidade(texto) {
  const normalizado = normalizarTexto(texto);
  for (const chave of Object.keys(CONFIG_UNIDADES)) {
    if (normalizado.includes(chave)) {
      return { chave,...CONFIG_UNIDADES[chave] };
    }
  }
  return null;
}

/* NÚMERO BR - CORRIGIDO */
function numeroBR(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = String(valor).trim();
  if (!texto) return null;
  // Remove tudo menos dígito,. -
  texto = texto.replace(/[^\d.,-]/g, '');
  if (texto.includes('.') && texto.includes(',')) {
    texto = texto.replace(/\./g,'').replace(',','.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    texto = texto.replace(/\./g,'');
  } else if (texto.includes(',')) {
    texto = texto.replace(',','.');
  }
  const n = Number(texto);
  return Number.isFinite(n)? n : null;
}

function formatarNumero(numero, casas = 0) {
  if (numero === null || numero === undefined || isNaN(Number(numero))) return '-';
  return Number(numero).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/* LABELS ESTOQUE */
function atualizarLabelsEstoque() {
  const agora = new Date();
  const h = agora.getHours();
  const fmt = v => String((v+24)%24).padStart(2,'0')+'h';
  if ($('stockLabel1')) $('stockLabel1').textContent = fmt(h-3)+' - 3h';
  if ($('stockLabel2')) $('stockLabel2').textContent = fmt(h-2)+' - 2h';
  if ($('stockLabel3')) $('stockLabel3').textContent = fmt(h-1)+' - 1h';
  if ($('stockLabel4')) $('stockLabel4').textContent = fmt(h)+' • ATUAL';
}
atualizarLabelsEstoque();
setInterval(atualizarLabelsEstoque, 60000);

/* PARSER PRINCIPAL */
function interpretarTabela(texto) {
  if (!texto ||!texto.trim()) return { rows:[], unidade: null, error:'Cole a tabela de potencial.' };

  // 1 - Usa o parser do index.html se existir (o que você validou)
  if (window.__parsePotential) {
    try {
      const p = window.__parsePotential(texto);
      if (p && p.dados && p.dados.length) {
        const unidade = identificarUnidade(texto) || { chave:'MANDU', nome: p.filial||'Mandu', nominal:917 };
        const nominalFinal = CONFIG_UNIDADES[unidade.chave]?.nominal || unidade.nominal || 917;
        const rows = p.dados.map(d => ({
          hora: d.hora,
          horaNumero: Number(String(d.hora).split(':')[0]),
          potencial: d.entrada,
          moagem: d.saida,
          entrada: d.entrada,
          saida: d.saida,
          maquinas: d.maquinas,
          despacho: d.despacho,
          nominal: nominalFinal
        }));
        return { rows, unidade: {...unidade, nominal: nominalFinal}, nominal: nominalFinal, parsedMandu: p, error: null };
      }
    } catch(e) { console.warn('Parser index falhou, usando fallback', e); }
  }

  // 2 - Fallback
  const unidade = identificarUnidade(texto) || { chave:'MANDU', nome:'Mandu', nominal:917 };
  const linhas = texto.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  const rows = [];
  for (const linha of linhas) {
    const m = linha.match(/^(\d{1,2})\s*-\s*(\d{1,2})/);
    if (!m) continue;
    const nums = linha.match(/[\d.,]+/g) || [];
    if (nums.length < 4) continue;
    const entrada = numeroBR(nums[nums.length-2]);
    const saida = numeroBR(nums[nums.length-1]);
    if (entrada === null || saida === null) continue;
    rows.push({
      hora: `${String(Number(m[1])).padStart(2,'0')}:00`,
      horaNumero: Number(m[1]),
      potencial: entrada, moagem: saida, entrada, saida,
      nominal: unidade.nominal
    });
  }
  if (rows.length >= 3) return { rows, unidade, nominal: unidade.nominal, error: null };
  return { rows:[], unidade, error:'Não consegui identificar o formato. Verifique se copiou hora, entrada e saída.' };
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

/* PREVIEW */
function renderizarPreview(){
  const preview = $('previewArea'); const content = $('previewContent'); const badge = $('previewBadge'); const status = $('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando tabela...'; return; }
  const futuro = selecionarProjecao(parsedPotential);
  const historico = selecionarHistorico(parsedPotential);
  if(status){ status.textContent=`✓ ${parsedPotential.length} horários identificados`; status.className='input-status success'; }
  if(badge) badge.textContent = unidadeDetectada? unidadeDetectada.nome.toUpperCase() : 'IDENTIFICADA';
  let html='';
  if(unidadeDetectada) html+=`<div style="margin-bottom:10px"><strong>Unidade:</strong> ${unidadeDetectada.nome} • <strong>Nominal:</strong> ${formatarNumero(unidadeDetectada.nominal)} t/h</div>`;
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">';
  futuro.forEach(r=>{ html+=`<div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:8px"><strong>${r.hora}</strong><br><span style="font-size:11px">Ent ${Math.round(r.potencial)} / Moag ${Math.round(r.moagem)} t/h</span></div>`; });
  html+='</div>';
  if(historico.length) html+=`<div style="margin-top:10px;font-size:11px"><strong>Histórico 3h:</strong> ${historico.map(r=>`${r.hora} → ${Math.round(r.potencial)}/${Math.round(r.moagem)}`).join(' • ')}</div>`;
  if(content) content.innerHTML=html;
  if(preview) preview.classList.remove('hidden');
}

/* INPUT DA TABELA */
const potentialInputEl = $('potentialInput');
if(potentialInputEl){
  potentialInputEl.addEventListener('input', function(){
    const tabela = this.value;
    const resultado = interpretarTabela(tabela);
    if(resultado.error){
      parsedPotential=[];
      unidadeDetectada=resultado.unidade||null;
      if($('potentialStatus')){ $('potentialStatus').textContent=resultado.error; $('potentialStatus').className='input-status error'; }
      if($('previewArea')) $('previewArea').classList.add('hidden');
      return;
    }
    parsedPotential = resultado.rows;
    unidadeDetectada = resultado.unidade || null;
    renderizarPreview();
  });
}

/* VOZ */
function configurarReconhecimento(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ if($('micButton')) $('micButton').disabled=true; if($('voiceSupport')) $('voiceSupport').textContent='Voz não disponível'; return; }
  recognition = new SR(); recognition.lang='pt-BR'; recognition.continuous=false; recognition.interimResults=true;
  recognition.onstart=()=>{ listening=true; if($('micButton')) $('micButton').classList.add('recording'); if($('voiceStatus')) $('voiceStatus').textContent='Ouvindo...'; };
  recognition.onresult=(e)=>{ let f=''; let p=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) f+=t; else p+=t; } const ta=$('comments'); if(ta && f) ta.value = ta.value.trim()? ta.value.trim()+' '+f.trim() : f.trim(); if($('voiceStatus') && p) $('voiceStatus').textContent=`Ouvindo: ${p}`; };
  recognition.onerror=(e)=>{ listening=false; if($('voiceStatus')) $('voiceStatus').textContent=`Erro: ${e.error}`; };
  recognition.onend=()=>{ listening=false; if($('micButton')) $('micButton').classList.remove('recording'); if($('voiceStatus')) $('voiceStatus').textContent='Clique no microfone para ditar.'; };
}
configurarReconhecimento();
if($('micButton')) $('micButton').addEventListener('click', ()=>{ if(!recognition){ alert('Voz não disponível. Use Chrome/Edge.'); return; } if(listening) recognition.stop(); else { try{ recognition.start(); }catch(e){} } });

/* MONTAR DADOS */
function montarDados(){
  const inputEl = $('potentialInput');
  if(!inputEl) throw new Error('Campo de tabela não encontrado.');
  const tabela = inputEl.value.trim();
  if(!tabela) throw new Error('Cole a Análise de Potencial de Produção.');
  const resultado = interpretarTabela(tabela);
  if(resultado.error) throw new Error(resultado.error);
  parsedPotential = resultado.rows; unidadeDetectada = resultado.unidade || null;
  if(!unidadeDetectada) throw new Error('Não consegui identificar a filial. Inclua no texto "MANDU, CRUZ ALTA, SAO JOSE..."');

  const e1 = $('stock1')?.value; const e2 = $('stock2')?.value; const e3 = $('stock3')?.value; const eAtual = $('stockCurrent')?.value;
  if(eAtual==='' || eAtual===null || eAtual===undefined) throw new Error('Informe o estoque atual.');
  const estoque1 = Number(e1||0); const estoque2 = Number(e2||0); const estoque3 = Number(e3||0); const estoqueAtual = Number(eAtual);
  if(isNaN(estoqueAtual)) throw new Error('Estoque atual inválido.');
  return { tabelaOriginal: tabela, unidade: unidadeDetectada, nominal: unidadeDetectada.nominal, potencial: parsedPotential, parsedMandu: resultado.parsedMandu, estoque:{h3:estoque1,h2:estoque2,h1:estoque3,atual:estoqueAtual}, comentarios: $('comments')?$('comments').value.trim():'' };
}

/* GERAR - LOCAL */
async function gerarPlanoVoo(){
  const botao=$('generateButton'); const textoBotao=$('generateText'); const icone=$('generateIcon');
  try{
    const dados = montarDados();
    if(botao) botao.disabled=true;
    if(textoBotao) textoBotao.textContent='ANALISANDO CENÁRIO...';
    if(icone) icone.textContent='⏳';
    if($('errorArea')) $('errorArea').classList.add('hidden');
    if($('loadingArea')) $('loadingArea').classList.remove('hidden');
    if($('resultArea')) $('resultArea').classList.add('hidden');

    await new Promise(r => setTimeout(r, 150)); // pra UI respirar

    let entradaTotal, saidaTotal, ultimas3Entrada, ultimas3Saida, saldo3;
    if(dados.parsedMandu){
      entradaTotal=dados.parsedMandu.entradaTotal; saidaTotal=dados.parsedMandu.saidaTotal; ultimas3Entrada=dados.parsedMandu.ultimas3Entrada; ultimas3Saida=dados.parsedMandu.ultimas3Saida; saldo3=dados.parsedMandu.saldo3;
    } else {
      const hist = selecionarHistorico(dados.potencial);
      const us = hist.length?hist:dados.potencial.slice(-3);
      ultimas3Entrada=us.reduce((a,b)=>a+(b.entrada||b.potencial||0),0); ultimas3Saida=us.reduce((a,b)=>a+(b.saida||b.moagem||0),0); saldo3=ultimas3Entrada-ultimas3Saida;
      entradaTotal=dados.potencial.reduce((a,b)=>a+(b.entrada||0),0); saidaTotal=dados.potencial.reduce((a,b)=>a+(b.saida||0),0);
    }

    const mediaEntrada = ultimas3Entrada/3;
    const mediaSaida = ultimas3Saida/3;
    const estoqueAtual = dados.estoque.atual;
    const estoqueTon = estoqueAtual*70;
    const tendencia = estoqueAtual - dados.estoque.h1;
    const nominal = dados.nominal;

    let moagemSegura = Math.round(mediaSaida || nominal * 0.9);
    let status='', horaRisco='', acao='';

    if(saldo3 < -200){
      moagemSegura=Math.round(Math.max(mediaEntrada*0.95, (mediaSaida||nominal)*0.85));
      status=`⚠ Pátio em queda. Saldo 3h ${saldo3.toFixed(0)}t.`;
      horaRisco='2-3h';
      acao='Reduzir moagem para '+moagemSegura+' t/h e acelerar frente de corte/entrada.';
    } else if(saldo3 > 200){
      moagemSegura=Math.round(Math.min((mediaSaida||nominal)*1.05, mediaEntrada+50));
      status=`✓ Pátio recuperando. Saldo 3h +${saldo3.toFixed(0)}t.`;
      horaRisco='Sem risco';
      acao='Manter moagem em '+moagemSegura+' t/h. Elevar estoque de segurança.';
    } else {
      status=`→ Pátio estável. Saldo 3h ${saldo3.toFixed(0)}t.`;
      horaRisco='Estável';
      acao='Manter moagem em '+moagemSegura+' t/h e monitorar hora a hora.';
    }

    const autonomia = moagemSegura>0? (estoqueTon/moagemSegura).toFixed(1) : '0';

    lastAnalysisText = `PLANO DE VOO - ${dados.unidade.nome.toUpperCase()} • Nominal ${formatarNumero(nominal)} t/h
Estoque atual: ${estoqueAtual} conjuntos (${estoqueTon.toFixed(0)}t) - Autonomia ${autonomia}h a ${moagemSegura} t/h

Últimas 3h: Entrada ${ultimas3Entrada.toFixed(0)}t / Moagem ${ultimas3Saida.toFixed(0)}t
Média 3h: Entrada ${mediaEntrada.toFixed(0)} t/h | Moagem ${mediaSaida.toFixed(0)} t/h
Saldo dia: Entrada ${entradaTotal.toFixed(0)}t / Saída ${saidaTotal.toFixed(0)}t (Saldo ${(entradaTotal-saidaTotal).toFixed(0)}t)

MOAGEM SEGURA: ${moagemSegura} t/h
${status}

AÇÃO: ${acao}
${dados.comentarios? '\nOBS: '+dados.comentarios : ''}`;

    if($('kpiStock')) $('kpiStock').textContent = `${estoqueAtual} (${estoqueTon.toFixed(0)}t)`;
    if($('kpiTrend')){ $('kpiTrend').textContent = `${tendencia>=0?'+':''}${formatarNumero(tendencia,1)}`; $('kpiTrend').className = `kpi-value ${tendencia<0?'danger':'positive'}`; }
    if($('kpiTrendDetail')) $('kpiTrendDetail').textContent='conj./h';
    if($('kpiSafeMoagem')) $('kpiSafeMoagem').textContent = formatarNumero(moagemSegura);
    if($('kpiRiskHour')) $('kpiRiskHour').textContent = horaRisco;
    if($('resultStatus')) $('resultStatus').textContent = `${dados.unidade.nome} • Nominal ${formatarNumero(nominal)} t/h • ${status}`;
    if($('analysisText')) $('analysisText').textContent = lastAnalysisText;
    if($('calculationContent')) $('calculationContent').innerHTML = `Entrada média 3h: ${mediaEntrada.toFixed(0)} t/h • Saída média 3h: ${mediaSaida.toFixed(0)} t/h<br>Saldo 3h: ${saldo3.toFixed(0)}t • Estoque: ${estoqueAtual} conj x 70t = ${estoqueTon.toFixed(0)}t<br>Autonomia: ${estoqueTon.toFixed(0)} / ${moagemSegura} = ${autonomia}h • Tendência: ${tendencia>0?'+':''}${tendencia} conj`;

    if($('resultArea')) $('resultArea').classList.remove('hidden');
    if($('resultArea')) window.scrollTo({ top: $('resultArea').offsetTop-20, behavior:'smooth' });

  }catch(error){
    console.error('Erro ao gerar:', error);
    if($('errorMessage')) $('errorMessage').textContent = error.message||'Erro ao gerar o Plano de Voo.';
    if($('errorArea')) $('errorArea').classList.remove('hidden');
  }finally{
    if(botao) botao.disabled=false;
    if(textoBotao) textoBotao.textContent='GERAR PLANO DE VOO';
    if(icone) icone.textContent='→';
    if($('loadingArea')) $('loadingArea').classList.add('hidden');
  }
}

if($('generateButton')) $('generateButton').addEventListener('click', gerarPlanoVoo);

/* COPIAR */
if($('copyButton')) $('copyButton').addEventListener('click', async function(){ if(!lastAnalysisText) return; try{ await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado'; setTimeout(()=>this.textContent=o,1500); }catch(e){ alert('Não foi possível copiar.'); } });

/* LIMPAR */
if($('clearButton')) $('clearButton').addEventListener('click', function(){
  if($('potentialInput')) $('potentialInput').value='';
  ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{ if($(id)) $(id).value=''; });
  parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null;
  if($('previewArea')) $('previewArea').classList.add('hidden');
  if($('potentialStatus')) $('potentialStatus').textContent='';
  if($('resultArea')) $('resultArea').classList.add('hidden');
  if($('errorArea')) $('errorArea').classList.add('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
});
