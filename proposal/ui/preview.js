// ======================================================
// CONFIGURAÇÕES E FUNÇÕES AUXILIARES
// ======================================================

// Obtém um elemento HTML através do seu ID.
const $ = id => document.getElementById(id);

// Importa as funções e propriedades necessárias do CTDoc.
const { W, kids, cellsOf, rowsOf, textOf, isTxbx } = CTDoc;

// Obtém o conteúdo de um ficheiro da extensão em formato ArrayBuffer.
const getBuf = name =>
    fetch(chrome.runtime.getURL(name)).then(r => r.arrayBuffer());

// Converte caracteres especiais para entidades HTML, evitando problemas
// quando o conteúdo do documento é inserido na página.
const esc = s =>
    String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

// Obtém o valor de uma propriedade XML do Word.
const wval = (el, name) => {
    const e = el && kids(el, name)[0];

    return e
        ? (e.getAttributeNS(W, "val") ?? e.getAttribute("w:val"))
        : undefined;
};

// Verifica se uma propriedade de formatação está ativa.
const on = (rPr, name) => {
    if (!rPr) return false;

    const e = kids(rPr, name)[0];
    if (!e) return false;

    const v = e.getAttributeNS(W, "val") ?? e.getAttribute("w:val");

    return v !== "0" && v !== "false";
};


// ======================================================
// CONVERSÃO DE TEXTO E FORMATAÇÃO DO WORD PARA HTML
// ======================================================

// Converte os elementos de texto de um parágrafo Word para HTML,
// preservando negrito, itálico e texto branco.
function runsHtml(p) {
    return [...p.getElementsByTagNameNS(W, "r")]
        .filter(r => !isTxbx(r))
        .map(r => {
            const t = [...r.children]
                .map(c =>
                    c.localName === "t"
                        ? c.textContent
                        : c.localName === "tab"
                            ? "\u00A0\u00A0"
                            : ""
                )
                .join("");

            if (!t) return "";

            const rPr = kids(r, "rPr")[0];
            let h = esc(t);

            // Preserva o negrito.
            if (on(rPr, "b")) {
                h = "<b>" + h + "</b>";
            }

            // Preserva o itálico.
            if (on(rPr, "i")) {
                h = "<i>" + h + "</i>";
            }

            // Preserva a cor branca do texto.
            const col = wval(rPr, "color");

            if (col && col !== "auto" && col.toUpperCase() === "FFFFFF") {
                h = '<span style="color:#fff">' + h + "</span>";
            }

            return h;
        })
        .join("");
}

// Verifica se um parágrafo pertence a uma lista.
const isList = p => !!kids(kids(p, "pPr")[0] || p, "numPr").length;

// Obtém o estilo aplicado a um parágrafo Word.
const styleOf = p => wval(kids(p, "pPr")[0], "pStyle");


// ======================================================
// CONVERSÃO DE TABELAS WORD PARA HTML
// ======================================================

// Converte o conteúdo de uma célula de tabela para HTML,
// preservando parágrafos e listas.
function cellHtml(c) {
    return kids(c, "p")
        .map(p => {
            const h = runsHtml(p);

            if (!h.trim()) return "";

            return isList(p)
                ? '<div class="li">• ' + h + "</div>"
                : "<div>" + h + "</div>";
        })
        .join("") || "&nbsp;";
}

