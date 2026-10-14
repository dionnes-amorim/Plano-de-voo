/* =========================================================
   COA | PLANO DE VOO CTT - GERÊNCIA COMPLEXO
   100% LOCAL - SEM API
========================================================= */

const CONFIG_UNIDADES = {
  'MANDU': { nome: 'Mandu', nominal: 917, difusores: 2, minPorDifusor: 300, minTotal: 600, min1Difusor: 300 },
  'CRUZ ALTA': { nome: 'Cruz Alta', nominal: 900, difusores: 2, minPorDifusor: 300, minTotal: 600, min1Difusor: 300 },
  'SAO JOSE': { nome: 'São José', nominal: 750, difusores: 1, minPorDifusor: 550, minTotal: 550, min1Difusor: 550 },
  'VERTENTE': { nome: 'Vertente', nominal: 500, difusores: 1, minPorDifusor: 400, minTotal: 400, min1Difusor: 400 },
  'TANABI': { nome: 'Tanabi', nominal: 710, difusores: 1, minPorDifusor: 500, minTotal: 500, min1Difusor: 500 }
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
  if(n.includes('MANDU')) return {chave:'MANDU',...CONFIG_UNIDADES['MANDU']};
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
  if($('stockLabel1')) $('stockLabel1').textContent=fmt(h-3)+' - 3h';
  if($('stockLabel2')) $('stockLabel2').textContent=fmt(h-2)+' - 2h';
  if($('stockLabel3')) $('stockLabel3').textContent=fmt(h-1)+' - 1h';
  if($('stockLabel4')) $('stockLabel4').textContent=fmt(h)+' • ATUAL';
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
  let html=''; if(unidadeDetectada) html+=`<div style="margin-bottom:8px"><strong>${unidadeDetectada.nome}</strong> • Nom ${formatarNumero(unidadeDetectada.nominal)} t/h • Mín ${formatarNumero(unidadeDetectada.minTotal)} t/h (${unidadeDetectada.difusores}x${formatarNumero(unidadeDetectada.minPorDifusor)})</div>`;
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">'; futuro.forEach(r=>{html+=`<div style="padding:6px;background:rgba(255,255,255,0.03);border-radius:6px"><strong>${r.hora}</strong><br><span style="font-size:10px">${Math.round(r.potencial)}/${Math.round(r.moagem)} t/h</span></div>`;}); html+='</div>';
  if(hist.length) html+=`<div style="margin-top:8px;font-size:11px"><strong>Hist 3h:</strong> ${hist.map(r=>`${r.hora} ${Math.round(r.potencial)}/${Math.round(r.moagem)}`).join(' • ')}</div>`;
  if(content) content.innerHTML=html; if(preview) preview.classList.remove('hidden');
}

const pEl=$('potentialInput');
if(pEl) pEl.addEventListener('input',function(){const res=interpretarTabela(this.value); if(res.error){parsedPotential=[]; unidadeDetectada=res.unidade||null; if($('potentialStatus')){$('potentialStatus').textContent=res.error; $('potentialStatus').className='input-status error';} if($('previewArea')) $('previewArea').classList.add('hidden'); return;} parsedPotential=res.rows; unidadeDetectada=res.unidade; renderizarPreview();});

function configurarReconhecimento(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR){ if($('micButton')) $('micButton').disabled=true; return; }
  recognition=new SR(); recognition.lang='pt-BR'; recognition.continuous=false; recognition.interimResults=true;
  recognition.onstart=()=>{listening=true; if($('micButton')) $('micButton').classList.add('recording'); if($('voiceStatus')) $('voiceStatus').textContent='Ouvindo...';};
  recognition.onresult=(e)=>{let f=''; for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) f+=e.results[i][0].transcript; } const ta=$('comments'); if(ta&&f) ta.value=ta.value.trim()?ta.value.trim()+' '+f.trim():f.trim();};
  recognition.onend=()=>{listening=false; if($('micButton')) $('micButton').classList.remove('recording'); if($('voiceStatus')) $('voiceStatus').textContent='Clique no microfone.';};
}
configurarReconhecimento();
if($('micButton')) $('micButton').addEventListener('click',()=>{ if(!recognition) return; if(listening) recognition.stop(); else try{recognition.start();}catch(e){} });

