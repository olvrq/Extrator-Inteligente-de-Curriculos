import { isResumeResult, parseResume } from "./resume-parser.mjs";
import { extractResumeText, ResumeFileError } from "./document-extractor.mjs";

const input = document.querySelector("#resume-text");
const processButton = document.querySelector("#process-button");
const clearButton = document.querySelector("#clear-button");
const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const characterCount = document.querySelector("#character-count");
const inputError = document.querySelector("#input-error");
const emptyState = document.querySelector("#empty-state");
const resultsContent = document.querySelector("#results-content");
const resultCount = document.querySelector("#result-count");
const resultSummary = document.querySelector("#result-summary");
const blockList = document.querySelector("#block-list");
const jsonOutput = document.querySelector("#json-output");
const toast = document.querySelector("#toast");
const localMode = document.querySelector("#mode-local");
const aiMode = document.querySelector("#mode-ai");
const aiConsentPanel = document.querySelector("#ai-consent-panel");
const aiConsent = document.querySelector("#ai-consent");
const privacyPill = document.querySelector("#privacy-pill");
const privacyNote = document.querySelector("#privacy-note-text");
const reviewNote = document.querySelector("#review-note");

let currentResult = null;
let toastTimeout;

const SAMPLE_RESUME = `MARIA OLIVEIRA
São Paulo, SP
Telefone: (11) 98888-7777 | maria.oliveira@email.com
LinkedIn: https://www.linkedin.com/in/maria-oliveira

OBJETIVO PROFISSIONAL
Atuar como desenvolvedora front-end, criando experiências digitais acessíveis e fáceis de usar.

FORMAÇÃO ACADÊMICA
Tecnologia em Análise e Desenvolvimento de Sistemas — Universidade de São Paulo, conclusão em 2024

CURSOS E CERTIFICAÇÕES
Desenvolvimento Web com React — Alura, 2024
UX e Acessibilidade Digital — Escola Virtual, 2023

HABILIDADES
JavaScript, React, HTML, CSS, Git

IDIOMAS
Português (nativo), Inglês (intermediário)

EXPERIÊNCIA PROFISSIONAL
Desenvolvedora Front-end — Estúdio Criativo, 2023–2025
Criação de páginas responsivas e componentes reutilizáveis.

PROJETOS
Site de portfólio pessoal — https://github.com/maria-oliveira/portfolio`;

const BLOCKS = [
  {
    number: "01",
    title: "Contato",
    type: "fields",
    key: "bloco_1_contato",
    fields: [
      ["Nome", "nome"],
      ["E-mail", "email"],
      ["Telefone", "telefone"],
      ["LinkedIn", "linkedin"],
      ["GitHub", "github"],
    ],
  },
  { number: "02", title: "Objetivo profissional", type: "value", key: "bloco_2_objetivo" },
  { number: "03", title: "Formação acadêmica", type: "list", key: "bloco_3_formacao_academica" },
  {
    number: "04",
    title: "Cursos e linguagens",
    type: "fields",
    key: "bloco_4_cursos_e_linguagens",
    fields: [
      ["Cursos", "cursos"],
      ["Habilidades", "habilidades"],
      ["Idiomas", "idiomas"],
    ],
  },
  {
    number: "05",
    title: "Informações extras",
    type: "fields",
    key: "bloco_5_informacoes_extras",
    fields: [
      ["Experiência", "experiencia_profissional"],
      ["Projetos", "projetos"],
      ["Links", "links"],
    ],
  },
];

function updateCharacterCount() {
  const count = input.value.length;
  characterCount.textContent = `${count.toLocaleString("pt-BR")} ${count === 1 ? "caractere" : "caracteres"}`;
}

function showError(message) {
  inputError.textContent = message;
  inputError.hidden = false;
}

function clearError() {
  inputError.textContent = "";
  inputError.hidden = true;
}

function showToast(message) {
  window.clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function addField(dl, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");

  if (Array.isArray(value)) {
    if (value.length) {
      const list = document.createElement("ul");
      value.forEach((item) => {
        const entry = document.createElement("li");
        entry.textContent = item;
        list.append(entry);
      });
      definition.append(list);
    } else {
      definition.textContent = "Não identificado";
      definition.classList.add("is-empty");
    }
  } else if (value) {
    definition.textContent = value;
  } else {
    definition.textContent = "Não identificado";
    definition.classList.add("is-empty");
  }

  dl.append(term, definition);
}

function renderBlock(block, result) {
  const article = document.createElement("article");
  article.className = "data-block";

  const header = document.createElement("div");
  header.className = "data-block-header";
  const number = document.createElement("span");
  number.className = "block-number";
  number.textContent = block.number;
  const title = document.createElement("h3");
  title.textContent = block.title;
  header.append(number, title);
  article.append(header);

  const value = result[block.key];
  const dl = document.createElement("dl");
  if (block.type === "fields") {
    for (const [label, key] of block.fields) addField(dl, label, value[key]);
  } else if (block.type === "list") {
    addField(dl, "Itens", value);
  } else {
    addField(dl, "Resumo", value);
  }
  article.append(dl);
  return article;
}

function countRecognizedValues(value) {
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (Array.isArray(value)) return value.filter((item) => String(item).trim()).length;
  if (value && typeof value === "object") {
    return Object.values(value).reduce((total, child) => total + countRecognizedValues(child), 0);
  }
  return value ? 1 : 0;
}

function renderResult(result, mode = "local") {
  currentResult = result;
  blockList.replaceChildren(...BLOCKS.map((block) => renderBlock(block, result)));
  jsonOutput.textContent = JSON.stringify([result], null, 2);
  reviewNote.textContent =
    mode === "ai"
      ? "A IA ajudou a organizar o currículo após seu consentimento. Confira todos os campos antes de usar."
      : "A extração usa padrões de texto locais, sem IA externa. Revise os dados antes de usá-los: currículos sem títulos claros podem precisar de ajustes.";

  const found = countRecognizedValues(result);
  resultCount.textContent = `${found} ${found === 1 ? "dado" : "dados"}`;
  resultCount.hidden = false;
  resultSummary.textContent = found
    ? `${found} informações identificadas. Confira os campos antes de usar.`
    : "Nenhuma informação conhecida foi identificada. Tente incluir títulos claros no currículo.";

  emptyState.hidden = true;
  resultsContent.hidden = false;
}

async function extractWithAI(text) {
  let response;
  try {
    response = await fetch("/api/ai/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, consent: aiConsent.checked }),
    });
  } catch {
    throw new Error("Não foi possível acessar o serviço de IA. Seu texto continua no campo; tente novamente ou use o modo local.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("O serviço de IA retornou uma resposta inválida. Seu texto continua no campo.");
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        "Não foi possível organizar com IA. Seu texto continua no campo; tente novamente ou use o modo local.",
    );
  }
  if (!isResumeResult(payload?.result)) {
    throw new Error("A resposta da IA não passou pela validação. Seu texto continua no campo; tente novamente.");
  }
  return payload.result;
}