// Converte uma tabela Word para uma tabela HTML,
// preservando larguras, células unidas, alinhamentos e cores.
function tableHtml(tbl) {
    const rows = rowsOf(tbl);

    // Recolhe as informações de cada célula da tabela.
    const grid = rows.map(r =>
        cellsOf(r).map(c => {
            const tcPr = kids(c, "tcPr")[0];
            const vm = tcPr && kids(tcPr, "vMerge")[0];

            return {
                c,
                tcPr,
                span: +(wval(tcPr, "gridSpan") || 1),

                // Identifica células com união vertical.
                vm: vm
                    ? (
                        (vm.getAttributeNS(W, "val") ??
                            vm.getAttribute("w:val")) === "restart"
                            ? "restart"
                            : "cont"
                    )
                    : null
            };
        })
    );

    // Obtém as larguras das colunas definidas no documento Word.
    const widths = (
        kids(tbl, "tblGrid")[0]
            ? kids(kids(tbl, "tblGrid")[0], "gridCol")
            : []
    ).map(g =>
        +(g.getAttributeNS(W, "w") || g.getAttribute("w:w") || 0)
    );

    const total = widths.reduce((a, b) => a + b, 0);

    // Cria o grupo de colunas com as respetivas larguras.
    const cols = total
        ? "<colgroup>" +
            widths.map(w =>
                '<col style="width:' + (w / total * 100).toFixed(1) + '%">'
            ).join("") +
            "</colgroup>"
        : "";

    // Constrói as linhas e células da tabela HTML.
    const body = rows.map((r, ri) => {
        let tds = "";

        grid[ri].forEach((cell, ci) => {
            // Ignora células que continuam uma união vertical.
            if (cell.vm === "cont") return;

            // Calcula o número de linhas ocupadas pela célula.
            let rs = 1;

            if (cell.vm === "restart") {
                for (
                    let j = ri + 1;
                    j < grid.length && grid[j][ci] && grid[j][ci].vm === "cont";
                    j++
                ) {
                    rs++;
                }
            }

            // Obtém a cor de fundo da célula.
            const shd = cell.tcPr && kids(cell.tcPr, "shd")[0];

            const fill = shd && (
                shd.getAttributeNS(W, "fill") ||
                shd.getAttribute("w:fill")
            );

            // Verifica o alinhamento horizontal e vertical.
            const p = kids(cell.c, "p")[0];
            const pPr = p && kids(p, "pPr")[0];

            const centered = !!pPr && wval(pPr, "jc") === "center";
            const va = wval(cell.tcPr, "vAlign") === "center";

            // Constrói a célula HTML com os atributos necessários.
            tds += "<td" +
                (cell.span > 1 ? ' colspan="' + cell.span + '"' : "") +
                (rs > 1 ? ' rowspan="' + rs + '"' : "") +
                ' class="' +
                    (centered ? "c " : "") +
                    (va || ri === 0 ? "m" : "") +
                '"' +
                (
                    fill && fill !== "auto"
                        ? ' style="background:#' + fill + '"'
                        : ""
                ) +
                ">" +
                cellHtml(cell.c) +
                "</td>";
        });

        return "<tr>" + tds + "</tr>";
    }).join("");

    return "<table>" + cols + body + "</table>";
}


// ======================================================
// CONVERSÃO DO CORPO DO DOCUMENTO WORD PARA HTML
// ======================================================

// Converte os parágrafos e tabelas do documento para HTML,
// preservando títulos, listas e notas.
function bodyHtml(doc) {
    const body = doc.getElementsByTagNameNS(W, "body")[0];

    let out = "";
    let inList = false;

    // Fecha uma lista HTML que esteja aberta.
    const closeList = () => {
        if (inList) {
            out += "</ul>";
            inList = false;
        }
    };

    // Percorre todos os elementos do corpo do documento.
    kids(body).forEach(el => {

        // Converte tabelas.
        if (el.localName === "tbl") {
            closeList();
            out += tableHtml(el);
            return;
        }

        // Ignora elementos que não sejam parágrafos.
        if (el.localName !== "p") return;

        const h = runsHtml(el);

        // Ignora parágrafos vazios.
        if (!h.trim()) return;

        // Agrupa parágrafos de lista numa lista HTML.
        if (isList(el)) {
            if (!inList) {
                out += "<ul>";
                inList = true;
            }

            out += "<li>" + h + "</li>";
            return;
        }

        // Fecha listas antes de iniciar um novo parágrafo.
        closeList();

        // Identifica o estilo do parágrafo para escolher
        // a estrutura HTML correspondente.
        out += (
            styleOf(el) === "Subtituloslaranja" ||
            styleOf(el) === "Ttulo1"
        )
            ? "<h2>" + h + "</h2>"
            : (
                styleOf(el) === "Ttulo2"
                    ? "<h3>" + h + "</h3>"
                    : (
                        styleOf(el) === "ExternalNote"
                            ? '<p class="external-note">' + h + "</p>"
                            : (
                                /^\\s*<i>.*Nota/.test(h) ||
                                /^<b>\\*?<i>/.test(h) ||
                                /^<i><b>\\*Nota/.test(h)
                            )
                                ? '<p class="note-i">' + h + "</p>"
                                : "<p>" + h + "</p>"
                    )
            );
    });

    // Garante que a última lista também seja fechada.
    closeList();

    return out;
}


