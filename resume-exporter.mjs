/**
 * Generates professional ABNT-inspired A4 PDF (.pdf) and Word (.docx) resumes
 * directly from the organized resume result, with zero external runtime dependencies.
 */

// A4 dimensions & ABNT margins (3 cm top/left, 2 cm bottom/right)
const CM_TO_PT = 28.3464567;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MARGIN_TOP_PT = Number((3 * CM_TO_PT).toFixed(2)); // 85.04 pt
const MARGIN_LEFT_PT = Number((3 * CM_TO_PT).toFixed(2)); // 85.04 pt
const MARGIN_BOTTOM_PT = Number((2 * CM_TO_PT).toFixed(2)); // 56.69 pt
const MARGIN_RIGHT_PT = Number((2 * CM_TO_PT).toFixed(2)); // 56.69 pt
const CONTENT_WIDTH_PT = Number((A4_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT).toFixed(2));

// Twips for DOCX (1 cm ≈ 566.93 twips)
const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;
const MARGIN_TOP_TWIPS = 1701; // 3.0 cm
const MARGIN_LEFT_TWIPS = 1701; // 3.0 cm
const MARGIN_BOTTOM_TWIPS = 1134; // 2.0 cm
const MARGIN_RIGHT_TWIPS = 1134; // 2.0 cm

const SUMMARY_HEADERS = /^(resumo profissional|perfil profissional|síntese de qualificações|sintese de qualificacoes|sobre mim|professional summary|summary)\s*[:\-–—|]?\s*(.*)$/i;
const OBJECTIVE_HEADERS = /^(objetivo profissional|objetivos profissionais|objetivo|objective)\s*[:\-–—|]?\s*(.*)$/i;
const OTHER_SECTION_HEADERS = /^(forma[çc][ãa]o|educa[çc][ãa]o|hist[óo]rico acad[êe]mico|cursos?|certifica[çc][õo]es|certificados|habilidades|compet[êe]ncias|tecnologias|linguagens|idiomas|projetos|portf[óo]lio|experi[êe]ncia|hist[óo]rico profissional|education|courses|skills|languages|projects|experience)\b/i;

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((item) => cleanString(String(item ?? ""))).filter(Boolean);
}

/**
 * Extracts city/state from the top lines of raw resume text when present
 * (e.g., "São Paulo, SP", "Belo Horizonte - MG", "Curitiba/PR").
 */
export function extractLocationFromText(rawText = "") {
  if (!rawText || typeof rawText !== "string") return null;
  const lines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, 10)
    .map((line) => line.trim())
    .filter(Boolean);

  const ufPattern = /\b([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s'.-]{1,38}?)\s*(?:,|\/|-|–|—)\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/;
  for (const line of lines) {
    if (/@|https?:\/\/|www\./i.test(line)) continue;
    const match = line.match(ufPattern);
    if (match) {
      const city = match[1].replace(/^(cidade|localiza[çc][ãa]o|endere[çc]o)\s*[:\-]\s*/i, "").trim();
      const state = match[2].toUpperCase();
      if (city && !/\d/.test(city)) {
        return `${city}, ${state}`;
      }
    }
  }
  return null;
}

/**
 * Separates Objective and Professional Summary when both are present in rawText,
 * while always prioritizing edits made to result.bloco_2_objetivo.
 */
function resolveObjectiveAndSummary(objectiveField, rawText = "") {
  const editedObjective = cleanString(objectiveField);
  if (!rawText || typeof rawText !== "string") {
    return { objetivo: editedObjective || null, resumo: null };
  }

  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const objLines = [];
  const sumLines = [];
  let mode = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const objMatch = line.match(OBJECTIVE_HEADERS);
    if (objMatch) {
      mode = "obj";
      if (objMatch[2]?.trim()) objLines.push(objMatch[2].trim());
      continue;
    }
    const sumMatch = line.match(SUMMARY_HEADERS);
    if (sumMatch) {
      mode = "sum";
      if (sumMatch[2]?.trim()) sumLines.push(sumMatch[2].trim());
      continue;
    }
    if (OTHER_SECTION_HEADERS.test(line)) {
      mode = null;
      continue;
    }
    if (mode === "obj") objLines.push(line);
    else if (mode === "sum") sumLines.push(line);
  }

  const rawObj = cleanString(objLines.join(" "));
  const rawSum = cleanString(sumLines.join(" "));
  const combinedRaw = cleanString([rawObj, rawSum].filter(Boolean).join(" "));

  // If rawText had both Objective and Summary and the user didn't overwrite the combined value
  if (rawObj && rawSum && (!editedObjective || editedObjective === combinedRaw)) {
    return { objetivo: rawObj, resumo: rawSum };
  }
  // If rawText had only a Summary header (no Objective header) and user kept it
  if (!rawObj && rawSum && editedObjective === rawSum) {
    return { objetivo: null, resumo: editedObjective };
  }

  return { objetivo: editedObjective || null, resumo: null };
}

