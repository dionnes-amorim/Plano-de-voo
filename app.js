/* APP.JS - VERSÃO FINAL COM IA INTEGRADA */
const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};
const API_URL = '/api/plano-voo';
const $ = (id) => document.getElementById(id);
let parsedPotential = [];
let recognition = null; let listening = false; let lastAnalysisText = ''; let unidadeDetectada = null;

function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function identificarUnidade(texto){
  const n = normalizarTexto(texto);
  for(const k of Object.keys(CONFIG_UNIDADES)){ if(n.includes(k)) return {chave:k,...CONFIG_UNIDADES[k]}; }
  if(n.includes('UIM')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
  if(n.includes('UICA')) return {chave:'CRUZ ALTA',...CONFIG_UNIDADES['CRUZ ALTA']};
  if(n.includes('UISJ')) return {chave:'SAO JOSE',...CONFIG_UNIDADES['SAO JOSE']};
  if(n.includes('UIV')||n.includes('VER')) return {chave:'VERTENTE',...CONFIG_UNIDADES['VERTENTE']};
  if(n.includes('UIT')) return {chave:'TANABI',...CONFIG_UNIDADES['TANABI']};
  return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
}
function numeroBR(v){ if(v==null) return null; let t=String(v).trim().replace(/[^\d.,-]/g,''); if(!t) return null; if(t.includes('.')&&t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); else if(/^\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,''); else if(t.includes(',')) t=t.replace(',','.'); const n=Number(t); return Number.isFinite(n)?n:null; }
function formatarNumero(n,c=0){ if(n==null||isNaN(n)) return '-'; return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:c, maximumFractionDigits:c}); }

function atualizarLabelsEstoque(){ const h=new Date().getHours(); const f=v=>String((v+24)%24).padStart(2,'0')+'h'; if($('stockLabel1'))$('stockLabel1').textContent=f(h-3)+' - 3h'; if($('stockLabel2'))$('stockLabel2').textContent=f(h-2)+' - 2h'; if($('stockLabel3'))$('stockLabel3').textContent=f(h-1)+' - 1h'; if($('stockLabel4'))$('stockLabel4').textContent=f(h)+' • ATUAL'; }
atualizarLabelsEstoque(); setInterval(atualizarLabelsEstoque,60000);

function interpretarTabela(texto){
  if(!texto||!texto.trim()) return {rows:[], unidade:null, error:'Cole a tabela de potencial.'};
  if(window.__parsePotential){ try{ const p=window.__parsePotential(texto); if(p&&p.dados&&p.dados.length){ const u=identificarUnidade(texto); const rows=p.dados.map(d=>({hora:d.hora, horaNumero:Number(String(d.hora).split(':')[0]), potencial:d.entrada, moagem:d.saida, entrada:d.entrada, saida:d.saida})); return {rows, unidade:u, nominal:u.nominal, parsedMandu:p, error:null}; } }catch(e){} }
  const unidade=identificarUnidade(texto); const linhas=texto.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean); const rows=[];
  for(const l of linhas){ const m=l.match(/(\d{1,2})\s*-\s*(\d{1,2})/); if(!m) continue; const nums=l.match(/[\d.,]+/g)||[]; if(nums.length<4) continue; const ent=numeroBR(nums[nums.length-2]); const sai=numeroBR(nums[nums.length-1]); if(ent==null||sai==null) continue; rows.push({hora:`${String(Number(m[1])).padStart(2,'0')}:00`, horaNumero:Number(m[1]), potencial:ent, moagem:sai, entrada:ent, saida:sai}); }
  if(rows.length>=3) return {rows, unidade, nominal:unidade.nominal, error:null};
  return {rows:[], unidade, error:'Formato não identificado.'};
}
function horaRelativa(h,a){ let d=(h-a+24)%24; if(d>12) d-=24; return d; }
function selecionarHistorico(rows){ const at=new Date().getHours(); return rows.map(r=>({...r, distancia:horaRelativa(r.horaNumero,at)})).filter(r=>r.distancia<0).sort((a,b)=>b.distancia-a.distancia).slice(0,3).sort((a,b)=>a.distancia-b.distancia); }
function selecionarProjecao(rows){ const at=new Date().getHours(); return rows.map(r=>({...r, distancia:horaRelativa(r.horaNumero,at)})).filter(r=>r.distancia>=0).sort((a,b)=>a.distancia-b.distancia).slice(0,12); }

