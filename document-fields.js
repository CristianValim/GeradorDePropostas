
/* ============================================================
   CARTRACK — EXTRAÇÃO E REVISÃO DE DADOS DO CLIENTE

   Etapa 2:
   - Analisa o texto extraído por document-ai.js
   - Identifica dados através de etiquetas e padrões locais
   - Apresenta evidências para revisão
   - Só preenche o contrato após confirmação

   Não utiliza serviços externos.
   ============================================================ */

(function (root) {
    "use strict";

    const $ = id => document.getElementById(id);

    const FIELD_DEFS = [
        {
            key: "company",
            id: "contractCompany",
            label: "Nome da empresa",
            aliases: [
                "denominação social",
                "nome da empresa",
                "firma",
                "empresa",
                "entidade"
            ]
        },
        {
            key: "nif",
            id: "contractNif",
            label: "NIF",
            aliases: [
                "nif",
                "n.i.f.",
                "número de contribuinte",
                "contribuinte",
                "NIPC",
                "nipc"
            ]
        },
        {
            key: "contact",
            id: "contractContact",
            label: "Gerente",
            aliases: [
                "gerente",
                "pessoa de contacto",
                "pessoa de contato",
                "responsável",
                "a/c",
                "a/c contacto",
                "contacto comercial",
                "nome",
                "representante"
            ]
        },
        {
            key: "phone",
            id: "contractPhone",
            label: "Telefone",
            aliases: [
                "telefone",
                "tel.",
                "tel",
                "telemóvel",
                "telemovel",
                "tlm",
                "contacto telefónico",
                "contato telefônico",
                "phone",
                "mobile"
            ]
        },
        {
            key: "email",
            id: "contractEmail",
            label: "E-mail",
            aliases: [
                "email",
                "e-mail",
                "correio eletrónico",
                "correio eletronico"
            ]
        },
        {
            key: "street",
            id: "contractStreet",
            label: "Morada / Rua",
            aliases: [
                "morada",
                "endereço",
                "endereco",
                "sede",
                "morada da sede",
                "rua",
                "avenida"
            ]
        },
        {
            key: "postalCode",
            id: "contractPostalCode",
            label: "Código postal",
            aliases: [
                "código postal",
                "codigo postal",
                "cp",
                "postal code"
            ]
        },
        {
            key: "locality",
            id: "contractLocality",
            label: "Localidade",
            aliases: [
                "localidade",
                "local",
                "cidade"
            ]
        },
        {
            key: "parish",
            id: "contractParish",
            label: "Freguesia",
            aliases: ["freguesia"]
        },
        {
            key: "municipality",
            id: "contractMunicipality",
            label: "Concelho",
            aliases: [
                "concelho",
                "município",
                "municipio"
            ]
        },
        {
            key: "district",
            id: "contractDistrict",
            label: "Distrito",
            aliases: ["distrito"]
        },
        {
            key: "country",
            id: "contractCountry",
            label: "País",
            aliases: [
                "país",
                "pais",
                "country"
            ]
        }
    ];

    let currentCandidates = [];

    /* ------------------------------------------------------------
       NORMALIZAÇÃO
       ------------------------------------------------------------ */

    function normalizeLines(text) {
        return String(text || "")
            .replace(/\r/g, "")
            .replace(/[\u00a0\t]+/g, " ")
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function cleanValue(value) {
        return String(value || "")
            .replace(/^\s*[:：\-–|]+\s*/, "")
            .replace(/\s+/g, " ")
            .replace(/[;,|]+\s*$/, "")
            .trim();
    }

    function isProbablyLabel(value) {
        const text = String(value || "").trim();

        if (!text) return true;
        if (text.length > 100) return false;

        return /^(nif|n\.i\.f\.|telefone|tel\.?|email|e-mail|morada|endereço|endereco|código postal|codigo postal|localidade|freguesia|concelho|município|municipio|distrito|país|pais|empresa|firma|contacto|contato)\s*[:：]?$/i.test(text);
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO POR ETIQUETAS
       Exemplo: NIF: 123456789
       ------------------------------------------------------------ */

    function findLabelledValue(lines, aliases) {
        const aliasPattern = aliases
            .map(escapeRegExp)
            .sort((a, b) => b.length - a.length)
            .join("|");

        const expression = new RegExp(
            "^\\s*(?:" + aliasPattern + ")\\s*(?:[:：\\-–|])?\\s*(.*?)\\s*$",
            "i"
        );

        for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(expression);

            if (!match) continue;

            let value = cleanValue(match[1]);
            let evidence = lines[index];

            // Alguns documentos colocam o valor na linha seguinte.
            if (
                !value &&
                lines[index + 1] &&
                !isProbablyLabel(lines[index + 1])
            ) {
                value = cleanValue(lines[index + 1]);
                evidence += " | " + lines[index + 1];
            }

            if (value) {
                return { value, evidence };
            }
        }

        return null;
    }

    function findLineContaining(lines, value) {
        const normalized = String(value || "").toLowerCase();

        return lines.find(line =>
            line.toLowerCase().includes(normalized)
        ) || value;
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
        const field = FIELD_DEFS.find(
            item => item.key === "nif"
        );

        const labelled = findLabelledValue(
            lines,
            field.aliases
        );

        if (labelled) {
            const match = labelled.value.match(/\b\d{9}\b/);

            if (
                match &&
                isValidPortugueseNif(match[0])
            ) {
                return {
                    value: match[0],
                    evidence: labelled.evidence,
                    confidence: "Elevada"
                };
            }
        }

        for (const line of lines) {
            const match = line.match(/\b\d{9}\b/);

            if (
                match &&
                isValidPortugueseNif(match[0]) &&
                /nif|contribuinte/i.test(line)
            ) {
                return {
                    value: match[0],
                    evidence: line,
                    confidence: "Elevada"
                };
            }
        }

        return null;
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DE E-MAIL
       ------------------------------------------------------------ */

    function extractEmail(lines) {
        const text = lines.join("\n");

        const match = text.match(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
        );

        if (!match) return null;

        return {
            value: match[0],
            evidence: findLineContaining(lines, match[0]),
            confidence: "Elevada"
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DE CÓDIGO POSTAL
       ------------------------------------------------------------ */

    function extractPostalCode(lines) {
        const field = FIELD_DEFS.find(
            item => item.key === "postalCode"
        );

        const labelled = findLabelledValue(
            lines,
            field.aliases
        );

        if (labelled) {
            const match = labelled.value.match(
                /\b\d{4}-\d{3}\b/
            );

            if (match) {
                return {
                    value: match[0],
                    evidence: labelled.evidence,
                    confidence: "Elevada"
                };
            }
        }

        for (const line of lines) {
            const match = line.match(/\b\d{4}-\d{3}\b/);

            if (match) {
                return {
                    value: match[0],
                    evidence: line,
                    confidence: "Média"
                };
            }
        }

        return null;
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DE TELEFONE
       Só aceita números associados a uma etiqueta telefónica.
       ------------------------------------------------------------ */

    function extractPhone(lines) {
        const field = FIELD_DEFS.find(
            item => item.key === "phone"
        );

        const labelled = findLabelledValue(
            lines,
            field.aliases
        );

        if (!labelled) return null;

        const match = labelled.value.match(
            /(?:\+351\s*)?(?:\d[\s.-]*){9,12}/
        );

        if (!match) return null;

        const value = match[0]
            .replace(/[\s.-]/g, "")
            .replace(/^00351/, "+351");

        return {
            value,
            evidence: labelled.evidence,
            confidence: "Elevada"
        };
    }

    /* ------------------------------------------------------------
       EXTRAÇÃO DOS RESTANTES CAMPOS
       ------------------------------------------------------------ */

    function candidateFromLabel(lines, field, confidence = "Média") {
        const found = findLabelledValue(
            lines,
            field.aliases
        );

        if (!found) return null;

        return {
            value: found.value,
            evidence: found.evidence,
            confidence
        };
    }

    /* ------------------------------------------------------------
       ANÁLISE DO DOCUMENTO
       ------------------------------------------------------------ */

    function analyzeDocument(documentData) {
        const lines = normalizeLines(documentData?.text);

        if (!lines.length) {
            throw new Error(
                "Não existe texto extraído para analisar."
            );
        }

        const extractors = {
            company: () =>
                candidateFromLabel(lines, FIELD_DEFS[0]),

            nif: () =>
                extractNif(lines),

            contact: () =>
                candidateFromLabel(lines, FIELD_DEFS[2]),

            phone: () =>
                extractPhone(lines),

            email: () =>
                extractEmail(lines),

            street: () =>
                candidateFromLabel(lines, FIELD_DEFS[5]),

            postalCode: () =>
                extractPostalCode(lines),

            locality: () =>
                candidateFromLabel(lines, FIELD_DEFS[7]),

            parish: () =>
                candidateFromLabel(lines, FIELD_DEFS[8]),

            municipality: () =>
                candidateFromLabel(lines, FIELD_DEFS[9]),

            district: () =>
                candidateFromLabel(lines, FIELD_DEFS[10]),

            country: () =>
                candidateFromLabel(lines, FIELD_DEFS[11])
        };

        return FIELD_DEFS
            .map(field => {
                const candidate = extractors[field.key]();

                if (!candidate?.value) return null;

                return {
                    ...field,
                    ...candidate,
                    value: String(candidate.value).trim()
                };
            })
            .filter(Boolean);
    }

    /* ------------------------------------------------------------
       CONSTRUÇÃO DA INTERFACE DE REVISÃO
       ------------------------------------------------------------ */

    function createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
    }

    function renderCandidates(candidates) {
        const panel = $("aiFieldReviewPanel");
        const container = $("aiFieldReview");
        const applyButton = $("aiApplyFields");
        const status = $("aiFieldReviewStatus");

        if (!panel || !container || !applyButton) return;

        currentCandidates = candidates;

        container.replaceChildren();
        panel.hidden = false;

        applyButton.disabled = candidates.length === 0;

        if (!candidates.length) {
            container.appendChild(
                createElement(
                    "p",
                    "small",
                    "Não foram identificados campos com etiquetas suficientemente claras. Podes preencher o contrato manualmente."
                )
            );

            if (status) {
                status.textContent =
                    "Sem dados identificados automaticamente.";
            }

            return;
        }

        candidates.forEach(candidate => {
            const row = createElement("div", "ai-field-row");
            const heading = createElement("div", "ai-field-heading");

            const label = createElement(
                "label",
                "ai-field-label",
                candidate.label
            );

            const confidence = createElement(
                "span",
                "ai-field-confidence",
                "Correspondência " + candidate.confidence
            );

            const checkboxLabel = createElement(
                "label",
                "ai-field-apply-label"
            );

            const checkbox = document.createElement("input");

            checkbox.type = "checkbox";
            checkbox.className = "ai-field-apply";
            checkbox.dataset.fieldId = candidate.id;

            const target = $(candidate.id);

            // Não substituir automaticamente dados já preenchidos.
            checkbox.checked = !target || !target.value.trim();

            checkboxLabel.append(
                checkbox,
                document.createTextNode(" Aplicar")
            );

            const input = document.createElement("input");

            input.type = "text";
            input.className = "ai-field-value";
            input.value = candidate.value;
            input.dataset.fieldId = candidate.id;
            input.autocomplete = "off";

            const evidence = createElement(
                "p",
                "ai-field-evidence",
                "Origem: " + candidate.evidence
            );

            heading.append(
                label,
                confidence,
                checkboxLabel
            );

            row.append(
                heading,
                input,
                evidence
            );

            container.appendChild(row);
        });

        if (status) {
            status.textContent =
                `${candidates.length} campo(s) identificado(s). ` +
                "Confirma os valores e seleciona os que pretendes aplicar.";
        }
    }

    /* ------------------------------------------------------------
       APLICAR AO FORMULÁRIO DO CONTRATO
       ------------------------------------------------------------ */

    async function applyCandidates() {
        const container = $("aiFieldReview");
        const status = $("aiFieldReviewStatus");
        const applyButton = $("aiApplyFields");

        if (!container) return;

        const inputs = [
            ...container.querySelectorAll(".ai-field-value")
        ];

        let applied = 0;

        inputs.forEach(input => {
            const id = input.dataset.fieldId;

            const checkbox = container.querySelector(
                `.ai-field-apply[data-field-id="${CSS.escape(id)}"]`
            );

            const target = $(id);
            const value = input.value.trim();

            if (!checkbox?.checked || !target || !value) {
                return;
            }

            target.value = value;

            target.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            target.dispatchEvent(
                new Event("change", { bubbles: true })
            );

            applied += 1;
        });

        // Guarda também através da função já existente no projeto.
        if (typeof root.saveContractData === "function") {
            await root.saveContractData();
        }

        if (status) {
            status.textContent = applied
                ? `${applied} campo(s) aplicado(s) ao contrato. Confirma os dados antes de gerar o PDF.`
                : "Não foi selecionado nenhum campo para aplicar.";
        }

        const contractStatus = $("contractStatus");

        if (contractStatus && applied) {
            contractStatus.textContent =
                `${applied} campo(s) importado(s) do documento. ` +
                "Revê os dados antes de gerar o contrato.";
        }

        if (applyButton) {
            applyButton.textContent =
                "Atualizar dados do contrato";
        }
    }

    /* ------------------------------------------------------------
       INICIALIZAÇÃO E EVENTOS
       ------------------------------------------------------------ */

    function initialize() {
        const applyButton = $("aiApplyFields");

        if (applyButton) {
            applyButton.addEventListener(
                "click",
                applyCandidates
            );
        }

        root.addEventListener(
            "ct:document-extracted",
            event => {
                try {
                    const candidates = analyzeDocument(event.detail);
                    renderCandidates(candidates);

                } catch (error) {
                    console.error(
                        "[Cartrack Document Fields]",
                        error
                    );

                    const status = $("aiFieldReviewStatus");

                    if (status) {
                        status.textContent = error.message;
                    }
                }
            }
        );
    }

    // API pública para futuras integrações.
    root.CTDocumentFields = {
        analyze: analyzeDocument,

        getCandidates: () =>
            currentCandidates.map(item => ({ ...item }))
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
