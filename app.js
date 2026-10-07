const form = document.getElementById("analysisForm");
const analyzeButton = document.getElementById("analyzeButton");
const buttonText = document.getElementById("buttonText");
const buttonLoader = document.getElementById("buttonLoader");
const resultSection = document.getElementById("resultSection");
const analysisOutput = document.getElementById("analysisOutput");
const kpiGrid = document.getElementById("kpiGrid");
const copyButton = document.getElementById("copyButton");
const clearButton = document.getElementById("clearButton");
const errorBox = document.getElementById("errorBox");
const generationInfo = document.getElementById("generationInfo");
const systemStatus = document.getElementById("systemStatus");
const tabelaPotencial = document.getElementById("tabelaPotencial");
const previewTabela = document.getElementById("previewTabela");

document.addEventListener("DOMContentLoaded", () => {
  checkSystem();
  document.getElementById("dataHora").value = new Date().toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
});

async function checkSystem() {
  try {
    const r = await fetch("/api/health"); const d = await r.json();
    if (r.ok && d.geminiConfigured) { systemStatus.textContent="Sistema online"; systemStatus.className="status online"; }
    else { systemStatus.textContent="Gemini não configurada"; systemStatus.className="status warning"; }
  } catch { systemStatus.textContent="Servidor offline"; systemStatus.className="status offline"; }
}

tabelaPotencial.addEventListener("input", () => {
  const parsed = parseTabela(tabelaPotencial.value);
  if (!parsed) { previewTabela.innerHTML=""; return; }
  previewTabela.innerHTML = `
    <div class="kpi normal"><span class="kpi-label">Total Máquinas</span><strong class="kpi-value">${parsed.totalMaquinas} t</strong></div>
    <div class="kpi normal"><span class="kpi-label">Total Despacho</span><strong class="kpi-value">${parsed.totalDespacho} t</strong></div>
    <div class="kpi ${parsed.saldoEntradaSaida<0?'danger':'normal'}"><span class="kpi-label">Saldo Entrada-Saída</span><strong class="kpi-value">${parsed.saldoEntradaSaida} t</strong></div>
    <div class="kpi attention"><span class="kpi-label">Últimas 3h Entrada</span><strong class="kpi-value">${parsed.ultimas3hEntrada} t</strong></div>
    <div class="kpi attention"><span class="kpi-label">Últimas 3h Saída</span><strong class="kpi-value">${parsed.ultimas3hSaida} t</strong></div>
  `;
});

function parseTabela(text) {
  if (!text || text.length < 20) return null;
  const lines = text.split("\n").filter(l=>/\d/.test(l));
  let totalMaquinas=0, totalDespacho=0, totalEntrada=0, totalSaida=0;
  let ultimas3hEntrada=0, ultimas3hSaida=0;
  const lastLines = lines.slice(-4, -1); // pega 19-20,20-21,21-22 sem o total
  lines.forEach(l=>{
    if (l.toLowerCase().includes("total")) return;
    const nums = l.match(/[\d.,]+/g)?.map(n=>Number(n.replace(",","."))) || [];
    if (nums.length >= 10) {
      const entrada = nums[nums.length-2];
      const saida = nums[nums.length-1];
      totalEntrada += entrada; totalSaida += saida;
    }
  });
  // tenta pegar últimas 3 linhas de hora
  const relevantes = lines.filter(l=> l.includes("19 - 20")||l.includes("20 - 21")||l.includes("21 - 22"));
  relevantes.forEach(l=>{
    const nums = l.match(/[\d.,]+/g)?.map(n=>Number(n.replace(",","."))) || [];
    if (nums.length>=2) { ultimas3hEntrada += nums[nums.length-2]; ultimas3hSaida += nums[nums.length-1]; }
  });
  return { totalMaquinas: Math.round(totalEntrada), totalDespacho: Math.round(totalSaida), saldoEntradaSaida: Math.round(totalEntrada-totalSaida), ultimas3hEntrada: Math.round(ultimas3hEntrada), ultimas3hSaida: Math.round(ultimas3hSaida) };
}

function collectFormData() {
  const fd = new FormData(form);
  return Object.fromEntries(fd.entries());
}

function setLoading(b) {
  analyzeButton.disabled=b;
  buttonText.textContent = b? "Analisando cenário...":"Gerar Plano de Voo";
  buttonLoader.classList.toggle("hidden", !b);
}
function showError(m){ errorBox.textContent=m; errorBox.classList.remove("hidden"); }
function hideError(){ errorBox.classList.add("hidden"); }

form.addEventListener("submit", async e=>{
  e.preventDefault(); hideError();
  const data = collectFormData();
  if (!data.unidade || !data.moagemAtual || !data.moagemNominal) { showError("Informe unidade, moagem atual e nominal."); return; }
  if (!data.tabelaPotencial || data.tabelaPotencial.length < 30) { showError("Cole a tela de potencial de produção."); return; }
  setLoading(true);
  try {
    const start=performance.now();
    const res=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    const result=await res.json();
    if (!res.ok) throw new Error(result.error);
    const elapsed=((performance.now()-start)/1000).toFixed(1);
    renderResult(result, elapsed);
  } catch(err){ showError(err.message); } finally{ setLoading(false); }
});

function renderResult(result, elapsed){
  resultSection.classList.remove("hidden");
  analysisOutput.textContent=result.analysis||"";
  renderKPIs(result.metrics);
  generationInfo.textContent=`Modelo: ${result.model} • Tempo: ${elapsed}s • Entrada 3h: ${result.metrics?.ultimas3hEntrada} t / Saída 3h: ${result.metrics?.ultimas3hSaida} t`;
  resultSection.scrollIntoView({behavior:"smooth"});
}
function renderKPIs(m){
  if (!m) return;
  kpiGrid.innerHTML="";
  const cards=[
    {label:"Gap x nominal", value:(m.gapMoagemNominal??"-")+" t/h", cls: m.gapMoagemNominal>0?"attention":"normal"},
    {label:"Saldo 3h (Ent-Saída)", value:(m.saldo3h??"-")+" t", cls: m.saldo3h<0?"danger":"normal"},
    {label:"Estoque vs mínimo", value:(m.saldoEstoque??"-")+" conj", cls: m.saldoEstoque<=0?"danger":m.saldoEstoque<=2?"attention":"normal"},
    {label:"Gap futuro 12h", value:(m.gapFuturo12h??"-")+" t", cls: m.gapFuturo12h<0?"danger":"normal"},
    {label:"Risco", value:m.risco||"N/D", cls: m.risco==="CRÍTICO"||m.risco==="ALTO"?"danger":m.risco==="ATENÇÃO"?"attention":"normal"},
  ];
  cards.forEach(c=>{
    const el=document.createElement("div"); el.className=`kpi ${c.cls}`;
    el.innerHTML=`<span class="kpi-label">${c.label}</span><strong class="kpi-value">${c.value}</strong>`;
    kpiGrid.appendChild(el);
  });
}
copyButton.addEventListener("click", async()=>{
  await navigator.clipboard.writeText(analysisOutput.textContent);
  copyButton.textContent="Copiado!"; setTimeout(()=>copyButton.textContent="Copiar",1500);
});
clearButton.addEventListener("click",()=>{ form.reset(); resultSection.classList.add("hidden"); previewTabela.innerHTML=""; });
