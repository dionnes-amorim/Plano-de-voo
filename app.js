/* =========================================================
   COA | PLANO DE VOO CTT - FRONTEND 100% LOCAL
   VERSÃO ANALÍTICA E GRADUAL CORRIGIDA
========================================================= */

/* CONFIG DAS UNIDADES */
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

/* NORMALIZAR */
function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

/* IDENTIFICAR UNIDADE */
function identificarUnidade(texto) {
  const normalizado = normalizarTexto(texto);
  for (const chave of Object.keys(CONFIG_UNIDADES)) {
    if (normalizado.includes(chave)) {
      return { chave, ...CONFIG_UNIDADES[chave] };
    }
  }
  if (normalizado.includes('UIM')) return { chave: 'MANDU', ...CONFIG_UNIDADES['MANDU'] };
  if (normalizado.includes('UICA')) return { chave: 'CRUZ ALTA', ...CONFIG_UNIDADES['CRUZ ALTA'] };
  if (normalizado.includes('UISJ')) return { chave: 'SAO JOSE', ...CONFIG_UNIDADES['SAO JOSE'] };
  if (normalizado.includes('UIV')) return { chave: 'VERTENTE', ...CONFIG_UNIDADES['VERTENTE'] };
  if (normalizado.includes('UIT')) return { chave: 'TANABI', ...CONFIG_UNIDADES['TANABI'] };
  return { chave: 'MANDU', ...CONFIG_UNIDADES['MANDU'] };
}

/* NÚMERO BR - CORRIGIDO */
function numeroBR(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = String(valor).trim();
  if (!texto) return null;
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
  if ($('stockLabel1'))$('stockLabel1').textContent = fmt(h-3)+' - 3h';
  if ($('stockLabel2'))$('stockLabel2').textContent = fmt(h-2)+' - 2h';
  if ($('stockLabel3'))$('stockLabel3').textContent = fmt(h-1)+' - 1h';
  if ($('stockLabel4'))$('stockLabel4').textContent = fmt(h)+' • ATUAL';
}
atualizarLabelsEstoque();
setInterval(atualizarLabelsEstoque, 60000);

/* PARSER PRINCIPAL */
function interpretarTabela(texto) {
  if (!texto || !texto.trim()) return { rows:[], unidade: null, error:'Cole a tabela de potencial.' };

  if (window.__parsePotential) {
    try {
      const p = window.__parsePotential(texto);
      if (p && p.dados && p.dados.length) {
        const unidade = identificarUnidade(texto);
        const rows = p.dados.map(d => ({
          hora: d.hora,
          horaNumero: Number(String(d.hora).split(':')[0] || String(d.hora).split('-')[0]),
          potencial: d.entrada,
          moagem: d.saida,
          entrada: d.entrada,
          saida: d.saida,
          maquinas: d.maquinas,
          despacho: d.despacho,
          nominal: unidade.nominal
        }));
        return { rows, unidade, nominal: unidade.nominal, parsedMandu: p, error: null };
      }
    } catch(e) { console.warn('Parser index falhou, usando fallback', e); }
  }

  const unidade = identificarUnidade(texto);
  const linhas = texto.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  const rows = [];
  for (const linha of linhas) {
    const m = linha.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
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
  const preview = $('previewArea'); const content =$('previewContent'); const badge = $('previewBadge'); const status =$('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando tabela...'; return; }
  const futuro = selecionarProjecao(parsedPotential);
  const historico = selecionarHistorico(parsedPotential);
  if(status){ status.textContent=`✓ ${parsedPotential.length} horários identificados`; status.className='input-status success'; }
  if(badge) badge.textContent = unidadeDetectada? unidadeDetectada.nome.toUpperCase() : 'IDENTIFICADA';
  let html='';
  if(unidadeDetectada) html+=`<div style="margin-bottom:10px"><strong>Unidade:</strong> ${unidadeDetectada.nome} (${unidadeDetectada.sigla}) • <strong>Nominal:</strong> ${formatarNumero(unidadeDetectada.nominal)} t/h • <strong>Mínimo:</strong> ${formatarNumero(unidadeDetectada.minTotal)} t/h</div>`;
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
      if($('previewArea'))$('previewArea').classList.add('hidden');
      return;
    }
    parsedPotential = resultado.rows;
    unidadeDetectada = resultado.unidade || null;
    renderizarPreview();
  });
}