/**
 * Builds the canonical resume model for PDF and Word export.
 * Omits any section that has no data. Never invents fields.
 */
export function buildStructuredResume(result, rawText = "") {
  const contact = result?.bloco_1_contato ?? {};
  const coursesBlock = result?.bloco_4_cursos_e_linguagens ?? {};
  const extrasBlock = result?.bloco_5_informacoes_extras ?? {};

  const nome = cleanString(contact.nome);
  const cidadeEstado = cleanString(contact.localizacao) || extractLocationFromText(rawText) || "";
  const telefone = cleanString(contact.telefone);
  const email = cleanString(contact.email);
  const linkedin = cleanString(contact.linkedin);
  const github = cleanString(contact.github);

  const extraLinks = cleanArray(extrasBlock.links).filter((link) => {
    const lower = link.toLowerCase();
    if (linkedin && lower === linkedin.toLowerCase()) return false;
    if (github && lower === github.toLowerCase()) return false;
    return true;
  });

  const portfolioList = [github, ...extraLinks].filter(Boolean);

  const contactDetails = [];
  if (cidadeEstado) contactDetails.push({ label: "Localização", value: cidadeEstado });
  if (telefone) contactDetails.push({ label: "Telefone", value: telefone });
  if (email) contactDetails.push({ label: "E-mail", value: email });
  if (linkedin) contactDetails.push({ label: "LinkedIn", value: linkedin });
  if (portfolioList.length > 0) {
    contactDetails.push({
      label: portfolioList.length === 1 && github ? "GitHub" : "Portfólio / GitHub",
      value: portfolioList.join(" | "),
    });
  }

  const { objetivo, resumo } = resolveObjectiveAndSummary(result?.bloco_2_objetivo, rawText);
  const formacao = cleanArray(result?.bloco_3_formacao_academica);
  const experiencia = cleanArray(extrasBlock.experiencia_profissional).filter(
    (item) => item !== objetivo && item !== resumo,
  );
  const projetos = cleanArray(extrasBlock.projetos).filter(
    (item) => item !== objetivo && item !== resumo,
  );
  const competencias = cleanArray(coursesBlock.habilidades);
  const cursos = cleanArray(coursesBlock.cursos);
  const idiomas = cleanArray(coursesBlock.idiomas);

  const sections = [];

  if (objetivo) {
    sections.push({
      id: "objetivo",
      title: "OBJETIVO PROFISSIONAL",
      type: "paragraph",
      text: objetivo,
    });
  }

  if (resumo) {
    sections.push({
      id: "resumo",
      title: "RESUMO PROFISSIONAL",
      type: "paragraph",
      text: resumo,
    });
  }

  if (formacao.length > 0) {
    sections.push({
      id: "formacao",
      title: "FORMAÇÃO ACADÊMICA",
      type: "list",
      items: formacao,
    });
  }

  if (experiencia.length > 0) {
    sections.push({
      id: "experiencia",
      title: "EXPERIÊNCIA PROFISSIONAL",
      type: "list",
      items: experiencia,
    });
  }

  if (projetos.length > 0) {
    sections.push({
      id: "projetos",
      title: "PROJETOS RELEVANTES",
      type: "list",
      items: projetos,
    });
  }

  if (competencias.length > 0) {
    sections.push({
      id: "competencias",
      title: "COMPETÊNCIAS TÉCNICAS",
      type: "list",
      items: competencias,
    });
  }

  if (cursos.length > 0) {
    sections.push({
      id: "cursos",
      title: "CURSOS E CERTIFICAÇÕES",
      type: "list",
      items: cursos,
    });
  }

  if (idiomas.length > 0) {
    sections.push({
      id: "idiomas",
      title: "IDIOMAS",
      type: "list",
      items: idiomas,
    });
  }

  return {
    dadosPessoais: {
      nome: nome || null,
      cidadeEstado: cidadeEstado || null,
      telefone: telefone || null,
      email: email || null,
      linkedin: linkedin || null,
      portfolioGithub: portfolioList,
      contactDetails,
    },
    sections,
  };
}

