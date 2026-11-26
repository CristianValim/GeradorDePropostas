
/* ============================================================
   CARTRACK — IMPORTAÇÃO DOCUMENTAL LOCAL
   Etapa 1:
   - TXT: leitura direta
   - DOCX: extração através do JSZip
   - PDF: leitura através de PDF.js (opcional)
   - Imagens: OCR através de Tesseract.js (opcional)

   Os documentos são processados localmente.
   Não são enviados para serviços externos.
   ============================================================ */

(function (root) {
    "use strict";

    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    const MAX_PDF_PAGES = 40;

    const $ = id => document.getElementById(id);

    let selectedFile = null;
    let extractedDocument = null;

    /* ------------------------------------------------------------
       ESTADO E MENSAGENS
       ------------------------------------------------------------ */

    function setStatus(message, isError = false) {
        const status = $("aiDocumentStatus");

        if (!status) return;

        status.textContent = message;
        status.dataset.state = isError ? "error" : "normal";
    }

    function getExtension(file) {
        const name = String(file?.name || "").toLowerCase();
        const index = name.lastIndexOf(".");

        return index >= 0 ? name.slice(index + 1) : "";
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO TXT
       ------------------------------------------------------------ */

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
            method: "Leitura de texto"
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DOCX
       Utiliza a biblioteca JSZip já presente na extensão.
       ------------------------------------------------------------ */

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
            method: "Extração de texto DOCX"
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO PDF
       Requer PDF.js instalado localmente.
       ------------------------------------------------------------ */

    async function extractPdf(file) {
        const pdfjs = root.pdfjsLib || root.PDFJS;

        if (!pdfjs?.getDocument) {
            throw new Error(
                "PDF.js não está instalado. " +
                "Adiciona lib/pdf.min.js e lib/pdf.worker.min.js."
            );
        }

        if (pdfjs.GlobalWorkerOptions) {
            pdfjs.GlobalWorkerOptions.workerSrc =
                chrome.runtime.getURL("lib/pdf.worker.min.js");
        }

        const bytes = new Uint8Array(
            await file.arrayBuffer()
        );

        const pdf = await pdfjs.getDocument({
            data: bytes
        }).promise;

        const total = Math.min(
            pdf.numPages,
            MAX_PDF_PAGES
        );

        const pages = [];

        for (
            let pageNumber = 1;
            pageNumber <= total;
            pageNumber += 1
        ) {
            setStatus(
                `A extrair texto do PDF — página ${pageNumber} de ${total}…`
            );

            const page = await pdf.getPage(pageNumber);
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
        }

        const text = pages
            .filter(Boolean)
            .join("\n\n");

        return {
            text,
            pages: total,
            totalPages: pdf.numPages,
            method: "Extração de texto PDF",
            scanned: !text
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DE IMAGENS
       Requer Tesseract.js e dados de idioma locais.
       ------------------------------------------------------------ */

    async function extractImage(file) {
        if (!root.Tesseract?.createWorker) {
            throw new Error(
                "Tesseract.js não está instalado. " +
                "Adiciona a biblioteca local e os dados de idioma."
            );
        }

        setStatus("A preparar o OCR local…");

        let worker;

        try {
            // API utilizada nas versões mais recentes.
            worker = await root.Tesseract.createWorker("por+eng");

        } catch {
            // Compatibilidade com versões antigas.
            worker = await root.Tesseract.createWorker();

            if (worker.loadLanguage) {
                await worker.loadLanguage("por+eng");
            }

            if (worker.initialize) {
                await worker.initialize("por+eng");
            }
        }

        try {
            const result = await worker.recognize(file);

            return {
                text: String(
                    result?.data?.text || ""
                ).trim(),

                pages: 1,

                method: "OCR local (português + inglês)"
            };

        } finally {
            if (worker.terminate) {
                await worker.terminate();
            }
        }
    }

    /* ------------------------------------------------------------
       IDENTIFICAR E PROCESSAR DOCUMENTO
       ------------------------------------------------------------ */

    async function extractDocument(file) {
        const extension = getExtension(file);

        // TXT
        if (
            extension === "txt" ||
            file.type === "text/plain"
        ) {
            return extractTxt(file);
        }

        // DOCX
        if (
            extension === "docx" ||
            file.type ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
            return extractDocx(file);
        }

        // PDF
        if (
            extension === "pdf" ||
            file.type === "application/pdf"
        ) {
            const result = await extractPdf(file);

            if (result.scanned) {
                throw new Error(
                    "Este PDF parece digitalizado e não contém texto selecionável. " +
                    "A leitura OCR de páginas PDF será acrescentada na próxima etapa."
                );
            }

            return result;
        }

        // IMAGENS
        if (
            file.type.startsWith("image/") ||
            ["png", "jpg", "jpeg", "webp", "tif", "tiff"]
                .includes(extension)
        ) {
            return extractImage(file);
        }

        throw new Error(
            "Formato não suportado. Utiliza PDF, DOCX, TXT ou uma imagem."
        );
    }

    /* ------------------------------------------------------------
       EXECUTAR EXTRAÇÃO
       ------------------------------------------------------------ */

    async function runExtraction() {
        const button = $("aiExtractDocument");
        const output = $("aiExtractedText");

        if (!selectedFile || !button || !output) {
            return;
        }

        button.disabled = true;
        button.textContent = "A extrair…";
        output.value = "";

        try {
            const result = await extractDocument(selectedFile);

            const text = String(
                result.text || ""
            ).trim();

            if (!text) {
                throw new Error(
                    "Não foi encontrado texto no documento."
                );
            }

            extractedDocument = {
                fileName: selectedFile.name,
                mimeType: selectedFile.type || "",
                method: result.method,
                pages: result.pages,
                text,
                extractedAt: new Date().toISOString()
            };

            output.value = text;

            const pageInfo = result.pages
                ? ` · ${result.pages} página(s)`
                : "";

            setStatus(
                `Texto extraído com sucesso — ${result.method}${pageInfo}. ` +
                "Revê o conteúdo antes da análise por IA."
            );

            // Evento que permitirá à próxima etapa
            // receber o documento extraído.
            root.dispatchEvent(
                new CustomEvent("ct:document-extracted", {
                    detail: structuredClone(extractedDocument)
                })
            );

        } catch (error) {
            console.error(
                "[Cartrack Document AI] Erro de extração:",
                error
            );

            setStatus(
                error.message ||
                "Não foi possível ler o documento.",
                true
            );

        } finally {
            button.disabled = !selectedFile;
            button.textContent = "Extrair texto do documento";
        }
    }

    /* ------------------------------------------------------------
       INICIALIZAÇÃO DA INTERFACE
       ------------------------------------------------------------ */

    function initialize() {
        const input = $("aiDocumentFile");
        const button = $("aiExtractDocument");

        if (!input || !button) {
            return;
        }

        input.addEventListener("change", () => {
            selectedFile = input.files?.[0] || null;
            extractedDocument = null;

            const output = $("aiExtractedText");

            if (output) {
                output.value = "";
            }

            if (!selectedFile) {
                button.disabled = true;

                setStatus(
                    "Seleciona um documento para começar."
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

        // Interface pública para a futura integração com IA.
        root.CTDocumentAI = {
            getExtractedDocument: () =>
                extractedDocument
                    ? structuredClone(extractedDocument)
                    : null,

            clear: () => {
                selectedFile = null;
                extractedDocument = null;

                input.value = "";
                button.disabled = true;

                $("aiExtractedText").value = "";

                setStatus(
                    "Documento removido da sessão."
                );
            }
        };
    }

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