function renderizarPreview(){
  const preview=$('previewArea'), content=$('previewContent'), badge=$('previewBadge'), status=$('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando tabela...'; return; }
  if(status){ status.textContent=`✓ ${parsedPotential.length} horários`; status.className='input-status success'; }
  if(badge) badge.textContent=unidadeDetectada?`${unidadeDetectada.sigla} ${unidadeDetectada.tipo} MÍN ${unidadeDetectada.min}`:'OK';
  let html=`<div style="margin-bottom:8px"><strong>${unidadeDetectada.nome} (${unidadeDetectada.sigla})</strong> • ${unidadeDetectada.tipo} • Nom ${unidadeDetectada.nominal} • Mín ${unidadeDetectada.min} • Gatilho <${unidadeDetectada.gatilhoReducao}</div>`;
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">';
  selecionarProjecao(parsedPotential).forEach(r=>{ html+=`<div style="padding:6px;background:rgba(255,255,255,0.04);border-radius:6px"><strong>${r.hora}</strong><br><span style="font-size:11px">${Math.round(r.potencial)}/${Math.round(r.moagem)}</span></div>`; }); html+='</div>';
  if(content) content.innerHTML=html; if(preview) preview.classList.remove('hidden');
}
const potentialInputEl=$('potentialInput');
if(potentialInputEl){ potentialInputEl.addEventListener('input', function(){ const res=interpretarTabela(this.value); if(res.error){ parsedPotential=[]; unidadeDetectada=res.unidade; if($('potentialStatus')){$('potentialStatus').textContent=res.error; $('potentialStatus').className='input-status error';} if($('previewArea'))$('previewArea').classList.add('hidden'); return; } parsedPotential=res.rows; unidadeDetectada=res.unidade; renderizarPreview(); }); }

function configurarReconhecimento(){ const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR){ if($('micButton'))$('micButton').disabled=true; return; } recognition=new SR(); recognition.lang='pt-BR'; recognition.continuous=true; recognition.interimResults=true;
  recognition.onstart=()=>{ listening=true; if($('micButton'))$('micButton').classList.add('recording'); if($('voiceStatus'))$('voiceStatus').textContent='Ouvindo...'; };
  recognition.onresult=(e)=>{ let fin=''; for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) fin+=e.results[i][0].transcript; } const ta=$('comments'); if(ta&&fin){ ta.value=ta.value.trim()?ta.value.trim()+' '+fin.trim():fin.trim(); } };
  recognition.onend=()=>{ listening=false; if($('micButton'))$('micButton').classList.remove('recording'); if($('voiceStatus'))$('voiceStatus').textContent='Clique no microfone para ditar.'; };
}
configurarReconhecimento();
if($('micButton')){$('micButton').addEventListener('click',()=>{ if(!recognition) return; if(listening) recognition.stop(); else try{recognition.start();}catch(e){} });}

function montarDados(){
  const inputEl=$('potentialInput'); if(!inputEl) throw new Error('Campo de tabela não encontrado.');
  const tabela=inputEl.value.trim(); if(!tabela) throw new Error('Cole a Análise de Potencial.');
  const res=interpretarTabela(tabela); if(res.error) throw new Error(res.error);
  parsedPotential=res.rows; unidadeDetectada=res.unidade||identificarUnidade(tabela);
  const eAtual=$('stockCurrent')?.value; if(eAtual===''||eAtual==null) throw new Error('Informe o estoque atual.');
  return {tabelaOriginal:tabela, potencial:parsedPotential, estoque:{h3:Number($('stock1')?.value||0), h2:Number($('stock2')?.value||0), h1:Number($('stock3')?.value||0), atual:Number(eAtual)}, comentarios:$('comments')?$('comments').value.trim():'', horaAtual:new Date().getHours()};
}