// ======================================================
// GERAÇÃO DA CAPA DA PROPOSTA
// ======================================================

// Cria a capa HTML com os dados principais da proposta.
function coverHtml(st) {
    return (
        '<section class="sheet cover">' +
            "<h1>CARTRACK</h1>" +
            '<div class="tag">PROPOSTA DE SERVIÇOS</div>' +
            "<dl>" +
                CT.coverFields(st)
                    .map(([k, v]) =>
                        "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"
                    )
                    .join("") +
            "</dl>" +
        "</section>"
    );
}


// ======================================================
// CONTROLO DA PRÉ-VISUALIZAÇÃO
// ======================================================

// Impede que várias renderizações sejam executadas em simultâneo.
let busy = false;

// Indica se é necessário repetir a renderização após a atual.
let again = false;


// ======================================================
// RENDERIZAÇÃO DO DOCUMENTO
// ======================================================

async function render() {

    // Se já existir uma renderização em curso, agenda outra.
    if (busy) {
        again = true;
        return;
    }

    busy = true;

    try {
        // Recupera os dados guardados da proposta.
        const saved = await chrome.storage.local.get(CTStore.KEYS);

        // Recupera os dados da assinatura do utilizador.
        const { userProfile } = await chrome.storage.local.get("userProfile");

        // Reconstrói o estado da proposta, incluindo placeholders.
        const st = CTStore.toState(saved, { placeholders: true });

        // Adiciona os dados da assinatura ao estado da pré-visualização.
        st.userProfile = userProfile || {};

        // Atualiza o nome do modelo apresentado na interface.
        $("tplName").textContent = "— " + CT.TEMPLATES[st.template].label;

        // Valida os dados da proposta.
        const errs = CT.validate(st);

        // Mostra ou esconde os avisos de validação.
        $("warn").hidden = !errs.length;
        $("warn").textContent = errs.join(" ");

        // Gera o documento Word com os dados atuais.
        const { doc } = await CTDoc.renderDocument(st, getBuf);

        // Insere a capa e o conteúdo do documento na pré-visualização.
        $("out").innerHTML =
            coverHtml(st) +
            '<section class="sheet">' +
                bodyHtml(doc) +
            "</section>";

        // Apresenta a hora da última atualização.
        $("live").textContent =
            "Atualizado às " +
            new Date().toLocaleTimeString("pt-PT", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }) +
            " · atualiza sozinho quando editas no painel";

    } catch (e) {

        // Apresenta erros na interface e na consola.
        $("live").textContent = "Erro: " + e.message;
        console.error(e);

    } finally {

        // Liberta o bloqueio da renderização.
        busy = false;

        // Se houve alterações durante a renderização,
        // executa novamente para apresentar os dados mais recentes.
        if (again) {
            again = false;
            render();
        }
    }
}


// ======================================================
// ATUALIZAÇÃO AUTOMÁTICA
// ======================================================

// Temporizador utilizado para evitar renderizações excessivas.
let t;

// Escuta alterações no armazenamento da extensão.
// Quando os dados mudam, atualiza a pré-visualização após 200 ms.
chrome.storage.onChanged.addListener(() => {
    clearTimeout(t);
    t = setTimeout(render, 200);
});


// ======================================================
// INICIALIZAÇÃO
// ======================================================

// Executa a primeira renderização ao abrir a pré-visualização.
render();