/**
 * Generates clean, structured plain text ready to paste into Word, Google Docs, or email.
 * Contains zero JSON or technical markup.
 */
export function generateResumePlainText(result, rawText = "") {
  const structured = buildStructuredResume(result, rawText);
  const { dadosPessoais, sections } = structured;
  const blocks = [];

  if (dadosPessoais.nome) {
    blocks.push(dadosPessoais.nome.toUpperCase());
  }

  const personalLines = [];
  if (dadosPessoais.email) personalLines.push(`E-mail: ${dadosPessoais.email}`);
  if (dadosPessoais.telefone) personalLines.push(`Telefone: ${dadosPessoais.telefone}`);
  if (dadosPessoais.cidadeEstado) personalLines.push(`Cidade: ${dadosPessoais.cidadeEstado}`);
  if (dadosPessoais.linkedin) personalLines.push(`LinkedIn: ${dadosPessoais.linkedin}`);
  if (dadosPessoais.portfolioGithub.length > 0) {
    const label =
      dadosPessoais.portfolioGithub.length === 1 && result?.bloco_1_contato?.github
        ? "GitHub"
        : "Portfólio / GitHub";
    personalLines.push(`${label}: ${dadosPessoais.portfolioGithub.join(" | ")}`);
  }

  if (personalLines.length > 0) {
    blocks.push(["DADOS PESSOAIS", ...personalLines].join("\n"));
  }

  for (const section of sections) {
    if (section.type === "paragraph") {
      blocks.push(`${section.title}\n${section.text}`);
    } else if (section.type === "list") {
      blocks.push([section.title, ...section.items.map((item) => `• ${item}`)].join("\n"));
    }
  }

  return blocks.join("\n\n").trim();
}

