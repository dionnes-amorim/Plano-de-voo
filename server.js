require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
app.set("trust proxy", 1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"500kb"}));
app.use(express.static(__dirname));
const limiter = rateLimit({windowMs:60*1000,max:20,message:{error:"Limite atingido"}});

function toNumber(v){ if(v===null||v===undefined||v==="") return null; const n=Number(String(v).replace(",",".")); return Number.isFinite(n)?n:null; }
function toText(v,m=5000){ return v?String(v).trim().slice(0,m):""; }

function parseTabelaPotencial(texto){
  if(!texto) return null;
  const linhas = texto.split("\n").map(l=>l.trim()).filter(l=>l);
  const dados = [];
  let total = null;
  for(const linha of linhas){
    if(linha.toLowerCase().includes("hora") && linha.toLowerCase().includes("máquinas")) continue;
    if(linha.toLowerCase().startsWith("total")){
      const nums = linha.match(/[\d.,]+/g)?.map(n=>Number(n.replace(",",".")))||[];
      total = { maquinas:nums[0], tratores:nums[1], restricao:nums[2], cota:nums[3], despacho:nums[4], entrada:nums[nums.length-2], saida:nums[nums.length-1] };
      continue;
    }
    const matchHora = linha.match(/(\d{2}\s*-\s*\d{2})/);
    if(!matchHora) continue;
    const nums = linha.match(/[\d.,]+/g)?.map(n=>Number(n.replace(",",".")))||[];
    if(nums.length < 8) continue;
    // Estrutura: Hora, Maquinas, Tratores, Restricao, Cota, Despacho, CamNec, CamAloc, SaidaCam, PesoEst, EntradaCam, Entrada(t), Saida(t)
    const entrada = nums[nums.length-2];
    const saida = nums[nums.length-1];
    const maquinas = nums[1];
    const despacho = nums[5];
    dados.push({ hora: matchHora[1], maquinas, despacho, entrada, saida, raw: linha });
  }
  const ultimas3 = dados.filter(d=>["19 - 20","20 - 21","21 - 22","19-20","20-21","21-22"].some(x=>d.hora.replace(/\s/g,"").includes(x.replace(/\s/g,""))));
  // fallback se formato diferente: pega últimas 3 linhas
  const ultimas3Final = ultimas3.length>=3? ultimas3 : dados.slice(-3);
  const ultimas3hEntrada = ultimas3Final.reduce((a,b)=>a+b.entrada,0);
  const ultimas3hSaida = ultimas3Final.reduce((a,b)=>a+b.saida,0);
  const saldo3h = ultimas3hEntrada - ultimas3hSaida;
  const entradaTotal = total?.entrada || dados.reduce((a,b)=>a+b.entrada,0);
  const saidaTotal = total?.saida || dados.reduce((a,b)=>a+b.saida,0);
  return { dados, total, ultimas3: ultimas3Final, ultimas3hEntrada, ultimas3hSaida, saldo3h, entradaTotal, saidaTotal };
}

function calculateMetrics(data, tabela){
  const gapMoagem = (toNumber(data.moagemAtual) - toNumber(data.moagemNominal));
  const saldoEstoque = (toNumber(data.estoqueAtual) - toNumber(data.estoqueMinimo)) || (toNumber(data.estoqueAtual) - 7);
  let risco="ESTÁVEL";
  if(tabela && tabela.saldo3h < -200) risco="ALTO";
  if(tabela && tabela.saldo3h < -600) risco="CRÍTICO";
  if(saldoEstoque!==null && saldoEstoque<=0) risco="CRÍTICO";
  const gapFuturo = tabela? tabela.entradaTotal - tabela.saidaTotal : null;
  return {
    gapMoagemNominal: gapMoagem,
    saldoEstoque,
    ultimas3hEntrada: tabela?.ultimas3hEntrada||null,
    ultimas3hSaida: tabela?.ultimas3hSaida||null,
    saldo3h: tabela?.saldo3h||null,
    gapFuturo12h: gapFuturo,
    risco,
    tabelaResumo: tabela
  };
}