/* VOZ - CORRIGIDO E ROBUSTO PARA O CAMPO DE COMENTÁRIOS */
function configurarReconhecimento(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ 
    if($('micButton'))$('micButton').disabled = true; 
    if($('voiceSupport'))$('voiceSupport').textContent = 'Reconhecimento de voz não suportado neste navegador.'; 
    return; 
  }
  
  recognition = new SR(); 
  recognition.lang = 'pt-BR'; 
  recognition.continuous = true; // Permite falar frases mais longas sem fechar sozinho
  recognition.interimResults = true;

  recognition.onstart = () => {
    listening = true; 
    if($('micButton'))$('micButton').classList.add('recording'); 
    if($('voiceStatus'))$('voiceStatus').textContent = 'Ouvindo... Fale sua observação.';
  };

  recognition.onresult = (e) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for(let i = e.resultIndex; i < e.results.length; i++){
      const transcript = e.results[i][0].transcript;
      if(e.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    const ta = $('comments');
    if(ta && finalTranscript){
      const atual = ta.value.trim();
      ta.value = atual ? atual + ' ' + finalTranscript.trim() : finalTranscript.trim();
    }
    
    if($('voiceStatus')){
      if(interimTranscript) {
        $('voiceStatus').textContent = `Ouvindo: ${interimTranscript}`;
      } else {
        $('voiceStatus').textContent = 'Clique no microfone para ditar.';
      }
    }
  };

  recognition.onerror = (e) => {
    listening = false; 
    if($('micButton'))$('micButton').classList.remove('recording');
    if($('voiceStatus'))$('voiceStatus').textContent = `Erro no microfone: ${e.error}`;
  };

  recognition.onend = () => {
    listening = false; 
    if($('micButton'))$('micButton').classList.remove('recording'); 
    if($('voiceStatus'))$('voiceStatus').textContent = 'Clique no microfone para ditar via voz.'; 
  };
}

configurarReconhecimento();

if($('micButton')) {$('micButton').addEventListener('click', () => {
    if(!recognition){ 
      alert('Seu navegador não suporta reconhecimento de voz. Utilize o Google Chrome ou Microsoft Edge.'); 
      return; 
    }
    if(listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch(e) {
        console.warn('Erro ao iniciar reconhecimento:', e);
      }
    }
  });
}

/* MONTAR DADOS */
function montarDados(){
  const inputEl = $('potentialInput');
  if(!inputEl) throw new Error('Campo de tabela não encontrado.');
  const tabela = inputEl.value.trim();
  if(!tabela) throw new Error('Cole a Análise de Potencial de Produção.');
  const resultado = interpretarTabela(tabela);
  if(resultado.error) throw new Error(resultado.error);
  parsedPotential = resultado.rows; 
  unidadeDetectada = resultado.unidade || identificarUnidade(tabela);
  if(!unidadeDetectada) throw new Error('Não consegui identificar a filial.');

  const e1 = $('stock1')?.value; const e2 =$('stock2')?.value; const e3 = $('stock3')?.value; const eAtual =$('stockCurrent')?.value;
  if(eAtual==='' || eAtual===null || eAtual===undefined) throw new Error('Informe o estoque atual.');
  const estoque1 = Number(e1||0); const estoque2 = Number(e2||0); const estoque3 = Number(e3||0); const estoqueAtual = Number(eAtual);
  if(isNaN(estoqueAtual)) throw new Error('Estoque atual inválido.');
  return { 
    tabelaOriginal: tabela, 
    unidade: unidadeDetectada, 
    nominal: unidadeDetectada.nominal, 
    potencial: parsedPotential, 
    parsedMandu: resultado.parsedMandu, 
    estoque: {h3:estoque1, h2:estoque2, h1:estoque3, atual:estoqueAtual}, 
    comentarios: $('comments') ?$('comments').value.trim() : '' 
  };
}