// ============================================================================
// WORD (.DOCX) GENERATOR — Genuine OpenXML Package (A4 + ABNT Margins + Arial)
// ============================================================================

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildDocxDocumentXml(structured) {
  const paragraphs = [];
  const { dadosPessoais, sections } = structured;

  // 1. DADOS PESSOAIS Header
  if (dadosPessoais.nome) {
    paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="0" w:after="80" w:line="276" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:b/>
            <w:color w:val="1F1E1A"/>
            <w:sz w:val="32"/>
            <w:szCs w:val="32"/>
          </w:rPr>
          <w:t>${escapeXml(dadosPessoais.nome.toUpperCase())}</w:t>
        </w:r>
      </w:p>`);
  }

  if (dadosPessoais.contactDetails.length > 0) {
    for (const item of dadosPessoais.contactDetails) {
      paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="0" w:after="40" w:line="260" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:b/>
            <w:color w:val="26251E"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
          </w:rPr>
          <w:t xml:space="preserve">${escapeXml(item.label)}: </w:t>
        </w:r>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:color w:val="26251E"/>
            <w:sz w:val="21"/>
            <w:szCs w:val="21"/>
          </w:rPr>
          <w:t>${escapeXml(item.value)}</w:t>
        </w:r>
      </w:p>`);
    }
  }

  // 2..8. Sections
  for (const section of sections) {
    paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:keepNext/>
          <w:pBdr>
            <w:bottom w:val="single" w:sz="4" w:space="3" w:color="84847E"/>
          </w:pBdr>
          <w:spacing w:before="240" w:after="100" w:line="276" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:b/>
            <w:color w:val="1F1E1A"/>
            <w:sz w:val="24"/>
            <w:szCs w:val="24"/>
          </w:rPr>
          <w:t>${escapeXml(section.title)}</w:t>
        </w:r>
      </w:p>`);

    if (section.type === "paragraph") {
      paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="40" w:after="100" w:line="300" w:lineRule="auto"/>
          <w:jc w:val="both"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:color w:val="26251E"/>
            <w:sz w:val="22"/>
            <w:szCs w:val="22"/>
          </w:rPr>
          <w:t>${escapeXml(section.text)}</w:t>
        </w:r>
      </w:p>`);
    } else if (section.type === "list") {
      for (const item of section.items) {
        paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:ind w:left="280" w:hanging="180"/>
          <w:spacing w:before="20" w:after="60" w:line="280" w:lineRule="auto"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
            <w:color w:val="26251E"/>
            <w:sz w:val="22"/>
            <w:szCs w:val="22"/>
          </w:rPr>
          <w:t xml:space="preserve">• ${escapeXml(item)}</w:t>
        </w:r>
      </w:p>`);
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}" w:orient="portrait"/>
      <w:pgMar w:top="${MARGIN_TOP_TWIPS}" w:right="${MARGIN_RIGHT_TWIPS}" w:bottom="${MARGIN_BOTTOM_TWIPS}" w:left="${MARGIN_LEFT_TWIPS}" w:header="709" w:footer="709" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildDocxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
        <w:color w:val="26251E"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="pt-BR"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="80" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function buildDocumentRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

// CRC-32 lookup table for ZIP container
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRawBytes(bytes) {
  if (typeof CompressionStream === "function") {
    const stream = new CompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const response = new Response(stream.readable);
    return {
      method: 8,
      data: new Uint8Array(await response.arrayBuffer()),
    };
  }
  return { method: 0, data: bytes };
}

async function createZipArchive(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const uncompressed = encoder.encode(file.content);
    const crc = crc32(uncompressed);
    const { method, data: compressed } = await deflateRawBytes(uncompressed);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed to extract (2.0)
    localView.setUint16(6, 0, true); // General purpose bit flag
    localView.setUint16(8, method, true); // Compression method (8 = deflate, 0 = store)
    localView.setUint16(10, 0, true); // File last modification time
    localView.setUint16(12, 0x21, true); // File last modification date
    localView.setUint32(14, crc, true); // CRC-32
    localView.setUint32(18, compressed.length, true); // Compressed size
    localView.setUint32(22, uncompressed.length, true); // Uncompressed size
    localView.setUint16(26, nameBytes.length, true); // File name length
    localView.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true); // Central directory signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed
    centralView.setUint16(8, 0, true); // Flags
    centralView.setUint16(10, method, true); // Compression method
    centralView.setUint16(12, 0, true); // Mod time
    centralView.setUint16(14, 0x21, true); // Mod date
    centralView.setUint32(16, crc, true); // CRC-32
    centralView.setUint32(20, compressed.length, true); // Compressed size
    centralView.setUint32(24, uncompressed.length, true); // Uncompressed size
    centralView.setUint16(28, nameBytes.length, true); // File name length
    centralView.setUint16(30, 0, true); // Extra field length
    centralView.setUint16(32, 0, true); // File comment length
    centralView.setUint16(34, 0, true); // Disk number start
    centralView.setUint16(36, 0, true); // Internal file attributes
    centralView.setUint32(38, 0, true); // External file attributes
    centralView.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, compressed);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true); // End of central directory signature
  endView.setUint16(4, 0, true); // Number of this disk
  endView.setUint16(6, 0, true); // Disk where central directory starts
  endView.setUint16(8, files.length, true); // Number of central directory records on this disk
  endView.setUint16(10, files.length, true); // Total number of central directory records
  endView.setUint32(12, centralSize, true); // Size of central directory
  endView.setUint32(16, offset, true); // Offset of start of central directory
  endView.setUint16(20, 0, true); // Comment length

  const totalLength = offset + centralSize + endRecord.length;
  const output = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of localParts) {
    output.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    output.set(part, pos);
    pos += part.length;
  }
  output.set(endRecord, pos);
  return output;
}

export async function generateResumeDocx(result, rawText = "") {
  const structured = buildStructuredResume(result, rawText);
  return createZipArchive([
    { name: "[Content_Types].xml", content: buildContentTypesXml() },
    { name: "_rels/.rels", content: buildRootRelsXml() },
    { name: "word/_rels/document.xml.rels", content: buildDocumentRelsXml() },
    { name: "word/styles.xml", content: buildDocxStylesXml() },
    { name: "word/document.xml", content: buildDocxDocumentXml(structured) },
  ]);
}

// ============================================================================
// PDF (.PDF) GENERATOR — Genuine Vector A4 PDF 1.4 with Selectable Text
// ============================================================================

const WIN_ANSI_SPECIAL = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

function encodePdfLiteralString(text) {
  let out = "(";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    let byte = 0x3f; // '?'
    if (code >= 0x20 && code <= 0x7e) {
      byte = code;
    } else if (code >= 0xa0 && code <= 0xff) {
      byte = code;
    } else if (WIN_ANSI_SPECIAL.has(code)) {
      byte = WIN_ANSI_SPECIAL.get(code);
    }

    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x20 || byte > 0x7e) {
      out += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  out += ")";
  return out;
}

function estimateCharWidthFactor(ch, isBold) {
  if ("ilI.,:;!|'\"` ".includes(ch)) return isBold ? 0.31 : 0.28;
  if ("mwMW@%".includes(ch)) return isBold ? 0.85 : 0.8;
  if (ch >= "A" && ch <= "Z") return isBold ? 0.68 : 0.64;
  return isBold ? 0.56 : 0.52;
}

function measureTextWidthPt(text, fontSize, isBold = false) {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += estimateCharWidthFactor(text[i], isBold) * fontSize;
  }
  return total;
}

