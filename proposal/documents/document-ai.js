
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

    let selectedFiles = [];
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
       PRÉ-PROCESSAMENTO LOCAL DE IMAGEM PARA OCR

       Usa apenas Canvas nativo do navegador:
       - amplia a imagem sem ultrapassar 3200 px;
       - converte para escala de cinzentos;
       - aumenta moderadamente o contraste.

       Não altera os ficheiros originais nem envia imagens para fora.
       ============================================================ */

    function preprocessCanvas(canvas) {
        const context = canvas.getContext("2d", {
            willReadFrequently: true
        });

        if (!context) return canvas;

        const image = context.getImageData(
            0, 0, canvas.width, canvas.height
        );
        const pixels = image.data;
        const contrast = 1.28;
        const brightness = 4;

        for (let i = 0; i < pixels.length; i += 4) {
            const gray =
                0.299 * pixels[i] +
                0.587 * pixels[i + 1] +
                0.114 * pixels[i + 2];
            const adjusted = Math.max(0, Math.min(255,
                (gray - 128) * contrast + 128 + brightness
            ));

            pixels[i] = adjusted;
            pixels[i + 1] = adjusted;
            pixels[i + 2] = adjusted;
        }

        context.putImageData(image, 0, 0);
        return canvas;
    }

    function createOcrCanvas(width, height, maxSide = 3200) {
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        return canvas;
    }

    /* ============================================================
       EXTRAÇÃO PDF

       Utiliza PDF.js através de módulos ES.
       ============================================================ */

    async function extractPdf(file) {
        setStatus("A carregar a biblioteca PDF.js…");

        const pdfjs = await loadPdfJs();
        const bytes = new Uint8Array(await file.arrayBuffer());

        setStatus("A abrir o documento PDF…");

        const loadingTask = pdfjs.getDocument({ data: bytes });
        let ocrWorker = null;

        try {
            const pdf = await loadingTask.promise;
            const totalPages = pdf.numPages;
            const pagesToRead = Math.min(totalPages, MAX_PDF_PAGES);
            const pages = [];

            for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
                setStatus(`A ler PDF — página ${pageNumber} de ${pagesToRead}…`);

                const page = await pdf.getPage(pageNumber);

                try {
                    const content = await page.getTextContent();
                    let pageText = content.items
                        .map(item => `${item.str || ""}${item.hasEOL ? "\n" : " "}`)
                        .join("")
                        .replace(/[ \t]+/g, " ")
                        .replace(/\n{2,}/g, "\n")
                        .trim();

                    // Se a página não tiver texto selecionável, aplicar OCR local.
                    if (pageText.length < 8) {
                        if (!ocrWorker) {
                            setStatus("PDF digitalizado detetado. A preparar OCR local…");
                            ocrWorker = await createLocalOcrWorker();
                        }

                        const baseViewport = page.getViewport({ scale: 3 });
                        const canvas = createOcrCanvas(
                            baseViewport.width,
                            baseViewport.height,
                            3200
                        );
                        const renderScale = canvas.width / page.getViewport({ scale: 1 }).width;
                        const viewport = page.getViewport({ scale: renderScale });
                        const context = canvas.getContext("2d", {
                            willReadFrequently: true
                        });

                        await page.render({
                            canvasContext: context,
                            viewport
                        }).promise;

                        preprocessCanvas(canvas);
                        const ocrResult = await ocrWorker.recognize(canvas);
                        pageText = String(ocrResult?.data?.text || "").trim();

                        canvas.width = 0;
                        canvas.height = 0;
                    }

                    pages.push(
                        pageText ? `[Página ${pageNumber}]\n${pageText}` : ""
                    );

                } finally {
                    page.cleanup();
                }
            }

            const extractedText = pages.filter(Boolean).join("\n\n");

            if (!extractedText.trim()) {
                throw new Error(
                    "Não foi possível reconhecer texto no PDF. Verifica a qualidade do documento."
                );
            }

            return {
                text: extractedText,
                pages: pagesToRead,
                totalPages,
                method: ocrWorker
                    ? "PDF.js + OCR local (Tesseract)"
                    : "Extração de texto PDF (PDF.js)",
                scanned: Boolean(ocrWorker)
            };

        } finally {
            if (ocrWorker && typeof ocrWorker.terminate === "function") {
                try {
                    await ocrWorker.terminate();
                } catch (error) {
                    console.warn("[Cartrack OCR] Não foi possível encerrar o worker PDF:", error);
                }
            }

            if (loadingTask && typeof loadingTask.destroy === "function") {
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
       OCR DO DUA POR RECORTES AUTOMÁTICOS

       O DUA tem campos em posições relativamente estáveis.
       Em vez de reconhecer a página inteira numa única passagem,
       renderizamos as duas páginas em alta resolução e ampliamos
       zonas com os campos A/B, D.1/D.3 e R.

       As coordenadas são proporcionais à página, pelo que não
       dependem da resolução original do PDF.
       ============================================================ */

    function createNormalizedCropCanvas(sourceCanvas, region, maxSide = 5000) {
        const sx = Math.max(0, Math.floor(sourceCanvas.width * region.x));
        const sy = Math.max(0, Math.floor(sourceCanvas.height * region.y));
        const sw = Math.max(1, Math.min(
            sourceCanvas.width - sx,
            Math.floor(sourceCanvas.width * region.width)
        ));
        const sh = Math.max(1, Math.min(
            sourceCanvas.height - sy,
            Math.floor(sourceCanvas.height * region.height)
        ));

        // Amplia o recorte para tornar caracteres pequenos mais legíveis.
        const scale = Math.min(2.2, maxSide / Math.max(sw, sh));
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round(sw * scale));
        crop.height = Math.max(1, Math.round(sh * scale));

        const context = crop.getContext("2d", {
            willReadFrequently: true
        });

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
            sourceCanvas,
            sx, sy, sw, sh,
            0, 0, crop.width, crop.height
        );

        preprocessCanvas(crop);
        return crop;
    }

    async function recognizeDuaCrop(worker, pageCanvas, region, label) {
        const crop = createNormalizedCropCanvas(pageCanvas, region);

        try {
            if (typeof worker.setParameters === "function") {
                try {
                    await worker.setParameters({
                        // Bloco de texto: preserva os códigos dos campos e os valores.
                        tessedit_pageseg_mode: "6",
                        // O DUA usa letras, algarismos e separadores nestas zonas.
                        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./ ",
                        preserve_interword_spaces: "1"
                    });
                } catch (parameterError) {
                    console.warn(
                        `[Cartrack DUA OCR] Não foi possível aplicar parâmetros ao recorte ${label}:`,
                        parameterError
                    );
                }
            }

            const result = await worker.recognize(crop);
            const recognized = String(result?.data?.text || "").trim();

            console.log(
                `[Cartrack DUA OCR] Recorte ${label}:`,
                recognized
            );

            return recognized;

        } finally {
            crop.width = 0;
            crop.height = 0;
        }
    }

    async function extractDuaPdfCrops(file, fallbackText = "") {
        const pdfjs = await loadPdfJs();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const loadingTask = pdfjs.getDocument({ data: bytes });

        let worker = null;
        const recognizedPages = [];

        try {
            const pdf = await loadingTask.promise;
            const pagesToRead = Math.min(pdf.numPages, 2);

            if (pagesToRead < 2) {
                console.warn(
                    "[Cartrack DUA OCR] O PDF tem menos de duas páginas; será mantido o OCR geral."
                );
                return fallbackText;
            }

            setStatus("A melhorar a leitura do DUA através de recortes…");
            worker = await createLocalOcrWorker();

            for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
                const page = await pdf.getPage(pageNumber);
                let pageCanvas = null;

                try {
                    // Renderização de alta resolução, respeitando a rotação da página.
                    const baseViewport = page.getViewport({ scale: 1 });
                    const renderScale = Math.min(
                        4.2,
                        4200 / Math.max(baseViewport.width, baseViewport.height)
                    );
                    const viewport = page.getViewport({ scale: renderScale });

                    pageCanvas = document.createElement("canvas");
                    pageCanvas.width = Math.max(1, Math.ceil(viewport.width));
                    pageCanvas.height = Math.max(1, Math.ceil(viewport.height));

                    const pageContext = pageCanvas.getContext("2d", {
                        willReadFrequently: true
                    });

                    await page.render({
                        canvasContext: pageContext,
                        viewport
                    }).promise;

                    if (pageNumber === 1) {
                        // Campo A (matrícula) e campo B (data da primeira matrícula).
                        const identityText = await recognizeDuaCrop(
                            worker,
                            pageCanvas,
                            { x: 0.02, y: 0.14, width: 0.96, height: 0.38 },
                            "A-B / identificação"
                        );

                        recognizedPages.push(
                            `[Página 1]\n[Recorte A-B]\n${identityText}`
                        );

                    } else {
                        // D.1 (marca), D.2 e D.3 (modelo).
                        const vehicleText = await recognizeDuaCrop(
                            worker,
                            pageCanvas,
                            { x: 0.02, y: 0.03, width: 0.96, height: 0.43 },
                            "D.1-D.3 / características"
                        );

                        // Segundo recorte sobreposto: amplia a zona onde surge D.3.
                        const modelText = await recognizeDuaCrop(
                            worker,
                            pageCanvas,
                            { x: 0.02, y: 0.14, width: 0.78, height: 0.34 },
                            "D.3 / modelo"
                        );

                        // Campo R (cor), habitualmente na metade inferior da página.
                        const colorText = await recognizeDuaCrop(
                            worker,
                            pageCanvas,
                            { x: 0.02, y: 0.48, width: 0.96, height: 0.46 },
                            "R / cor"
                        );

                        recognizedPages.push(
                            `[Página 2]\n[Recorte D.1-D.3]\n${vehicleText}\n` +
                            `[Recorte D.3]\n${modelText}\n` +
                            `[Recorte R]\n${colorText}`
                        );
                    }

                } finally {
                    if (pageCanvas) {
                        pageCanvas.width = 0;
                        pageCanvas.height = 0;
                    }
                    page.cleanup();
                }
            }

            const croppedText = recognizedPages.join("\n\n").trim();

            if (!croppedText) return fallbackText;

            // Mantém cada OCR integral dentro da respetiva página.
            // Assim, a extração A/B continua limitada à página 1 e D.1/D.3/R à página 2.
            const fallbackPage1 = String(fallbackText || "").match(
                /\[Página\s+1\]([\s\S]*?)(?=\[Página\s+2\]|$)/i
            )?.[1]?.trim() || "";

            const fallbackPage2 = String(fallbackText || "").match(
                /\[Página\s+2\]([\s\S]*)$/i
            )?.[1]?.trim() || "";

            return [
                `${recognizedPages[0] || "[Página 1]"}\n[OCR integral página 1]\n${fallbackPage1}`,
                `${recognizedPages[1] || "[Página 2]"}\n[OCR integral página 2]\n${fallbackPage2}`
            ].join("\n\n").trim();

        } finally {
            if (worker && typeof worker.terminate === "function") {
                try {
                    await worker.terminate();
                } catch (error) {
                    console.warn(
                        "[Cartrack DUA OCR] Não foi possível encerrar o worker dos recortes:",
                        error
                    );
                }
            }

            if (loadingTask && typeof loadingTask.destroy === "function") {
                await loadingTask.destroy();
            }
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

            let ocrSource = file;
            let imageBitmap = null;
            let imageCanvas = null;

            try {
                if (typeof createImageBitmap === "function") {
                    imageBitmap = await createImageBitmap(file);
                    imageCanvas = createOcrCanvas(
                        imageBitmap.width,
                        imageBitmap.height,
                        3200
                    );
                    const imageContext = imageCanvas.getContext("2d", {
                        willReadFrequently: true
                    });
                    imageContext.drawImage(
                        imageBitmap,
                        0, 0,
                        imageCanvas.width,
                        imageCanvas.height
                    );
                    preprocessCanvas(imageCanvas);
                    ocrSource = imageCanvas;
                }
            } catch (imageError) {
                console.warn(
                    "[Cartrack OCR] Não foi possível pré-processar a imagem; será usada a imagem original.",
                    imageError
                );
                ocrSource = file;
            }

            const result = await worker.recognize(ocrSource);

            if (imageCanvas) {
                imageCanvas.width = 0;
                imageCanvas.height = 0;
            }
            if (imageBitmap && typeof imageBitmap.close === "function") {
                imageBitmap.close();
            }

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
            return await extractPdf(file);
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

    function classifyDocument(text, fileName = "") {
        const source = `${fileName}\n${text}`.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

        const certificateSignals =
            /certidao permanente|codigo de acesso|registo comercial|conservatoria|\bnipc\b|\bfirma\s*:/i.test(source);

        const duaSignals =
            /documento unico automovel|certificado de matricula|data da primeira matricula|designacao comercial|\bd\.\s*1\b|\bd\.\s*3\b/i.test(source);

        if (certificateSignals) return "certificate";
        if (duaSignals) return "dua";

        // DUA sem título: exige vários indícios dos campos do documento.
        const duaFieldCount = [
            /matricula/i,
            /marca/i,
            /modelo|designacao comercial/i,
            /cor/i,
            /primeira matricula/i
        ].filter(regex => regex.test(source)).length;

        return duaFieldCount >= 3 ? "dua" : "unknown";
    }

    function sendDuaText(text, metadata) {
                console.log(
            "[Cartrack DUA] TEXTO OCR BRUTO:",
            metadata.fileName,
            text
        );
        root.dispatchEvent(
            new CustomEvent("ct:dua-extracted", {
                detail: {
                    ...metadata,
                    text
                }
            })
        );
    }

    async function runExtraction() {
        const button = $("aiExtractDocument");
        const input = $("aiDocumentFile");

        if (!selectedFiles.length || isExtracting) return;

        isExtracting = true;
        if (button) {
            button.disabled = true;
            button.textContent = "A analisar documentos…";
        }
        if (input) input.disabled = true;

        let certificates = 0;
        let duas = 0;
        let unknown = 0;
        const errors = [];

        try {
            for (let index = 0; index < selectedFiles.length; index++) {
                const file = selectedFiles[index];

                setStatus(
                    `A analisar ${index + 1} de ${selectedFiles.length}: ${file.name}`
                );

                try {
                    const result = await extractDocument(file);
                    let text = String(result.text || "").trim();

                    if (!text) {
                        throw new Error("Não foi encontrado texto.");
                    }

                    let kind = classifyDocument(text, file.name);

                    // Só os DUA em PDF passam pela segunda leitura por recortes.
                    // A Certidão Permanente e os restantes documentos mantêm o fluxo original.
                    const isPdf =
                        getExtension(file) === "pdf" ||
                        getFileType(file) === "application/pdf";

                    if (kind === "dua" && isPdf) {
                        try {
                            setStatus(
                                `A melhorar a leitura dos campos do DUA: ${file.name}…`
                            );

                            text = await extractDuaPdfCrops(file, text);
                            kind = "dua";

                        } catch (cropError) {
                            console.warn(
                                "[Cartrack DUA OCR] A leitura por recortes falhou; será utilizado o OCR integral:",
                                cropError
                            );
                        }
                    }

                    const metadata = {
                        fileName: file.name,
                        mimeType: file.type || "",
                        method: result.method,
                        pages: result.pages,
                        totalPages: result.totalPages,
                        kind,
                        extractedAt: new Date().toISOString()
                    };

                    if (kind === "certificate") {
                        sendTextToFieldExtractor(text, metadata);
                        certificates++;
                    } else if (kind === "dua") {
                        sendDuaText(text, metadata);
                        duas++;
                    } else {
                        unknown++;
                        errors.push(`${file.name}: tipo de documento não identificado`);
                    }

                    extractedDocument = metadata;

                } catch (error) {
                    console.error(
                        `[Cartrack Document AI] Erro em ${file.name}:`,
                        error
                    );
                    errors.push(`${file.name}: ${error?.message || "erro de leitura"}`);
                }
            }

            const summary = [
                `${selectedFiles.length} ficheiro(s) analisado(s)`,
                `${certificates} Certidão(ões)`,
                `${duas} DUA`,
                `${unknown} não identificado(s)`
            ].join(" · ");

            setStatus(
                summary + (errors.length ? `\nAtenção: ${errors.join(" | ")}` : "")
            );

        } finally {
            isExtracting = false;
            if (button) {
                button.disabled = !selectedFiles.length;
                button.textContent = "Analisar documentos selecionados";
            }
            if (input) input.disabled = false;
        }
    }

    /* ============================================================
       LIMPAR DOCUMENTO
       ============================================================ */

    function clearDocument() {
        const input = $("aiDocumentFile");
        const button = $("aiExtractDocument");

        selectedFiles = [];
        extractedDocument = null;

        if (input) input.value = "";
        if (button) button.disabled = true;
        const selected = $("aiSelectedFiles");
        if (selected) selected.textContent = "";

        setStatus("Documentos removidos da sessão.");
    }

    function initialize() {
        if (initialized) return;

        const input = $("aiDocumentFile");
        const button = $("aiExtractDocument");

        if (!input) return;

        initialized = true;
        if (button) button.disabled = true;

        input.addEventListener("change", () => {
            const files = Array.from(input.files || []);
            selectedFiles = [];
            extractedDocument = null;

            if (!files.length) {
                if (button) button.disabled = true;
                const selected = $("aiSelectedFiles");
                if (selected) selected.textContent = "";
                setStatus("Seleciona os documentos para começar.");
                return;
            }

            const invalid = files.find(file =>
                file.size === 0 ||
                file.size > MAX_FILE_SIZE ||
                !isSupportedFile(file)
            );

            if (invalid) {
                input.value = "";
                if (button) button.disabled = true;

                const selected = $("aiSelectedFiles");
                if (selected) selected.textContent = "";

                const reason = invalid.size === 0
                    ? "O ficheiro está vazio."
                    : invalid.size > MAX_FILE_SIZE
                        ? "O ficheiro excede o limite de 25 MB."
                        : "Formato não suportado.";

                setStatus(`${invalid.name}: ${reason}`, true);
                return;
            }

            selectedFiles = files;
            if (button) button.disabled = false;

            const selected = $("aiSelectedFiles");
            if (selected) {
                const names = files.map(file => file.name).join(" · ");
                selected.textContent = `${files.length} ficheiro(s): ${names}`;
            }

            setStatus(`${files.length} ficheiro(s) selecionado(s). A análise vai começar automaticamente…`);
            runExtraction();
        });

        if (button) button.addEventListener("click", runExtraction);

        root.CTDocumentAI = {
            getExtractedDocument: () =>
                extractedDocument ? { ...extractedDocument } : null,

            recognizeImageText,
            processFiles: files => Promise.all(
                Array.from(files || []).map(extractDocument)
            ),
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