/* GERAR - PLANO DE VOO ANALÍTICO E GRADUAL */
async function gerarPlanoVoo(){
  const botao=$('generateButton'); const textoBotao=$('generateText'); const icone=$('generateIcon');
  try{
    const dados = montarDados();
    if(botao) botao.disabled=true;
    if(textoBotao) textoBotao.textContent='GERANDO PLANO ANALÍTICO...';
    if(icone) icone.textContent='⏳';
    if($('errorArea'))$('errorArea').classList.add('hidden');
    if($('loadingArea'))$('loadingArea').classList.remove('hidden');
    if($('resultArea'))$('resultArea').classList.add('hidden');

    await new Promise(r => setTimeout(r, 200));

    let entradaTotal, saidaTotal, ultimas3Entrada, ultimas3Saida, saldo3;
    if(dados.parsedMandu){
      entradaTotal=dados.parsedMandu.entradaTotal; saidaTotal=dados.parsedMandu.saidaTotal; ultimas3Entrada=dados.parsedMandu.ultimas3Entrada; ultimas3Saida=dados.parsedMandu.ultimas3Saida; saldo3=dados.parsedMandu.saldo3;
    } else {
      const hist = selecionarHistorico(dados.potencial);
      const us = hist.length? hist : dados.potencial.slice(-3);
      ultimas3Entrada = us.reduce((a,b)=>a+(b.entrada||b.potencial||0),0); 
      ultimas3Saida = us.reduce((a,b)=>a+(b.saida||b.moagem||0),0); 
      saldo3 = ultimas3Entrada - ultimas3Saida;
      entradaTotal = dados.potencial.reduce((a,b)=>a+(b.entrada||0),0); 
      saidaTotal = dados.potencial.reduce((a,b)=>a+(b.saida||0),0);
    }

    const mediaEnt = ultimas3Entrada/3;
    const mediaSai = ultimas3Saida/3;
    const estoqueAtual = dados.estoque.atual;
    const estoqueTon = estoqueAtual * 70;
    const tendencia = estoqueAtual - dados.estoque.h1;
    const uni = dados.unidade;
    const nominal = uni.nominal;
    const minTotal = uni.minTotal;

    // PROJEÇÃO HORA A HORA
    const proj = selecionarProjecao(dados.potencial);
    let estoqueSim = estoqueAtual; 
    let menorEstoque = estoqueAtual; 
    let horaMenor = new Date().getHours(); 
    let horaCritica = null;
    const projDetalhada = [];
    
    for(const r of proj){
      const saldo = r.entrada - r.saida;
      estoqueSim += saldo / 70;
      projDetalhada.push({ hora: r.hora, horaNum: r.horaNumero, entrada: r.entrada, saida: r.saida, saldo, estoqueProj: estoqueSim });
      if(estoqueSim < menorEstoque){ menorEstoque = estoqueSim; horaMenor = r.horaNumero; }
      if(horaCritica == null && estoqueSim <= 7) horaCritica = r.horaNumero;
    }

    // AJUSTES GRADUAIS (Passos de 50 a 100 t/h)
    let moagemAtualOp = Math.round(mediaSai);
    let moagemSugerida = moagemAtualOp;
    let acaoGradual = '';
    const fmtH = (h) => String((h+24)%24).padStart(2,'0')+':00';

    let nivel = 'ESTÁVEL';
    if(saldo3 < -400 || estoqueAtual <= 5){
      nivel = 'CRÍTICO';
      moagemSugerida = Math.max(minTotal, moagemAtualOp - 100);
      acaoGradual = `Redução preventiva e gradual de ${moagemAtualOp} t/h para ${moagemSugerida} t/h (recuo de 100 t/h). Redução é o ÚLTIMO CASO, priorizando acelerar frentes de corte e transporte próprio.`;
    } else if(saldo3 < -150 || estoqueAtual <= 8){
      nivel = 'ATENÇÃO / QUEDA';
      moagemSugerida = Math.max(minTotal, moagemAtualOp - 50);
      acaoGradual = `Ajuste fino de recuo em 50 t/h (de ${moagemAtualOp} para ${moagemSugerida} t/h) para estancar a queda do pátio enquanto o campo recupera o ciclo.`;
    } else if(saldo3 > 150 && estoqueAtual >= 10 && moagemAtualOp < nominal){
      nivel = 'RECUPERAÇÃO / ELEVAÇÃO';
      moagemSugerida = Math.min(nominal, moagemAtualOp + 50);
      acaoGradual = `Cenário favorável com saldo positivo (+${saldo3.toFixed(0)}t). Elevação gradual de 50 t/h (de ${moagemAtualOp} para ${moagemSugerida} t/h), buscando retornar progressivamente ao nominal de ${nominal} t/h.`;
    } else {
      nivel = 'ESTÁVEL';
      moagemSugerida = moagemAtualOp;
      acaoGradual = `Manter moagem estável em ${moagemAtualOp} t/h, monitorando a chegada hora a hora para buscar incrementos graduais rumo ao nominal.`;
    }

    const autonomiaAtual = (estoqueTon / (mediaSai || nominal)).toFixed(1);

    // TEXTO EXECUTIVO PADRÃO COMUNICADO
    lastAnalysisText = `Comunicado ${uni.sigla} (${uni.nome.toUpperCase()}) — Plano de Voo Analítico (${nivel})

No momento, a moagem da unidade está ajustada em ${Math.round(mediaSai)} t/h, tendo registrado nas últimas 3 horas uma entrada média de ${mediaEnt.toFixed(0)} t/h contra uma saída de ${mediaSai.toFixed(0)} t/h (saldo de ${saldo3.toFixed(0)}t). O pátio contabiliza ${estoqueAtual} conjuntos carregados (${estoqueTon.toFixed(0)}t), o que representa uma autonomia de ${autonomiaAtual}h.

O principal ponto de atenção da unidade é o comportamento do saldo de pátio e a regularidade de entrega das frentes. ${acaoGradual}

PROJEÇÃO HORA A HORA:
${projDetalhada.map(p=>`• ${p.hora} | Entrada: ${p.entrada.toFixed(0)}t \vert{} Moagem:${p.saida.toFixed(0)}t | Saldo: ${p.saldo>=0?'+':''}${p.saldo.toFixed(0)}t | Estoque Proj: ${p.estoqueProj.toFixed(1)} conj${p.estoqueProj<=7?'⚠':''}`).join('\n')}

DIRETRIZES E GATILHOS DE AJUSTE (GRADUAL DE 50 A 100 t/h):
1. REDUÇÃO É O ÚLTIMO CASO: Antes de qualquer corte, intensificar o acompanhamento das colhedoras e transbordos para elevar a entrada.
2. FAIXAS DE AJUSTE:
   - Se a entrada se mantiver abaixo da moagem por 2h consecutivas, aplicar redução gradual de 50 a 100 t/h (nunca excedendo 100 t/h por ajuste).
   - O limite mínimo operacional da unidade é ${minTotal} t/h (${uni.difusores} difusor(es) x ${uni.minPorDifusor} t/h). O desligamento de 1 difusor (${uni.min1Difusor} t/h) é estritamente o último recurso.
3. RETOMADA GRADUAL AO NOMINAL (${nominal} t/h):
   - Conforme o cenário de campo normalizar e o saldo voltar a ser positivo, realizar aumentos escalonados de 50 t/h por hora.
   - Meta: Buscar ${Math.min(nominal, Math.round(mediaSai + 50))} t/h nas próximas horas e avançar progressivamente até atingir o nominal de ${nominal} t/h.

Seguimos acompanhando o cenário hora a hora. Caso a indisponibilidade de equipamentos persista e o pátio atinja níveis críticos (${horaCritica ? `com risco projetado às ${fmtH(horaCritica)}` : '≤ 7 conjuntos'}), novos ajustes graduais serão avaliados pela gerência.
${dados.comentarios ? `\nOBSERVAÇÃO OPERACIONAL:\n${dados.comentarios}` : ''}`;

    if($('kpiStock'))$('kpiStock').textContent = `${estoqueAtual} (${estoqueTon.toFixed(0)}t)`;
    if($('kpiTrend')){$('kpiTrend').textContent = `${tendencia>=0?'+':''}${formatarNumero(tendencia,1)}`; 
      $('kpiTrend').className = `kpi-value ${tendencia<0?'danger':'positive'}`; 
    }
    if($('kpiTrendDetail'))$('kpiTrendDetail').textContent='conj./h';
    if($('kpiSafeMoagem'))$('kpiSafeMoagem').textContent = formatarNumero(moagemSugerida);
    if($('kpiRiskHour'))$('kpiRiskHour').textContent = horaCritica != null ? fmtH(horaCritica) : nivel;
    if($('resultStatus'))$('resultStatus').textContent = `${uni.sigla} • Nominal ${formatarNumero(nominal)} t/h • Mín ${minTotal} t/h • ${nivel}`;
    if($('analysisText'))$('analysisText').textContent = lastAnalysisText;
    if($('calculationContent'))$('calculationContent').innerHTML = `Média Ent ${mediaEnt.toFixed(0)} t/h | Média Sai ${mediaSai.toFixed(0)} t/h | Saldo 3h ${saldo3.toFixed(0)}t<br>Estoque ${estoqueAtual} conj = ${estoqueTon.toFixed(0)}t | Autonomia ${autonomiaAtual}h<br>Moagem Sugerida (Gradual): ${moagemSugerida} t/h`;

    if($('resultArea'))$('resultArea').classList.remove('hidden');
    if($('resultArea')) window.scrollTo({ top:$('resultArea').offsetTop-20, behavior:'smooth' });

  }catch(error){
    console.error('Erro ao gerar:', error);
    if($('errorMessage'))$('errorMessage').textContent = error.message || 'Erro ao gerar o Plano de Voo.';
    if($('errorArea'))$('errorArea').classList.remove('hidden');
  }finally{
    if(botao) botao.disabled=false;
    if(textoBotao) textoBotao.textContent='GERAR PLANO DE VOO';
    if(icone) icone.textContent='→';
    if($('loadingArea'))$('loadingArea').classList.add('hidden');
  }
}

if($('generateButton'))$('generateButton').addEventListener('click', gerarPlanoVoo);

/* COPIAR */
if($('copyButton'))$('copyButton').addEventListener('click', async function(){ 
  if(!lastAnalysisText) return; 
  try{ 
    await navigator.clipboard.writeText(lastAnalysisText); 
    const o=this.textContent; 
    this.textContent='✓ Copiado'; 
    setTimeout(()=>this.textContent=o,1500); 
  }catch(e){ 
    alert('Não foi possível copiar.'); 
  } 
});

/* LIMPAR */
if($('clearButton'))$('clearButton').addEventListener('click', function(){
  if($('potentialInput'))$('potentialInput').value='';
  ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{ if($(id))$(id).value=''; });
  parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null;
  if($('previewArea'))$('previewArea').classList.add('hidden');
  if($('potentialStatus'))$('potentialStatus'].textContent='';
  if($('resultArea'))$('resultArea').classList.add('hidden');
  if($('errorArea'))$('errorArea').classList.add('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
});
