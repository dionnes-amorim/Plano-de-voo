/* =========================================================
   COA | PLANO DE VOO CTT - PADRÃO GESTÃO WHATS - V3 FINAL
   REGRAS: UIM 650, UICA 600 (2x300), UISJ 550, UIV 400, UIT 300
   GATILHO: <12 conj (UIV <4) | AJUSTE GRADUAL 50-100t/h
========================================================= */

const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', sigla: 'UIM', nominal: 917, tipo: 'MOENDA', min: 650, gatilhoReducao: 12 },
  'CRUZ ALTA': { nome: 'Cruz Alta', sigla: 'UICA', nominal: 900, tipo: 'DIFUSOR', difusores: 2, minPorDifusor: 300, min: 600, gatilhoReducao: 12 },
  'SAO JOSE': { nome: 'São José', sigla: 'UISJ', nominal: 750, tipo: 'MOENDA', min: 550, gatilhoReducao: 12 },
  'VERTENTE': { nome: 'Vertente', sigla: 'UIV', nominal: 500, tipo: 'DIFUSOR', min: 400, gatilhoReducao: 4 },
  'TANABI': { nome: 'Tanabi', sigla: 'UIT', nominal: 710, tipo: 'MOENDA', min: 300, gatilhoReducao: 12 }
};

const $ = (id) => document.getElementById(id);
let parsedPotential = [];
let recognition = null;
let listening = false;
let lastAnalysisText = '';
let unidadeDetectada = null;

