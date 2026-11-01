const PDFJS_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
const MAMMOTH_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";
const LEGACY_DOC_READER_URL =
  "https://cdn.jsdelivr.net/gh/Alpaq92/JSDoc@821695a884e0c0bb8592a635d9524bb3e116cd67/src/docToText.js";

let pdfJsPromise;
let mammothPromise;
let legacyDocReaderPromise;

export class ResumeFileError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ResumeFileError";
    this.code = code;
  }
}

function fileExtension(file) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isPasswordError(error, pdfjs) {
  return (
    error?.name === "PasswordException" ||
    error?.code === pdfjs.PasswordResponses?.NEED_PASSWORD ||
    error?.code === pdfjs.PasswordResponses?.INCORRECT_PASSWORD
  );
}

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_MODULE_URL)
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch(() => {
        pdfJsPromise = undefined;
        throw new ResumeFileError(
          "Não foi possível carregar o leitor de PDF. Verifique sua conexão e tente novamente. O arquivo continua no seu dispositivo.",
          "reader-unavailable",
        );
      });
  }
  return pdfJsPromise;
}

async function getMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MAMMOTH_SCRIPT_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.resumeDocxReader = "true";
      script.onload = () => {
        if (window.mammoth) {
          resolve(window.mammoth);
        } else {
          reject(new Error("A biblioteca de leitura do Word não foi disponibilizada."));
        }
      };
      script.onerror = () => reject(new Error("Não foi possível carregar a biblioteca do Word."));
      document.head.append(script);
    }).catch(() => {
      mammothPromise = undefined;
      throw new ResumeFileError(
        "Não foi possível carregar o leitor de Word. Verifique sua conexão e tente novamente. O arquivo continua no seu dispositivo.",
        "reader-unavailable",
      );
    });
  }
  return mammothPromise;
}

async function getLegacyDocReader() {
  if (!legacyDocReaderPromise) {
    legacyDocReaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LEGACY_DOC_READER_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.resumeDocReader = "true";
      script.onload = () => {
        if (typeof window.docToText === "function") {
          resolve(window.docToText);
        } else {
          reject(new Error("O leitor de documentos Word antigos não foi disponibilizado."));
        }
      };
      script.onerror = () => reject(new Error("Não foi possível carregar o leitor de documentos Word antigos."));
      document.head.append(script);
    }).catch(() => {
      legacyDocReaderPromise = undefined;
      throw new ResumeFileError(
        "Não foi possível carregar o leitor de .doc. Verifique sua conexão e tente novamente. O arquivo continua no seu dispositivo.",
        "reader-unavailable",
      );
    });
  }
  return legacyDocReaderPromise;
}

function hasEncryptedOfficeHeader(buffer) {
  if (buffer.byteLength < 8) return false;
  const signature = new Uint8Array(buffer, 0, 8);
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
    (byte, index) => signature[index] === byte,
  );
}

function requireExtractedText(text, type) {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (normalized) return normalized;

  if (type === "pdf") {
    throw new ResumeFileError(
      "Este PDF não tem texto extraível. Ele pode ser digitalizado como imagem; a leitura por OCR não está disponível. Tente um PDF com texto selecionável ou cole o conteúdo.",
      "no-text",
    );
  }

  if (type === "doc") {
    throw new ResumeFileError(
      "Não encontramos texto extraível neste arquivo .doc. Ele pode estar protegido, corrompido ou usar uma versão antiga do Word. Tente salvar como .docx ou colar o conteúdo.",
      "no-text",
    );
  }

  throw new ResumeFileError(
    "Não encontramos texto extraível neste DOCX. Verifique o arquivo ou cole o conteúdo do currículo.",
    "no-text",
  );
}

function pageItemsToText(items) {
  let text = "";
  let previousY;

  for (const item of items) {
    if (!item.str) continue;

    const y = item.transform?.[5];
    const startsNewLine =
      text &&
      y !== undefined &&
      previousY !== undefined &&
      Math.abs(y - previousY) > 2;

    if (startsNewLine && !text.endsWith("\n")) {
      text += "\n";
    } else if (text && !text.endsWith("\n") && !item.str.startsWith(" ")) {
      text += " ";
    }

    text += item.str;
    if (item.hasEOL) text += "\n";
    previousY = y;
  }

  return text;
}

async function extractPdf(file) {
  const pdfjs = await getPdfJs();
  let loadingTask;

  try {
    loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items));
    }

    return requireExtractedText(pages.join("\n"), "pdf");
  } catch (error) {
    if (error instanceof ResumeFileError) throw error;
    if (isPasswordError(error, pdfjs)) {
      throw new ResumeFileError(
        "Este PDF está protegido por senha. Remova a proteção no seu dispositivo e envie o arquivo novamente.",
        "protected",
      );
    }
    throw new ResumeFileError(
      "Não foi possível ler este PDF. Verifique se o arquivo está íntegro e tente novamente.",
      "invalid-file",
    );
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

async function extractDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  if (hasEncryptedOfficeHeader(arrayBuffer)) {
    throw new ResumeFileError(
      "Este arquivo Word está protegido por senha. Remova a proteção no seu dispositivo e envie o DOCX novamente.",
      "protected",
    );
  }

  const mammoth = await getMammoth();
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return requireExtractedText(result.value, "docx");
  } catch (error) {
    if (error instanceof ResumeFileError) throw error;
    throw new ResumeFileError(
      "Não foi possível ler este DOCX. Verifique se o arquivo está íntegro e tente novamente.",
      "invalid-file",
    );
  }
}

async function extractLegacyDoc(file) {
  const docToText = await getLegacyDocReader();
  let text;
  try {
    text = docToText(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ResumeFileError(
      "Não foi possível ler este arquivo .doc. Verifique se ele está íntegro e tente novamente.",
      "invalid-file",
    );
  }

  if (text === null || typeof text !== "string") {
    throw new ResumeFileError(
      "Não foi possível ler este arquivo .doc. Ele pode estar protegido, corrompido ou usar uma versão antiga do Word. Tente salvar como .docx ou colar o conteúdo.",
      "unsupported",
    );
  }
  return requireExtractedText(text, "doc");
}

export async function extractResumeText(file) {
  const extension = fileExtension(file);
  const isTextFile =
    extension === "txt" ||
    extension === "md" ||
    (!["pdf", "doc", "docx"].includes(extension) && ["text/plain", "text/markdown"].includes(file.type));
  if (isTextFile) {
    try {
      return await file.text();
    } catch {
      throw new ResumeFileError("Não foi possível ler este arquivo de texto. Tente novamente.", "invalid-file");
    }
  }

  if (extension === "pdf") return extractPdf(file);
  if (extension === "doc") return extractLegacyDoc(file);
  if (extension === "docx") return extractDocx(file);

  throw new ResumeFileError(
    "Formato não compatível. Envie um arquivo .txt, .md, .pdf, .doc ou .docx.",
    "unsupported",
  );
}
