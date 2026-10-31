const SECTION_ALIASES = {
  objective: [
    "objetivo profissional",
    "objetivos profissionais",
    "objetivo",
    "resumo profissional",
    "perfil profissional",
    "sobre mim",
    "professional summary",
    "summary",
    "objective",
  ],
  education: [
    "formacao academica",
    "formacao",
    "educacao",
    "historico academico",
    "academic background",
    "education",
  ],
  courses: ["cursos e certificacoes", "cursos", "certificacoes", "certificados", "courses", "certifications"],
  skills: ["habilidades tecnicas", "habilidades", "competencias", "tecnologias", "linguagens de programacao", "skills", "technologies"],
  languages: ["idiomas", "languages"],
  projects: ["projetos", "portfolio", "projects"],
  experience: ["experiencia profissional", "experiencia", "historico profissional", "professional experience", "experience"],
};

const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function cleanLine(value) {
  return value
    .replace(/^\s*(?:[-*•▪◦]+|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSection(line) {
  const normalized = normalize(line).replace(/^\s*(?:[-*•▪◦]+|\d+[.)])\s*/, "");
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      if (normalized === alias) return { key, inlineText: "" };
      if (normalized.startsWith(alias)) {
        const next = normalized[alias.length];
        if (next === ":" || next === "-" || next === "—" || next === " " || next === "|") {
          const inlineText = line.slice(alias.length).replace(/^\s*[:\-–—|]\s*/, "").trim();
          return { key, inlineText };
        }
      }
    }
  }
  return null;
}

function sectionLines(lines, sectionKey) {
  const collected = [];
  let active = false;

  for (const line of lines) {
    const section = matchSection(line);
    if (section) {
      active = section.key === sectionKey;
      if (active && section.inlineText) collected.push(cleanLine(section.inlineText));
      continue;
    }
    if (active && cleanLine(line)) collected.push(cleanLine(line));
  }
  return collected;
}

function splitItems(lines, splitCommas = false) {
  const separator = splitCommas ? /\s*[;|,]\s*/ : /\s*[;|]\s*/;
  return lines
    .flatMap((line) =>
      line
        .split(separator)
        .map(cleanLine)
        .filter(Boolean),
    )
    .filter((value, index, values) => values.findIndex((item) => normalize(item) === normalize(value)) === index);
}

function findName(lines) {
  for (const line of lines.slice(0, 8)) {
    const labeled = line.match(/^\s*nome\s*[:\-]\s*(.+)$/i);
    if (labeled?.[1]) return cleanLine(labeled[1]);
  }

  const firstCandidates = lines.slice(0, 7).map(cleanLine).filter(Boolean);
  for (const candidate of firstCandidates) {
    if (/@|https?:\/\/|www\.|\d{2,}/i.test(candidate)) continue;
    if (/^(curriculum(?: vitae)?|currículo(?: vitae)?|resume|cv|contato|contact)$/i.test(candidate)) continue;
    const words = candidate.match(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'.-]*/g) || [];
    if (words.length >= 2 && words.length <= 5 && words.join(" ").length >= candidate.length * 0.72) {
      return candidate;
    }
  }
  return null;
}

function findPhone(text) {
  const candidates = text.match(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9\d{4}|\d{4})[\s.-]?\d{4}/g) || [];
  return candidates.find((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13;
  })?.trim() ?? null;
}

function findLinks(text) {
  return [...new Set(text.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [])]
    .map((link) => link.replace(/[.,;]+$/, ""));
}

function linesByKeyword(lines, pattern) {
  return lines
    .filter((line) => pattern.test(normalize(line)))
    .map(cleanLine)
    .filter(Boolean);
}

function joinSection(values) {
  const text = values.join(" ").replace(/\s+/g, " ").trim();
  return text || null;
}

function sectionOrKeywordLines(lines, sectionKey, keywordPattern, splitCommas = false) {
  const fromSection = sectionLines(lines, sectionKey);
  return fromSection.length
    ? splitItems(fromSection, splitCommas)
    : splitItems(linesByKeyword(lines, keywordPattern), splitCommas);
}

/**
 * Organizes resume text into the five portfolio blocks shown by the app.
 * This is a local heuristic parser, not an AI/LLM call.
 */
export function parseResume(rawText) {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n");
  const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const phone = findPhone(text);
  const links = findLinks(text);
  const linkedin = links.find((link) => /linkedin\.com/i.test(link)) ?? null;
  const github = links.find((link) => /github\.com/i.test(link)) ?? null;
  const contact = {
    nome: findName(lines),
    telefone: phone,
    email: emails[0] ?? null,
    linkedin,
    github,
  };

  const education = sectionOrKeywordLines(
    lines,
    "education",
    /\b(graduacao|bacharelado|licenciatura|tecnologo|mestrado|doutorado|ensino medio|universidade|faculdade|instituto)\b/,
  );
  const courses = sectionOrKeywordLines(
    lines,
    "courses",
    /\b(curso|certificacao|certificado|bootcamp|formacao complementar)\b/,
  );
  const skills = sectionOrKeywordLines(
    lines,
    "skills",
    /\b(habilidades|competencias|tecnologias|javascript|typescript|python|java|sql|excel)\b/,
    true,
  );
  const languages = sectionOrKeywordLines(
    lines,
    "languages",
    /\b(idiomas?|portugues|ingles|espanhol|frances|alemao|italiano|fluente|intermediario|basico|nativo)\b/,
    true,
  );
  const projects = sectionOrKeywordLines(
    lines,
    "projects",
    /\b(projeto|projetos|portfolio)\b/,
  );
  const experience = sectionOrKeywordLines(
    lines,
    "experience",
    /\b(experiencia profissional|analista|desenvolvedor|desenvolvedora|gerente|estagio|estagiario|estagiaria)\b/,
  );

  return {
    bloco_1_contato: contact,
    bloco_2_objetivo: joinSection(sectionLines(lines, "objective")),
    bloco_3_formacao_academica: education,
    bloco_4_cursos_e_linguagens: {
      cursos: courses,
      habilidades: skills,
      idiomas: languages,
    },
    bloco_5_informacoes_extras: {
      experiencia_profissional: experience,
      projetos: projects,
      links: links,
    },
  };
}
