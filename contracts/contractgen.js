// ======================================================
// CARTRACK PROPOSAL GENERATOR
// Geração de contratos: preenche os campos do PDF editável
//
// Depende de:
//   - PDFLib      (lib/pdf-lib.min.js)
//   - CTContracts (contracts.js)
// ======================================================

(function (root) {
    "use strict";

    // ==================================================
    // AUXILIARES
    // ==================================================

    // Devolve a lista normalizada de campos PDF de um campo do formulário.
    const pdfNames = field =>
        [].concat(field.pdf || []).filter(Boolean);

    // Valor por omissão de um campo do esquema.
    function defaultValue(field, ctx) {
        if (field.default === "today") return ctx.today();

        if (field.default !== undefined) return field.default;

        if (field.fromProfile) {
            const v = ctx.userProfile?.[field.fromProfile] || "";

            // O PDF original usa o nome do gestor em maiúsculas.
            return field.fromProfile === "name" ? v.toLocaleUpperCase("pt-PT") : v;
        }

        return "";
    }

    // Remove caracteres que a fonte Helvetica (WinAnsi) não consegue escrever.
    function sanitize(font, text, multiline) {
        const allowed = font.getCharacterSet();

        return [...String(text ?? "").replace(/\r/g, "").replace(/\t/g, " ")]
            .map(ch => {
                if (ch === "\n") return multiline ? "\n" : " ";

                return allowed.includes(ch.codePointAt(0)) ? ch : "?";
            })
            .join("");
    }

    // Escolhe o maior tamanho de letra (até max) que cabe na largura do campo.
    function fitSize(font, text, width, max, min) {
        let size = max;

        while (size > min && font.widthOfTextAtSize(text, size) > width - 4) {
            size -= 0.5;
        }

        return size;
    }


    // ==================================================
    // PREENCHIMENTO
    // ==================================================

    // Devolve os bytes do PDF preenchido.
    //   def    — contrato do registo (CTContracts.REGISTRY[...])
    //   values — valores do formulário (inclui values.vehicles)
    //   bytes  — ArrayBuffer do PDF original
    //   ctx    — { userProfile, today }
    async function fill(def, values, bytes, ctx) {
        const { PDFDocument, StandardFonts } = root.PDFLib;

        const pdf = await PDFDocument.load(bytes);
        const form = pdf.getForm();
        const font = await pdf.embedFont(StandardFonts.Helvetica);

        // Nomes realmente existentes no PDF, para detetar mapeamentos errados.
        const existing = new Set(form.getFields().map(f => f.getName()));

        const need = name => {
            if (!existing.has(name)) {
                throw new Error("Campo inexistente no PDF: " + name);
            }
        };

        // Escreve texto num campo, ajustando o tamanho da letra.
        function setText(name, raw, { multiline = false, size = 9 } = {}) {
            need(name);

            const tf = form.getTextField(name);

            let text = sanitize(font, raw, multiline);

            const max = tf.getMaxLength();

            if (max && text.length > max) text = text.slice(0, max);

            if (multiline) {
                tf.enableMultiline();
                tf.setFontSize(size);
            } else {
                const rect = tf.acroField.getWidgets()[0].getRectangle();

                tf.setFontSize(fitSize(font, text, rect.width, size, 5));
            }

            tf.setText(text);
        }

        // Marca ou desmarca uma checkbox.
        function setCheck(name, on) {
            need(name);

            const cb = form.getCheckBox(name);

            if (on) cb.check(); else cb.uncheck();
        }

        // ---------- Campos do formulário ----------
        def.sections.forEach(section => {
            section.fields.forEach(field => {
                let v = values[field.key];

                if (v === undefined || v === null) {
                    v = defaultValue(field, ctx);
                }

                // Escolha exclusiva: marca uma checkbox e desmarca as outras.
                if (field.type === "choice") {
                    field.options.forEach(opt => {
                        setCheck(opt.pdf, String(v) === opt.value);
                    });

                    return;
                }

                let text = String(v);

                // Valores monetários: o PDF já usa o símbolo € à esquerda.
                if (field.format === "money") {
                    const n = root.CTContracts.fmtMoney(text);

                    text = n ? "€ " + n : "€";
                }

                pdfNames(field).forEach(name => {
                    setText(name, text, {
                        multiline: field.type === "textarea",
                        size: 9
                    });
                });
            });
        });

        // ---------- Veículos ----------
        if (def.vehicles) {
            const cfg = def.vehicles;
            const list = (values.vehicles || []).slice(0, cfg.max);

            setCheck(cfg.attachedFlag.pdf, !!values[cfg.attachedFlag.key]);

            list.forEach((veh, i) => {
                const row = cfg.rows[i];

                setText(row.plate, veh.plate || "", { size: 8 });
                setText(row.brand, veh.brand || "", { size: 8 });
                setText(row.model, veh.model || "", { size: 8 });
                setText(row.year, veh.year || "", { size: 8 });
                setText(row.color, veh.color || "", { size: 8 });

                cfg.categories.forEach(c => {
                    setCheck(row[c.value], veh.category === c.value);
                });

                cfg.cutoffs.forEach(c => {
                    setCheck(row[c.value], veh.cutoff === c.value);
                });

                setCheck(row.can, !!veh.can);
                setCheck(row.did, !!veh.did);
            });
        }

        // Gera as aparências dos campos para o PDF abrir igual em qualquer leitor.
        form.updateFieldAppearances(font);

        return pdf.save();
    }

    // Verifica obrigatórios; devolve a lista de nomes em falta.
    function missingRequired(def, values) {
        return (def.required || [])
            .filter(([key]) => !String(values[key] ?? "").trim())
            .map(([, label]) => label);
    }

    root.CTContractGen = {
        fill,
        missingRequired,
        defaultValue
    };

})(self);