/* =========================================================
   COA | PLANO DE VOO CTT - GERÊNCIA COMPLEXO (ANALÍTICO)
   100% LOCAL - SEM API
========================================================= */

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

function normalizarTexto(t){return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();}

function identificarUnidade(texto){
  const n = normalizarTexto(texto);
  for(const chave of Object.keys(CONFIG_UNIDADES)){
    if(n.includes(chave)) return {chave,...CONFIG_UNIDADES[chave]};
  }
  if(n.includes('MANDU') || n.includes('UIM')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
  return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
}

function numeroBR(v){
  if(v==null) return null;
  let t=String(v).trim().replace(/[^\d.,-]/g,'');
  if(!t) return null;
  if(t.includes('.') && t.includes(',')) t=t.replace(/\./g,'').replace(',','.');
  else if(t.includes(',')) t=t.replace(',','.');
  const n=Number(t); return Number.isFinite(n)?n:null;
}

function formatarNumero(n,c=0){ if(n==null||isNaN(n)) return '-'; return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:c,maximumFractionDigits:c}); }

function atualizarLabelsEstoque(){
  const h=new Date().getHours(); const fmt=v=>String((v+24)%24).padStart(2,'0')+'h';
  if($('stockLabel1'))$('stockLabel1').textContent=fmt(h-3)+' - 3h';
  if($('stockLabel2'))$('stockLabel2').textContent=fmt(h-2)+' - 2h';
  if($('stockLabel3'))$('stockLabel3').textContent=fmt(h-1)+' - 1h';
  if($('stockLabel4'))$('stockLabel4').textContent=fmt(h)+' • ATUAL';
}
atualizarLabelsEstoque(); setInterval(atualizarLabelsEstoque,60000);

function interpretarTabela(texto){
  if(!texto||!texto.trim()) return {rows:[],unidade:null,error:'Cole a tabela.'};
  if(window.__parsePotential){
    try{
      const p=window.__parsePotential(texto);
      if(p&&p.dados&&p.dados.length){
        const uni=identificarUnidade(texto);
        const rows=p.dados.map(d=>({hora:d.hora,horaNumero:Number(String(d.hora).split('-')[0]||String(d.hora).split(':')[0]),potencial:d.entrada,moagem:d.saida,entrada:d.entrada,saida:d.saida,nominal:uni.nominal}));
        return {rows,unidade:uni,nominal:uni.nominal,parsedMandu:p,error:null};
      }
    }catch(e){}
  }
  const unidade=identificarUnidade(texto); const linhas=texto.split('\n').map(l=>l.trim()).filter(Boolean); const rows=[];
  for(const linha of linhas){
    const m=linha.match(/(\d{1,2})\s*-\s*(\d{1,2})/); if(!m) continue;
    const nums=linha.match(/[\d.,]+/g)||[]; if(nums.length<4) continue;
    const entrada=numeroBR(nums[nums.length-2]); const saida=numeroBR(nums[nums.length-1]); if(entrada==null||saida==null) continue;
    rows.push({hora:`${String(Number(m[1])).padStart(2,'0')}:00`,horaNumero:Number(m[1]),potencial:entrada,moagem:saida,entrada,saida,nominal:unidade.nominal});
  }
  if(rows.length>=3) return {rows,unidade,nominal:unidade.nominal,error:null};
  return {rows:[],unidade,error:'Não consegui identificar o formato.'};
}

function horaRelativa(h,a){let d=(h-a+24)%24; if(d>12) d-=24; return d;}
function selecionarHistorico(rows){const a=new Date().getHours(); return rows.map(r=>({...r,distancia:horaRelativa(r.horaNumero,a)})).filter(r=>r.distancia<0).sort((x,y)=>y.distancia-x.distancia).slice(0,3).sort((x,y)=>x.distancia-y.distancia);}
function selecionarProjecao(rows){const a=new Date().getHours(); return rows.map(r=>({...r,distancia:horaRelativa(r.horaNumero,a)})).filter(r=>r.distancia>=0).sort((x,y)=>x.distancia-y.distancia).slice(0,12);}

