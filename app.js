const form =
  document.getElementById("analysisForm");

const analyzeButton =
  document.getElementById("analyzeButton");

const buttonText =
  document.getElementById("buttonText");

const buttonLoader =
  document.getElementById("buttonLoader");

const resultSection =
  document.getElementById("resultSection");

const analysisOutput =
  document.getElementById("analysisOutput");

const kpiGrid =
  document.getElementById("kpiGrid");

const copyButton =
  document.getElementById("copyButton");

const clearButton =
  document.getElementById("clearButton");

const errorBox =
  document.getElementById("errorBox");

const generationInfo =
  document.getElementById("generationInfo");

const systemStatus =
  document.getElementById("systemStatus");


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    checkSystem();

    const now =
      new Date();

    const formatted =
      now.toLocaleString(
        "pt-BR",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }
      );

    document.getElementById(
      "dataHora"
    ).value = formatted;
  }
);


/* =========================================================
   STATUS DO SISTEMA
========================================================= */

async function checkSystem() {

  try {

    const response =
      await fetch("/api/health");

    const data =
      await response.json();

    if (
      response.ok &&
      data.ok &&
      data.geminiConfigured
    ) {

      systemStatus.textContent =
        "Sistema online";

      systemStatus.className =
        "status online";

    } else {

      systemStatus.textContent =
        "Gemini não configurada";

      systemStatus.className =
        "status warning";
    }

  } catch (error) {

    systemStatus.textContent =
      "Servidor offline";

    systemStatus.className =
      "status offline";
  }
}


/* =========================================================
   CAMPOS NUMÉRICOS
========================================================= */

const numericFields = [

  "moagemAtual",
  "moagemNominal",
  "entregaMedia",

  "estoqueAtual",
  "estoqueMinimo",
  "estoqueProjetado",
  "moagemContingencia",

  "colhedorasMedia",
  "colhedorasPico",

  "tracoesMedia",
  "tracoesPico",

  "cavalosMedia",
  "cavalosPico"

];


/* =========================================================
   COLETAR FORMULÁRIO
========================================================= */

function collectFormData() {

  const formData =
    new FormData(form);

  const data =
    Object.fromEntries(
      formData.entries()
    );


  numericFields.forEach(
    (field) => {

      if (
        data[field] === undefined ||
        data[field] === ""
      ) {

        data[field] = null;

      } else {

        const number =
          Number(
            String(data[field])
              .replace(",", ".")
          );

        data[field] =
          Number.isFinite(number)
            ? number
            : null;
      }
    }
  );


  return data;
}


/* =========================================================
   ESTADO DE CARREGAMENTO
========================================================= */

function setLoading(isLoading) {

  analyzeButton.disabled =
    isLoading;

  if (isLoading) {

    buttonText.textContent =
      "Analisando cenário...";

    buttonLoader.classList.remove(
      "hidden"
    );

  } else {

    buttonText.textContent =
      "Gerar Plano de Voo";

    buttonLoader.classList.add(
      "hidden"
    );
  }
}


/* =========================================================
   ERRO
========================================================= */

function showError(message) {

  errorBox.textContent =
    message;

  errorBox.classList.remove(
    "hidden"
  );

  errorBox.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}


function hideError() {

  errorBox.classList.add(
    "hidden"
  );

  errorBox.textContent =
    "";
}


/* =========================================================
   ENVIO PARA O SERVIDOR
========================================================= */

form.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    hideError();

    const data =
      collectFormData();


    if (
      !data.unidade ||
      data.moagemAtual === null ||
      data.moagemNominal === null
    ) {

      showError(
        "Informe a unidade, a moagem atual e a moagem nominal."
      );

      return;
    }


    setLoading(true);


    try {

      const startTime =
        performance.now();


      const response =
        await fetch(
          "/api/analyze",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(data)
          }
        );


      const result =
        await response.json();


      if (!response.ok) {

        throw new Error(
          result.error ||
          "Erro ao gerar o Plano de Voo."
        );
      }


      const endTime =
        performance.now();

      const elapsed =
        (
          (endTime - startTime) /
          1000
        ).toFixed(1);


      renderResult(
        result,
        elapsed
      );


    } catch (error) {

      console.error(
        error
      );

      showError(
        error.message ||
        "Não foi possível gerar a análise."
      );

    } finally {

      setLoading(false);
    }
  }
);


/* =========================================================
   RENDERIZAÇÃO DO RESULTADO
========================================================= */