function montarDados(){
  const t=$('potentialInput').value.trim(); if(!t) throw new Error('Cole a tabela.');
  const res=interpretarTabela(t); if(res.error) throw new Error(res.error);
  parsedPotential=res.rows; unidadeDetectada=res.unidade;
  const e1=Number($('stock1')?.value||0); const e2=Number($('stock2')?.value||0); const e3=Number($('stock3')?.value||0); const eAtual=Number($('stockCurrent')?.value);
  if(isNaN(eAtual)) throw new Error('Informe estoque atual.');
  return {tabelaOriginal:t,unidade:unidadeDetectada,nominal:unidadeDetectada.nominal,potencial:parsedPotential,parsedMandu:res.parsedMandu,estoque:{h3:e1,h2:e2,h1:e3,atual:eAtual},comentarios:$('comments')?.value.trim()||''};
}

async function gerarPlanoVoo(){
  const botao=$('generateButton'); const txt=$('generateText'); const ico=$('generateIcon');
  try{
    const dados=montarDados();
    if(botao) botao.disabled=true; if(txt) txt.textContent='GERANDO PLANO GERÊNCIA...'; if(ico) ico.textContent='⏳';
    if($('errorArea')) $('errorArea').classList.add('hidden'); if($('loadingArea')) $('loadingArea').classList.remove('hidden'); if($('resultArea')) $('resultArea').classList.add('hidden');
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

    // MOAGEM SEGURA EM 3 NÍVEIS
    let moagemSegura = Math.round(mediaEnt);
    let moagemAlerta = Math.round(mediaEnt*0.95);
    let moagemReduzida = Math.max(minTotal, Math.round(mediaEnt*0.85));

    // DECISÃO GERÊNCIA
    let nivel='ESTÁVEL', acaoPrincipal='', reducaoNecessaria=0;
    const fmtH=(h)=>String((h+24)%24).padStart(2,'0')+':00';
    const agora=new Date().getHours();

    if(saldo3 < -400 || estoqueAtual <= 5){
      nivel='CRÍTICO';
      reducaoNecessaria = Math.max(0, Math.round(mediaSai - moagemReduzida));
      acaoPrincipal=`REDUÇÃO É ÚLTIMO CASO - Mas cenário exige. Estoque ${estoqueAtual} conj (${estoqueTon}t) só ${ (estoqueTon / (mediaSai||nominal)).toFixed(1)}h de autonomia a ${Math.round(mediaSai)} t/h. Saldo 3h ${saldo3.toFixed(0)}t negativo.`;
    } else if(saldo3 < -150 || estoqueAtual <= 8){
      nivel='ATENÇÃO / QUEDA';
      acaoPrincipal=`Pátio em queda controlada. Autonomia curta. Prioridade máxima acelerar entrada antes de pensar em reduzir.`;
      moagemSegura=Math.round(Math.min(mediaSai, mediaEnt));
    } else if(saldo3 > 150){
      nivel='RECUPERAÇÃO';
      moagemSegura=Math.round(Math.min(nominal, mediaEnt+40));
      acaoPrincipal=`Pátio recuperando. Saldo 3h +${saldo3.toFixed(0)}t. Condição para elevar moagem até ${moagemSegura} t/h e formar estoque pulmão.`;
    } else {
      nivel='ESTÁVEL';
      acaoPrincipal=`Pátio estável. Manter ritmo e monitorar entrada hora a hora.`;
    }

    // QUANDO REDUZ E QUANDO VOLTA
    let planoReducao='';
    if(nivel==='CRÍTICO'){
      planoReducao = `→ ${fmtH(agora)} até ${horaCritica!=null?fmtH(horaCritica):fmtH(agora+2)}: Manter ${Math.round(mediaSai)} t/h SE entrada reagir. Se não, reduzir para ${moagemAlerta} t/h (redução de ${Math.round(mediaSai-moagemAlerta)} t/h)\n`+
                     `→ Se estoque < 7 conj: Reduzir para MÍNIMO OPERACIONAL ${minTotal} t/h (${numDif}x ${minPorDif} t/h por difusor)\n`+
                     `→ ${numDif>1?`ÚLTIMO CASO: Desligar 1 difusor → operar a ${uni.min1Difusor} t/h (mínimo de 1 difusor)`: `ÚLTIMO CASO: Operar no mínimo ${minTotal} t/h`}\n`+
                     `→ RETORNO: Quando estoque voltar a 10 conj E entrada média 3h > ${Math.round(mediaSai)} t/h, elevar para ${moagemSegura} t/h e depois para nominal ${nominal} t/h`;
    } else if(nivel.includes('ATENÇÃO')){
      planoReducao = `→ Próximas 2h: Tentar manter ${Math.round(mediaSai)} t/h acelerando corte\n`+
                     `→ Se saldo continuar negativo: Reduzir para ${moagemAlerta} t/h\n`+
                     `→ NÃO reduzir para mínimo ${minTotal} t/h agora - mínimo é último caso\n`+
                     `→ RETORNO: Quando saldo 3h ficar positivo por 2h seguidas, voltar para ${nominal} t/h`;
    } else {
      planoReducao = `→ Manter ${moagemSegura} t/h nas próximas ${projDetalhada.length}h\n`+
                     `→ Janela para formar estoque: ${projDetalhada.filter(p=>p.entrada>p.saida).map(p=>p.hora).join(', ')||'avaliar entrada'}\n`+
                     `→ RETORNO AO NOMINAL: Já em condição, pode buscar ${nominal} t/h se entrada sustentar > ${nominal-50} t/h`;
    }

    const autonomiaAtual = (estoqueTon / (mediaSai||nominal)).toFixed(1);
    const autonomiaMin = (estoqueTon / minTotal).toFixed(1);

    // TEXTO FINAL GERÊNCIA
    lastAnalysisText =
`*PLANO DE VOO — ${uni.nome.toUpperCase()} — ${nivel}*
Unidade: ${uni.nome} | Nominal ${nominal} t/h | Mínimo operacional ${minTotal} t/h (${numDif} difusor(es) x ${minPorDif} t/h) | Último caso 1 difusor ${uni.min1Difusor} t/h

*SITUAÇÃO ATUAL - ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}*
Estoque: ${estoqueAtual} conj (${estoqueTon.toFixed(0)}t) | Autonomia ${autonomiaAtual}h a ${Math.round(mediaSai)} t/h | ${autonomiaMin}h se for para mínimo ${minTotal} t/h
Últimas 3h: Entrada ${ult3Ent.toFixed(0)}t / Saída ${ult3Sai.toFixed(0)}t | Saldo ${saldo3.toFixed(0)}t (${saldo3<0?'↓ queda':'↑ recuperação'})
Média 3h: Entrada ${mediaEnt.toFixed(0)} t/h | Moagem ${mediaSai.toFixed(0)} t/h | Dif ${ (mediaEnt-mediaSai).toFixed(0)} t/h
Dia: Entrada ${entradaTotal.toFixed(0)}t / Saída ${saidaTotal.toFixed(0)}t | Saldo dia ${(entradaTotal-saidaTotal).toFixed(0)}t

*PROJEÇÃO HORA A HORA (próximas ${projDetalhada.length}h)*
${projDetalhada.map(p=>`${p.hora} | Ent ${p.entrada.toFixed(0)}t / Moag ${p.saida.toFixed(0)}t | Saldo ${p.saldo>=0?'+':''}${p.saldo.toFixed(0)}t | Estoque proj ${p.estoqueProj.toFixed(1)} conj ${p.estoqueProj<=7?'⚠':''}`).join('\n')}
→ Menor estoque projetado: ${menorEstoque.toFixed(1)} conj às ${fmtH(horaMenor)}
${horaCritica!=null?`→ Entra em risco (≤7 conj) às ${fmtH(horaCritica)}`: '→ Não entra em risco ≤7 conj no horizonte'}
${horaZera!=null?`→ RISCO DE ZERAR às ${fmtH(horaZera)}`: ''}

*MOAGEM CADASTRADA*
Nominal: ${nominal} t/h
Mínimo operacional total: ${minTotal} t/h (${numDif}x ${minPorDif} t/h)
Mínimo 1 difusor: ${uni.min1Difusor} t/h - ÚLTIMO CASO
Faixa segura calculada agora: ${moagemReduzida} - ${moagemSegura} t/h

*PONTO DE ATENÇÃO - ${nivel}*
${acaoPrincipal}
${saldo3 < -200?`Causa raiz: Entrada média ${mediaEnt.toFixed(0)} t/h < Moagem ${mediaSai.toFixed(0)} t/h = déficit de ${(mediaSai-mediaEnt).toFixed(0)} t/h. Cada hora com esse déficit consome ${(mediaSai-mediaEnt)/70} conj.`:''}
${estoqueAtual<=7?`Estoque crítico: ${estoqueAtual} conj é abaixo do pulmão de 10 conj.`:''}

*PLANO DE AÇÃO - REDUÇÃO É ÚLTIMO CASO*
1. ACELERAR ENTRADA (antes de reduzir): ${dados.comentarios? `\n Obs operacional: ${dados.comentarios}`: '\n - Checar frente de corte, ciclo de caminhões, transbordo'}
   - Meta entrada próximas 2h: > ${Math.round(mediaSai+30)} t/h para estabilizar
2. MANTER MOAGEM:
${planoReducao}
3. GATILHOS:
   - Se estoque ≥12 conj por 2h: Liberar nominal ${nominal} t/h
   - Se estoque 8-10 conj: Manter ${moagemSegura} t/h
   - Se estoque ≤7 conj: Reduzir para ${moagemAlerta} t/h e acionar liderança
   - Se estoque ≤4 conj: Mínimo ${minTotal} t/h + ${numDif>1?'avaliar desligar 1 difusor para '+uni.min1Difusor+' t/h':''}
   - Se estoque ≤2 conj: ÚLTIMO CASO - ${uni.min1Difusor} t/h e parada programada

*PERSPECTIVA / RETORNO AO NORMAL*
${nivel==='CRÍTICO'?`→ Retorno ao normal só após estoque ≥10 conj E entrada > ${Math.round(mediaSai+50)} t/h por 3h. Previsão: ${horaCritica!=null? `após ${fmtH(horaCritica+2)} se entrada reagir`: 'avaliar nas próximas 2h'}`: nivel.includes('ATENÇÃO')? `→ Se entrada reagir para > ${Math.round(mediaSai)} t/h nas próximas 2h, já volta para nominal ${nominal} t/h. Senão, manter ${moagemAlerta} t/h até recuperar.`: `→ Cenário favorável para buscar nominal ${nominal} t/h e formar estoque de segurança para turno da noite.`}
${projDetalhada.some(p=>p.entrada>p.saida+100)?`→ Janelas de recuperação identificadas: ${projDetalhada.filter(p=>p.entrada>p.saida+50).map(p=>p.hora).join(', ')} (entrada > moagem)`:''}

*OBSERVAÇÕES GERÊNCIA*
- Redução de moagem é último caso, sempre priorizar acelerar entrada
- Mínimo ${minTotal} t/h é operacional, abaixo disso só com 1 difusor a ${uni.min1Difusor} t/h
- Autonomia atual ${autonomiaAtual}h - ${estoqueAtual<=7?'curta, exige ação imediata':'adequada para gestão'}
${dados.comentarios?`\n*COMENTÁRIO OPERACIONAL INFORMADO:*\n${dados.comentarios}`:''}
`;

    if($('kpiStock')) $('kpiStock').textContent=`${estoqueAtual} (${estoqueTon.toFixed(0)}t)`;
    if($('kpiTrend')){ const tend=estoqueAtual - dados.estoque.h1; $('kpiTrend').textContent=`${tend>=0?'+':''}${formatarNumero(tend,1)}`; $('kpiTrend').className=`kpi-value ${tend<0?'danger':'positive'}`;}
    if($('kpiTrendDetail')) $('kpiTrendDetail').textContent='conj./h';
    if($('kpiSafeMoagem')) $('kpiSafeMoagem').textContent=formatarNumero(moagemSegura);
    if($('kpiRiskHour')) $('kpiRiskHour').textContent=horaCritica!=null?fmtH(horaCritica):nivel;
    if($('resultStatus')) $('resultStatus').textContent=`${uni.nome} • Nominal ${formatarNumero(nominal)} t/h • Mín ${minTotal} t/h • ${nivel} • Autonomia ${autonomiaAtual}h`;
    if($('analysisText')) $('analysisText').textContent=lastAnalysisText;
    if($('calculationContent')) $('calculationContent').innerHTML=`Média Ent ${mediaEnt.toFixed(0)} t/h | Média Sai ${mediaSai.toFixed(0)} t/h | Saldo 3h ${saldo3.toFixed(0)}t<br>Estoque ${estoqueAtual} conj = ${estoqueTon.toFixed(0)}t | Autonomia ${autonomiaAtual}h a ${Math.round(mediaSai)} t/h / ${autonomiaMin}h a mínimo ${minTotal} t/h<br>Menor proj ${menorEstoque.toFixed(1)} conj às ${fmtH(horaMenor)} | Risco ≤7 conj ${horaCritica!=null?fmtH(horaCritica):'não entra'}<br>Mínimos: ${numDif}x${minPorDif}=${minTotal} t/h | 1 dif=${uni.min1Difusor} t/h`;

    if($('resultArea')) $('resultArea').classList.remove('hidden');
    window.scrollTo({top:$('resultArea').offsetTop-20,behavior:'smooth'});
  }catch(err){
    console.error(err); if($('errorMessage')) $('errorMessage').textContent=err.message; if($('errorArea')) $('errorArea').classList.remove('hidden');
  }finally{
    if(botao) botao.disabled=false; if(txt) txt.textContent='GERAR PLANO DE VOO'; if(ico) ico.textContent='→'; if($('loadingArea')) $('loadingArea').classList.add('hidden');
  }
}
if($('generateButton')) $('generateButton').addEventListener('click',gerarPlanoVoo);
if($('copyButton')) $('copyButton').addEventListener('click',async function(){ if(!lastAnalysisText) return; try{await navigator.clipboard.writeText(lastAnalysisText); const o=this.textContent; this.textContent='✓ Copiado'; setTimeout(()=>this.textContent=o,1500);}catch(e){}});
if($('clearButton')) $('clearButton').addEventListener('click',()=>{ if($('potentialInput')) $('potentialInput').value=''; ['stock1','stock2','stock3','stockCurrent','comments'].forEach(id=>{if($(id)) $(id).value='';}); parsedPotential=[]; lastAnalysisText=''; unidadeDetectada=null; if($('previewArea')) $('previewArea').classList.add('hidden'); if($('potentialStatus')) $('potentialStatus').textContent=''; if($('resultArea')) $('resultArea').classList.add('hidden'); if($('errorArea')) $('errorArea').classList.add('hidden'); window.scrollTo({top:0,behavior:'smooth'});});