function renderizarPreview(){
  const preview=$('previewArea'); const content=$('previewContent'); const badge=$('previewBadge'); const status=$('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando...'; return; }
  const futuro=selecionarProjecao(parsedPotential); const hist=selecionarHistorico(parsedPotential);
  if(status){status.textContent=`✓ ${parsedPotential.length} horários`; status.className='input-status success';}
  if(badge) badge.textContent=unidadeDetectada?unidadeDetectada.nome.toUpperCase():'IDENTIFICADA';
  let html=''; if(unidadeDetectada) html+=`<div style="margin-bottom:8px"><strong>${unidadeDetectada.nome} (${unidadeDetectada.sigla})</strong> • Nom ${formatarNumero(unidadeDetectada.nominal)} t/h • Mín ${formatarNumero(unidadeDetectada.minTotal)} t/h (${unidadeDetectada.difusores}x${formatarNumero(unidadeDetectada.minPorDifusor)})</div>`;
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">'; futuro.forEach(r=>{html+=`<div style="padding:6px;background:rgba(255,255,255,0.03);border-radius:6px"><strong>${r.hora}</strong><br><span style="font-size:10px">${Math.round(r.potencial)}/${Math.round(r.moagem)} t/h</span></div>`;}); html+='</div>';
  if(hist.length) html+=`<div style="margin-top:8px;font-size:11px"><strong>Hist 3h:</strong> ${hist.map(r=>`${r.hora} ${Math.round(r.potencial)}/${Math.round(r.moagem)}`).join(' • ')}</div>`;
  if(content) content.innerHTML=html; if(preview) preview.classList.remove('hidden');
}

const pEl=$('potentialInput');
if(pEl) pEl.addEventListener('input',function(){const res=interpretarTabela(this.value); if(res.error){parsedPotential=[]; unidadeDetectada=res.unidade||null; if($('potentialStatus')){$('potentialStatus').textContent=res.error; $('potentialStatus').className='input-status error';} if($('previewArea'))$('previewArea').classList.add('hidden'); return;} parsedPotential=res.rows; unidadeDetectada=res.unidade; renderizarPreview();});

function configurarReconhecimento(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR){ if($('micButton'))$('micButton').disabled=true; return; }
  recognition=new SR(); recognition.lang='pt-BR'; recognition.continuous=false; recognition.interimResults=true;
  recognition.onstart=()=>{listening=true; if($('micButton'))$('micButton').classList.add('recording'); if($('voiceStatus'))$('voiceStatus').textContent='Ouvindo...';};
  recognition.onresult=(e)=>{let f=''; for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) f+=e.results[i][0].transcript; } const ta=$('comments'); if(ta&&f) ta.value=ta.value.trim()?ta.value.trim()+' '+f.trim():f.trim();};
  recognition.onend=()=>{listening=false; if($('micButton'))$('micButton').classList.remove('recording'); if($('voiceStatus'))$('voiceStatus').textContent='Clique no microfone.';};
}
configurarReconhecimento();
if($('micButton'))$('micButton').addEventListener('click',()=>{ if(!recognition) return; if(listening) recognition.stop(); else try{recognition.start();}catch(e){} });

function montarDados(){
  const t=$('potentialInput').value.trim(); if(!t) throw new Error('Cole a tabela.');
  const res=interpretarTabela(t); if(res.error) throw new Error(res.error);
  parsedPotential=res.rows; unidadeDetectada=res.unidade;
  const e1=Number($('stock1')?.value\vert{}\vert{}0); const e2=Number($('stock2')?.value||0); const e3=Number($('stock3')?.value\vert{}\vert{}0); const eAtual=Number($('stockCurrent')?.value);
  if(isNaN(eAtual)) throw new Error('Informe estoque atual.');
  return {tabelaOriginal:t,unidade:unidadeDetectada,nominal:unidadeDetectada.nominal,potencial:parsedPotential,parsedMandu:res.parsedMandu,estoque:{h3:e1,h2:e2,h1:e3,atual:eAtual},comentarios:$('comments')?.value.trim()||''};
}

