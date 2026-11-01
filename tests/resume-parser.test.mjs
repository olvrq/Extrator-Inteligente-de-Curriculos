import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { createAppServer } from "../server.mjs";
import {
  buildStructuredResume,
  generateResumeDocx,
  generateResumePdf,
} from "../resume-exporter.mjs";
import { isResumeResult, parseResume, RESUME_RESULT_SCHEMA } from "../resume-parser.mjs";

const SAMPLE_RESUME = `MARIA OLIVEIRA
São Paulo, SP
Telefone: (11) 98888-7777 | maria.oliveira@example.com
LinkedIn: https://www.linkedin.com/in/maria-oliveira

OBJETIVO PROFISSIONAL
Atuar como desenvolvedora front-end, criando experiências digitais acessíveis.

FORMAÇÃO ACADÊMICA
Análise e Desenvolvimento de Sistemas — Universidade de São Paulo, 2024

HABILIDADES
JavaScript, React, HTML5, CSS3

IDIOMAS
Português (nativo), Inglês (avançado)`;

const VALID_AI_RESULT = {
  bloco_1_contato: {
    nome: "Maria Oliveira",
    email: "maria.oliveira@example.com",
    telefone: null,
    linkedin: null,
    github: null,
  },
  bloco_2_objetivo: null,
  bloco_3_formacao_academica: ["Análise e Desenvolvimento de Sistemas — Universidade de São Paulo"],
  bloco_4_cursos_e_linguagens: {
    cursos: [],
    habilidades: ["JavaScript", "React"],
    idiomas: [],
  },
  bloco_5_informacoes_extras: {
    experiencia_profissional: [],
    projetos: [],
    links: [],
  },
};

function readZipEntries(zipBytes) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= zipBytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const name = decoder.decode(zipBytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawSlice = zipBytes.subarray(dataStart, dataStart + compressedSize);

    const uncompressed = method === 8 ? inflateRawSync(rawSlice) : rawSlice;
    entries.set(name, decoder.decode(uncompressed));
    offset = dataStart + compressedSize;
  }

  return entries;
}

let server;
let baseUrl;
let openAiCalls = 0;
let aiResponseContent = JSON.stringify(VALID_AI_RESULT);
let aiInputText = null;

before(async () => {
  server = createAppServer({
    apiKey: "test-key",
    now: () => Date.now(),
    fetchImpl: async (url, options) => {
      openAiCalls += 1;
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.model, "gpt-4o-mini");
      assert.equal(requestBody.response_format.json_schema.strict, true);
      aiInputText = requestBody.messages[1].content;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: aiResponseContent } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("local parser keeps the expected result shape", () => {
  const result = parseResume(SAMPLE_RESUME);
  assert.equal(isResumeResult(result), true);
});

test("AI result validation rejects missing fields and extra properties", () => {
  assert.equal(isResumeResult(VALID_AI_RESULT), true);
  assert.equal(
    isResumeResult({ ...VALID_AI_RESULT, unexpected: "not allowed" }),
    false,
  );
  assert.equal(
    isResumeResult({
      ...VALID_AI_RESULT,
      bloco_3_formacao_academica: "not a list",
    }),
    false,
  );
  assert.equal(RESUME_RESULT_SCHEMA.additionalProperties, false);
});

test("AI endpoint refuses to send a resume without explicit consent", async () => {
  openAiCalls = 0;
  const response = await fetch(`${baseUrl}/api/ai/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: SAMPLE_RESUME }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /consentimento/i);
  assert.equal(openAiCalls, 0);
});

test("AI endpoint validates the service response before returning it", async () => {
  aiResponseContent = JSON.stringify(VALID_AI_RESULT);
  openAiCalls = 0;
  const response = await fetch(`${baseUrl}/api/ai/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: SAMPLE_RESUME, consent: true }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(isResumeResult(payload.result), true);
  assert.equal(openAiCalls, 1);
});

test("AI endpoint forwards the reviewed text exactly as submitted", async () => {
  aiResponseContent = JSON.stringify(VALID_AI_RESULT);
  const reviewedText = "  Currículo revisado\nsem e-mail ou telefone  \n";
  const response = await fetch(`${baseUrl}/api/ai/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: reviewedText, consent: true }),
  });

  assert.equal(response.status, 200);
  assert.equal(aiInputText, reviewedText);
});

test("AI endpoint rejects malformed service output", async () => {
  aiResponseContent = JSON.stringify({ ...VALID_AI_RESULT, unexpected: true });
  const response = await fetch(`${baseUrl}/api/ai/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: SAMPLE_RESUME, consent: true }),
  });
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(Object.hasOwn(payload, "result"), false);
  aiResponseContent = JSON.stringify(VALID_AI_RESULT);
});