async function gerarPlanoVoo(){
  const botao=$('generateButton'), textoBotao=$('generateText'), icone=$('generateIcon');
  try{
    const dados=montarDados();
    if(botao) botao.disabled=true; if(textoBotao) textoBotao.textContent='ENVIANDO PARA IA...'; if(icone) icone.textContent='🤖';
    if($('errorArea'))$('errorArea').classList.add('hidden'); if($('loadingArea'))$('loadingArea').classList.remove('hidden'); if($('resultArea'))$('resultArea').classList.add('hidden');

    console.log('Enviando para', API_URL, dados);

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });

    const data = await resp.json();
    console.log('Resposta IA:', data);

    if(!resp.ok) throw new Error(data.error || 'Erro na IA');

    lastAnalysisText = data.texto || data.planoVoo || data.comunicado;
    if(!lastAnalysisText) throw new Error('IA não retornou texto');

    if($('analysisText'))$('analysisText').textContent = lastAnalysisText;
    if($('resultStatus'))$('resultStatus').textContent = `${data.unidade?.sigla||''} • IA ${data.modelo||''} • ${data.calculos?.moagemSugerida||''} t/h sugerida`;
    if($('kpiStock'))$('kpiStock').textContent = `${dados.estoque.atual} conj`;
    if($('kpiSafeMoagem'))$('kpiSafeMoagem').textContent = `${data.calculos?.moagemSugerida||'-'}`;
    if($('kpiRiskHour'))$('kpiRiskHour').textContent = data.calculos?.risco?.primeiraHoraRisco!=null? String(data.calculos.risco.primeiraHoraRisco).padStart(2,'0')+':00' : 'OK';
    if($('calculationContent'))$('calculationContent').innerHTML = `Menor estoque ${data.calculos?.risco?.menorEstoque?.toFixed(1)} conj às ${data.calculos?.risco?.horaMenorEstoque}:00 | Mín ${data.unidade?.min} t/h`;

    if($('resultArea')){ $('resultArea').classList.remove('hidden'); window.scrollTo({top:$('resultArea').offsetTop-20, behavior:'smooth'}); }

  }catch(err){
    console.error(err);
    if($('errorMessage'))$('errorMessage').textContent = 'Erro IA: '+err.message+' - Verifique se o server está no ar e GEMINI_API_KEY configurada';
    if($('errorArea'))$('errorArea').classList.remove('hidden');
  }finally{
    if(botao) botao.disabled=false; if(textoBotao) textoBotao.textContent='GERAR PLANO DE VOO'; if(icone) icone.textContent='→'; if($('loadingArea'))$('loadingArea').classList.add('hidden');
  }
}

if($('generateButton'))$('generateButton').addEventListener('click', gerarPlanoVoo);
if($('copyButton'))$('copyButton').addEventListener('click', async function(){ if(!lastAnalysisText) return; try{ await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado p/ Whats'; setTimeout(()=>this.textContent=o,2000);}catch(e){}});
if($('clearButton'))$('clearButton').addEventListener('click', function(){
  if($('potentialInput'))$('potentialInput').value='';
  ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{ if($(id))$(id).value=''; });
  parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null;
  if($('previewArea'))$('previewArea').classList.add('hidden');
  if($('potentialStatus'))$('potentialStatus').textContent='';
  if($('resultArea'))$('resultArea').classList.add('hidden');
  if($('errorArea'))$('errorArea').classList.add('hidden');
  window.scrollTo({top:0, behavior:'smooth'});
});
