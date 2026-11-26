// ======================================================
// CARTRACK PROPOSAL GENERATOR
// Preenchimento dos modelos Word (.docx)
// Ficheiro partilhado pelo painel e pela pré-visualização
// ======================================================

(function (root) {
    "use strict";

    // Referência às funções e configurações gerais da extensão.
    const CT = root.CT;

    // Namespaces utilizados na estrutura XML do Word.
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
    const XML_NS = "http://www.w3.org/XML/1998/namespace";

    // Tamanhos de letra utilizados nos documentos Word.
    const COVER_SIZE = "28"; // 14 pt (capa)
    const TABLE_SIZE = "20"; // 10 pt (tabelas)


    // ==================================================
    // FUNÇÕES AUXILIARES DE XML
    // ==================================================

    // Obtém os elementos filhos diretos pertencentes ao namespace do Word.
    const kids = (el, name) =>
        [...el.children].filter(x =>
            x.namespaceURI === W && (!name || x.localName === name)
        );

    // Verifica se um elemento está dentro de uma caixa de texto do Word.
    const isTxbx = n => {
        while (n) {
            if (n.localName === "txbxContent") return true;
            n = n.parentNode;
        }

        return false;
    };

    // Extrai o texto de um elemento, ignorando caixas de texto.
    function textOf(el) {
        return [...el.getElementsByTagNameNS(W, "t")]
            .filter(t => !isTxbx(t))
            .map(t => t.textContent)
            .join("");
    }

    // Elementos que devem aparecer depois das propriedades de tamanho.
    const RPR_AFTER_SZ = [
        "highlight", "u", "effect", "bdr", "shd", "fitText",
        "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout",
        "specVanish", "oMath"
    ];

    // Garante que um elemento run tenha uma estrutura de propriedades rPr.
    function ensureRPr(doc, run) {
        let rPr = kids(run, "rPr")[0];

        if (!rPr) {
            rPr = doc.createElementNS(W, "w:rPr");
            run.insertBefore(rPr, run.firstChild);
        }

        return rPr;
    }

    // Define o tamanho da letra para texto normal e complexo.
    function setSize(doc, rPr, size) {
        let prev = null;

        ["sz", "szCs"].forEach(n => {
            let e = kids(rPr, n)[0];

            if (!e) {
                e = doc.createElementNS(W, "w:" + n);

                const ref = prev
                    ? prev.nextSibling
                    : kids(rPr).find(x =>
                        RPR_AFTER_SZ.includes(x.localName)
                    ) || null;

                rPr.insertBefore(e, ref);
            }

            e.setAttributeNS(W, "w:val", size);
            prev = e;
        });
    }

    // Define ou remove o negrito de um elemento run.
    function setBold(doc, rPr, on) {
        ["b", "bCs"].forEach(n =>
            kids(rPr, n).forEach(x => rPr.removeChild(x))
        );

        let after = null;

        kids(rPr).forEach(ch => {
            if (ch.localName === "rStyle" || ch.localName === "rFonts") {
                after = ch;
            }
        });

        const ref = after ? after.nextSibling : rPr.firstChild;

        ["b", "bCs"].forEach(n => {
            const e = doc.createElementNS(W, "w:" + n);

            if (!on) {
                e.setAttributeNS(W, "w:val", "0");
            }

            rPr.insertBefore(e, ref);
        });
    }

    // Define o conteúdo de texto de um elemento run.
    function setRunText(doc, run, value) {
        let t = run.getElementsByTagNameNS(W, "t")[0];

        if (!t) {
            t = doc.createElementNS(W, "w:t");
            run.appendChild(t);
        }

        t.textContent = value;
        t.setAttributeNS(XML_NS, "xml:space", "preserve");
    }

    // Escreve texto num parágrafo, preservando a formatação existente.
    // Utiliza o primeiro run com texto e limpa os restantes.
    function setParaText(doc, p, value, { bold = null, size = null } = {}) {
        const inBox = isTxbx(p);

        // Obtém os runs do parágrafo, respeitando as caixas de texto.
        const runs = [...p.getElementsByTagNameNS(W, "r")]
            .filter(r => inBox || !isTxbx(r));

        let run = runs.find(r =>
            r.getElementsByTagNameNS(W, "t").length
        ) || runs[0];

        // Cria um run caso o parágrafo ainda não tenha nenhum.
        if (!run) {
            run = doc.createElementNS(W, "w:r");
            p.appendChild(run);

            const mark = kids(kids(p, "pPr")[0] || p, "rPr")[0];

            if (mark) {
                run.appendChild(mark.cloneNode(true));
            }
        }

        const rPr = ensureRPr(doc, run);

        // Aplica o tamanho e o negrito, quando solicitados.
        if (size) setSize(doc, rPr, size);
        if (bold !== null) setBold(doc, rPr, bold);

        // Escreve o novo texto.
        setRunText(doc, run, value);

        // Limpa o texto dos restantes runs para evitar duplicações.
        runs
            .filter(r => r !== run)
            .forEach(r =>
                [...r.getElementsByTagNameNS(W, "t")]
                    .forEach(x => x.textContent = "")
            );
    }

    // Preenche uma célula de tabela, permitindo configurar
    // negrito, tamanho da letra e alinhamento.
    function setCellText(doc, cell, value, bold = null, size = TABLE_SIZE, align = null) {
        let p = kids(cell, "p")[0];

        if (!p) {
            p = doc.createElementNS(W, "w:p");
            cell.appendChild(p);
        }

        setParaText(doc, p, value, { bold, size });

        // Aplica o alinhamento horizontal, se indicado.
        if (align) {
            let pPr = kids(p, "pPr")[0];

            if (!pPr) {
                pPr = doc.createElementNS(W, "w:pPr");
                p.insertBefore(pPr, p.firstChild);
            }

            kids(pPr, "jc").forEach(x => pPr.removeChild(x));

            const jc = doc.createElementNS(W, "w:jc");
            jc.setAttributeNS(W, "w:val", align);

            // O elemento jc deve respeitar a ordem definida pelo esquema Word.
            pPr.insertBefore(
                jc,
                kids(pPr).find(x =>
                    [
                        "textDirection", "textAlignment", "textboxTightWrap",
                        "outlineLvl", "divId", "cnfStyle", "rPr",
                        "sectPr", "pPrChange"
                    ].includes(x.localName)
                ) || null
            );
        }
    }


    // ==================================================
    // CAPA DA PROPOSTA
    // ==================================================

    // Preenche o texto de uma caixa de texto específica da capa.
    function setShapeText(doc, shapeName, value, bold = false, size = COVER_SIZE) {
        const shape = [...doc.getElementsByTagNameNS(WP, "docPr")]
            .find(x => x.getAttribute("name") === shapeName);

        if (!shape) {
            throw new Error("Campo não encontrado: " + shapeName);
        }

        // Localiza a âncora ou o elemento inline da caixa.
        let node = shape;

        while (
            node &&
            node.localName !== "anchor" &&
            node.localName !== "inline"
        ) {
            node = node.parentNode;
        }

        // Localiza o conteúdo e o primeiro parágrafo da caixa.
        const content = node
            ?.getElementsByTagNameNS(WPS, "txbx")[0]
            ?.getElementsByTagNameNS(W, "txbxContent")[0];

        const p = content?.getElementsByTagNameNS(W, "p")[0];

        if (!p) {
            throw new Error("Não foi possível editar " + shapeName);
        }

        setParaText(doc, p, value, {
            bold: bold ? true : null,
            size
        });
    }

    // Obtém a âncora ou o elemento inline de uma caixa de texto.
    const shapeAnchor = (doc, name) => {
        const dp = [...doc.getElementsByTagNameNS(WP, "docPr")]
            .find(x => x.getAttribute("name") === name);

        let n = dp;

        while (
            n &&
            n.localName !== "anchor" &&
            n.localName !== "inline"
        ) {
            n = n.parentNode;
        }

        return n;
    };

    // Remove uma caixa de texto da estrutura do documento.
    function removeShape(doc, name) {
        let n = shapeAnchor(doc, name);

        // Localiza o run que contém a caixa de texto,
        // incluindo a versão alternativa VML.
        while (
            n &&
            !(n.namespaceURI === W && n.localName === "r")
        ) {
            n = n.parentNode;
        }

        if (n) {
            n.parentNode.removeChild(n);
        }
    }

    // Copia a posição vertical de uma caixa de texto para outra.
    function copyShapeTop(doc, fromName, toName) {
        const a = shapeAnchor(doc, fromName);
        const b = shapeAnchor(doc, toName);

        const va = a
            .getElementsByTagNameNS(WP, "positionV")[0]
            .getElementsByTagNameNS(WP, "posOffset")[0];

        const vb = b
            .getElementsByTagNameNS(WP, "positionV")[0]
            .getElementsByTagNameNS(WP, "posOffset")[0];

        vb.textContent = va.textContent;
    }


    // ==================================================
    // TEXTO CORRENTE E ASSINATURA
    // ==================================================

    // Obtém o elemento principal body do documento Word.
    const bodyOf = doc =>
        doc.getElementsByTagNameNS(W, "body")[0];

    // Atualiza a saudação do documento.
    function setGreeting(doc, text) {
        const p = kids(bodyOf(doc), "p")
            .find(x => /^\s*Car[oa]\b/i.test(textOf(x)));

        if (!p) {
            throw new Error('Saudação "Caro Sr." não encontrada no modelo.');
        }

        setParaText(doc, p, text);

        // Remove o realce amarelo dos campos por preencher.
        [...p.getElementsByTagNameNS(W, "highlight")]
            .forEach(h => h.parentNode.removeChild(h));
    }

    // Preenche automaticamente os dados da assinatura do utilizador.
    function setUserSignature(doc, profile) {
        if (!profile) return;

        const paragraphs = kids(bodyOf(doc), "p");

        // Procura o parágrafo que contém o marcador GESTOR.
        for (let i = 0; i < paragraphs.length; i++) {
            const text = textOf(paragraphs[i]).trim();

            if (text === "GESTOR") {
                // Nome do responsável comercial.
                setParaText(doc, paragraphs[i], profile.name);

                // Número de telefone.
                if (paragraphs[i + 1]) {
                    setParaText(
                        doc,
                        paragraphs[i + 1],
                        "Tel: " + profile.phone
                    );
                }

                // Endereço de e-mail.
                if (paragraphs[i + 2]) {
                    setParaText(
                        doc,
                        paragraphs[i + 2],
                        profile.email
                    );
                }

                return;
            }
        }
    }

    // Atualiza o prazo de fidelização e outras referências ao número de meses.
    function setTerm(doc, term) {
        // Vision: "Fidelização: 36 meses | Validade da proposta: 30 dias".
        const fp = kids(bodyOf(doc), "p")
            .find(x => /^\s*Fidelização:/i.test(textOf(x)));

        if (fp) {
            const ts = [...fp.getElementsByTagNameNS(W, "t")];
            let done = false;

            ts.forEach(t => {
                if (!done && /\d+/.test(t.textContent)) {
                    t.textContent = t.textContent.replace(/\d+/, term);
                    done = true;
                }
            });
        }

        // Atualiza também referências como "mínimo de 36 meses".
        [...doc.getElementsByTagNameNS(W, "t")].forEach(t => {
            if (/mínimo de \d+ meses/.test(t.textContent)) {
                t.textContent = t.textContent.replace(
                    /(mínimo de )\d+( meses)/,
                    "$1" + term + "$2"
                );
            }
        });
    }


    // ==================================================
    // AJUSTES ESPECÍFICOS DOS MODELOS FLEET
    // ==================================================

    // CN5: remove do documento a secção sobre a ligação CAN-BUS.
    function removeCanSection(doc) {
        const body = bodyOf(doc);
        const list = kids(body);

        // Localiza o início da secção CAN-BUS.
        const start = list.findIndex(k =>
            k.localName === "p" &&
            /^Funcionalidades principais da liga..o CanBus/i.test(textOf(k).trim())
        );

        // Localiza o início da secção seguinte.
        const end = list.findIndex((k, i) =>
            i > start &&
            k.localName === "p" &&
            /^Fatura..o e Pagamentos/i.test(textOf(k).trim())
        );

        if (start < 0 || end < 0) {
            throw new Error("Secção CAN-BUS não encontrada no modelo.");
        }

        // Identifica parágrafos vazios que não contenham desenhos
        // nem propriedades de quebra de secção.
        const isBlank = k =>
            k.localName === "p" &&
            !textOf(k).trim() &&
            !k.getElementsByTagNameNS(W, "drawing").length &&
            !k.getElementsByTagNameNS(W, "sectPr").length;

        const toRemove = list.slice(start, end);

        // Mantém o espaço antes do título "Faturação".
        if (isBlank(toRemove[toRemove.length - 1])) {
            toRemove.pop();
        }

        // Remove também o espaço anterior à secção, se existir.
        if (start > 0 && isBlank(list[start - 1])) {
            toRemove.push(list[start - 1]);
        }

        toRemove.forEach(k => body.removeChild(k));
    }

    // Cria um parágrafo vazio com o mesmo formato do modelo,
    // sem duplicar identificadores ou propriedades desnecessárias.
    function blankLike(doc, proto) {
        const p = doc.createElementNS(W, "w:p");
        const pPr = kids(proto, "pPr")[0];

        if (pPr) {
            const c = pPr.cloneNode(true);

            [...c.children]
                .filter(x =>
                    x.localName === "sectPr" ||
                    x.localName === "rPr" && false
                )
                .forEach(x => c.removeChild(x));

            p.appendChild(c);
        }

        return p;
    }

    // Adiciona linhas em branco antes do título das funcionalidades base,
    // ajudando a posicionar o título na página seguinte.
    function padBeforeBaseHeading(doc, n = 1) {
        const body = bodyOf(doc);
        const list = kids(body);

        const i = list.findIndex(k =>
            k.localName === "p" &&
            /^Funcionalidades principais dos Servi.os Cartrack de Base/i.test(textOf(k).trim())
        );

        if (i < 1) {
            throw new Error("Título das funcionalidades de base não encontrado no modelo.");
        }

        const proto = list[i - 1];

        for (let k = 0; k < n; k++) {
            body.insertBefore(blankLike(doc, proto), list[i]);
        }
    }

    // CN5: adiciona linhas em branco antes da assinatura,
    // para posicioná-la na última página.
    function padBeforeSignature(doc, n) {
        const body = bodyOf(doc);
        const list = kids(body);

        const i = list.findIndex(k =>
            k.localName === "p" &&
            /^_{5,}/.test(textOf(k).trim())
        );

        if (i < 1) {
            throw new Error("Linha de assinatura não encontrada no modelo.");
        }

        const proto = list[i - 1];

        for (let k = 0; k < n; k++) {
            body.insertBefore(blankLike(doc, proto), list[i]);
        }
    }


    // ==================================================
    // TABELAS E CÉLULAS
    // ==================================================

    // Obtém as linhas de uma tabela Word.
    const rowsOf = tbl =>
        kids(tbl, "tr");

    // Obtém as células de uma linha.
    const cellsOf = row =>
        kids(row, "tc");

    // Configura a união vertical de células e o alinhamento vertical.
    function setVMerge(doc, cell, mode) {
        let tcPr = kids(cell, "tcPr")[0];

        if (!tcPr) {
            tcPr = doc.createElementNS(W, "w:tcPr");
            cell.insertBefore(tcPr, cell.firstChild);
        }

        // Remove configurações anteriores de união e alinhamento.
        kids(tcPr)
            .filter(x =>
                x.localName === "vMerge" ||
                x.localName === "vAlign"
            )
            .forEach(x => tcPr.removeChild(x));

        // Define o início ou a continuação da união vertical.
        const vm = doc.createElementNS(W, "w:vMerge");

        if (mode === "restart") {
            vm.setAttributeNS(W, "w:val", "restart");
        }

        let after = null;

        kids(tcPr).forEach(ch => {
            if (["cnfStyle", "tcW", "gridSpan", "hMerge"].includes(ch.localName)) {
                after = ch;
            }
        });

        tcPr.insertBefore(
            vm,
            after ? after.nextSibling : tcPr.firstChild
        );

        // Centraliza verticalmente o conteúdo da célula.
        const va = doc.createElementNS(W, "w:vAlign");
        va.setAttributeNS(W, "w:val", "center");

        tcPr.insertBefore(
            va,
            kids(tcPr, "hideMark")[0] || null
        );
    }

    // Formata os preços para utilização nos documentos Word.
    const price = v =>
        CT.forDoc(CT.fmtPrice(v));

    // Adiciona uma nota imediatamente depois de uma tabela,
    // mantendo a formatação definida para notas externas.
    function appendOutsideTableNote(doc, table, text) {
        const p = doc.createElementNS(W, "w:p");
        const pPr = doc.createElementNS(W, "w:pPr");

        // Aplica o estilo ExternalNote.
        const style = doc.createElementNS(W, "w:pStyle");
        style.setAttributeNS(W, "w:val", "ExternalNote");
        pPr.appendChild(style);

        // Define o espaçamento inferior.
        const spacing = doc.createElementNS(W, "w:spacing");
        spacing.setAttributeNS(W, "w:after", "80");
        pPr.appendChild(spacing);

        p.appendChild(pPr);

        // Cria o elemento de texto com tamanho de 10 pt.
        const r = doc.createElementNS(W, "w:r");
        const rPr = doc.createElementNS(W, "w:rPr");

        const sz = doc.createElementNS(W, "w:sz");
        sz.setAttributeNS(W, "w:val", "20");
        rPr.appendChild(sz);

        const szCs = doc.createElementNS(W, "w:szCs");
        szCs.setAttributeNS(W, "w:val", "20");
        rPr.appendChild(szCs);

        r.appendChild(rPr);

        const t = doc.createElementNS(W, "w:t");
        t.textContent = text;
        t.setAttributeNS(XML_NS, "xml:space", "preserve");

        r.appendChild(t);
        p.appendChild(r);

        // Insere a nota imediatamente a seguir à tabela.
        table.parentNode.insertBefore(p, table.nextSibling);
    }

    // Adiciona sub-pontos à célula de descrição de um serviço.
    // Os novos parágrafos utilizam o formato do modelo original.
    function addBullets(doc, cell, bullets, makeProto) {
        // Remove sub-parágrafos anteriores.
        kids(cell, "p").slice(1).forEach(p =>
            cell.removeChild(p)
        );

        // Adiciona os novos sub-pontos.
        bullets.forEach(b => {
            const p = makeProto();

            setParaText(
                doc,
                p,
                b.trim ? b.trim() : b,
                { size: TABLE_SIZE }
            );

            cell.appendChild(p);
        });
    }


    // ==================================================
    // TABELA DE SERVIÇOS FLEET
    // ==================================================

    // Constrói a tabela de serviços e preços dos modelos Fleet.
    function buildFleetTable(doc, state) {
        const tables = [...doc.getElementsByTagNameNS(W, "tbl")];

        if (tables.length < 2) {
            throw new Error("As tabelas de preços/condições não foram encontradas.");
        }

        // A primeira tabela contém os serviços e preços.
        const priceTable = tables[0];
        const orig = rowsOf(priceTable);

        // Guarda os modelos das linhas de instalação e dos restantes serviços.
        const installTpl = orig[1];
        const regularTpl = orig[2];

        // Remove as linhas antigas, mantendo apenas o cabeçalho.
        orig.forEach((r, i) => {
            if (i > 0) {
                r.parentNode.removeChild(r);
            }
        });

        // Guarda notas especiais que serão colocadas fora da tabela.
        const externalNotes = [];

        // Ordena os serviços por grupo, mantendo a ordem original dentro
        // de cada grupo.
        const ordered = state.services
            .map((svc, index) => ({
                svc,
                index,

                group: (() => {
                    const d = (svc.description || "")
                        .trim()
                        .toLocaleLowerCase("pt-PT");

                    if (d.startsWith("lembretes")) return 2;

                    if (
                        d.startsWith("formação na plataforma") ||
                        d.startsWith("formacao na plataforma") ||
                        d.startsWith("formação da plataforma") ||
                        d.startsWith("formacao da plataforma")
                    ) {
                        return 3;
                    }

                    if (
                        d === "instalação" ||
                        d.startsWith("sistema base") ||
                        d.startsWith("ligação can-bus") ||
                        d.startsWith("ligacao can-bus")
                    ) {
                        return 0;
                    }

                    return 1;
                })()
            }))
            .sort((a, b) =>
                a.group - b.group || a.index - b.index
            )
            .map(x => x.svc);

        // Percorre os serviços ordenados e cria uma linha para cada um.
        ordered.forEach((svc, i) => {
            // A instalação utiliza uma linha com formatação própria.
            const useInstall =
                svc.description.trim().toLowerCase() === "instalação";

            const clone = (useInstall ? installTpl : regularTpl)
                .cloneNode(true);

            const cells = cellsOf(clone);

            if (cells.length < 4) {
                throw new Error("A estrutura da tabela de preços é diferente da esperada.");
            }

            // Une verticalmente a célula do número de viaturas.
            // O número é escrito apenas na primeira linha.
            setVMerge(
                doc,
                cells[1],
                i === 0 ? "restart" : "continue"
            );

            setCellText(
                doc,
                cells[1],
                i === 0 ? (state.vehicleCount || " ") : "",
                null,
                "22"
            );

            // Remove uniões verticais das restantes células.
            cells.forEach((c, idx) => {
                if (idx !== 1) {
                    kids(kids(c, "tcPr")[0] || c, "vMerge")
                        .forEach(x => x.parentNode.removeChild(x));
                }
            });

            // Preenche a descrição do serviço.
            setCellText(
                doc,
                cells[0],
                svc.description || " ",
                null
            );

            // Centraliza verticalmente o conteúdo das células.
            cells.slice(1).forEach(cell => {
                let tcPr = kids(cell, "tcPr")[0];

                if (!tcPr) {
                    tcPr = doc.createElementNS(W, "w:tcPr");
                    cell.insertBefore(tcPr, cell.firstChild);
                }

                kids(tcPr, "vAlign").forEach(x =>
                    tcPr.removeChild(x)
                );

                const va = doc.createElementNS(W, "w:vAlign");
                va.setAttributeNS(W, "w:val", "center");

                tcPr.appendChild(va);
            });

            // Prepara o formato dos sub-pontos com base no parágrafo
            // original da descrição, tal como no modelo de tacógrafos.
            const proto = kids(cells[0], "p")[0].cloneNode(true);

            const regularBullets = [];
            const starredBullets = [];

            // Separa os sub-pontos normais das notas especiais.
            (svc.bullets || []).forEach(b =>
                (/^\s*\*/.test(b) ? starredBullets : regularBullets).push(b)
            );

            // Adiciona os sub-pontos normais com um hífen.
            addBullets(
                doc,
                cells[0],
                regularBullets.map(b => "- " + b),
                () => proto.cloneNode(true)
            );

            // Guarda as notas especiais para inserir fora da tabela.
            starredBullets.forEach(b =>
                externalNotes.push(
                    b.replace(/^\s*\*\s*/, "").trim()
                )
            );

            // Preenche o número de viaturas.
            setCellText(
                doc,
                cells[1],
                i === 0 ? (state.vehicleCount || " ") : "",
                null,
                "22",
                "center"
            );

            // Preenche os valores mensais e unitários.
            setCellText(
                doc,
                cells[2],
                price(svc.monthly) || " ",
                CT.isOferta(svc.monthly),
                "20",
                "center"
            );

            setCellText(
                doc,
                cells[3],
                price(svc.unit) || " ",
                CT.isOferta(svc.unit),
                "20",
                "center"
            );

            // Insere a nova linha na tabela.
            priceTable.appendChild(clone);
        });

        // Insere as notas especiais depois da tabela, caso existam.
        if (externalNotes.length) {
            appendOutsideTableNote(
                doc,
                priceTable,
                externalNotes.join(" ")
            );
        }

        // Preenche a tabela de condições comerciais.
        fillConditions(doc, tables[1], state);
    }

    // Preenche a tabela de condições com o número de viaturas
    // e o prazo de fidelização.
    function fillConditions(doc, tbl, state) {
        const r = rowsOf(tbl);

        if (r[1]) {
            const c = cellsOf(r[1]);

            if (c[1]) {
                setCellText(
                    doc,
                    c[1],
                    state.vehicleCount || " ",
                    null,
                    "20",
                    "center"
                );
            }
        }

        if (r[2]) {
            const c = cellsOf(r[2]);

            if (c[1]) {
                setCellText(
                    doc,
                    c[1],
                    state.term + " meses",
                    null,
                    TABLE_SIZE,
                    "center"
                );
            }
        }
    }


    // ==================================================
    // MODELOS VISION E VISION TVDE
    // ==================================================

    // Preenche a capa dos modelos Vision.
    // Empresas: Empresa, NIF, A/c e Data.
    // Particulares e TVDE: Nome e Data.
    function fillVisionCover(doc, st, tpl, mode) {

        // Atualiza uma caixa de texto mantendo o tamanho e estilo do modelo.
        const keep = (name, val, bold = false) =>
            setShapeText(doc, name, val, bold, null);

        // Modelo TVDE: empresa/nome e data.
        if (tpl.tvde) {
            keep("Text Box 4", st.company);
            keep("Text Box 6", st.date);
            return;
        }

        // Modelo para empresas.
        if (mode === "company") {
            keep("Text Box 4", st.company);
            keep("Text Box 6", st.nif);
            keep("Text Box 8", st.contact);
            keep("Text Box 10", st.date);
            return;
        }

        // Modelo para particulares:
        // apresenta apenas Nome e Data.
        keep("Text Box 3", "Nome");
        keep("Text Box 4", st.company);

        // Ajusta a posição vertical das caixas para a nova disposição.
        copyShapeTop(doc, "Text Box 5", "Text Box 9");
        copyShapeTop(doc, "Text Box 6", "Text Box 10");

        // Remove as caixas que já não são necessárias.
        [
            "Text Box 5",
            "Text Box 6",
            "Text Box 7",
            "Text Box 8"
        ].forEach(n => removeShape(doc, n));

        // Preenche a data na nova posição.
        keep("Text Box 10", st.date);
    }

    // Constrói a tabela de serviços e preços dos modelos Vision.
    function buildVisionTable(doc, state) {
        // Localiza a tabela através do texto do cabeçalho.
        const priceTable = [...doc.getElementsByTagNameNS(W, "tbl")]
            .find(t =>
                /NÚMERO DE VIATURAS/.test(
                    textOf(kids(t, "tr")[0])
                )
            );

        if (!priceTable) {
            throw new Error("Tabela de preços não encontrada no modelo.");
        }

        const orig = rowsOf(priceTable);

        // Guarda as linhas com fundo cinzento e branco,
        // utilizadas alternadamente para os serviços.
        const shaded = orig[1];
        const plain = orig[2] || orig[1];

        // Remove as linhas antigas, mantendo o cabeçalho.
        orig.forEach((r, i) => {
            if (i > 0) {
                r.parentNode.removeChild(r);
            }
        });

        // Guarda notas especiais para inserir fora da tabela.
        const notes = [];

        // Cria uma linha para cada serviço.
        state.services.forEach((svc, i) => {
            // Alterna entre linha cinzenta e linha branca.
            const clone = (i % 2 === 0 ? shaded : plain).cloneNode(true);
            const cells = cellsOf(clone);

            if (cells.length < 4) {
                throw new Error("A estrutura da tabela de preços é diferente da esperada.");
            }

            // Une verticalmente a célula do número de viaturas.
            setVMerge(
                doc,
                cells[1],
                i === 0 ? "restart" : "continue"
            );

            setCellText(
                doc,
                cells[1],
                i === 0 ? (state.vehicleCount || " ") : "",
                null,
                "20",
                "center"
            );

            // Preenche a descrição do serviço.
            setCellText(
                doc,
                cells[0],
                svc.description || " ",
                null
            );

            // Utiliza a formatação do parágrafo original para os sub-pontos.
            const proto = kids(cells[0], "p")[0].cloneNode(true);

            const reg = [];

            // Separa as notas especiais dos sub-pontos normais.
            (svc.bullets || []).forEach(b => {
                if (/^\s*\*/.test(b)) {
                    notes.push(
                        b.replace(/^\s*\*\s*/, "").trim()
                    );
                } else {
                    reg.push(b);
                }
            });

            // Adiciona os sub-pontos normais com um hífen.
            addBullets(
                doc,
                cells[0],
                reg.map(b => "- " + b),
                () => proto.cloneNode(true)
            );

            // Preenche os preços mensais e unitários.
            setCellText(
                doc,
                cells[2],
                price(svc.monthly) || " ",
                CT.isOferta(svc.monthly),
                "20",
                "center"
            );

            setCellText(
                doc,
                cells[3],
                price(svc.unit) || " ",
                CT.isOferta(svc.unit),
                "20",
                "center"
            );

            // Adiciona a linha à tabela.
            priceTable.appendChild(clone);
        });

        // Insere as notas especiais depois da tabela.
        if (notes.length) {
            appendOutsideTableNote(
                doc,
                priceTable,
                notes.join(" ")
            );
        }
    }


    // ==================================================
    // PONTO DE ENTRADA: GERAÇÃO DO DOCUMENTO
    // ==================================================

    // Recebe o estado da proposta e o carregador do modelo Word.
    // Devolve o ZIP original e o documento XML já preenchido.
    async function renderDocument(state, getBuf) {

        // Identifica o modelo selecionado.
        const tpl = CT.TEMPLATES[state.template] || CT.TEMPLATES.standard;

        // Carrega o ficheiro DOCX através do JSZip.
        const zip = await root.JSZip.loadAsync(
            await getBuf(tpl.base)
        );

        // Extrai o XML principal do documento Word.
        const source = await zip.file("word/document.xml").async("text");

        // Converte o XML para um documento manipulável.
        const doc = new DOMParser().parseFromString(
            source,
            "application/xml"
        );

        // Verifica se ocorreu algum erro ao interpretar o XML.
        if (doc.getElementsByTagName("parsererror").length) {
            throw new Error("Não foi possível interpretar o modelo Word.");
        }

        // Prepara o estado da proposta e normaliza os serviços.
        const st = {
            ...state,
            services: CT.cleanSvcs(state.services)
        };


        // ----------------------------------------------
        // PROCESSAMENTO DOS MODELOS VISION
        // ----------------------------------------------

        if (tpl.kind === "vision") {

            // Nos modelos TVDE, assume uma viatura caso não exista
            // um número preenchido.
            if (tpl.tvde && !String(st.vehicleCount || "").trim()) {
                st.vehicleCount = "1";
            }

            // Preenche a capa e a tabela de serviços.
            fillVisionCover(doc, st, tpl, CT.coverMode(st));
            buildVisionTable(doc, st);

            // Atualiza o prazo de fidelização.
            setTerm(doc, st.term);

            // Preenche a assinatura do responsável comercial.
            setUserSignature(doc, st.userProfile);

            return { zip, doc };
        }


        // ----------------------------------------------
        // PROCESSAMENTO DOS MODELOS FLEET
        // ----------------------------------------------

        // Preenche os campos da capa.
        setShapeText(doc, "Text Box 4", st.company, true);
        setShapeText(doc, "Text Box 6", st.nif);
        setShapeText(doc, "Text Box 8", st.contact);
        setShapeText(doc, "Text Box 14", st.date);

        // Preenche a saudação com o tratamento automático.
        setGreeting(doc, CT.greetingText(st));

        // Constrói a tabela de serviços e preços.
        buildFleetTable(doc, st);

        // Atualiza o prazo de fidelização.
        setTerm(doc, st.term);

        // Preenche os dados da assinatura.
        setUserSignature(doc, st.userProfile);

        // Adiciona espaço antes do título das funcionalidades base.
        padBeforeBaseHeading(doc, 1);

        // Remove a secção CAN-BUS quando o modelo assim o determina.
        if (tpl.removeCanSection) {
            removeCanSection(doc);
        }

        // Adiciona espaço antes da assinatura, quando configurado.
        if (tpl.padBeforeSignature) {
            padBeforeSignature(doc, tpl.padBeforeSignature);
        }

        return { zip, doc };
    }


    // ==================================================
    // EXPORTAÇÃO DO DOCUMENTO WORD
    // ==================================================

    // Gera o ficheiro DOCX final em formato Blob.
    async function renderBlob(state, getBuf) {

        // Gera o documento com os dados da proposta.
        const { zip, doc } = await renderDocument(state, getBuf);

        // Substitui o XML original pelo documento preenchido.
        zip.file(
            "word/document.xml",
            new XMLSerializer().serializeToString(doc)
        );

        // Exporta o DOCX com o MIME type correto.
        return zip.generateAsync({
            type: "blob",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });
    }


    // ==================================================
    // DISPONIBILIZAÇÃO DAS FUNÇÕES PARA A EXTENSÃO
    // ==================================================

    // Expõe as funções utilizadas pelo painel e pela pré-visualização.
    root.CTDoc = {
        renderDocument,
        renderBlob,
        textOf,
        kids,
        cellsOf,
        rowsOf,
        isTxbx,
        W
    };

})(typeof self !== "undefined" ? self : this);
