// ======================================================
// CARTRACK PROPOSAL GENERATOR
// Núcleo partilhado pelo painel lateral e pré-visualização
// ======================================================

(function (root) {
    "use strict";

    // ==================================================
    // CONFIGURAÇÕES GERAIS
    // ==================================================

    // Espaço não separável utilizado antes do símbolo € nos documentos Word.
    const NBSP = "\u00A0";


    // ==================================================
    // FORMATAÇÃO DE PREÇOS
    // ==================================================

    // Converte valores para o formato português:
    // 9,00 € | 1.500,00 € | OFERTA | N.A
    function fmtPrice(raw) {
        const s0 = String(raw ?? "").trim();

        // Não altera valores vazios.
        if (!s0) return "";

        // Normaliza o texto para verificar ofertas e valores não aplicáveis.
        const up = s0.toUpperCase().replace(/\s+/g, "");

        if (up === "OFERTA") return "OFERTA";

        if (["N.A", "N.A.", "NA", "N/A", "N.D", "ND"].includes(up)) {
            return "N.A";
        }

        // Identifica o valor numérico e eventuais asteriscos.
        const m = s0.match(/^€?\s*(-?\d[\d.,\s]*)\s*€?\s*(\*+)?$/);

        // Se não for um valor numérico reconhecido, mantém o texto original.
        if (!m) return s0;

        let n = m[1].replace(/\s/g, "");

        const lastDot = n.lastIndexOf(".");
        const lastComma = n.lastIndexOf(",");

        // Quando existem os dois separadores, o último é o decimal.
        if (lastDot > -1 && lastComma > -1) {
            if (lastComma > lastDot) {
                n = n.replace(/\./g, "").replace(",", ".");
            } else {
                n = n.replace(/,/g, "");
            }

        // Quando existe apenas vírgula, considera-a separador decimal.
        } else if (lastComma > -1) {
            n = n.replace(/\./g, "").replace(",", ".");

        // Quando existe apenas ponto, verifica se representa milhares.
        } else if (lastDot > -1) {
            if (/^-?\d{1,3}(\.\d{3})+$/.test(n)) {
                n = n.replace(/\./g, "");
            }
        }

        const v = Number(n);

        // Evita formatar valores inválidos.
        if (!Number.isFinite(v)) return s0;

        // Garante sempre duas casas decimais.
        let [int, dec] = v.toFixed(2).split(".");

        // Adiciona pontos como separadores de milhares.
        int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

        // Devolve o preço no formato português, preservando os asteriscos.
        return int + "," + dec + " €" + (m[2] || "");
    }

    // Verifica se o valor corresponde a uma oferta.
    const isOferta = v =>
        String(v || "").trim().toUpperCase() === "OFERTA";

    // Verifica se o valor contém pelo menos um número.
    const hasNumber = v =>
        /\d/.test(String(v || ""));

    // Prepara os preços para o Word.
    // Substitui o espaço normal antes de € por um espaço não separável,
    // evitando que o símbolo apareça sozinho na linha seguinte.
    const forDoc = v =>
        String(v || "").replace(/ €/g, NBSP + "€");


    // ==================================================
    // TRATAMENTO AUTOMÁTICO: SR. / SRA.
    // ==================================================

    // Remove acentos e converte o texto para minúsculas.
    const strip = s =>
        s.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

    // Nomes identificados como femininos, mesmo sem terminarem em "a".
    const FEM_EXCEPT = new Set([
        "ines", "beatriz", "isabel", "raquel", "rachel", "carmen",
        "mercedes", "merces", "ester", "esther", "ruth", "rute",
        "miriam", "sol", "luz", "leonor", "lurdes", "liz", "iris",
        "dolores", "soledade", "conceicao", "assuncao", "anunciacao",
        "natercia", "alice", "denise", "eunice", "bernardete", "odete",
        "anete", "ivone", "aline", "solange", "janete", "lisete",
        "claudete", "ivete", "jaqueline", "caroline", "madalene",
        "margarete", "gisele", "michele", "noemi", "naomi", "abigail",
        "edite", "judite", "vanessa", "jessica", "patricia", "ariane",
        "mariane", "adriane", "cristiane", "viviane", "luciane",
        "liliane", "tatiane", "sheila", "ingrid", "sarah", "sara",
        "ana", "joana", "maria"
    ]);

    // Nomes identificados como masculinos, mesmo sem terminarem em "o".
    const MASC_EXCEPT = new Set([
        "luca", "joshua", "nikita", "mika", "sasha", "jonas",
        "tomas", "andrea", "elias", "matias", "jose", "jorge",
        "guilherme", "alexandre", "henrique", "filipe", "felipe",
        "vicente", "tome", "clemente", "valente", "quim", "simone",
        "dave", "jake", "mike", "steve", "pierre"
    ]);

    // Tratamentos claramente femininos.
    const HONOR_F =
        /^(sra|dra|engª|eng\.ª|arqª|arq\.ª|profª|prof\.ª|d)\.?$/i;

    // Tratamento claramente masculino.
    const HONOR_M =
        /^sr\.?$/i;

    // Tratamentos neutros: o género será determinado pelo nome.
    const HONOR_NEUTRAL =
        /^(dr|eng|arq|prof|engenheiro|engenheira|arquiteto|arquiteta|professor|professora)\.?$/i;

    // Determina automaticamente o tratamento com base no nome.
    function guessTitle(name) {
        const parts = String(name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        // Sem nome, utiliza o tratamento masculino por defeito.
        if (!parts.length) return "Sr.";

        let skip = 0;

        // Verifica se o nome começa com um tratamento profissional.
        if (parts.length > 1) {
            if (HONOR_F.test(parts[0])) return "Sra.";
            if (HONOR_M.test(parts[0])) return "Sr.";

            if (HONOR_NEUTRAL.test(parts[0])) {
                skip = 1;
            }
        }

        // Analisa apenas o primeiro nome.
        const first = strip(parts[skip]).replace(/[^a-z]/g, "");

        if (!first) return "Sr.";

        // Primeiro verifica as exceções conhecidas.
        if (MASC_EXCEPT.has(first)) return "Sr.";
        if (FEM_EXCEPT.has(first)) return "Sra.";

        // Regras gerais para nomes femininos.
        if (/cao$/.test(first)) return "Sra.";
        if (/a$/.test(first)) return "Sra.";
        if (/(ete|ice|ine|ele|ette)$/.test(first)) return "Sra.";

        // Tratamento masculino por defeito.
        return "Sr.";
    }

    // Determina o tratamento final da proposta.
    // Se existir uma escolha manual válida, respeita-a.
    // Caso contrário, utiliza a identificação automática.
    function resolveTitle(state) {
        return state.greeting === "Sr." || state.greeting === "Sra."
            ? state.greeting
            : guessTitle(state.contact);
    }

    // Gera a saudação completa:
    // "Caro Sr. João Silva,"
    // "Cara Sra. Maria Silva,"
    //
    // Se o nome já incluir um tratamento, evita repeti-lo.
    function greetingText(state) {
        const t = resolveTitle(state);
        const word = t === "Sra." ? "Cara" : "Caro";

        let name = String(state.contact || "").trim();
        const parts = name.split(/\s+/);

        // Remove tratamentos simples já presentes no nome.
        if (
            parts.length > 1 &&
            /^(sr|sra|d)\.?$/i.test(parts[0])
        ) {
            parts.shift();
            name = parts.join(" ");

        // Mantém tratamentos profissionais e não os duplica.
        } else if (
            parts.length > 1 &&
            (
                HONOR_NEUTRAL.test(parts[0]) ||
                /^(dra|engª|eng\.ª|arqª|arq\.ª|profª|prof\.ª)\.?$/i.test(parts[0])
            )
        ) {
            return word + " " + name + ",";
        }

        return word + " " + t + " " + name + ",";
    }


    // ==================================================
    // IDENTIFICAÇÃO DO CLIENTE
    // ==================================================

    // Identifica empresas através do final do nome:
    // Lda, Limitada, Unipessoal, SA, S.A., SGPS ou CRL.
    const COMPANY_RE =
        /(?:^|[\s,])(?:lda|limitada|unipessoal|s\.?\s?a|sgps|crl)\.?\s*$/i;

    // Verifica se o nome introduzido corresponde a uma empresa.
    const isCompanyName = name =>
        COMPANY_RE.test(String(name || "").trim());

    // Determina o tipo de capa a utilizar:
    // fleet   = modelos antigos
    // company = Vision para empresas
    // person  = Vision para particulares ou TVDE
    function coverMode(state) {
        const t = TEMPLATES[state.template] || TEMPLATES.standard;

        // Os modelos que não são Vision utilizam a capa Fleet.
        if (t.kind !== "vision") return "fleet";

        // Os modelos TVDE utilizam sempre a capa de particular.
        if (t.tvde) return "person";

        // Respeita a escolha manual ou identifica automaticamente.
        const type =
            state.clientType === "empresa" ||
            state.clientType === "particular"
                ? state.clientType
                : (
                    isCompanyName(state.company)
                        ? "empresa"
                        : "particular"
                );

        return type === "empresa" ? "company" : "person";
    }

    // Devolve os campos que devem aparecer na capa,
    // de acordo com o tipo de cliente e modelo selecionado.
    function coverFields(state) {
        const m = coverMode(state);

        // Capa para particulares.
        if (m === "person") {
            return [
                ["Nome", state.company],
                ["Data", state.date]
            ];
        }

        // Capa Vision para empresas.
        if (m === "company") {
            return [
                ["Empresa", state.company],
                ["Nº Contribuinte", state.nif],
                ["A/c", state.contact],
                ["Data", state.date]
            ];
        }

        // Capa dos modelos Fleet.
        return [
            ["Empresa", state.company],
            ["NIF", state.nif],
            ["Contacto", state.contact],
            ["Data", state.date]
        ];
    }

    // Verifica quais os campos obrigatórios que ainda não foram preenchidos.
    // Devolve os nomes dos campos para apresentar ao utilizador.
    function requiredMissing(state) {
        const t = TEMPLATES[state.template] || TEMPLATES.standard;
        const m = coverMode(state);

        const need = [
            ["company", m === "person" ? "nome" : "empresa"],
            ["date", "data"]
        ];

        // NIF e contacto só são obrigatórios quando aplicáveis.
        if (m !== "person") {
            need.push(
                ["nif", "NIF"],
                ["contact", m === "company" ? "a/c" : "contacto"]
            );
        }

        // Nos modelos que não são TVDE, exige a quantidade de viaturas.
        if (!t.tvde) {
            need.push(["vehicleCount", "quantidade"]);
        }

        // Devolve apenas os campos vazios.
        return need
            .filter(([k]) => !String(state[k] || "").trim())
            .map(x => x[1]);
    }


    // ==================================================
    // DEFINIÇÃO DE SERVIÇOS
    // ==================================================

    // Função auxiliar para criar um serviço.
    // Cada serviço contém descrição, mensalidade, instalação e sub-pontos.
    const S = (description, monthly, unit, bullets = []) => ({
        description,
        monthly,
        unit,
        bullets: [...bullets]
    });

    // Serviços base utilizados nos diferentes modelos.
    const BASE_SERVICES = {

        // Instalação da solução.
        install: () =>
            S("Instalação", "N.A", "OFERTA"),

        // Serviço de localização GPS.
        base: () =>
            S("Sistema Base – Localização", "9,00 €", "N.A"),

        // Ligação CAN-BUS.
        can: () =>
            S("Ligação CAN-BUS – Controlo de abastecimentos", "2,00 €", "N.A"),

        // Serviço de lembretes.
        reminders: () =>
            S("Lembretes – Gestão de obrigações", "OFERTA", "N.A"),

        // Formação na plataforma.
        training: () =>
            S("Formação da Plataforma", "OFERTA", "N.A")
    };

    // Atalho para aceder aos serviços base.
    const B = BASE_SERVICES;

    // Rótulos das colunas das tabelas dos modelos Fleet.
    const VEHICLE_LABELS = {
        count: "Quantidade de viaturas",
        monthly: "Mensal / viatura",
        unit: "Preço unidade"
    };

    // Serviço unificado de localização e ligação CAN-BUS.
    const UNIFIED = () =>
        S(
            "Sistema Base + Ligação CAN-BUS – Localização + Controlo de abastecimentos",
            "11,00 €",
            "N.A"
        );


    // ==================================================
    // MODELOS DE PROPOSTA
    // ==================================================

    // Define os modelos disponíveis, respetivos ficheiros Word,
    // rótulos, serviços predefinidos e regras específicas.
    const TEMPLATES = {

        // ----------------------------------------------
        // STANDARD
        // Localização + CAN-BUS
        // ----------------------------------------------
        standard: {
            label: "Standard – Localização + CAN-BUS",
            base: "template.docx",
            labels: VEHICLE_LABELS,

            defaults: () => [
                B.install(),
                B.base(),
                B.can(),
                B.reminders(),
                B.training()
            ]
        },

        // ----------------------------------------------
        // CN5
        // Modelo apenas com localização.
        // ----------------------------------------------
        cn5: {
            label: "CN5 – só Localização",
            base: "template.docx",
            labels: VEHICLE_LABELS,

            // Remove a secção CAN-BUS e impede a utilização dessa linha.
            removeCanSection: true,
            forbidCan: true,

            // Espaço adicional antes da assinatura.
            padBeforeSignature: 12,

            defaults: () => [
                B.install(),
                B.base(),
                B.reminders(),
                B.training()
            ]
        },

        // ----------------------------------------------
        // TACÓGRAFOS
        // Inclui localização, CAN-BUS e ligação ao tacógrafo.
        // ----------------------------------------------
        tacografos: {
            label: "Tacógrafos",
            base: "template.docx",
            labels: VEHICLE_LABELS,

            // Este modelo exige a linha CAN-BUS.
            requireCan: true,

            defaults: () => [
                B.install(),
                UNIFIED(),

                S(
                    "Ligação ao tacógrafo",
                    "3,00 €",
                    "N.A",
                    [
                        "Análise em tempo real dos tempos de condução, descanso e trabalho",
                        "Descarga remota dos dados do tacógrafo e cartão de motorista"
                    ]
                ),

                B.reminders(),
                B.training()
            ]
        },

        // ----------------------------------------------
        // VISION
        // Modelos de videovigilância e gestão de frota.
        // ----------------------------------------------
        vision: {
            label: "Vision",
            kind: "vision",
            base: "template-vision.docx",

            // Rótulos específicos da tabela Vision.
            labels: {
                count: "Quantidade de viaturas",
                monthly: "Subscrição mensal",
                unit: "Instalação"
            },

            defaults: () => [
                S("Serviço Base – Localização", "OFERTA", "N.A"),
                S("Cartrack Road Vision", "18,00 €", "90,00 €"),
                S("Cartrack Dual Vision", "24,00 €", "90,00 €"),
                S("Cartrack Dual Vision AI", "42,00 €", "90,00 €")
            ]
        },

        // ----------------------------------------------
        // VISION TVDE
        // Modelo específico para o setor TVDE.
        // ----------------------------------------------
        tvde: {
            label: "Vision TVDE",
            kind: "vision",
            tvde: true,
            base: "template-vision-tvde.docx",

            labels: {
                count: "Quantidade de viaturas",
                monthly: "Subscrição mensal",
                unit: "Instalação"
            },

            defaults: () => [
                S("Sistema Base – Localização", "OFERTA", "N.A"),
                S("Cartrack Dual Vision", "24,00 €", "90,00 €"),
                S("E-Taco Lite", "OFERTA", "N.A")
            ]
        },

        // ----------------------------------------------
        // MÁQUINAS
        // Modelo específico para máquinas e equipamentos.
        // ----------------------------------------------
        maquinas: {
            label: "Máquinas",
            base: "template.docx",
            labels: VEHICLE_LABELS,

            defaults: () => [
                B.install(),
                UNIFIED(),

                S(
                    "Ligação ao contador de horas",
                    "0,00 €",
                    "N.A"
                ),

                S(
                    "Alerta de roubo de bateria ou baixa voltagem 24/h",
                    "0,00 €",
                    "100,00 €*",
                    [
                        "**Para não haver acréscimo de custo de instalação, o cliente deve garantir a passagem de um cabo ligado diretamente ao borne positivo e outro ao negativo da bateria, permitindo-nos efetuar um contorno ao corta-corrente da máquina e ter alertas de roubo de baterias corretos."
                    ]
                ),

                B.reminders(),
                B.training()
            ]
        }
    };


    // ==================================================
    // REGRAS E TRATAMENTO DOS SERVIÇOS
    // ==================================================

    // Verifica se existe algum serviço com ligação CAN-BUS.
    const hasCan = svcs =>
        svcs.some(s =>
            /can[\s-]?bus/i.test(s.description || "")
        );

    // Normaliza a lista de serviços.
    // Garante que todas as propriedades existem e que os sub-pontos
    // são strings sem espaços desnecessários.
    const cleanSvcs = svcs =>
        (svcs || []).map(s => ({
            description: s.description || "",
            monthly: s.monthly || "",
            unit: s.unit || "",
            bullets: (s.bullets || [])
                .map(x => String(x).trim())
                .filter(Boolean)
        }));


    // ==================================================
    // VALIDAÇÃO DA PROPOSTA
    // ==================================================

    // Verifica se os serviços selecionados são compatíveis
    // com o modelo de proposta escolhido.
    function validate(state) {
        const t = TEMPLATES[state.template] || TEMPLATES.standard;
        const errs = [];

        // Exige pelo menos um serviço na proposta.
        if (!state.services || !state.services.length) {
            errs.push("Adiciona pelo menos uma linha de serviço.");

        } else {

            // Verifica se o modelo exige ligação CAN-BUS.
            if (t.requireCan && !hasCan(state.services)) {
                errs.push(
                    "Este modelo exige a linha «Ligação CAN-BUS» na tabela."
                );
            }

            // Impede CAN-BUS nos modelos que não o permitem.
            if (t.forbidCan && hasCan(state.services)) {
                errs.push(
                    "O modelo CN5 não tem ligação CAN-BUS: remove essa linha da tabela."
                );
            }
        }

        // A Câmara Extra só pode ser utilizada quando existe Dual Vision AI.
        if (
            (state.services || []).some(s =>
                /câmara extra/i.test(s.description || "")
            ) &&
            !(state.services || []).some(s =>
                /dual vision ai/i.test(s.description || "")
            )
        ) {
            errs.push(
                "A Câmara Extra requer a linha Cartrack Dual Vision AI."
            );
        }

        return errs;
    }


    // ==================================================
    // EXPORTAÇÃO DAS FUNÇÕES
    // ==================================================

    // Disponibiliza as funções e configurações para o restante código.
    // No Node.js, exporta através de module.exports.
    // Na extensão Chrome, disponibiliza o objeto global CT.
    const api = {
        NBSP,
        fmtPrice,
        isOferta,
        hasNumber,
        forDoc,
        isCompanyName,
        coverMode,
        coverFields,
        requiredMissing,
        guessTitle,
        resolveTitle,
        greetingText,
        TEMPLATES,
        hasCan,
        cleanSvcs,
        validate
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        root.CT = api;
    }

})(typeof self !== "undefined" ? self : this);
