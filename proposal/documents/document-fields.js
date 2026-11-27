
/* ============================================================
   CARTRACK — EXTRAÇÃO E PREENCHIMENTO DOS DADOS DO CLIENTE

   Etapa 2:
   - Analisa o texto extraído por document-ai.js.
   - Identifica os dados relevantes da Certidão Permanente.
   - Preenche diretamente os inputs existentes do contrato.
   - Permite validar e corrigir os dados nos próprios inputs.

   ORIGEM DOS DADOS:

   Certidão Permanente:
   - Nome da empresa
   - NIF / NIPC
   - Gerente
   - Morada
   - Código postal
   - Localidade
   - Freguesia
   - Concelho
   - Distrito
   - País

   CRM:
   - Telefone
   - Email

   Não utiliza serviços externos.
   ============================================================ */

(function (root) {
    "use strict";

    const $ = id => document.getElementById(id);

    /* ------------------------------------------------------------
       CONFIGURAÇÃO DOS CAMPOS

       contractContact corresponde ao gerente.
       Telefone e email não são preenchidos por este módulo.
       ------------------------------------------------------------ */

    const FIELD_DEFS = [
        {
            key: "company",
            id: "contractCompany",
            label: "Nome da empresa"
        },
        {
            key: "nif",
            id: "contractNif",
            label: "NIF / NIPC"
        },
        {
            key: "manager",
            id: "contractContact",
            label: "Gerente"
        },
        {
            key: "street",
            id: "contractStreet",
            label: "Morada"
        },
        {
            key: "postalCode",
            id: "contractPostalCode",
            label: "Código postal"
        },
        {
            key: "locality",
            id: "contractLocality",
            label: "Localidade"
        }
    ];

    let currentCandidates = {};

    /* ------------------------------------------------------------
       NORMALIZAÇÃO DO TEXTO
       ------------------------------------------------------------ */

    function normalizeText(text) {
        return String(text || "")
            .replace(/\u0000/g, "")
            .replace(/\r\n?/g, "\n")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+/g, " ")
            .trim();
    }

    function normalizeLines(text) {
        return normalizeText(text)
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);
    }

    function cleanText(value) {
        return String(value || "")
            .replace(/^\s*[:：\-–|]+\s*/, "")
            .replace(/\s+/g, " ")
            .replace(/[;,|]+\s*$/, "")
            .trim();
    }

    function normalizeLabel(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /* ------------------------------------------------------------
       PROCURAR VALORES ASSOCIADOS A ETIQUETAS

       Exemplo:
       Firma: EMPRESA LDA
       NIPC: 519049004

       Também suporta valores na linha seguinte.
       ------------------------------------------------------------ */

    function findLabelValue(lines, labels, options = {}) {
        const normalizedLabels = labels.map(normalizeLabel);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const match = line.match(
                /^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/
            );

            if (!match) continue;

            const label = normalizeLabel(match[1]);

            if (!normalizedLabels.includes(label)) {
                continue;
            }

            let value = cleanText(match[2]);

            if (!value && options.nextLine !== false) {
                const nextLine = lines[i + 1];

                if (nextLine && !/^[^:：]{1,50}\s*[:：]/.test(nextLine)) {
                    value = cleanText(nextLine);
                }
            }

            if (value) {
                return {
                    value,
                    evidence: line
                };
            }
        }

        return null;
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DA FIRMA / NOME DA EMPRESA
       ------------------------------------------------------------ */

    function extractCompany(lines) {
        const found = findLabelValue(
            lines,
            ["Firma", "Denominação social"]
        );

        if (!found) return null;

        return {
            value: found.value,
            evidence: found.evidence
        };
    }

    /* ------------------------------------------------------------
       VALIDAÇÃO DO NIF PORTUGUÊS
       ------------------------------------------------------------ */

    function isValidPortugueseNif(value) {
        const nif = String(value || "").replace(/\D/g, "");

        if (!/^\d{9}$/.test(nif)) return false;

        const digits = [...nif].map(Number);

        const sum = digits
            .slice(0, 8)
            .reduce(
                (total, digit, index) =>
                    total + digit * (9 - index),
                0
            );

        const remainder = sum % 11;

        const checkDigit =
            remainder < 2 ? 0 : 11 - remainder;

        return digits[8] === checkDigit;
    }

    function extractNif(lines) {
        const found = findLabelValue(
            lines,
            ["NIPC", "NIF", "Número de identificação fiscal"]
        );

        if (!found) return null;

        const match = found.value.match(/\b\d{9}\b/);

        if (!match || !isValidPortugueseNif(match[0])) {
            return null;
        }

        return {
            value: match[0],
            evidence: found.evidence
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DO GERENTE

       Prioridade:
       1. Secção GERÊNCIA.
       2. Nome indicado nessa secção.
       3. Estruturas de órgãos sociais / órgãos designados.

       Não utiliza nomes encontrados aleatoriamente no documento.
       ------------------------------------------------------------ */

    function extractManager(lines) {
        const normalized = lines.map(line => cleanText(line));
        const sectionStart = /^(?:ger[eê]ncia|[óo]rg[aã]os\s+sociais|[óo]rg[aã]o\(s\)\s+designado\(s\))\s*[:：]?\s*(.*)$/i;

        for (let i = 0; i < normalized.length; i++) {
            const sectionMatch = normalized[i].match(sectionStart);
            if (!sectionMatch) continue;

            const sameLine = sectionMatch[1] || "";
            const sameLineName = sameLine.match(
                /(?:Nome(?:\s*\/\s*Firma)?\s*[:：]\s*)(.+?)(?=\s+NIF\/NIPC\s*:|$)/i
            );
            if (sameLineName && isPlausiblePersonName(sameLineName[1])) {
                return { value: cleanText(sameLineName[1]), evidence: normalized[i] };
            }

            for (let j = i + 1; j < Math.min(i + 16, normalized.length); j++) {
                const line = normalized[j];
                if (/^(capital|forma de obrigar|objeto|objecto|sede|matr[ií]cula|inscri[cç][aã]o|firma|s[oó]cios e quotas)\s*[:：]?$/i.test(line)) break;
                const nameMatch = line.match(/^\s*Nome(?:\s*\/\s*Firma)?\s*[:：]\s*(.+?)\s*$/i);
                if (nameMatch && isPlausiblePersonName(nameMatch[1])) {
                    return { value: cleanText(nameMatch[1]), evidence: line };
                }
            }
        }

        // Fallback limitado ao bloco GERÊNCIA; não recolhe nomes aleatórios.
        const fullText = normalized.join("\n");
        const block = fullText.match(/GER[ÊE]NCIA\s*[:：]?\s*([\s\S]{0,500})/i);
        if (block) {
            const match = block[1].match(/Nome(?:\s*\/\s*Firma)?\s*[:：]\s*([^\r\n]+?)(?=\s+NIF\/NIPC\s*:|$)/i);
            if (match && isPlausiblePersonName(match[1])) {
                return { value: cleanText(match[1]), evidence: match[0] };
            }
        }
        return null;
    }
    function isPlausiblePersonName(value) {
        const name = cleanText(value);

        if (!name || name.length < 5 || name.length > 120) {
            return false;
        }

        if (/\d/.test(name)) return false;

        if (
            /\b(LDA|UNIPESSOAL|LIMITADA|SA|S\.A\.|SOCIEDADE|GERÊNCIA|GERENCIA)\b/i.test(name)
        ) {
            return false;
        }

        return name.split(/\s+/).length >= 2;
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DA MORADA DA SEDE

       Procura a etiqueta Sede: e recolhe a morada até encontrar
       os campos administrativos seguintes.
       ------------------------------------------------------------ */

    function extractStreet(lines) {
        const found = findLabelValue(
            lines,
            ["Sede", "Morada da sede"]
        );

        if (!found) return null;

        let value = found.value;

        // Remover dados administrativos caso apareçam na mesma linha.
        value = value
            .replace(/\s+(Distrito|Concelho|Freguesia|Código Postal)\s*[:：].*$/i, "")
            .trim();

        if (!value || value.length < 5) {
            return null;
        }

        return {
            value,
            evidence: found.evidence
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DO CÓDIGO POSTAL

       Aceita:
       4730-581
       4730 - 581 Soutelo
       4730 581 Soutelo
       ------------------------------------------------------------ */

    function extractPostalCode(lines) {
        const found = findLabelValue(
            lines,
            ["Código Postal", "Codigo Postal", "CP"]
        );

        const sources = found
            ? [found.value]
            : lines;

        for (const source of sources) {
            const match = source.match(
                /\b(\d{4})\s*[- ]\s*(\d{3})\b/
            );

            if (match) {
                return {
                    value: `${match[1]}-${match[2]}`,
                    evidence: found?.evidence || source
                };
            }
        }

        // Algumas certidões apresentam o código postal sem etiqueta.
        for (const line of lines) {
            const match = line.match(
                /\b(\d{4})\s*[- ]\s*(\d{3})\b/
            );

            if (match) {
                return {
                    value: `${match[1]}-${match[2]}`,
                    evidence: line
                };
            }
        }

        return null;
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DOS CAMPOS ADMINISTRATIVOS
       ------------------------------------------------------------ */

    function extractAdministrativeField(lines, labels) {
        const found = findLabelValue(lines, labels);

        if (!found) return null;

        return {
            value: found.value,
            evidence: found.evidence
        };
    }

    /* ------------------------------------------------------------
       LOCALIDADE

       Prioridade:
       1. Texto após o código postal.
       2. Etiqueta Localidade.
       3. Etiqueta Local.
       ------------------------------------------------------------ */

    function extractLocality(lines) {
        for (const line of lines) {
            const match = line.match(
                /\b\d{4}\s*[- ]\s*\d{3}\s+(.+?)\s*$/
            );

            if (match) {
                const locality = cleanText(match[1]);

                if (
                    locality &&
                    !/^(concelho|freguesia|distrito)\b/i.test(locality)
                ) {
                    return {
                        value: locality,
                        evidence: line
                    };
                }
            }
        }

        return extractAdministrativeField(
            lines,
            ["Localidade", "Local"]
        );
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO COMPLETA DA CERTIDÃO
       ------------------------------------------------------------ */

    function analyzeCertificate(documentData) {
        const lines = normalizeLines(documentData?.text);

        if (!lines.length) {
            throw new Error(
                "Não existe texto extraído para analisar."
            );
        }

        const candidates = {
            company: extractCompany(lines),
            nif: extractNif(lines),
            manager: extractManager(lines),
            street: extractStreet(lines),
            postalCode: extractPostalCode(lines),
            locality: extractLocality(lines),

            parish: extractAdministrativeField(
                lines,
                ["Freguesia"]
            ),

            municipality: extractAdministrativeField(
                lines,
                ["Concelho", "Município", "Municipio"]
            ),

            district: extractAdministrativeField(
                lines,
                ["Distrito"]
            ),

            country: {
                value: "Portugal",
                evidence: "País definido pelo tipo de certidão e morada portuguesa."
            }
        };

        // Remover campos não identificados.
        Object.keys(candidates).forEach(key => {
            if (!candidates[key]?.value) {
                delete candidates[key];
            }
        });

        return candidates;
    }

    /* ------------------------------------------------------------
       PREENCHIMENTO DOS INPUTS EXISTENTES
       ------------------------------------------------------------ */

    function dispatchFieldEvents(element) {
        element.dispatchEvent(
            new Event("input", { bubbles: true })
        );

        element.dispatchEvent(
            new Event("change", { bubbles: true })
        );
    }

    async function applyToContract(candidates) {
        let applied = 0;
        const missingInputs = [];

        FIELD_DEFS.forEach(field => {
            const candidate = candidates[field.key];

            if (!candidate?.value) {
                return;
            }

            const target = $(field.id);

            if (!target) {
                missingInputs.push(field.id);

                console.warn(
                    `[Cartrack Document AI] Input não encontrado: ${field.id}`
                );

                return;
            }

            // Preencher diretamente o input existente.
            target.value = cleanText(candidate.value);

            dispatchFieldEvents(target);

            applied++;
        });

        // Preservar a rotina de gravação existente.
        if (typeof root.saveContractData === "function") {
            await root.saveContractData();
        }

        return {
            applied,
            missingInputs
        };
    }

    /* ------------------------------------------------------------
       RECEBER DOCUMENTO EXTRAÍDO
       ------------------------------------------------------------ */

    async function handleDocumentExtracted(event) {
        const detail = event.detail || {};

        if (!detail.text) {
            return;
        }

        try {
            currentCandidates = analyzeCertificate(detail);

            const result = await applyToContract(
                currentCandidates
            );

            console.log(
                "[Cartrack Document AI] Dados identificados:",
                currentCandidates
            );

            console.log(
                "[Cartrack Document AI] Resultado do preenchimento:",
                result
            );

            const status = $("aiDocumentStatus");

            if (status) {
                if (result.applied > 0) {
                    status.textContent =
                        `Certidão analisada: ${result.applied} campo(s) preenchido(s). ` +
                        "Revê e valida os dados diretamente nos campos do contrato.";

                    status.dataset.state = "success";
                } else {
                    status.textContent =
                        "A certidão foi lida, mas não foram identificados dados suficientes para preencher o contrato.";

                    status.dataset.state = "error";
                }
            }

        } catch (error) {
            console.error(
                "[Cartrack Document Fields] Erro:",
                error
            );

            const status = $("aiDocumentStatus");

            if (status) {
                status.textContent =
                    "O documento foi lido, mas ocorreu um erro ao preencher os campos.";

                status.dataset.state = "error";
            }
        }
    }

    /* ------------------------------------------------------------
       INICIALIZAÇÃO
       ------------------------------------------------------------ */

    function initialize() {
        root.addEventListener(
            "ct:document-extracted",
            handleDocumentExtracted
        );
    }

    /* ------------------------------------------------------------
       API PÚBLICA
       ------------------------------------------------------------ */

    root.CTDocumentFields = {
        analyze: analyzeCertificate,

        getCandidates: () => ({
            ...currentCandidates
        }),

        applyToContract: () =>
            applyToContract(currentCandidates),

        clear: () => {
            currentCandidates = {};
        }
    };

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