async function processResume() {
  clearError();
  const text = input.value.trim();
  if (!text) {
    showError("Cole o texto de um currículo antes de continuar.");
    input.focus();
    return;
  }

  const mode = aiMode.checked ? "ai" : "local";
  if (mode === "ai" && !aiConsent.checked) {
    showError("Confirme o consentimento antes de enviar o currículo à OpenAI.");
    aiConsent.focus();
    return;
  }

  processButton.disabled = true;
  processButton.querySelector("span").textContent = mode === "ai" ? "Enviando com consentimento…" : "Organizando…";
  try {
    const result = mode === "ai" ? await extractWithAI(text) : parseResume(text);
    renderResult(result, mode);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Não foi possível organizar este texto. Confira o conteúdo e tente novamente.");
  } finally {
    processButton.disabled = false;
    processButton.querySelector("span").textContent = "Organizar currículo";
  }
}

function updateProcessingMode() {
  const useAI = aiMode.checked;
  aiConsentPanel.hidden = !useAI;
  privacyPill.lastChild.textContent = useAI ? "IA selecionada" : "Processamento local";
  privacyNote.textContent = useAI
    ? "O arquivo é lido neste navegador. O texto integral só será enviado à OpenAI após seu consentimento. Os leitores de PDF e Word são carregados do jsDelivr."
    : "No modo local, seus arquivos são lidos neste navegador e não são enviados. Os leitores de PDF e Word são carregados do jsDelivr.";
  if (!useAI) aiConsent.checked = false;
  clearError();
}

function resetApp() {
  input.value = "";
  localMode.checked = true;
  aiConsent.checked = false;
  updateProcessingMode();
  currentResult = null;
  clearError();
  updateCharacterCount();
  blockList.replaceChildren();
  jsonOutput.textContent = "";
  resultCount.hidden = true;
  resultsContent.hidden = true;
  emptyState.hidden = false;
  fileInput.value = "";
  input.focus();
}

async function loadFile(file) {
  if (!file) return;
  const buttonLabel = processButton.querySelector("span");
  processButton.disabled = true;
  buttonLabel.textContent = "Lendo arquivo…";
  try {
    input.value = await extractResumeText(file);
    aiConsent.checked = false;
    updateCharacterCount();
    clearError();
    showToast(`Arquivo "${file.name}" carregado. Revise o texto antes de organizar.`);
  } catch (error) {
    showError(
      error instanceof ResumeFileError
        ? error.message
        : "Não foi possível ler este arquivo. Verifique se ele está íntegro ou cole o texto do currículo.",
    );
  } finally {
    fileInput.value = "";
    processButton.disabled = false;
    buttonLabel.textContent = "Organizar currículo";
  }
}

async function copyResult() {
  if (!currentResult) return;
  const content = JSON.stringify([currentResult], null, 2);
  try {
    await navigator.clipboard.writeText(content);
    showToast("JSON copiado para a área de transferência.");
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = content;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    showToast(copied ? "JSON copiado para a área de transferência." : "Não foi possível copiar. Use a área de JSON.");
  }
}

function downloadResult() {
  if (!currentResult) return;
  const blob = new Blob([`${JSON.stringify([currentResult], null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "curriculo-organizado.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Arquivo JSON baixado.");
}

input.addEventListener("input", () => {
  aiConsent.checked = false;
  updateCharacterCount();
  clearError();
});
processButton.addEventListener("click", processResume);
clearButton.addEventListener("click", resetApp);
localMode.addEventListener("change", updateProcessingMode);
aiMode.addEventListener("change", updateProcessingMode);
document.querySelector("#load-example").addEventListener("click", () => {
  input.value = SAMPLE_RESUME;
  aiConsent.checked = false;
  updateCharacterCount();
  clearError();
  input.focus();
});
document.querySelector("#choose-file").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
document.querySelector("#copy-button").addEventListener("click", copyResult);
document.querySelector("#download-button").addEventListener("click", downloadResult);

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}
dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
dropZone.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  fileInput.click();
});

updateCharacterCount();
updateProcessingMode();