function renderResult(
  result,
  elapsed
) {

  resultSection.classList.remove(
    "hidden"
  );


  analysisOutput.textContent =
    result.analysis ||
    "Nenhuma análise retornada.";


  renderKPIs(
    result.metrics
  );


  generationInfo.textContent =
    `Modelo: ${result.model || "-"} • ` +
    `Tempo de processamento: ${elapsed}s`;


  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* =========================================================
   KPIs
========================================================= */

function renderKPIs(metrics) {

  kpiGrid.innerHTML = "";


  const cards = [];


  if (
    metrics &&
    metrics.gapMoagemNominal !== null
  ) {

    cards.push({
      label: "Gap x nominal",
      value:
        formatNumber(
          metrics.gapMoagemNominal
        ) + " t/h",
      className:
        metrics.gapMoagemNominal > 0
          ? "attention"
          : "normal"
    });
  }


  if (
    metrics &&
    metrics.gapEntregaMoagem !== null
  ) {

    cards.push({
      label: "Entrega x moagem",
      value:
        formatNumber(
          metrics.gapEntregaMoagem
        ) + " t/h",
      className:
        metrics.gapEntregaMoagem < 0
          ? "danger"
          : "normal"
    });
  }


  if (
    metrics &&
    metrics.coberturaNominal !== null
  ) {

    cards.push({
      label: "Cobertura nominal",
      value:
        formatNumber(
          metrics.coberturaNominal
        ) + "%",
      className:
        metrics.coberturaNominal < 100
          ? "attention"
          : "normal"
    });
  }


  if (
    metrics &&
    metrics.saldoEstoque !== null
  ) {

    cards.push({
      label: "Saldo do estoque",
      value:
        formatNumber(
          metrics.saldoEstoque
        ) + " conj.",
      className:
        metrics.saldoEstoque <= 0
          ? "danger"
          : metrics.saldoEstoque <= 2
            ? "attention"
            : "normal"
    });
  }


  cards.push({
    label: "Risco operacional",
    value:
      metrics?.risco ||
      "N/D",
    className:
      riskClass(
        metrics?.risco
      )
  });


  cards.forEach(
    (card) => {

      const element =
        document.createElement(
          "div"
        );

      element.className =
        `kpi ${card.className}`;


      element.innerHTML = `
        <span class="kpi-label">
          ${escapeHtml(card.label)}
        </span>

        <strong class="kpi-value">
          ${escapeHtml(card.value)}
        </strong>
      `;


      kpiGrid.appendChild(
        element
      );
    }
  );
}


/* =========================================================
   FORMATAÇÃO
========================================================= */

function formatNumber(value) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {

    return "-";
  }

  return Number(value)
    .toLocaleString(
      "pt-BR",
      {
        maximumFractionDigits: 1
      }
    );
}


function riskClass(risk) {

  switch (risk) {

    case "CRÍTICO":
      return "danger";

    case "ALTO":
      return "danger";

    case "ATENÇÃO":
      return "attention";

    default:
      return "normal";
  }
}


/* =========================================================
   SEGURANÇA
========================================================= */

function escapeHtml(value) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* =========================================================
   COPIAR PLANO
========================================================= */

copyButton.addEventListener(
  "click",
  async () => {

    const text =
      analysisOutput.textContent;

    if (!text) {
      return;
    }

    try {

      await navigator.clipboard.writeText(
        text
      );

      const original =
        copyButton.textContent;

      copyButton.textContent =
        "Copiado!";

      setTimeout(
        () => {
          copyButton.textContent =
            original;
        },
        1500
      );

    } catch (error) {

      showError(
        "Não foi possível copiar automaticamente."
      );
    }
  }
);


/* =========================================================
   LIMPAR
========================================================= */

clearButton.addEventListener(
  "click",
  () => {

    form.reset();

    resultSection.classList.add(
      "hidden"
    );

    hideError();

    analysisOutput.textContent =
      "";

    kpiGrid.innerHTML =
      "";

    const now =
      new Date();

    document.getElementById(
      "dataHora"
    ).value =
      now.toLocaleString(
        "pt-BR",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }
      );
  }
);

const numericFields = [
  "moagemAtual","moagemNominal","entregaMedia",
  "estoqueAtual","estoqueMinimo","estoqueProjetado","moagemContingencia",
  "colhedorasMedia","colhedorasPico","tracoesMedia","tracoesPico","cavalosMedia","cavalosPico",
  // NOVOS INTEGRADOS
  "h19_20_entrada","h19_20_moagem","h19_20_estoque",
  "h20_21_entrada","h20_21_moagem","h20_21_estoque",
  "h21_22_entrada","h21_22_moagem","h21_22_estoque",
  "potencial12h","metaMoagem12h","moagemDesejada"
];