test("structured resume builder includes only populated sections and preserves location", () => {
  const parsed = parseResume(SAMPLE_RESUME);
  const structured = buildStructuredResume(parsed, SAMPLE_RESUME);

  assert.equal(structured.dadosPessoais.nome, "MARIA OLIVEIRA");
  assert.equal(structured.dadosPessoais.cidadeEstado, "São Paulo, SP");
  assert.equal(structured.dadosPessoais.email, "maria.oliveira@example.com");
  assert.equal(structured.dadosPessoais.telefone, "(11) 98888-7777");

  const sectionIds = structured.sections.map((section) => section.id);
  assert.deepEqual(sectionIds, ["objetivo", "formacao", "competencias", "idiomas"]);
  assert.equal(sectionIds.includes("cursos"), false);
  assert.equal(sectionIds.includes("experiencia"), false);
});

test("DOCX exporter generates a valid OpenXML archive with A4 ABNT margins and editable content", async () => {
  const parsed = parseResume(SAMPLE_RESUME);
  const docxBytes = await generateResumeDocx(parsed, SAMPLE_RESUME);

  // Verify ZIP signature PK\x03\x04
  assert.equal(docxBytes[0], 0x50);
  assert.equal(docxBytes[1], 0x4b);
  assert.equal(docxBytes[2], 0x03);
  assert.equal(docxBytes[3], 0x04);

  const entries = readZipEntries(docxBytes);
  assert.equal(entries.has("[Content_Types].xml"), true);
  assert.equal(entries.has("_rels/.rels"), true);
  assert.equal(entries.has("word/document.xml"), true);
  assert.equal(entries.has("word/styles.xml"), true);

  const documentXml = entries.get("word/document.xml");
  assert.match(documentXml, /w:pgSz w:w="11906" w:h="16838"/);
  assert.match(documentXml, /w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/);
  assert.match(documentXml, /MARIA OLIVEIRA/);
  assert.match(documentXml, /São Paulo, SP/);
  assert.match(documentXml, /FORMAÇÃO ACADÊMICA/);
  assert.match(documentXml, /Análise e Desenvolvimento de Sistemas/);
  assert.match(documentXml, /Português \(nativo\)/);
});

test("PDF exporter generates a valid A4 PDF with selectable text and multi-page support", () => {
  const parsed = parseResume(SAMPLE_RESUME);
  // Add extensive experience items to trigger multi-page A4 overflow
  parsed.bloco_5_informacoes_extras.experiencia_profissional = Array.from(
    { length: 65 },
    (_, index) =>
      `Experiência ${index + 1}: Desenvolvimento de sistemas distribuídos, arquitetura front-end e otimização de performance em aplicações críticas.`,
  );

  const pdfBytes = generateResumePdf(parsed, SAMPLE_RESUME);
  const pdfString = Buffer.from(pdfBytes).toString("latin1");

  assert.equal(pdfString.startsWith("%PDF-1.4"), true);
  assert.match(pdfString, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(pdfString, /\/BaseFont \/Helvetica/);
  assert.match(pdfString, /\/Encoding \/WinAnsiEncoding/);
  assert.match(pdfString, /\(MARIA OLIVEIRA\) Tj/);
  assert.match(pdfString, /\/Count [234]/);
});

test("HTML and CSS reflect local section removal, export actions, and Cursor Style Reference tokens", () => {
  const html = readFileSync(resolve("index.html"), "utf8");
  const css = readFileSync(resolve("styles.css"), "utf8");

  assert.equal(html.includes("Como organizar o currículo?"), false);
  assert.equal(html.includes("O texto fica neste navegador."), false);
  assert.equal(html.includes('id="mode-local"'), false);
  assert.equal(html.includes("Seu currículo está organizado"), true);
  assert.equal(html.includes("Seu documento está pronto para baixar e editar."), true);
  assert.equal(html.includes("Baixar PDF"), true);
  assert.equal(html.includes("Baixar Word"), true);

  const requiredTokens = [
    "--color-parchment: #f7f7f4;",
    "--color-bone: #f2f1ed;",
    "--color-linen: #e6e5e0;",
    "--color-stone: #cdcdc9;",
    "--color-mist: #a1a19f;",
    "--color-driftwood: #84847e;",
    "--color-ash: #7a7974;",
    "--color-ink: #26251e;",
    "--color-ember: #f54e00;",
    "--color-amber: #c08532;",
    "--color-forest: #34785c;",
    "--color-verdant: #1f8a65;",
  ];
  for (const token of requiredTokens) {
    assert.equal(css.includes(token), true, `Missing CSS token: ${token}`);
  }
});