function splitLongWord(word, maxWidthPt, fontSize, isBold) {
  const chunks = [];
  let current = "";
  for (const ch of word) {
    if (measureTextWidthPt(current + ch, fontSize, isBold) > maxWidthPt && current) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapTextToLines(text, maxWidthPt, fontSize, isBold = false) {
  const normalized = cleanString(text);
  if (!normalized) return [];

  const rawWords = normalized.split(" ");
  const words = [];
  for (const word of rawWords) {
    if (measureTextWidthPt(word, fontSize, isBold) > maxWidthPt) {
      words.push(...splitLongWord(word, maxWidthPt, fontSize, isBold));
    } else {
      words.push(word);
    }
  }

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (measureTextWidthPt(candidate, fontSize, isBold) <= maxWidthPt || !currentLine) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export function generateResumePdf(result, rawText = "") {
  const structured = buildStructuredResume(result, rawText);
  const { dadosPessoais, sections } = structured;

  const pages = [[]];
  let currentY = A4_HEIGHT_PT - MARGIN_TOP_PT;

  const currentPageOps = () => pages[pages.length - 1];

  const ensureSpace = (neededHeightPt) => {
    if (currentY - neededHeightPt < MARGIN_BOTTOM_PT) {
      pages.push([]);
      currentY = A4_HEIGHT_PT - MARGIN_TOP_PT;
    }
  };

  const drawTextLine = (text, x, y, fontSize, { bold = false, color = [0.15, 0.145, 0.118] } = {}) => {
    const fontKey = bold ? "/F2" : "/F1";
    const [r, g, b] = color;
    currentPageOps().push(
      `BT ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${fontKey} ${fontSize} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${encodePdfLiteralString(text)} Tj ET`,
    );
  };

  const drawHorizontalRule = (x1, x2, y) => {
    currentPageOps().push(
      `0.52 0.52 0.49 RG 0.6 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`,
    );
  };

  // 1. DADOS PESSOAIS
  if (dadosPessoais.nome) {
    const nameFontSize = 15;
    const nameLineHeight = 19;
    const nameLines = wrapTextToLines(dadosPessoais.nome.toUpperCase(), CONTENT_WIDTH_PT, nameFontSize, true);
    for (const line of nameLines) {
      ensureSpace(nameLineHeight);
      currentY -= nameFontSize;
      drawTextLine(line, MARGIN_LEFT_PT, currentY, nameFontSize, { bold: true });
      currentY -= nameLineHeight - nameFontSize;
    }
    currentY -= 4;
  }

  if (dadosPessoais.contactDetails.length > 0) {
    const contactFontSize = 10.5;
    const contactLineHeight = 14.5;
    for (const item of dadosPessoais.contactDetails) {
      const fullLine = `${item.label}: ${item.value}`;
      const wrapped = wrapTextToLines(fullLine, CONTENT_WIDTH_PT, contactFontSize, false);
      for (const line of wrapped) {
        ensureSpace(contactLineHeight);
        currentY -= contactFontSize;
        drawTextLine(line, MARGIN_LEFT_PT, currentY, contactFontSize, {
          bold: false,
          color: [0.22, 0.21, 0.18],
        });
        currentY -= contactLineHeight - contactFontSize;
      }
    }
    currentY -= 6;
  }

  // 2..8. Sections
  const headingFontSize = 11.5;
  const headingLineHeight = 16;
  const bodyFontSize = 11;
  const bodyLineHeight = 15.5;
  const bulletIndentPt = 12;

  for (const section of sections) {
    // Keep heading together with at least 1 line of content (prevent orphan headings)
    ensureSpace(headingLineHeight + bodyLineHeight + 18);
    currentY -= 10;
    currentY -= headingFontSize;
    drawTextLine(section.title, MARGIN_LEFT_PT, currentY, headingFontSize, { bold: true });
    currentY -= 4;
    drawHorizontalRule(MARGIN_LEFT_PT, A4_WIDTH_PT - MARGIN_RIGHT_PT, currentY);
    currentY -= 6;

    if (section.type === "paragraph") {
      const lines = wrapTextToLines(section.text, CONTENT_WIDTH_PT, bodyFontSize, false);
      for (const line of lines) {
        ensureSpace(bodyLineHeight);
        currentY -= bodyFontSize;
        drawTextLine(line, MARGIN_LEFT_PT, currentY, bodyFontSize, { bold: false });
        currentY -= bodyLineHeight - bodyFontSize;
      }
      currentY -= 2;
    } else if (section.type === "list") {
      for (const item of section.items) {
        const lines = wrapTextToLines(item, CONTENT_WIDTH_PT - bulletIndentPt, bodyFontSize, false);
        lines.forEach((line, index) => {
          ensureSpace(bodyLineHeight);
          currentY -= bodyFontSize;
          if (index === 0) {
            drawTextLine("•", MARGIN_LEFT_PT, currentY, bodyFontSize, { bold: true });
          }
          drawTextLine(line, MARGIN_LEFT_PT + bulletIndentPt, currentY, bodyFontSize, { bold: false });
          currentY -= bodyLineHeight - bodyFontSize;
        });
        currentY -= 2;
      }
    }
  }

  // Assemble PDF 1.4 objects
  // Object 1: Catalog
  // Object 2: Pages
  // Object 3: Font /F1 (Helvetica / Arial)
  // Object 4: Font /F2 (Helvetica-Bold / Arial Bold)
  // Objects 5..: Page + Content Stream pairs
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  addObject(""); // 1: Catalog placeholder
  addObject(""); // 2: Pages placeholder
  const fontRegularId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBoldId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const pageIds = [];
  for (const ops of pages) {
    const streamContent = ops.join("\n");
    const contentId = addObject(
      `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdfText = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdfText.length);
    pdfText += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n`;
  pdfText += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdfText += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdfText.length);
  for (let i = 0; i < pdfText.length; i += 1) {
    bytes[i] = pdfText.charCodeAt(i) & 0xff;
  }
  return bytes;
}
