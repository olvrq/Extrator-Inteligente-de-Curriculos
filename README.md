# Extrator de Currículos

Aplicação web para organizar currículos em blocos estruturados, com revisão antes de copiar ou baixar os dados.

## Recursos

- Recebe texto colado e arquivos `.txt`, `.md`, `.pdf`, `.doc` (Word 97–2003) e `.docx`.
- Lê os arquivos no navegador; o arquivo original não é enviado ao servidor.
- Oferece extração local e uma opção de extração com IA, que só envia o texto revisado após consentimento.
- Permite revisar e editar os campos extraídos antes de exportar o JSON.

PDFs digitalizados como imagem, documentos protegidos por senha e arquivos corrompidos podem não ser extraíveis.

## Executar

```bash
npm install
node server.mjs
```

O servidor local usa a porta `5000`. Para a opção de IA, configure `OPENAI_API_KEY` no gerenciador de segredos do ambiente.

Os leitores de PDF, DOC e DOCX são carregados do jsDelivr quando necessários. O conteúdo do currículo permanece no navegador durante a extração do arquivo.
