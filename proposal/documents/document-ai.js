
/* ============================================================
   CARTRACK — IMPORTAÇÃO DOCUMENTAL LOCAL

   - TXT: leitura direta
   - DOCX: extração através do JSZip
   - PDF: PDF.js (pdf.mjs + pdf.worker.mjs)
   - Imagens: OCR através de Tesseract.js

   FUNCIONAMENTO:
   1. O utilizador seleciona um documento.
   2. O documento é processado localmente.
   3. O texto extraído é enviado temporariamente para
      document-fields.js.
   4. document-fields.js identifica os dados relevantes
      e preenche diretamente os campos do contrato.

   OCR DOS DUA:
   - Disponibiliza uma função independente para reconhecer
     texto em fotografias dos Documentos Únicos Automóveis.
   - Não envia o texto do DUA para document-fields.js.
   - Não interfere com a importação da Certidão Permanente.

   PRIVACIDADE:
   - Os documentos são processados localmente.
   - Não são enviados para serviços externos.
   - O texto integral não é guardado neste módulo.
   ============================================================ */

(function (root) {
    "use strict";

    /* ============================================================
       CONFIGURAÇÕES
       ============================================================ */

    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    const MAX_PDF_PAGES = 40;

    const TESSERACT_BASE_PATH = "lib/tesseract/";

    const $ = id => document.getElementById(id);

    let selectedFile = null;
    let extractedDocument = null;
    let isExtracting = false;
    let initialized = false;

    // Cache da biblioteca PDF.js.
    let pdfjsPromise = null;

    /* ============================================================
       ESTADO E MENSAGENS
       ============================================================ */

    function setStatus(message, isError = false) {
        const status = $("aiDocumentStatus");

        if (!status) return;

        status.textContent = message;
        status.dataset.state = isError ? "error" : "normal";
    }

    function getExtension(file) {
        const name = String(file?.name || "").toLowerCase();
        const index = name.lastIndexOf(".");

        return index >= 0
            ? name.slice(index + 1)
            : "";
    }

    function getFileType(file) {
        return String(file?.type || "").toLowerCase();
    }

    function isImageFile(file) {
        if (!file) return false;

        const extension = getExtension(file);
        const mimeType = getFileType(file);

        return (
            mimeType.startsWith("image/") ||
            ["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"]
                .includes(extension)
        );
    }

    function isSupportedFile(file) {
        const extension = getExtension(file);
        const mimeType = getFileType(file);

        return (
            extension === "txt" ||
            extension === "docx" ||
            extension === "pdf" ||
            isImageFile(file) ||
            mimeType === "text/plain" ||
            mimeType === "application/pdf" ||
            mimeType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    }

    /* ============================================================
       CARREGAR PDF.JS — ES MODULE

       Utiliza:
       lib/pdf.mjs
       lib/pdf.worker.mjs

       A biblioteca é carregada apenas uma vez.
       ============================================================ */

    async function loadPdfJs() {
        if (!pdfjsPromise) {
            pdfjsPromise = import(
                chrome.runtime.getURL("lib/pdf.mjs")
            )
                .then(pdfjs => {
                    if (!pdfjs?.getDocument) {
                        throw new Error(
                            "O ficheiro pdf.mjs não disponibiliza getDocument."
                        );
                    }

                    if (!pdfjs.GlobalWorkerOptions) {
                        throw new Error(
                            "Não foi possível configurar o PDF.js."
                        );
                    }

                    pdfjs.GlobalWorkerOptions.workerSrc =
                        chrome.runtime.getURL("lib/pdf.worker.mjs");

                    return pdfjs;
                })
                .catch(error => {
                    // Permite tentar novamente se o carregamento falhar.
                    pdfjsPromise = null;
                    throw error;
                });
        }

        return pdfjsPromise;
    }

    /* ============================================================
       EXTRAÇÃO TXT
       ============================================================ */

    function decodeText(buffer) {
        return new TextDecoder("utf-8")
            .decode(buffer)
            .replace(/\u0000/g, "")
            .replace(/\r\n?/g, "\n")
            .trim();
    }

    async function extractTxt(file) {
        return {
            text: decodeText(await file.arrayBuffer()),
            pages: 1,
            totalPages: 1,
            method: "Leitura de texto"
        };
    }

    /* ============================================================
       EXTRAÇÃO DOCX

       Utiliza a biblioteca JSZip.
       ============================================================ */

    async function extractDocx(file) {
        if (!root.JSZip) {
            throw new Error(
                "A biblioteca JSZip não está disponível."
            );
        }

        const zip = await root.JSZip.loadAsync(file);
        const documentXml = zip.file("word/document.xml");

        if (!documentXml) {
            throw new Error(
                "O DOCX não contém word/document.xml."
            );
        }

        const xml = await documentXml.async("text");

        const parsed = new DOMParser().parseFromString(
            xml,
            "application/xml"
        );

        if (parsed.querySelector("parsererror")) {
            throw new Error(
                "Não foi possível interpretar o conteúdo XML do DOCX."
            );
        }

        const paragraphs = [
            ...parsed.getElementsByTagNameNS(
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "p"
            )
        ];

        const text = paragraphs
            .map(paragraph => {
                const nodes = paragraph.getElementsByTagNameNS(
                    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                    "t"
                );

                return [...nodes]
                    .map(node => node.textContent || "")
                    .join("");
            })
            .filter(Boolean)
            .join("\n");

        return {
            text: text.trim(),
            pages: null,
            totalPages: null,
            method: "Extração de texto DOCX"
        };
    }

    /* ============================================================
       EXTRAÇÃO PDF

       Utiliza PDF.js através de módulos ES.
       ============================================================ */

    async function extractPdf(file) {
        setStatus("A carregar a biblioteca PDF.js…");

        const pdfjs = await loadPdfJs();

        const bytes = new Uint8Array(
            await file.arrayBuffer()
        );

        setStatus("A abrir o documento PDF…");

        const loadingTask = pdfjs.getDocument({
            data: bytes
        });

        let pdf = null;

        try {
            pdf = await loadingTask.promise;

            const totalPages = pdf.numPages;

            const pagesToRead = Math.min(
                totalPages,
                MAX_PDF_PAGES
            );

            const pages = [];

            for (
                let pageNumber = 1;
                pageNumber <= pagesToRead;
                pageNumber += 1
            ) {
                setStatus(
                    `A extrair texto do PDF — página ${pageNumber} de ${pagesToRead}…`
                );

                const page = await pdf.getPage(pageNumber);

                try {
                    const content = await page.getTextContent();

                    const text = content.items
                        .map(item => item.str || "")
                        .join(" ")
                        .replace(/[ \t]+/g, " ")
                        .trim();

                    pages.push(
                        text
                            ? `[Página ${pageNumber}]\n${text}`
                            : ""
                    );

                } finally {
                    page.cleanup();
                }
            }

            const extractedText = pages
                .filter(Boolean)
                .join("\n\n");

            return {
                text: extractedText,
                pages: pagesToRead,
                totalPages,
                method: "Extração de texto PDF (PDF.js)",
                scanned: !extractedText
            };

        } finally {
            // O destroy pertence ao loadingTask.
            if (
                loadingTask &&
                typeof loadingTask.destroy === "function"
            ) {
                await loadingTask.destroy();
            }
        }
    }

    /* ============================================================
       CONFIGURAÇÃO DO TESSERACT.JS LOCAL

       Estrutura esperada:

       lib/
       └── tesseract/
           ├── tesseract.min.js
           ├── worker.min.js
           ├── core/
           │   ├── tesseract-core.wasm.js
           │   ├── tesseract-core.wasm
           │   ├── tesseract-core-simd.wasm.js
           │   ├── tesseract-core-simd.wasm
           │   ├── tesseract-core-lstm.wasm.js
           │   ├── tesseract-core-lstm.wasm
           │   ├── tesseract-core-simd-lstm.wasm.js
           │   └── tesseract-core-simd-lstm.wasm
           └── lang/
               ├── por.traineddata
               └── eng.traineddata

       Todos os recursos são carregados da própria extensão.
       Não utiliza CDN nem serviços externos.
       ============================================================ */

    async function createLocalOcrWorker(onProgress = null) {
        if (!root.Tesseract?.createWorker) {
            throw new Error(
                "Tesseract.js não está carregado. " +
                "Verifica se o script tesseract.min.js está incluído no HTML."
            );
        }

        const basePath = chrome.runtime.getURL(
            TESSERACT_BASE_PATH
        );

        const workerPath =
            basePath + "worker.min.js";

        const corePath =
            basePath + "core";

        const langPath =
            basePath + "lang";

        try {
            const worker = await root.Tesseract.createWorker(
                "por+eng",
                1,
                {
                    workerPath,
                    corePath,
                    langPath,

                    // Os ficheiros de idioma não estão comprimidos.
                    gzip: false,

                    // Evita criar workers através de Blob URLs.
                    workerBlobURL: false,

                    logger: message => {
                        if (typeof onProgress === "function") {
                            onProgress(message);
                            return;
                        }

                        if (
                            message?.status === "recognizing text"
                        ) {
                            const percentage = Math.round(
                                (message.progress || 0) * 100
                            );

                            setStatus(
                                `A reconhecer o texto da imagem… ${percentage}%`
                            );
                        }

                        if (
                            message?.status === "loading language model"
                        ) {
                            setStatus(
                                "A carregar os idiomas do OCR…"
                            );
                        }

                        if (
                            message?.status === "loading tesseract core"
                        ) {
                            setStatus(
                                "A preparar o motor de reconhecimento…"
                            );
                        }
                    }
                }
            );

            return worker;

        } catch (error) {
            console.error(
                "[Cartrack OCR] Erro ao criar o worker:",
                error
            );

            throw new Error(
                "Não foi possível iniciar o OCR local. " +
                "Verifica os ficheiros do Tesseract, do core e dos idiomas. " +
                (error?.message || "")
            );
        }
    }

    /* ============================================================
       RECONHECIMENTO DE TEXTO DE UMA IMAGEM

       Função partilhada por:
       - Importador de documentos.
       - Importador de fotografias dos DUA.

       onProgress é opcional.

       Quando fornecido, o progresso é enviado para essa função
       e não altera o estado da importação da Certidão Permanente.
       ============================================================ */

    async function recognizeImageText(
        file,
        onProgress = null
    ) {
        if (!file || !isImageFile(file)) {
            throw new Error(
                "Seleciona uma imagem válida."
            );
        }

        if (file.size === 0) {
            throw new Error(
                "A imagem selecionada está vazia."
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            throw new Error(
                "A imagem excede o limite de 25 MB."
            );
        }

        if (typeof onProgress !== "function") {
            setStatus("A preparar o OCR local…");
        } else {
            onProgress({
                status: "preparing",
                progress: 0
            });
        }

        let worker = null;

        try {
            worker = await createLocalOcrWorker(onProgress);

            if (typeof onProgress !== "function") {
                setStatus(
                    "A reconhecer o texto da imagem…"
                );
            } else {
                onProgress({
                    status: "recognizing text",
                    progress: 0
                });
            }

            const result = await worker.recognize(file);

            const text = String(
                result?.data?.text || ""
            ).trim();

            if (!text) {
                throw new Error(
                    "Não foi possível reconhecer texto na imagem. " +
                    "Tenta utilizar uma fotografia mais nítida e com boa iluminação."
                );
            }

            return text;

        } catch (error) {
            console.error(
                "[Cartrack OCR] Erro no reconhecimento:",
                error
            );

            throw error;

        } finally {
            if (
                worker &&
                typeof worker.terminate === "function"
            ) {
                try {
                    await worker.terminate();
                } catch (error) {
                    console.warn(
                        "[Cartrack OCR] Não foi possível encerrar o worker:",
                        error
                    );
                }
            }
        }
    }

    /* ============================================================
       EXTRAÇÃO DE IMAGENS PARA O IMPORTADOR DE DOCUMENTOS

       Esta função mantém a integração com a Certidão Permanente.

       O texto é devolvido ao fluxo normal de extração e enviado
       temporariamente para document-fields.js.
       ============================================================ */

    async function extractImage(file) {
        const text = await recognizeImageText(file);

        return {
            text,
            pages: 1,
            totalPages: 1,
            method: "OCR local (português + inglês)"
        };
    }

    /* ============================================================
       IDENTIFICAR E PROCESSAR DOCUMENTO
       ============================================================ */

    async function extractDocument(file) {
        const extension = getExtension(file);
        const mimeType = getFileType(file);

        // TXT
        if (
            extension === "txt" ||
            mimeType === "text/plain"
        ) {
            return extractTxt(file);
        }

        // DOCX
        if (
            extension === "docx" ||
            mimeType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
            return extractDocx(file);
        }

        // PDF
        if (
            extension === "pdf" ||
            mimeType === "application/pdf"
        ) {
            const result = await extractPdf(file);

            if (result.scanned) {
                throw new Error(
                    "Este PDF parece digitalizado e não contém texto selecionável. " +
                    "A leitura OCR de páginas PDF ainda não está implementada."
                );
            }

            return result;
        }

        // IMAGENS
        if (isImageFile(file)) {
            return extractImage(file);
        }

        throw new Error(
            "Formato não suportado. Utiliza PDF, DOCX, TXT ou uma imagem."
        );
    }

    /* ============================================================
       ENVIAR TEXTO PARA O EXTRATOR DE CAMPOS

       O texto é enviado temporariamente através de um evento.

       O document-fields.js é responsável por:
       - Identificar os dados relevantes.
       - Validar os valores.
       - Preencher os inputs do contrato.
       - Guardar os dados do contrato.

       Não é apresentada uma caixa com o texto integral.
       ============================================================ */

    function sendTextToFieldExtractor(text, metadata) {
        if (!root.CTDocumentFields) {
            throw new Error(
                "O módulo document-fields.js não está carregado. " +
                "Verifica a ordem de carregamento dos scripts."
            );
        }

        root.dispatchEvent(
            new CustomEvent("ct:document-extracted", {
                detail: {
                    ...metadata,
                    text
                }
            })
        );
    }

    /* ============================================================
       EXECUTAR EXTRAÇÃO — DOCUMENTOS DA EMPRESA

       Este fluxo é independente da leitura dos DUA.
       ============================================================ */

    async function runExtraction() {
        const button = $("aiExtractDocument");

        if (!selectedFile || !button || isExtracting) {
            return;
        }

        isExtracting = true;

        button.disabled = true;
        button.textContent = "A analisar documento…";

        try {
            const result = await extractDocument(selectedFile);

            const text = String(
                result.text || ""
            ).trim();

            if (!text) {
                throw new Error(
                    "Não foram encontrados dados no documento."
                );
            }

            // Guardar apenas os metadados.
            // O texto integral não fica guardado nesta variável.
            const metadata = {
                fileName: selectedFile.name,
                mimeType: selectedFile.type || "",
                method: result.method,
                pages: result.pages,
                totalPages: result.totalPages,
                extractedAt: new Date().toISOString()
            };

            // Enviar o texto temporariamente para document-fields.js.
            sendTextToFieldExtractor(text, metadata);

            // Guardar apenas os metadados do documento.
            extractedDocument = metadata;

            let pageInfo = "";

            if (result.pages) {
                if (
                    result.totalPages &&
                    result.totalPages > result.pages
                ) {
                    pageInfo =
                        ` · Foram lidas ${result.pages} de ${result.totalPages} páginas`;
                } else {
                    pageInfo =
                        ` · ${result.pages} página(s)`;
                }
            }

            setStatus(
                `Documento analisado com sucesso${pageInfo}. ` +
                "Os dados relevantes foram encaminhados para os campos do contrato."
            );

        } catch (error) {
            console.error(
                "[Cartrack Document AI] Erro de extração:",
                error
            );

            extractedDocument = null;

            setStatus(
                error?.message ||
                "Não foi possível ler o documento.",
                true
            );

        } finally {
            isExtracting = false;

            button.disabled = !selectedFile;
            button.textContent = "Extrair dados do documento";
        }
    }

    /* ============================================================
       LIMPAR DOCUMENTO
       ============================================================ */

    function clearDocument() {
        const input = $("aiDocumentFile");
        const button = $("aiExtractDocument");

        selectedFile = null;
        extractedDocument = null;

        if (input) {
            input.value = "";
        }

        if (button) {
            button.disabled = true;
        }

        setStatus(
            "Documento removido da sessão."
        );
    }

    /* ============================================================
       INICIALIZAÇÃO DA INTERFACE
       ============================================================ */

    function initialize() {
        if (initialized) return;

        const input = $("aiDocumentFile");
        const button = $("aiExtractDocument");

        if (!input || !button) {
            return;
        }

        initialized = true;

        button.disabled = true;

        input.addEventListener("change", () => {
            selectedFile = input.files?.[0] || null;
            extractedDocument = null;

            if (!selectedFile) {
                button.disabled = true;

                setStatus(
                    "Seleciona um documento para começar."
                );

                return;
            }

            if (selectedFile.size === 0) {
                selectedFile = null;
                input.value = "";
                button.disabled = true;

                setStatus(
                    "O ficheiro selecionado está vazio.",
                    true
                );

                return;
            }

            if (selectedFile.size > MAX_FILE_SIZE) {
                selectedFile = null;
                input.value = "";
                button.disabled = true;

                setStatus(
                    "O ficheiro excede o limite de 25 MB.",
                    true
                );

                return;
            }

            if (!isSupportedFile(selectedFile)) {
                selectedFile = null;
                input.value = "";
                button.disabled = true;

                setStatus(
                    "Formato não suportado. Utiliza PDF, DOCX, TXT ou uma imagem.",
                    true
                );

                return;
            }

            button.disabled = false;

            setStatus(
                `Ficheiro selecionado: ${selectedFile.name} ` +
                `(${(selectedFile.size / 1024 / 1024).toFixed(2)} MB).`
            );
        });

        button.addEventListener(
            "click",
            runExtraction
        );

        /* --------------------------------------------------------
           INTERFACE PÚBLICA

           Outros módulos podem utilizar:

           CTDocumentAI.getExtractedDocument()
           CTDocumentAI.recognizeImageText(file, onProgress)
           CTDocumentAI.clear()

           O sidepanel.js utiliza recognizeImageText() para
           reconhecer fotografias dos DUA.
           -------------------------------------------------------- */

        root.CTDocumentAI = {
            getExtractedDocument: () =>
                extractedDocument
                    ? { ...extractedDocument }
                    : null,

            recognizeImageText,

            clear: clearDocument
        };
    }

    /* ============================================================
       ARRANQUE
       ============================================================ */

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }

})(globalThis);