function buildPrompt(data, metrics, tabela){
  const tabelaTxt = tabela? tabela.dados.map(d=>`${d.hora}: Máq ${d.maquinas}t | Despacho ${d.despacho}t | Entrada ${d.entrada}t | Saída ${d.saida}t`).join("\n") : "Não informado";
  const ultimas3Txt = tabela? tabela.ultimas3.map(d=>`${d.hora}: Entrou ${d.entrada}t | Saiu ${d.saida}t`).join("\n") : "Não informado";
  return `
Você é especialista COA CTT Agroindustrial Tereos.

Analise esta tela de POTENCIAL DE PRODUÇÃO colada pelo usuário.

UNIDADE: ${data.unidade} - Data: ${data.dataHora}
MOAGEM ATUAL: ${data.moagemAtual} t/h | NOMINAL: ${data.moagemNominal} t/h | DESEJADA: ${data.moagemDesejada||"NI"}

TABELA COMPLETA HORÁRIA (Entrada x Saída):
${tabelaTxt}

RECORTE ÚLTIMAS 3 HORAS (19h às 22h):
${ultimas3Txt}
Total últimas 3h - Entrada: ${metrics.ultimas3hEntrada} t | Saída: ${metrics.ultimas3hSaida} t | Saldo: ${metrics.saldo3h} t

TOTAL DIA:
Entrada total: ${tabela?.entradaTotal||"NI"} t | Saída total: ${tabela?.saidaTotal||"NI"} t | Saldo dia: ${tabela? tabela.entradaTotal - tabela.saidaTotal : "NI"} t
Máquinas total: ${tabela?.total?.maquinas||"NI"} t | Despacho total: ${tabela?.total?.despacho||"NI"} t

ESTOQUE:
19h: ${data.estoque19||"NI"} | 20h: ${data.estoque20||"NI"} | 21h: ${data.estoque21||"NI"} | ATUAL ${data.estoqueAtual||"NI"} conj.
Saldo vs mínimo: ${metrics.saldoEstoque} conj.

OFENSORES: ${data.ofensores||"Não informado"}
EVENTOS: ${data.eventos||"NI"}
AÇÕES COA: ${data.acoesCOA||"NI"}

REGRAS:
1. Analise a tabela hora a hora. Identifique onde a entrada caiu (ex: 19-20 caiu para ${tabela?.ultimas3[0]?.entrada||"NI"}t).
2. Explique porque saldo negativo nas últimas 3h está consumindo estoque.
3. Calcule tendência: se entrar ${metrics.ultimas3hEntrada/3} t/h e sair ${metrics.ultimas3hSaida/3} t/h, em quantas horas acaba estoque.
4. Cruze com moagem atual ${data.moagemAtual} e diga se precisa reduzir para contingência.
5. Dê plano de ação real COA.

FORMATO:
PLANO DE VOO — ${data.unidade}

CENÁRIO ATUAL
(Use dados da tabela 19-22h)

PONTOS CRÍTICOS
(Identifique horas críticas da tabela)

ESTOQUE E RISCO
(Tendência com base nas últimas 3h)

PLANO DE AÇÃO
TENDÊNCIA
Texto 400-650 palavras, sem tabela, sem emoji, linguagem COA real.
`;
}

async function callGemini(prompt){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const body={ systemInstruction:{parts:[{text:"Você é motor COA CTT."}]}, contents:[{role:"user",parts:[{text:prompt}]}], generationConfig:{temperature:0.35,topP:0.9,maxOutputTokens:3500} };
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GEMINI_API_KEY},body:JSON.stringify(body)});
  const j=await r.json();
  if(!r.ok) throw new Error(j?.error?.message||`Erro ${r.status}`);
  const txt=j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("").trim();
  if(!txt) throw new Error("Gemini sem retorno");
  return txt;
}

app.get("/api/health",(req,res)=>res.json({ok:true,model:GEMINI_MODEL,geminiConfigured:!!GEMINI_API_KEY}));
app.post("/api/analyze",limiter, async (req,res)=>{
  try{
    const data=req.body;
    if(!data.unidade) return res.status(400).json({error:"Informe unidade"});
    const tabela=parseTabelaPotencial(data.tabelaPotencial||"");
    const metrics=calculateMetrics(data,tabela);
    const prompt=buildPrompt(data,metrics,tabela);
    const analysis=await callGemini(prompt);
    res.json({success:true,model:GEMINI_MODEL,metrics,analysis});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.use((req,res)=>{ if(req.method==="GET"&&!req.path.startsWith("/api/")) return res.sendFile(path.join(__dirname,"index.html")); res.status(404).end(); });
app.listen(PORT,()=>console.log(`COA INTEGRADO TABELA RODANDO EM ${PORT}`));