function normalizarTexto(t){ return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function identificarUnidade(texto){
  const n = normalizarTexto(texto);
  for(const k of Object.keys(CONFIG_UNIDADES)){ if(n.includes(k)) return {chave:k,...CONFIG_UNIDADES[k]}; }
  if(n.includes('UIM')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
  if(n.includes('UICA')) return {chave:'CRUZ ALTA',...CONFIG_UNIDADES['CRUZ ALTA']};
  if(n.includes('UISJ')) return {chave:'SAO JOSE',...CONFIG_UNIDADES['SAO JOSE']};
  if(n.includes('UIV')||n.includes('VER')||n.includes('VERTENTE')) return {chave:'VERTENTE',...CONFIG_UNIDADES['VERTENTE']};
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
  return {rows:[], unidade, error:'Não consegui identificar o formato.'};
}
function horaRelativa(h,a){ let d=(h-a+24)%24; if(d>12) d-=24; return d; }
function selecionarHistorico(rows){ const at=new Date().getHours(); return rows.map(r=>({...r, distancia:horaRelativa(r.horaNumero,at)})).filter(r=>r.distancia<0).sort((a,b)=>b.distancia-a.distancia).slice(0,3).sort((a,b)=>a.distancia-b.distancia); }
function selecionarProjecao(rows){ const at=new Date().getHours(); return rows.map(r=>({...r, distancia:horaRelativa(r.horaNumero,at)})).filter(r=>r.distancia>=0).sort((a,b)=>a.distancia-b.distancia).slice(0,12); }

function renderizarPreview(){
  const preview=$('previewArea'), content=$('previewContent'), badge=$('previewBadge'), status=$('potentialStatus');
  if(!parsedPotential.length){ if(preview) preview.classList.add('hidden'); if(status) status.textContent='Aguardando tabela...'; return; }
  if(status){ status.textContent=`✓ ${parsedPotential.length} horários`; status.className='input-status success'; }
  if(badge) badge.textContent=unidadeDetectada?`${unidadeDetectada.sigla} ${unidadeDetectada.tipo} MÍN ${unidadeDetectada.min} GATILHO <${unidadeDetectada.gatilhoReducao}`:'OK';
  let html=`<div style="margin-bottom:8px"><strong>${unidadeDetectada.nome} (${unidadeDetectada.sigla})</strong> • ${unidadeDetectada.tipo} • Nominal ${unidadeDetectada.nominal} • Mín ${unidadeDetectada.min} t/h • Gatilho redução <${unidadeDetectada.gatilhoReducao} conj</div>`;
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
  return {tabelaOriginal:tabela, unidade:unidadeDetectada, nominal:unidadeDetectada.nominal, potencial:parsedPotential, parsedMandu:res.parsedMandu, estoque:{h3:Number($('stock1')?.value||0), h2:Number($('stock2')?.value||0), h1:Number($('stock3')?.value||0), atual:Number(eAtual)}, comentarios:$('comments')?$('comments').value.trim():''};
}

async function gerarPlanoVoo(){
  const botao=$('generateButton'), textoBotao=$('generateText'), icone=$('generateIcon');
  try{
    const dados=montarDados();
    if(botao) botao.disabled=true; if(textoBotao) textoBotao.textContent='GERANDO ANÁLISE GERÊNCIA...'; if(icone) icone.textContent='⏳';
    if($('errorArea'))$('errorArea').classList.add('hidden'); if($('loadingArea'))$('loadingArea').classList.remove('hidden'); if($('resultArea'))$('resultArea').classList.add('hidden');
    await new Promise(r=>setTimeout(r,100));

    let entradaTotal, saidaTotal, ultimas3Entrada, ultimas3Saida, saldo3;
    if(dados.parsedMandu){ entradaTotal=dados.parsedMandu.entradaTotal; saidaTotal=dados.parsedMandu.saidaTotal; ultimas3Entrada=dados.parsedMandu.ultimas3Entrada; ultimas3Saida=dados.parsedMandu.ultimas3Saida; saldo3=dados.parsedMandu.saldo3; }
    else{ const hist=selecionarHistorico(dados.potencial); const us=hist.length?hist:dados.potencial.slice(-3); ultimas3Entrada=us.reduce((a,b)=>a+(b.entrada||0),0); ultimas3Saida=us.reduce((a,b)=>a+(b.saida||0),0); saldo3=ultimas3Entrada-ultimas3Saida; entradaTotal=dados.potencial.reduce((a,b)=>a+(b.entrada||0),0); saidaTotal=dados.potencial.reduce((a,b)=>a+(b.saida||0),0); }

    const mediaEnt=ultimas3Entrada/3, mediaSai=ultimas3Saida/3;
    const estoqueAtual=dados.estoque.atual, estoqueH1=dados.estoque.h1, estoqueH2=dados.estoque.h2, estoqueH3=dados.estoque.h3;
    const tendenciaEstoque = estoqueAtual - estoqueH1;
    const tendenciaSaldo = saldo3;
    const uni=dados.unidade;
    const proj=selecionarProjecao(dados.potencial);
    const fmtH=h=>String((h+24)%24).padStart(2,'0')+':00';
    const agoraH=new Date().getHours();

    // PROJEÇÃO DETALHADA
    let estoqueSim=estoqueAtual, menorEstoque=estoqueAtual, horaMenor=null, horaQueda=null, horaCritica12=null, horaZera=null;
    let janelasRecuperacao=[];
    const projDet=[];
    for(const r of proj){
      const saldo=r.entrada - r.saida;
      estoqueSim+=saldo/70;
      projDet.push({...r, saldo, estoqueProj:estoqueSim});
      if(estoqueSim<menorEstoque){ menorEstoque=estoqueSim; horaMenor=r.horaNumero; }
      if(horaQueda==null && r.entrada < r.saida*0.95) horaQueda=r.horaNumero;
      if(horaCritica12==null && estoqueSim < uni.gatilhoReducao) horaCritica12=r.horaNumero;
      if(horaZera==null && estoqueSim <=1) horaZera=r.horaNumero;
      if(r.entrada > r.saida + 50) janelasRecuperacao.push(r.hora);
    }

    // LÓGICA DE MOAGEM SUGERIDA - NOMINAL É TETO
    let moagemSugerida = Math.round(mediaSai);
    let justificativaMoagem = '';
    let planoRetorno = '';

    if(estoqueAtual < uni.gatilhoReducao){
      // ESTOQUE BAIXO - REDUZ GRADUAL
      const recuo = Math.min(100, Math.max(50, Math.round((uni.gatilhoReducao - estoqueAtual)*20)));
      moagemSugerida = Math.max(uni.min, moagemSugerida - recuo);
      justificativaMoagem = `estoque atual de ${estoqueAtual} conj abaixo do gatilho de ${uni.gatilhoReducao} conj, com saldo negativo de ${saldo3.toFixed(0)}t nas últimas 3h.`;
      planoRetorno = `Ajuste gradual de -${recuo} t/h para ${moagemSugerida} t/h. Retorno para nominal ${uni.nominal} t/h em passos de +50 t/h assim que o pátio superar ${uni.gatilhoReducao+2} conj e a entrada média superar ${Math.round(uni.nominal*0.85)} t/h por 2h consecutivas.`;
    } else if(estoqueAtual >= uni.gatilhoReducao && estoqueAtual < uni.gatilhoReducao + 3 && saldo3 < -100){
      // ATENÇÃO - NÃO REDUZ AINDA, MAS NÃO VAI PRA NOMINAL
      moagemSugerida = Math.max(uni.min, Math.round(mediaSai) - 50);
      justificativaMoagem = `estoque em ${estoqueAtual} conj (limite do gatilho de ${uni.gatilhoReducao}) e tendência de queda (${tendenciaEstoque>=0?'+':''}${tendenciaEstoque.toFixed(1)} conj/h).`;
      planoRetorno = `Recuo preventivo de 50 t/h para ${moagemSugerida} t/h para estancar a queda e evitar atingir o gatilho.`;
    } else if(mediaSai > uni.nominal){
      // ACIMA DO NOMINAL - TRAZER PARA NOMINAL
      moagemSugerida = uni.nominal;
      justificativaMoagem = `média de ${mediaSai.toFixed(0)} t/h acima da capacidade nominal de ${uni.nominal} t/h.`;
      planoRetorno = `Adequação para nominal ${uni.nominal} t/h.`;
    } else if(saldo3 > 200 && estoqueAtual >= 12){
      // CENÁRIO BOM - PODE SUBIR GRADUAL
      const aumento = 50;
      moagemSugerida = Math.min(uni.nominal, Math.round(mediaSai) + aumento);
      justificativaMoagem = `saldo positivo de +${saldo3.toFixed(0)}t e pátio estável em ${estoqueAtual} conj, permitindo elevação segura.`;
      planoRetorno = `Elevação gradual de +${aumento} t/h para ${moagemSugerida} t/h, com meta de atingir nominal ${uni.nominal} t/h nas próximas ${janelasRecuperacao.length>0? janelasRecuperacao.length : 2}h.`;
    } else {
      moagemSugerida = Math.round(mediaSai);
      justificativaMoagem = `cenário em equilíbrio, buscando estabilizar entrega com estoque.`;
      planoRetorno = `Manter ${moagemSugerida} t/h e avaliar elevação de +50 t/h quando a entrega sustentar.`;
    }

    // Monta texto de frentes / quebras do comentário
    let obsFrentes = dados.comentarios;
    if(!obsFrentes){
      obsFrentes = `Estamos em acompanhamento das frentes de corte, com atenção para quebras de colhedoras, tratores transbordo e caminhões, visando garantir a entrega projetada.`;
    }

    // TEXTO FINAL - PADRÃO GESTÃO COMPLETO E LONGO
    lastAnalysisText =
`*Comunicado ${uni.sigla}*

No momento, a moagem da ${uni.sigla} está liberada para ${moagemSugerida} t/h (nominal máxima ${uni.nominal} t/h / mínimo operacional ${uni.min} t/h ${uni.tipo}${uni.difusores?` ${uni.difusores}x${uni.minPorDifusor}`:''}), porém a média das últimas 3 horas está em ${mediaSai.toFixed(0)} t/h, com entrada média de ${mediaEnt.toFixed(0)} t/h. Diante disso, ${mediaSai > uni.nominal? 'foi realizado um ajuste para manter a moagem dentro da capacidade nominal da planta' : `foi avaliado cenário de ${justificativaMoagem}`}. ${planoRetorno}

Análise de pátio: O pátio saiu de ${estoqueH3} conj (3h atrás) para ${estoqueH2} conj (2h atrás), depois para ${estoqueH1} conj (1h atrás) e agora contabiliza ${estoqueAtual} conj, representando ${tendenciaEstoque>=0?'+':''}${tendenciaEstoque.toFixed(1)} conj na última hora. Saldo das últimas 3h de ${saldo3.toFixed(0)}t (entrada ${ultimas3Entrada.toFixed(0)}t vs saída ${ultimas3Saida.toFixed(0)}t). No acumulado do dia, entrada total de ${entradaTotal.toFixed(0)}t e saída de ${saidaTotal.toFixed(0)}t.

Atualmente, ${obsFrentes}

Com base nos pontos citados acima, estamos reforçando junto à indústria a necessidade de manter a moagem o mais próximo possível da nominal de ${uni.nominal} t/h, evitando redução adicional, visto que ${horaQueda!=null?`a partir das ${fmtH(horaQueda)} a projeção indica entrada de ${projDet.find(p=>p.horaNumero==horaQueda)?.entrada.toFixed(0) || '-'}t/h abaixo da moagem`:'a tendência é de oscilação na entrega'}.

Como pode ser observado no gráfico acima, o pátio contabiliza no momento ${estoqueAtual} conjuntos carregados, com tendência de ${tendenciaSaldo<0?'nova redução':'estabilização'} nas próximas horas${horaCritica12!=null?`, gerando risco iminente de atingir o gatilho de ${uni.gatilhoReducao} conj e necessidade de redução de moagem até as ${fmtH(horaCritica12)}.`:` e projeção de menor nível de ${menorEstoque.toFixed(1)} conj às ${horaMenor!=null?fmtH(horaMenor):'-'}.`} ${horaZera!=null?`Risco crítico de zerar o pátio às ${fmtH(horaZera)} se o ciclo não for restabelecido.` : ''}

Estamos em contato com a supervisão da unidade para garantir a entrega das demais frentes, buscando manter a moagem o mais próximo possível da nominal, mesmo operando com o pátio em nível baixo. Sugestões para melhorar o cenário:
• Acelerar mudança de frentes com maior rendimento e menor distância média
• Verificar quebras de colhedoras e transbordos que estão impactando a entrega (F501, F505, F506, F542, F503 quando citadas)
• Priorizar transporte próprio e checagem de tempo de ciclo dos caminhões
• Alinhar troca de turno do transporte (18h / 21h / 06h) para evitar quebra de ciclo
${janelasRecuperacao.length>0?`• Janelas de recuperação identificadas: ${janelasRecuperacao.join(', ')} - oportunidade para elevar +50 t/h` : ''}

Outro fator crítico para a quebra de ciclo será a troca de turno do transporte e da colheita. Caso ocorram atrasos nesse processo, a moagem corre grande risco de sofrer novas reduções graduais de 50 a 100 t/h até estabilizar em ${uni.min} t/h (mínimo da ${uni.sigla}) e só retornando para nominal após recuperação do pátio acima de ${uni.gatilhoReducao+2} conjuntos.

*Projeção hora a hora:*
${projDet.map(p=>`${p.hora}: Ent ${p.entrada.toFixed(0)} / Moag ${p.saida.toFixed(0)} | Saldo ${p.saldo>=0?'+':''}${p.saldo.toFixed(0)}t | Estoque proj ${p.estoqueProj.toFixed(1)} conj ${p.estoqueProj < uni.gatilhoReducao? '⚠ ABAIXO GATILHO' : ''}`).join('\n')}
`.trim();

    if($('kpiStock'))$('kpiStock').textContent=`${estoqueAtual} conj`;
    if($('kpiTrend')){ $('kpiTrend').textContent=`${tendenciaEstoque>=0?'+':''}${formatarNumero(tendenciaEstoque,1)}`; $('kpiTrend').className=`kpi-value ${tendenciaEstoque<0?'danger':'positive'}`; }
    if($('kpiSafeMoagem'))$('kpiSafeMoagem').textContent=formatarNumero(moagemSugerida);
    if($('kpiRiskHour'))$('kpiRiskHour').textContent=horaCritica12!=null?fmtH(horaCritica12):(horaQueda!=null?fmtH(horaQueda):'ESTÁVEL');
    if($('resultStatus'))$('resultStatus').textContent=`${uni.sigla} ${uni.tipo} Nom ${uni.nominal} Mín ${uni.min} Gatilho <${uni.gatilhoReducao} • Sugerida ${moagemSugerida} t/h`;
    if($('analysisText'))$('analysisText').textContent=lastAnalysisText;
    if($('calculationContent'))$('calculationContent').innerHTML=`Estoque ${estoqueH3}→${estoqueH2}→${estoqueH1}→<b>${estoqueAtual}</b> | Saldo 3h ${saldo3.toFixed(0)}t | Menor proj ${menorEstoque.toFixed(1)} às ${horaMenor!=null?fmtH(horaMenor):'-'} | Sug ${moagemSugerida} t/h`;

    if($('resultArea')){ $('resultArea').classList.remove('hidden'); window.scrollTo({top:$('resultArea').offsetTop-20, behavior:'smooth'}); }

  }catch(err){ if($('errorMessage'))$('errorMessage').textContent=err.message; if($('errorArea'))$('errorArea').classList.remove('hidden'); }
  finally{ if(botao) botao.disabled=false; if(textoBotao) textoBotao.textContent='GERAR PLANO DE VOO'; if(icone) icone.textContent='→'; if($('loadingArea'))$('loadingArea').classList.add('hidden'); }
}

if($('generateButton'))$('generateButton').addEventListener('click', gerarPlanoVoo);
if($('copyButton'))$('copyButton').addEventListener('click', async function(){ if(!lastAnalysisText) return; try{ await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado p/ Whats'; setTimeout(()=>this.textContent=o,2000);}catch(e){ alert('Copie manualmente'); }});
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