async function gerarPlanoVoo(){
  const botao=$('generateButton'); const txt=$('generateText'); const ico=$('generateIcon');
  try{
    const dados=montarDados();
    if(botao) botao.disabled=true; if(txt) txt.textContent='GERANDO PLANO ANALÍTICO...'; if(ico) ico.textContent='⏳';
    if($('errorArea'))$('errorArea').classList.add('hidden'); if($('loadingArea'))$('loadingArea').classList.remove('hidden'); if($('resultArea'))$('resultArea').classList.add('hidden');
    await new Promise(r=>setTimeout(r,200));

    let entradaTotal,saidaTotal,ult3Ent,ult3Sai,saldo3;
    if(dados.parsedMandu){ entradaTotal=dados.parsedMandu.entradaTotal; saidaTotal=dados.parsedMandu.saidaTotal; ult3Ent=dados.parsedMandu.ultimas3Entrada; ult3Sai=dados.parsedMandu.ultimas3Saida; saldo3=dados.parsedMandu.saldo3; }
    else{ const h=selecionarHistorico(dados.potencial); const u=h.length?h:dados.potencial.slice(-3); ult3Ent=u.reduce((a,b)=>a+(b.entrada||0),0); ult3Sai=u.reduce((a,b)=>a+(b.saida||0),0); saldo3=ult3Ent-ult3Sai; entradaTotal=dados.potencial.reduce((a,b)=>a+(b.entrada||0),0); saidaTotal=dados.potencial.reduce((a,b)=>a+(b.saida||0),0); }

    const mediaEnt=ult3Ent/3; const mediaSai=ult3Sai/3; const estoqueAtual=dados.estoque.atual; const estoqueTon=estoqueAtual*70;
    const uni=dados.unidade; const nominal=uni.nominal; const minTotal=uni.minTotal; const minPorDif=uni.minPorDifusor; const numDif=uni.difusores;

    // PROJEÇÃO HORA A HORA
    const proj=selecionarProjecao(dados.potencial);
    let estoqueSim=estoqueAtual; let menorEstoque=estoqueAtual; let horaMenor=new Date().getHours(); let horaZera=null; let horaCritica=null;
    const projDetalhada=[];
    for(const r of proj){
      const saldo=r.entrada - r.saida;
      estoqueSim+=saldo/70;
      projDetalhada.push({hora:r.hora, horaNum:r.horaNumero, entrada:r.entrada, saida:r.saida, saldo, estoqueProj:estoqueSim});
      if(estoqueSim<menorEstoque){menorEstoque=estoqueSim; horaMenor=r.horaNumero;}
      if(horaCritica==null && estoqueSim<=7) horaCritica=r.horaNumero;
      if(horaZera==null && estoqueSim<=0) horaZera=r.horaNumero;
    }

    // AJUSTES GRADUAIS (Passos de 50 a 100 t/h)
    let moagemAtualOperacional = Math.round(mediaSai);
    let moagemSugerida = moagemAtualOperacional;
    let acaoGradual = '';
    const fmtH = (h) => String((h+24)%24).padStart(2,'0')+':00';

    let nivel = 'ESTÁVEL';
    if(saldo3 < -400 || estoqueAtual <= 5){
      nivel = 'CRÍTICO';
      moagemSugerida = Math.max(minTotal, moagemAtualOperacional - 100);
      acaoGradual = `Redução preventiva e gradual de ${moagemAtualOperacional} t/h para ${moagemSugerida} t/h (recuo de 100 t/h). Redução é o ÚLTIMO CASO, priorizando acelerar frentes de corte e transporte próprio.`;
    } else if(saldo3 < -150 || estoqueAtual <= 8){
      nivel = 'ATENÇÃO / QUEDA';
      moagemSugerida = Math.max(minTotal, moagemAtualOperacional - 50);
      acaoGradual = `Ajuste fino de recuo em 50 t/h (de ${moagemAtualOperacional} para ${moagemSugerida} t/h) para estancar a queda do pátio enquanto o campo recupera o ciclo.`;
    } else if(saldo3 > 150 && estoqueAtual >= 10){
      nivel = 'RECUPERAÇÃO / ELEVAÇÃO';
      moagemSugerida = Math.min(nominal, moagemAtualOperacional + 50);
      acaoGradual = `Cenário favorável com saldo positivo (+${saldo3.toFixed(0)}t). Elevação gradual de 50 t/h (de ${moagemAtualOperacional} para ${moagemSugerida} t/h), buscando retornar progressivamente ao nominal de ${nominal} t/h.`;
    } else {
      nivel = 'ESTÁVEL';
      moagemSugerida = moagemAtualOperacional;
      acaoGradual = `Manter moagem estável em ${moagemAtualOperacional} t/h, monitorando a chegada hora a hora para buscar incrementos graduais rumo ao nominal.`;
    }

    const autonomiaAtual = (estoqueTon / (mediaSai||nominal)).toFixed(1);
    const autonomiaMin = (estoqueTon / minTotal).toFixed(1);

    // TEXTO FINAL PADRÃO COMUNICADO / PLANO DE VOO ANALÍTICO
    lastAnalysisText =
`Comunicado ${uni.sigla} (${uni.nome.toUpperCase()}) — Plano de Voo Analítico (${nivel})

No momento, a moagem da unidade está ajustada em ${Math.round(mediaSai)} t/h, tendo registrado nas últimas 3 horas uma entrada média de ${mediaEnt.toFixed(0)} t/h contra uma saída de ${mediaSai.toFixed(0)} t/h (saldo de ${saldo3.toFixed(0)}t). O pátio contabiliza ${estoqueAtual} conjuntos carregados (${estoqueTon.toFixed(0)}t), o que representa uma autonomia de ${autonomiaAtual}h.

O principal ponto de atenção da unidade é o comportamento do saldo de pátio e a regularidade de entrega das frentes. ${acaoGradual}

PROJEÇÃO HORA A HORA:
${projDetalhada.map(p=>`• ${p.hora} | Entrada: ${p.entrada.toFixed(0)}t \vert{} Moagem:${p.saida.toFixed(0)}t | Saldo: ${p.saldo>=0?'+':''}${p.saldo.toFixed(0)}t | Estoque Proj: ${p.estoqueProj.toFixed(1)} conj${p.estoqueProj<=7?'⚠':''}`).join('\n')}

DIRETRIZES E GATILHOS DE AJUSTE (GRADUAL DE 50 A 100 t/h):
1. REDUÇÃO É O ÚLTIMO CASO: Antes de qualquer corte, intensificar o acompanhamento das colhedoras e transbordos para elevar a entrada.
2. FAIXAS DE AJUSTE:
   - Se a entrada se mantiver abaixo da moagem por 2h consecutivas, aplicar redução gradual de 50 a 100 t/h (nunca excedendo 100 t/h por ajuste).
   - O limite mínimo operacional da unidade é ${minTotal} t/h (${uni.difusores} difusor(es) x ${minPorDif} t/h). O desligamento de 1 difusor (${uni.min1Difusor} t/h) é estritamente o último recurso.
3. RETOMADA GRADUAL AO NOMINAL (${nominal} t/h):
   - Conforme o cenário de campo normalizar e o saldo voltar a ser positivo, realizar aumentos escalonados de 50 t/h por hora.
   - Meta: Buscar ${Math.min(nominal, Math.round(mediaSai + 50))} t/h nas próximas horas e avançar progressivamente até atingir o nominal de ${nominal} t/h.

Seguimos acompanhando o cenário hora a hora. Caso a indisponibilidade de equipamentos persista e o pátio atinja níveis críticos (${horaCritica ? `com risco projetado às ${fmtH(horaCritica)}` : '≤ 7 conjuntos'}), novos ajustes graduais serão avaliados pela gerência.
${dados.comentarios ? `\nOBSERVAÇÃO OPERACIONAL:\n${dados.comentarios}` : ''}`;

    if($('kpiStock'))$('kpiStock').textContent=`${estoqueAtual} (${estoqueTon.toFixed(0)}t)`;
    if($('kpiTrend')){ const tend=estoqueAtual - dados.estoque.h1; $('kpiTrend').textContent=`${tend>=0?'+':''}${formatarNumero(tend,1)}`; $('kpiTrend').className=`kpi-value ${tend<0?'danger':'positive'}`;}
    if($('kpiTrendDetail'))$('kpiTrendDetail').textContent='conj./h';
    if($('kpiSafeMoagem'))$('kpiSafeMoagem').textContent=formatarNumero(moagemSugerida);
    if($('kpiRiskHour'))$('kpiRiskHour').textContent=horaCritica!=null?fmtH(horaCritica):nivel;
    if($('resultStatus'))$('resultStatus').textContent=`${uni.sigla} • Nominal ${formatarNumero(nominal)} t/h • Mín ${minTotal} t/h • ${nivel} • Autonomia ${autonomiaAtual}h`;
    if($('analysisText'))$('analysisText').textContent=lastAnalysisText;
    
    // CORREÇÃO APLICADA AQUI (fechamento correto do parêntese)
    if($('calculationContent'))$('calculationContent').innerHTML=`Média Ent ${mediaEnt.toFixed(0)} t/h | Média Sai ${mediaSai.toFixed(0)} t/h | Saldo 3h ${saldo3.toFixed(0)}t<br>Estoque ${estoqueAtual} conj = ${estoqueTon.toFixed(0)}t | Autonomia ${autonomiaAtual}h<br>Moagem Sugerida (Gradual): ${moagemSugerida} t/h`;

    if($('resultArea'))$('resultArea').classList.remove('hidden');
    window.scrollTo({top:$('resultArea').offsetTop-20,behavior:'smooth'});
  }catch(err){
    console.error(err); if($('errorMessage'))$('errorMessage').textContent=err.message; if($('errorArea'))$('errorArea').classList.add('hidden');
  }finally{
    if(botao) botao.disabled=false; if(txt) txt.textContent='GERAR PLANO DE VOO'; if(ico) ico.textContent='→'; if($('loadingArea'))$('loadingArea').classList.add('hidden');
  }
}

if($('generateButton'))$('generateButton').addEventListener('click',gerarPlanoVoo);
if($('copyButton'))$('copyButton').addEventListener('click',async function(){ if(!lastAnalysisText) return; try{await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado'; setTimeout(()=>this.textContent=o,1500);}catch(e){}});
if($('clearButton'))$('clearButton').addEventListener('click',()=>{ if($('potentialInput'))$('potentialInput').value=''; ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{if($(id))$(id).value='';}); parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null; if($('previewArea'))$('previewArea').classList.add('hidden'); if($('potentialStatus'))$('potentialStatus').textContent=''; if($('resultArea'))$('resultArea').classList.add('hidden'); if($('errorArea'))$('errorArea').classList.add('hidden'); window.scrollTo({top:0,behavior:'smooth'});});
