import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAppServer } from "../server.mjs";
import { isResumeResult, parseResume, RESUME_RESULT_SCHEMA } from "../resume-parser.mjs";

const SAMPLE_RESUME = `MARIA OLIVEIRA
maria.oliveira@example.com
FORMAÇÃO ACADÊMICA
Análise e Desenvolvimento de Sistemas — Universidade de São Paulo
HABILIDADES
JavaScript, React`;

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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
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
