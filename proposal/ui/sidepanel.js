/* ============================================================
   CONFIGURAÇÕES INICIAIS
   ============================================================ */

const { FIELDS: fields } = CTStore;

const $ = id => document.getElementById(id);

const getBuf = name =>
    fetch(chrome.runtime.getURL(name)).then(response => response.arrayBuffer());

let services = [];
let currentTpl = "standard";
let servicesByTpl = {};
let lastLeadId = null;

const today = () => {
    const date = new Date();

    return [
        String(date.getDate()).padStart(2, "0"),
        String(date.getMonth() + 1).padStart(2, "0"),
        date.getFullYear()
    ].join("/");
};


/* ============================================================
   PERFIL DO UTILIZADOR E ASSINATURA
   ============================================================ */

function generateEmail(name) {
    const parts = name.trim().split(/\s+/);

    const normalize = value => value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");

    const first = normalize(parts[0]);
    const last = normalize(parts[parts.length - 1]);

    return `${first}.${last}@cartrack.com`;
}

async function showProfileSetup() {
    let name = "";
    let phone = "";

    while (!name.trim()) {
        name = prompt(
            "Configuração inicial\n\nIntroduza o seu nome completo:"
        );

        if (name === null) return false;
    }

    while (!phone.trim()) {
        phone = prompt("Introduza o seu número de telemóvel:");

        if (phone === null) return false;
    }

    const userProfile = {
        name: name.trim(),
        phone: phone.trim(),
        email: generateEmail(name),
        configured: true
    };

    await chrome.storage.local.set({ userProfile });

    return true;
}

async function checkUserProfile() {
    const { userProfile } = await chrome.storage.local.get("userProfile");

    if (!userProfile?.configured) {
        return await showProfileSetup();
    }

    return true;
}

async function loadProfile() {
    const { userProfile } = await chrome.storage.local.get("userProfile");

    if (!userProfile) return;

    $("profileName").value = userProfile.name || "";
    $("profilePhone").value = userProfile.phone || "";
}

async function saveProfile() {
    const name = $("profileName").value.trim();
    const phone = $("profilePhone").value.trim();

    if (!name) {
        $("status").textContent = "Introduza o nome completo.";
        return false;
    }

    if (!phone) {
        $("status").textContent = "Introduza o número de telemóvel.";
        return false;
    }

    const userProfile = {
        name,
        phone,
        email: generateEmail(name),
        configured: true
    };

    await chrome.storage.local.set({ userProfile });

    $("status").textContent = "Assinatura atualizada.";

    return true;
}


/* ============================================================
   NORMALIZAÇÃO DO NOME DA EMPRESA
   ============================================================ */

function normalizeCompanyName(name) {
    name = (name || "").trim();

    if (name && name === name.toLocaleUpperCase("pt-PT")) {
        name = name.toLocaleLowerCase("pt-PT");

        name = name.replace(
            /(^|[\s-])(\p{L})/gu,
            (match, separator, letter) =>
                separator + letter.toLocaleUpperCase("pt-PT")
        );
    }

    return name;
}


/* ============================================================
   MODELOS DE PROPOSTA
   ============================================================ */

const TEMPLATE_ORDER = [
    "cn5",
    "standard",
    "tacografos",
    "maquinas",
    "---",
    "vision",
    "tvde"
];

function fillTemplateSelect() {
    const sel = $("template");

    if (!sel) return;

    sel.replaceChildren();

    TEMPLATE_ORDER.forEach(key => {
        if (key === "---") {
            const sep = new Option("──────────", "");
            sep.disabled = true;
            sel.appendChild(sep);
            return;
        }

        const template = CT.TEMPLATES[key];

        if (template) {
            sel.appendChild(new Option(template.label, key));
        }
    });
}


/* ============================================================
   FORMULÁRIO DINÂMICO
   ============================================================ */

function applyFormMode() {
    const template = CT.TEMPLATES[currentTpl];

    if (!template) return;

    const state = currentState();
    const mode = CT.coverMode(state);

    const vision = template.kind === "vision";

    $("clientTypeLabel").hidden = !(vision && !template.tvde);
    $("clientTypeHint").hidden = $("clientTypeLabel").hidden;

    if (!$("clientTypeHint").hidden) {
        const auto = $("clientType").value === "auto";

        $("clientTypeHint").textContent = auto
            ? (
                state.company
                    ? "Detetado pelo nome: " +
                      (mode === "company" ? "empresa" : "particular") + "."
                    : "Será detetado a partir do nome."
            )
            : "";

        $("clientTypeHint").hidden = !auto;
    }

    const person = mode === "person";

    $("companyLabel").firstChild.textContent = person
        ? "Nome"
        : "Nome da empresa";

    $("company").placeholder = person
        ? "Nome"
        : "Nome da empresa";

    $("nifLabel").hidden = person;
    $("contactLabel").hidden = person;

    $("contactLabel").firstChild.textContent = mode === "company"
        ? "A/c (contacto)"
        : "Contacto";

    fillPresets();
}

function applyLabels() {
    const template = CT.TEMPLATES[currentTpl];

    if (!template) return;

    $("countLabel").firstChild.textContent = template.labels.count;
    $("thMonthly").textContent = template.labels.monthly;
    $("thUnit").textContent = template.labels.unit;
}

function switchTemplate(next) {
    if (!CT.TEMPLATES[next]) return;

    servicesByTpl[currentTpl] = services;

    currentTpl = next;

    services = servicesByTpl[next] || CT.TEMPLATES[next].defaults();

    $("template").value = currentTpl;

    applyLabels();
    drawServices();
    applyFormMode();
}


/* ============================================================
   TRATAMENTO AUTOMÁTICO
   ============================================================ */

function updateGreetingHint() {
    $("greeting").value = "auto";
}


/* ============================================================
   ORDENAÇÃO AUTOMÁTICA DOS SERVIÇOS
   ============================================================ */

function serviceGroup(svc) {
    const description = (svc.description || "")
        .trim()
        .toLocaleLowerCase("pt-PT")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    if (description.startsWith("lembretes")) {
        return 2;
    }

    if (
        description.startsWith("formacao na plataforma") ||
        description.startsWith("formacao da plataforma")
    ) {
        return 3;
    }

    if (
        description === "instalacao" ||
        description.startsWith("sistema base") ||
        description.startsWith("ligacao can-bus")
    ) {
        return 0;
    }

    return 1;
}

function normalizeServiceOrder() {
    if (CT.TEMPLATES[currentTpl]?.kind === "vision") {
        return;
    }

    const indexed = services.map((svc, index) => ({
        svc,
        index,
        group: serviceGroup(svc)
    }));

    indexed.sort((a, b) => a.group - b.group || a.index - b.index);

    services = indexed.map(item => item.svc);
}

function insertService(svc) {
    services.push(svc);
    normalizeServiceOrder();
}


/* ============================================================
   GESTÃO E DESENHO DOS SERVIÇOS
   ============================================================ */

function drawServices() {
    const host = $("services");

    if (!host) return;

    host.replaceChildren();

    const template = CT.TEMPLATES[currentTpl];

    services.forEach((svc, i) => {
        svc.bullets = svc.bullets || [];

        const wrap = document.createElement("div");
        wrap.className = "service";

        const row = document.createElement("div");
        row.className = "service-row";

        [
            ["description", "Serviço"],
            ["monthly", template.labels.monthly],
            ["unit", template.labels.unit]
        ].forEach(([key, placeholder]) => {
            const input = document.createElement("input");

            input.value = svc[key] ?? "";
            input.placeholder = placeholder;
            input.setAttribute("aria-label", placeholder);

            input.addEventListener("input", () => {
                services[i][key] = input.value;
                scheduleSave();
            });

            // Ao terminar de editar a descrição, reaplica a ordenação.
            if (key === "description") {
                input.addEventListener("change", () => {
                    services[i][key] = input.value;

                    normalizeServiceOrder();
                    drawServices();
                    scheduleSave();
                });
            }

            if (key !== "description") {
                input.addEventListener("change", () => {
                    input.value = services[i][key] =
                        CT.fmtPrice(input.value);

                    scheduleSave();
                });
            }

            row.appendChild(input);
        });

        const mover = document.createElement("div");
        mover.className = "mover";

        const up = document.createElement("button");

        up.type = "button";
        up.textContent = "▲";
        up.title = "Mover para cima";
        up.disabled = i === 0;

        up.addEventListener("click", () => {
            if (i === 0) return;

            [services[i - 1], services[i]] = [
                services[i],
                services[i - 1]
            ];

            // Não executar normalizeServiceOrder aqui:
            // a ordem manual deve ser preservada.
            drawServices();
            scheduleSave();
        });

        const down = document.createElement("button");

        down.type = "button";
        down.textContent = "▼";
        down.title = "Mover para baixo";
        down.disabled = i === services.length - 1;

        down.addEventListener("click", () => {
            if (i >= services.length - 1) return;

            [services[i + 1], services[i]] = [
                services[i],
                services[i + 1]
            ];

            // Preserva a ordem definida manualmente.
            drawServices();
            scheduleSave();
        });

        mover.append(up, down);
        row.appendChild(mover);

        const del = document.createElement("button");

        del.className = "remove";
        del.type = "button";
        del.textContent = "×";
        del.title = "Remover linha";

        del.addEventListener("click", () => {
            services.splice(i, 1);
            drawServices();
            scheduleSave();
        });

        row.appendChild(del);
        wrap.appendChild(row);

        if (svc.bullets.length || svc._open) {
            const textarea = document.createElement("textarea");

            textarea.value = svc.bullets.join("\n");
            textarea.placeholder = "Sub-pontos desta linha (um por linha)";
            textarea.setAttribute("aria-label", "Sub-pontos");

            textarea.addEventListener("input", () => {
                services[i].bullets = textarea.value.split("\n");
                scheduleSave();
            });

            wrap.appendChild(textarea);

        } else {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "subtoggle";
            button.textContent = "＋ sub-pontos";

            button.addEventListener("click", () => {
                services[i]._open = true;
                drawServices();
            });

            wrap.appendChild(button);
        }

        host.appendChild(wrap);
    });
}


/* ============================================================
   GUARDAR E RESTAURAR DADOS DA PROPOSTA
   ============================================================ */

function scheduleSave() {
    clearTimeout(window._saveTimer);

    window._saveTimer = setTimeout(saveAll, 250);
}

async function saveAll() {
    servicesByTpl[currentTpl] = services;

    const data = {};

    fields.forEach(field => {
        const element = $(field);

        if (element) {
            data[field] = element.value;
        }
    });

    data.servicesByTpl = servicesByTpl;
    data.template = currentTpl;
    data.term = $("term").value;
    data.greeting = $("greeting").value;
    data.clientType = $("clientType").value;

    await chrome.storage.local.set(data);

    $("status").textContent = "Dados guardados automaticamente.";
}

async function restore() {
    const profileConfigured = await checkUserProfile();

    if (!profileConfigured) {
        $("status").textContent =
            "É necessário configurar os seus dados para utilizar a extensão.";

        return;
    }

    await loadProfile();

    const saved = await chrome.storage.local.get(CTStore.KEYS);

    lastLeadId = saved.leadId || null;

    fields.forEach(field => {
        const element = $(field);

        if (element) {
            element.value = saved[field] || "";
        }
    });

    if (!$("date").value) {
        $("date").value = today();
    }

    $("term").value = saved.term || "36";
    $("greeting").value = saved.greeting || "auto";

    servicesByTpl = saved.servicesByTpl || (
        Array.isArray(saved.services)
            ? { standard: saved.services }
            : {}
    );

    currentTpl = CT.TEMPLATES[saved.template]
        ? saved.template
        : "standard";

    $("template").value = currentTpl;

    services = servicesByTpl[currentTpl] ||
        CT.TEMPLATES[currentTpl].defaults();

    $("clientType").value = saved.clientType || "auto";

    applyLabels();
    drawServices();
    updateGreetingHint();
    applyFormMode();

    // Recupera os dados do contrato separadamente.
    await restoreContractData();

    // Verifica se existe um novo lead aberto no CRM.
    autoImport();
}


/* ============================================================
   EDIÇÃO DA ASSINATURA
   ============================================================ */

$("toggleProfile").addEventListener("click", async () => {
    const editor = $("profileEditor");

    editor.hidden = !editor.hidden;

    $("toggleProfile").title = editor.hidden
        ? "Editar assinatura"
        : "Fechar edição";

    $("toggleProfile").setAttribute(
        "aria-expanded",
        String(!editor.hidden)
    );

    if (!editor.hidden) {
        await loadProfile();
        $("profileName").focus();
    }
});

$("saveProfile").addEventListener("click", async () => {
    const saved = await saveProfile();

    if (saved) {
        $("profileEditor").hidden = true;
        $("toggleProfile").title = "Editar assinatura";

        $("toggleProfile").setAttribute(
            "aria-expanded",
            "false"
        );
    }
});


/* ============================================================
   EVENTOS DOS CAMPOS DO FORMULÁRIO
   ============================================================ */

fields.forEach(field => {
    const element = $(field);

    if (element) {
        element.addEventListener("input", scheduleSave);
    }
});

$("contact").addEventListener("input", updateGreetingHint);
$("company").addEventListener("input", applyFormMode);

$("clientType").addEventListener("change", () => {
    applyFormMode();
    scheduleSave();
});

$("term").addEventListener("change", scheduleSave);

$("template").addEventListener("change", () => {
    switchTemplate($("template").value);
    scheduleSave();
});


/* ============================================================
   SERVIÇOS PREDEFINIDOS
   ============================================================ */

const SERVICE_PRESETS = {
    driverid: {
        description: "Driver ID – Identificação dos condutores",
        monthly: "OFERTA",
        unit: "N.A",
        bullets: [
            "*DriverID - Oferta de 2 chaves de identificação por viatura"
        ]
    },

    immobilizer: {
        description: "Imobilização remota",
        monthly: "OFERTA",
        unit: "100,00 €",
        bullets: []
    },

    starter: {
        description: "Inibição de arranque",
        monthly: "OFERTA",
        unit: "100,00 €",
        bullets: [
            "Requer o serviço Driver ID instalado e ativo na viatura."
        ]
    },

    dualai: {
        description: "Cartrack Dual Vision AI",
        monthly: "42,00 €",
        unit: "90,00 €",
        bullets: []
    },

    extracam: {
        description: "Câmara Extra",
        monthly: "2,00 €",
        unit: "50,00 €",
        bullets: [
            "Requer Dual Vision AI",
            "Máximo de 2 câmaras extras"
        ]
    }
};

const PRESET_MENU = {
    fleet: [
        [
            "driverid",
            "Driver ID — Identificação dos condutores"
        ],
        [
            "immobilizer",
            "Imobilização remota — 0,00 € mensal / 100,00 € instalação"
        ],
        [
            "starter",
            "Inibição de arranque — requer Driver ID"
        ]
    ],

    vision: [
        [
            "extracam",
            "Câmara Extra — 2,00 € mensal / 50,00 € instalação (requer Dual Vision AI)"
        ]
    ]
};

function fillPresets() {
    const template = CT.TEMPLATES[currentTpl];

    if (!template) return;

    const menu = template.tvde
        ? []
        : PRESET_MENU[
            template.kind === "vision" ? "vision" : "fleet"
        ];

    const sel = $("servicePreset");

    sel.replaceChildren(
        new Option("Seleciona um serviço…", "")
    );

    menu.forEach(([key, label]) => {
        sel.appendChild(new Option(label, key));
    });

    $("presetLabel").hidden = !menu.length;
}


/* ============================================================
   ADICIONAR SERVIÇOS MANUALMENTE
   ============================================================ */

$("addRow").addEventListener("click", () => {
    insertService({
        description: "",
        monthly: "",
        unit: "",
        bullets: []
    });

    drawServices();
    scheduleSave();
});

$("servicePreset").addEventListener("change", async () => {
    const key = $("servicePreset").value;

    if (!key || !SERVICE_PRESETS[key]) {
        return;
    }

    let warn = "";

    // Câmara Extra: impede duplicação e garante o Dual Vision AI.
    if (key === "extracam") {
        if (services.some(svc =>
            /câmara extra/i.test(svc.description || "")
        )) {
            $("servicePreset").value = "";

            $("status").textContent =
                "A linha Câmara Extra já existe (máximo de 2 câmaras extras).";

            return;
        }

        if (!services.some(svc =>
            /dual vision ai/i.test(svc.description || "")
        )) {
            insertService({
                ...SERVICE_PRESETS.dualai,
                bullets: []
            });

            warn =
                "Adicionei também a linha Cartrack Dual Vision AI (obrigatória para a Câmara Extra).";
        }
    }

    // Inibição de arranque: adiciona Driver ID se ainda não existir.
    if (key === "starter") {
        const hasDriverId = services.some(svc =>
            /driver\s*id/i.test(svc.description || "")
        );

        if (!hasDriverId) {
            insertService({
                ...SERVICE_PRESETS.driverid,
                bullets: [...SERVICE_PRESETS.driverid.bullets]
            });
        }

        // Evita duplicar a própria Inibição de Arranque.
        const hasStarter = services.some(svc =>
            /inibição de arranque/i.test(svc.description || "")
        );

        if (hasStarter) {
            $("servicePreset").value = "";

            $("status").textContent =
                "A linha Inibição de Arranque já existe.";

            return;
        }
    }

    // Evita adicionar Driver ID repetidamente.
    if (key === "driverid") {
        const hasDriverId = services.some(svc =>
            /driver\s*id/i.test(svc.description || "")
        );

        if (hasDriverId) {
            $("servicePreset").value = "";

            $("status").textContent =
                "A linha Driver ID já existe.";

            return;
        }
    }

    insertService({
        ...SERVICE_PRESETS[key],
        bullets: [...SERVICE_PRESETS[key].bullets]
    });

    $("servicePreset").value = "";

    drawServices();

    await saveAll();

    if (warn) {
        $("status").textContent = warn;
    }
});


/* ============================================================
   IMPORTAÇÃO DE DADOS DO CRM
   ============================================================ */

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

const leadIdOf = url => {
    const match = (url || "").match(
        /^https:\/\/crm-pt\.karooooo\.com\/lead\/([0-9a-f-]{36})/i
    );

    return match ? match[1] : null;
};

async function activeTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
    });

    return tab;
}

// Esta função é executada dentro da página CRM.
function pageReader() {
    const clean = value => {
        value = (value || "").trim();
        return value === "-" ? "" : value;
    };

    // Obtém o conteúdo de um campo identificado pelo data-testid.
    const field = id => clean(
        document.querySelector(
            `[data-testid="${id}"] [data-testid="field-info"]`
        )?.innerText
    );

    // Procura o nome da empresa.
    const companyInput =
        document.querySelector(
            'input[readonly][font-weight="bold"][font-size="25"]'
        ) ||
        document.querySelector(
            'input[readonly][font-weight="bold"]'
        );

    // Procura um valor associado a um ícone específico.
    function getValueFromIcon(iconSelector, regex) {
        const icons = document.querySelectorAll(iconSelector);

        for (const icon of icons) {
            let parent = icon;

            // Sobe na estrutura até encontrar o texto correspondente.
            for (let i = 0; i < 12 && parent; i++) {
                const text = clean(parent.innerText || parent.textContent);
                const match = text.match(regex);

                if (match) {
                    return match[1] || match[0];
                }

                parent = parent.parentElement;
            }
        }

        return "";
    }

    // Normaliza o telefone para o formato português 999 999 999.
    function normalizePhone(value) {
        let digits = (value || "").replace(/\D/g, "");

        // Remove o indicativo internacional português.
        if (digits.startsWith("351") && digits.length === 12) {
            digits = digits.slice(3);
        }

        // Formata números portugueses com 9 algarismos.
        if (digits.length === 9) {
            return digits.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
        }

        // Se não for um número português de 9 algarismos,
        // mantém o valor original para evitar perder informação.
        return value.trim();
    }

    // Procura o email associado ao ícone do envelope.
    const email = getValueFromIcon(
        'svg[data-icon="envelope"]',
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
    );

    // Procura o telefone associado ao ícone do telefone.
    const phone = getValueFromIcon(
        'svg[data-icon="phone-flip"]',
        /(?:Mobile|Telefone|Phone)?\s*[|:]?\s*(\+?[\d\s().-]{9,})/i
    );

    const vehicleCount = parseInt(
        field("market_potential"),
        10
    );

    return {
        company: clean(companyInput?.value),
        nif: field("registration_number"),

        contact: clean(
            document.querySelector(
                '[data-testid="contact-name"]'
            )?.innerText
        ),

        email: clean(email),
        phone: phone ? normalizePhone(phone) : "",

        vehicleCount: Number.isFinite(vehicleCount) && vehicleCount > 0
            ? String(vehicleCount)
            : ""
    };
}

async function importCRM({ silent = false, retries = 0 } = {}) {
    const tab = await activeTab();
    const id = leadIdOf(tab?.url);

    if (!id) {
        if (!silent) {
            $("status").textContent =
                "Abre uma ficha de lead no CRM e tenta de novo.";
        }

        return false;
    }

    let d = null;

    for (let n = 0; n <= retries; n++) {
        try {
            [{ result: d }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: pageReader
            });

        } catch (error) {
            console.error("Erro ao ler o CRM:", error);
            d = null;
        }

        if (d?.company) {
            break;
        }

        if (n < retries) {
            await sleep(700);
        }
    }

    if (!d || !d.company) {
        if (!silent) {
            $("status").textContent =
                "Não encontrei os dados na página (espera que carregue e tenta de novo).";
        }

        return false;
    }

    ["company", "nif", "contact", "vehicleCount"].forEach(key => {
        $(key).value = key === "company"
            ? normalizeCompanyName(d[key])
            : d[key];
    });

    $("greeting").value = "auto";

    updateGreetingHint();
    applyFormMode();

    lastLeadId = id;

    await chrome.storage.local.set({ leadId: id });

    await saveAll();

    const missing = [
        ["nif", "NIF"],
        ["contact", "contacto"],
        ["vehicleCount", "nº de viaturas"]
    ]
        .filter(([key]) => !d[key])
        .map(([, label]) => label);

    $("status").textContent =
        "Importado do CRM." +
        (
            missing.length
                ? " Em falta no CRM: " + missing.join(", ") + "."
                : ""
        );

    return true;
}


/* ============================================================
   DADOS DO CONTRATO FLEET E GESTÃO DAS VIATURAS
   ============================================================ */

const CONTRACT_FIELDS = [
    "contractCompany",
    "contractNif",
    "contractContact",
    "contractPhone",
    "contractEmail",
    "contractStreet",
    "contractPostalCode",
    "contractLocality"
];

// Lista de viaturas do contrato.
let contractVehicles = [];


/* ------------------------------------------------------------
   GERAR IDENTIFICADOR DE VIATURA
   ------------------------------------------------------------ */

function createVehicleId() {
    return (
        "vehicle_" +
        Date.now() +
        "_" +
        Math.random().toString(36).slice(2, 9)
    );
}


/* ------------------------------------------------------------
   CRIAR ESTRUTURA DE UMA VIATURA
   ------------------------------------------------------------ */

function createEmptyVehicle() {
    return {
        id: createVehicleId(),
        matricula: "",
        marca: "",
        modelo: "",
        ano: "",
        cor: "",
        duaReview: false
    };
}

/* Normaliza a cor do DUA e conserva apenas a primeira cor. */
function normalizeVehicleColor(value) {
    const source = String(value || "")
        .replace(/[|¦]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!source) return "";

    const firstColor = source
        .replace(/\s+E\s+OUTRAS?\b[\s\S]*$/i, "")
        .split(/[;,/]/)[0]
        .trim();

    const colorRules = [
        [/\bBRANCO\b/i, "Branco"], [/\bPRETO\b/i, "Preto"],
        [/\bCINZENTO\b|\bCINZA\b/i, "Cinzento"],
        [/\bPRATA\b/i, "Prata"], [/\bAZUL\b/i, "Azul"],
        [/\bVERMELHO\b/i, "Vermelho"], [/\bVERDE\b/i, "Verde"],
        [/\bAMARELO\b/i, "Amarelo"], [/\bBEGE\b/i, "Bege"],
        [/\bCASTANHO\b|\bCASTANHA\b/i, "Castanho"],
        [/\bLARANJA\b/i, "Laranja"], [/\bDOURADO\b/i, "Dourado"],
        [/\bBORDEAUX\b/i, "Bordeaux"], [/\bROXO\b/i, "Roxo"]
    ];

    for (const [pattern, canonical] of colorRules) {
        if (pattern.test(firstColor)) return canonical;
    }

    return firstColor;
}


/* ------------------------------------------------------------
   GUARDAR DADOS DO CONTRATO

   Os dados das viaturas ficam dentro de contractData.vehicles.
   ------------------------------------------------------------ */

async function saveContractData() {
    const { contractData = {} } =
        await chrome.storage.local.get("contractData");

    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element) {
            contractData[id] = element.value;
        }
    });

    contractData.vehicles = contractVehicles.map(vehicle => ({
        id: vehicle.id,
        matricula: vehicle.matricula || "",
        marca: vehicle.marca || "",
        modelo: vehicle.modelo || "",
        ano: vehicle.ano || "",
        cor: vehicle.cor || "",
        duaReview: Boolean(vehicle.duaReview)
    }));

    await chrome.storage.local.set({ contractData });
}


/* ------------------------------------------------------------
   ATUALIZAR UM CAMPO DE UMA VIATURA
   ------------------------------------------------------------ */

function isValidPortuguesePlate(value) {
    const compact = String(value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    return /^(?:\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{2}[A-Z]{2}|\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{4}|\d{4}[A-Z]{2})$/.test(compact);
}

function updateVehicleField(vehicleId, field, value) {
    const vehicle = contractVehicles.find(
        item => item.id === vehicleId
    );

    if (!vehicle) return;

    vehicle[field] = field === "cor"
        ? normalizeVehicleColor(value)
        : value;

    if (field === "matricula" && isValidPortuguesePlate(value)) {
        vehicle.duaReview = false;
    }

    saveContractData().catch(error => {
        console.error(
            "[Cartrack] Erro ao guardar viatura:",
            error
        );
    });
}


/* ------------------------------------------------------------
   EXTRAÇÃO DE CAMPOS DO DUA

   Campos:
   A   = Matrícula
   B   = Data da primeira matrícula
   D.1 = Marca
   D.3 = Designação comercial / modelo
   D.2 = Tipo, variante e versão (alternativa ao modelo)
   R   = Cor
   ------------------------------------------------------------ */

function parseDuaText(text) {
    const source = String(text || "")
        .replace(/\u0000/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ");

    const lines = source.split("\n")
        .map(line => line.replace(/[\t ]+/g, " ").trim())
        .filter(Boolean);

    const findLineValue = (codeRegex) => {
        for (const line of lines) {
            const match = line.match(codeRegex);
            if (match && match[1]) return match[1].trim();
        }
        return "";
    };

    // Matrícula: aceitar apenas os formatos portugueses conhecidos.
    const plateSource = findLineValue(/^A\s*[.:)\-–]?\s*(.*)$/i) ||
        (source.match(/(?:^|\s)A\s+((?:\d{2}\s*[- ]?\s*[A-Z]{2}\s*[- ]?\s*\d{2}|[A-Z]{2}\s*[- ]?\s*\d{2}\s*[- ]?\s*[A-Z]{2}))(?:\s|$)/im)?.[1] || "");
    const plateMatch = String(plateSource).toUpperCase().match(
        /\b(?:\d{2}\s*[- ]?\s*[A-Z]{2}\s*[- ]?\s*\d{2}|[A-Z]{2}\s*[- ]?\s*\d{2}\s*[- ]?\s*[A-Z]{2})\b/
    );
    const compactPlate = plateMatch
        ? plateMatch[0].replace(/[^A-Z0-9]/g, "")
        : "";
    const matricula = compactPlate
        ? compactPlate.match(/.{1,2}/g).join("-")
        : "";

    // B: data da primeira matrícula. Só aproveita um ano válido.
    const dateValue = findLineValue(/^B\s*[.:)\-–]?\s*(.*)$/i) ||
        (source.match(/(?:^|\s)B\s+(.{1,24}?)(?=\s+(?:C|D\s*[.]?\s*1|I)\b|$)/im)?.[1] || "");
    const yearMatch = String(dateValue).match(/\b(?:19|20)\d{2}\b/);

    // D.1: só aceitar marcas reconhecidas; não guardar o resto do OCR.
    const makeValue = findLineValue(/^D\s*[.]?\s*1\s*[:.)\-–]?\s*(.*)$/i) ||
        (source.match(/(?:^|\s)D\s*[.]?\s*1\s+(.{1,45}?)(?=\s+D\s*[.]?\s*[23]\b|\s+E\b|\s+F[.]|$)/im)?.[1] || "");
    const makeRules = [
        [/\bRENAULT\s+TRUCKS?\b/i, "RENAULT TRUCKS"],
        [/\bRENAULT\b/i, "RENAULT"],
        [/\bSCANIA\b/i, "SCANIA"],
        [/\bMERCEDES(?:[- ]BENZ)?\b/i, "MERCEDES-BENZ"],
        [/\bVOLVO\b/i, "VOLVO"], [/\bDAF\b/i, "DAF"],
        [/\bIVECO\b/i, "IVECO"], [/\bMAN\b/i, "MAN"],
        [/\bFORD\b/i, "FORD"], [/\bPEUGEOT\b/i, "PEUGEOT"],
        [/\bCITRO[EË]N\b/i, "CITROËN"], [/\bFIAT\b/i, "FIAT"],
        [/\bTOYOTA\b/i, "TOYOTA"], [/\bOPEL\b/i, "OPEL"],
        [/\bNISSAN\b/i, "NISSAN"], [/\bMITSUBISHI\b/i, "MITSUBISHI"],
        [/\bISUZU\b/i, "ISUZU"], [/\bHONDA\b/i, "HONDA"],
        [/\bKIA\b/i, "KIA"], [/\bHYUNDAI\b/i, "HYUNDAI"],
        [/\bSKODA\b/i, "SKODA"], [/\bSEAT\b/i, "SEAT"],
        [/\bVOLKSWAGEN\b|\bVW\b/i, "VOLKSWAGEN"],
        [/\bBMW\b/i, "BMW"], [/\bAUDI\b/i, "AUDI"],
        [/\bDACIA\b/i, "DACIA"]
    ];
    let marca = "";
    for (const [pattern, canonical] of makeRules) {
        if (pattern.test(makeValue)) {
            marca = canonical;
            break;
        }
    }

    // D.3: conservar apenas um valor curto e limpo do campo de modelo.
    let modelo = findLineValue(/^D\s*[.]?\s*3\s*[:.)\-–]?\s*(.*)$/i);
    if (!modelo) {
        modelo = source.match(/(?:^|\s)D\s*[.]?\s*3\s+(.{1,45}?)(?=\s+(?:E\b|F[.]|G\b|H\b|J[.]|K\b|R\b)|$)/im)?.[1] || "";
    }
    modelo = String(modelo)
        .replace(/\s+(?:E\b|F[.]|G\b|H\b|J[.]|K\b|R\b)[\s\S]*$/i, "")
        .replace(/[|¦].*$/, "")
        .replace(/[^A-Z0-9À-Ý .\-/]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const modelTokens = modelo.split(/\s+/).filter(Boolean);
    const knownWordModels = new Set([
        "CLIO", "MEGANE", "CAPTUR", "KADJAR", "KANGOO", "MASTER", "TRAFIC",
        "KADJAR", "SCENIC", "TWINGO", "CORSA", "ASTRA", "COMBO", "VIVARO",
        "DUCATO", "DOBLO", "PANDA", "PUNTO", "TRANSIT", "RANGER", "FIESTA",
        "FOCUS", "CIVIC", "ACCORD", "HILUX", "LANDCRUISER", "YARIS", "COROLLA",
        "SPRINTER", "ATEGO", "ACTROS", "AROCS", "ANTOS", "FH", "FM", "FL",
        "RANGE", "DISCOVERY", "DEFENDER", "TIGUAN", "GOLF", "PASSAT", "CADDY"
    ]);
    const modelHasNumber = /\d/.test(modelo);
    const modelIsKnownWord = knownWordModels.has(modelo.toUpperCase());
    // Alguns modelos comerciais são identificados por um único carácter (ex.: T ou 7).
    const modelIsKnownSingle = new Set(["T", "7"]).has(modelo.toUpperCase());
    if (
        modelo.length > 35 ||
        (modelo.length < 2 && !modelIsKnownSingle) ||
        modelTokens.length > 3 ||
        (!/[A-ZÀ-Ý]/i.test(modelo) && !modelIsKnownSingle) ||
        (!modelHasNumber && !modelIsKnownWord && !modelIsKnownSingle)
    ) {
        modelo = "";
    }

    // R: cor. Só aceitar nomes de cores comuns, evitando texto de rodapé.
    const colorValueRaw = findLineValue(/^R\s*[:.)\-–]?\s*(.*)$/i) ||
        (source.match(/(?:^|\s)R\s+(.{1,35}?)(?=\s+(?:Z[.]|X[.]|U[.]|V[.]|W[.]|Y[.])|$)/im)?.[1] || "");
    const colorValue = String(colorValueRaw)
        .replace(/\s+E\s+OUTRAS?\b[\s\S]*$/i, "")
        .split(/[;,/]/)[0]
        .trim();
    const colorRules = [
        [/\bBRANCO\b/i, "Branco"], [/\bPRETO\b/i, "Preto"],
        [/\bCINZENTO\b|\bCINZA\b/i, "Cinzento"],
        [/\bPRATA\b/i, "Prata"], [/\bAZUL\b/i, "Azul"],
        [/\bVERMELHO\b/i, "Vermelho"], [/\bVERDE\b/i, "Verde"],
        [/\bAMARELO\b/i, "Amarelo"], [/\bBEGE\b/i, "Bege"],
        [/\bCASTANHO\b|\bCASTANHA\b/i, "Castanho"],
        [/\bLARANJA\b/i, "Laranja"], [/\bDOURADO\b/i, "Dourado"],
        [/\bBORDEAUX\b/i, "Bordeaux"], [/\bROXO\b/i, "Roxo"]
    ];
    let cor = "";
    for (const [pattern, canonical] of colorRules) {
        if (pattern.test(colorValue)) {
            cor = canonical;
            break;
        }
    }

    return {
        matricula,
        marca,
        modelo,
        ano: yearMatch ? yearMatch[0] : "",
        cor
    };
}

/* ------------------------------------------------------------
   RECEBER DUA DO IMPORTADOR GERAL

   O document-ai.js envia o texto através do evento
   ct:dua-extracted. Este módulo aplica os dados à frota.
   ------------------------------------------------------------ */

function normalizeVehiclePlate(value) {
    return String(value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function handleDuaExtracted(event) {
    const detail = event.detail || {};
    const text = String(detail.text || "").trim();
    const status = $("aiDocumentStatus");

    if (!text) return;

    try {
        const candidates = parseDuaText(text);
        const hasValidPlate = Boolean(candidates.matricula);

        let vehicle = null;
        let created = false;

        if (hasValidPlate) {
            const normalizedPlate = normalizeVehiclePlate(
                candidates.matricula
            );

            vehicle = contractVehicles.find(item =>
                normalizeVehiclePlate(item.matricula) === normalizedPlate
            );
        } else {
            // Procura uma viatura provisória criada anteriormente.
            vehicle = contractVehicles.find(item =>
                item.duaReview === true && !item.matricula
            );
        }

        if (!vehicle) {
            vehicle = createEmptyVehicle();
            contractVehicles.push(vehicle);
            created = true;
        }

        let applied = 0;

        if (hasValidPlate) {
            vehicle.matricula = candidates.matricula;
            vehicle.duaReview = false;
        } else {
            vehicle.matricula = "";
            vehicle.duaReview = true;
        }

        for (const field of ["marca", "modelo", "ano", "cor"]) {
            const value = field === "cor"
                ? normalizeVehicleColor(candidates[field])
                : candidates[field];

            if (!value) continue;

            vehicle[field] = value;
            applied++;
        }

        renderContractVehicles();

        saveContractData().then(() => {
            if (status) {
                if (!hasValidPlate) {
                    status.textContent =
                        `${created ? "Viatura provisória criada" : "Viatura provisória atualizada"}. ` +
                        `${applied} outro(s) campo(s) preenchido(s). ` +
                        "A matrícula não foi validada. Confirma-a manualmente no DUA.";

                    status.dataset.state = "error";
                } else {
                    const action = created
                        ? "Nova viatura adicionada"
                        : "Viatura existente atualizada";

                    const fieldsText = applied
                        ? `${applied} outro(s) campo(s) preenchido(s)`
                        : "apenas a matrícula foi validada";

                    status.textContent =
                        `${action}: ${candidates.matricula} — ${fieldsText}.`;

                    status.dataset.state = "success";
                }
            }

            const contractStatus = $("contractStatus");

            if (contractStatus) {
                contractStatus.textContent = !hasValidPlate
                    ? "DUA importado para revisão. Confirma e corrige a matrícula da viatura."
                    : created
                        ? "DUA importado. A viatura foi adicionada ao contrato."
                        : "DUA importado. Os dados da viatura existente foram atualizados.";
            }
        }).catch(error => {
            console.error(
                "[Cartrack DUA] Erro ao guardar viatura:",
                error
            );

            if (status) {
                status.textContent =
                    "Os dados do DUA foram reconhecidos, mas ocorreu um erro ao guardá-los.";

                status.dataset.state = "error";
            }
        });

        console.log(
            "[Cartrack DUA] Campos extraídos:",
            candidates,
            "Matrícula validada:",
            hasValidPlate
        );

    } catch (error) {
        console.error(
            "[Cartrack DUA] Erro ao aplicar os dados:",
            error
        );

        if (status) {
            status.textContent =
                `O DUA foi reconhecido, mas não foi possível aplicar os dados: ${error.message}`;

            status.dataset.state = "error";
        }
    }
}
// Ligação em falta: o document-ai.js emite este evento após reconhecer um DUA.
window.addEventListener("ct:dua-extracted", handleDuaExtracted);


/* ------------------------------------------------------------
   AVISOS DE VALIDAÇÃO DOS CAMPOS DA VIATURA
   ------------------------------------------------------------ */

function getVehicleFieldWarning(field, value, isProvisional = false) {
    const current = String(value || "").trim();

    if (field === "matricula") {
        if (!current) {
            return isProvisional
                ? "A matrícula não foi reconhecida pelo OCR. Confirme o campo A do DUA e introduza-a manualmente."
                : "Matrícula por preencher. Confirme-a no DUA antes de concluir o contrato.";
        }

        if (!isValidPortuguesePlate(current)) {
            return "A matrícula pode estar incorreta. Confirme os caracteres e o formato no DUA.";
        }

        return "Confirme a matrícula no DUA: o OCR pode confundir, por exemplo, O/0 e I/1.";
    }

    if (field === "modelo") {
        if (!current) {
            return "Modelo não identificado no DUA. Confirme o campo D.3 e preencha-o manualmente.";
        }

        if (
            current.length > 35 ||
            !/^[A-Z0-9À-Ý][A-Z0-9À-Ý .\-/]{0,34}$/i.test(current)
        ) {
            return "O modelo reconhecido pode estar incorreto. Confirme-o no campo D.3 do DUA.";
        }

        return "Confirme se o modelo corresponde exatamente ao campo D.3 do DUA.";
    }

    return "";
}

function updateVehicleFieldWarning(
    field,
    value,
    warning,
    isProvisional = false
) {
    if (!warning) return;

    const message = getVehicleFieldWarning(
        field,
        value,
        isProvisional
    );

    warning.textContent = message;
    warning.hidden = !message;
}


/* ------------------------------------------------------------
   DESENHAR AS VIATURAS
   ------------------------------------------------------------ */

function renderContractVehicles() {
    const host = $("contractVehicles");

    if (!host) return;

    host.replaceChildren();

    if (!contractVehicles.length) {
        const empty = document.createElement("p");

        empty.className = "empty-message";
        empty.textContent =
            "Ainda não existem viaturas adicionadas.";

        host.appendChild(empty);
        return;
    }

    const definitions = [
        ["matricula", "Matrícula", "Ex.: 12-AB-34"],
        ["marca", "Marca", "Ex.: Renault"],
        ["modelo", "Modelo", "Ex.: Clio"],
        ["ano", "Ano", "Ex.: 2022"],
        ["cor", "Cor", "Ex.: Branco"]
    ];

    contractVehicles.forEach((vehicle, index) => {
        const card = document.createElement("div");

        card.className = "vehicle-card";

        const header = document.createElement("div");
        header.className = "vehicle-header";

        const title = document.createElement("h3");
        title.textContent = `Viatura ${index + 1}`;

        const remove = document.createElement("button");

        remove.type = "button";
        remove.className = "vehicle-remove";
        remove.textContent = "Remover viatura";

        remove.addEventListener("click", async () => {
            contractVehicles = contractVehicles.filter(
                item => item.id !== vehicle.id
            );

            renderContractVehicles();
            await saveContractData();
        });

        header.append(title);
        card.appendChild(header);

        definitions.forEach(([field, labelText, placeholder]) => {
            const label = document.createElement("label");

            label.textContent = labelText;

            const input = document.createElement("input");

            input.type = "text";
            input.placeholder = placeholder;
            input.value = field === "cor"
                ? normalizeVehicleColor(vehicle[field])
                : (vehicle[field] || "");

            input.autocomplete = "off";

            label.appendChild(input);

            let warning = null;
            if (field === "matricula" || field === "modelo") {
                warning = document.createElement("small");
                warning.className = "vehicle-field-warning";
                warning.setAttribute("role", "status");
                label.appendChild(warning);
                updateVehicleFieldWarning(
                    field,
                    input.value,
                    warning,
                    Boolean(vehicle.duaReview)
                );            }

            input.addEventListener("input", () => {
                updateVehicleField(
                    vehicle.id,
                    field,
                    input.value
                );

                updateVehicleFieldWarning(
                    field,
                    input.value,
                    warning,
                    Boolean(vehicle.duaReview)
                );
            });

            if (field === "cor") {
                input.addEventListener("change", () => {
                    input.value = normalizeVehicleColor(input.value);
                    updateVehicleField(vehicle.id, field, input.value);
                });
            }

            card.appendChild(label);
        });

        card.appendChild(remove);
        host.appendChild(card);
    });
}


/* ------------------------------------------------------------
   ADICIONAR VIATURA
   ------------------------------------------------------------ */

function addContractVehicle() {
    contractVehicles.push(createEmptyVehicle());

    renderContractVehicles();

    saveContractData().catch(error => {
        console.error(
            "[Cartrack] Erro ao guardar nova viatura:",
            error
        );
    });
}


/* ------------------------------------------------------------
   RESTAURAR DADOS DO CONTRATO
   ------------------------------------------------------------ */

async function restoreContractData() {
    const { contractData } =
        await chrome.storage.local.get("contractData");

    if (!contractData) {
        contractVehicles = [];
        renderContractVehicles();
        return;
    }

    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element && contractData[id] !== undefined) {
            element.value = contractData[id];
        }
    });

    contractVehicles = Array.isArray(contractData.vehicles)
        ? contractData.vehicles.map(vehicle => ({
            id: vehicle.id || createVehicleId(),
            matricula: vehicle.matricula || "",
            marca: vehicle.marca || "",
            modelo: vehicle.modelo || "",
            ano: vehicle.ano || "",
            cor: normalizeVehicleColor(vehicle.cor || ""),
            duaReview: Boolean(vehicle.duaReview)
        }))
        : [];

    renderContractVehicles();
}


/* ------------------------------------------------------------
   LIMPAR DADOS DO CONTRATO
   ------------------------------------------------------------ */

async function clearContractData() {
    const confirmed = confirm(
        "Tens a certeza de que pretendes limpar todos os dados do contrato?"
    );

    if (!confirmed) return;

    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element) {
            element.value = "";
        }
    });

    contractVehicles = [];

    renderContractVehicles();

    await chrome.storage.local.remove([
        "contractData",
        "contractLeadId"
    ]);

    const status = $("contractStatus");

    if (status) {
        status.textContent = "Dados do contrato limpos.";
    }
}


/* ------------------------------------------------------------
   EVENTOS DOS DADOS DO CONTRATO
   ------------------------------------------------------------ */

if ($("clearContract")) {
    $("clearContract").addEventListener(
        "click",
        clearContractData
    );
}

if ($("addContractVehicle")) {
    $("addContractVehicle").addEventListener(
        "click",
        addContractVehicle
    );
}

// Guardar automaticamente alterações nos campos do cliente.
CONTRACT_FIELDS.forEach(id => {
    const element = $(id);

    if (element) {
        element.addEventListener("input", () => {
            saveContractData().catch(console.error);
        });
    }
});

/* ============================================================
   IMPORTAÇÃO DO CRM PARA O CONTRATO FLEET
   Não altera os dados da proposta.
   ============================================================ */

async function importContractCRM() {
    const button = $("importContractCrm");
    const status = $("contractStatus");

    if (!button || !status) return;

    button.disabled = true;
    button.textContent = "A importar dados...";

    try {
        const tab = await activeTab();
        const id = leadIdOf(tab?.url);

        if (!id) {
            status.textContent =
                "Abre uma ficha de lead no CRM e tenta novamente.";

            return;
        }

        const [{ result: data }] =
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: pageReader
            });

        if (!data || !data.company) {
            status.textContent =
                "Não foi possível encontrar os dados do cliente no CRM.";

            return;
        }

        $("contractCompany").value =
            normalizeCompanyName(data.company || "");

        $("contractNif").value = data.nif || "";
        // Dados da Certidão Permanente preenchem contractContact via interface de revisão.
        // A importação do CRM não substitui o campo contact/gerente.
        // $("contractContact").value = data.contact || "";
        $("contractPhone").value = data.phone || "";
        $("contractEmail").value = data.email || "";

        // Guarda os campos no objeto contractData.
        await saveContractData();

        // Guarda o identificador do lead separadamente.
        await chrome.storage.local.set({
            contractLeadId: id
        });

        status.textContent =
            "Dados importados do CRM. Completa os campos em falta.";

    } catch (error) {
        console.error("Erro ao importar contrato:", error);

        status.textContent =
            "Erro ao importar dados: " + error.message;

    } finally {
        button.disabled = false;
        button.textContent = "↻ Importar dados do CRM";
    }
}

if ($("importContractCrm")) {
    $("importContractCrm").addEventListener(
        "click",
        importContractCRM
    );
}


/* ============================================================
   IMPORTAÇÃO AUTOMÁTICA DO CRM
   ============================================================ */

let autoTimer;

function autoImport() {
    clearTimeout(autoTimer);

    autoTimer = setTimeout(async () => {
        try {
            const tab = await activeTab();
            const id = leadIdOf(tab?.url);

            if (id && id !== lastLeadId) {
                await importCRM({
                    silent: true,
                    retries: 10
                });
            }

        } catch (error) {
            console.error("Erro na importação automática:", error);
        }
    }, 400);
}

chrome.tabs.onActivated.addListener(autoImport);

chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url || info.status === "complete") {
        autoImport();
    }
});

$("importCrm").addEventListener("click", () => {
    importCRM({ retries: 3 });
});


/* ============================================================
   PRÉ-VISUALIZAÇÃO
   ============================================================ */

$("preview").addEventListener("click", async () => {
    await saveAll();

    const url = chrome.runtime.getURL("preview.html");

    try {
        const [open] = await chrome.tabs.query({ url });

        if (open) {
            await chrome.tabs.update(open.id, { active: true });
            await chrome.windows.update(open.windowId, { focused: true });
            return;
        }

    } catch (error) {
        console.warn("Não foi possível verificar a pré-visualização:", error);
    }

    chrome.tabs.create({ url });
});


/* ============================================================
   ESTADO ATUAL DA PROPOSTA
   ============================================================ */

function currentState() {
    return {
        template: currentTpl,

        company: normalizeCompanyName($("company").value),
        nif: $("nif").value.trim(),
        contact: $("contact").value.trim(),

        date: $("date").value.trim(),
        vehicleCount: $("vehicleCount").value.trim(),

        greeting: $("greeting").value,
        clientType: $("clientType").value,
        term: $("term").value,

        services: CT.cleanSvcs(services)
    };
}


/* ============================================================
   GERAÇÃO DO DOCUMENTO WORD
   ============================================================ */

$("generate").addEventListener("click", async () => {
    const button = $("generate");

    try {
        const st = currentState();

        const { userProfile } =
            await chrome.storage.local.get("userProfile");

        st.userProfile = userProfile;

        const missing = CT.requiredMissing(st);

        if (missing.length) {
            $("status").textContent =
                "Preenche: " + missing.join(", ") + ".";

            return;
        }

        const errors = CT.validate(st);

        if (errors.length) {
            $("status").textContent = errors[0];
            return;
        }

        button.disabled = true;
        button.textContent = "A preparar documento…";

        const blob = await CTDoc.renderBlob(st, getBuf);

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;

        a.download =
            "Proposta Cartrack - " +
            st.company.replace(/[\\/:*?"<>|]/g, "_") +
            ".docx";

        a.click();

        setTimeout(() => URL.revokeObjectURL(url), 30000);

        await saveAll();

        $("status").textContent =
            "Documento Word preenchido e descarregado.";

    } catch (error) {
        $("status").textContent =
            "Erro ao gerar: " + error.message;

        console.error("Erro na geração do documento:", error);

    } finally {
        button.disabled = false;
        button.textContent = "Gerar documento Word preenchido";
    }
});


/* ============================================================
   LIMPAR PROPOSTA
   ============================================================ */

$("clear").addEventListener("click", async () => {
    fields.forEach(field => {
        const element = $(field);

        if (element) {
            element.value = "";
        }
    });

    servicesByTpl = {};
    services = CT.TEMPLATES[currentTpl].defaults();

    $("term").value = "36";
    $("greeting").value = "auto";
    $("clientType").value = "auto";
    $("date").value = today();

    lastLeadId = null;

    drawServices();
    updateGreetingHint();
    applyFormMode();

    await chrome.storage.local.remove([
        ...fields,
        "services",
        "servicesByTpl",
        "term",
        "greeting",
        "clientType",
        "leadId"
    ]);

    $("status").textContent = "Proposta limpa.";
});


/* ============================================================
   NAVEGAÇÃO ENTRE PROPOSTAS E CONTRATOS
   ============================================================ */

function switchMainTab(tab) {
    const proposalsPanel = $("proposalsPanel");
    const contractsPanel = $("contractsPanel");

    const proposalsTab = $("tabProposals");
    const contractsTab = $("tabContracts");

    // Não executa se a estrutura HTML estiver incompleta.
    if (
        !proposalsPanel ||
        !contractsPanel ||
        !proposalsTab ||
        !contractsTab
    ) {
        console.warn("Não foram encontrados todos os elementos dos separadores.");
        return;
    }

    const showProposals = tab === "proposals";

    proposalsPanel.hidden = !showProposals;
    contractsPanel.hidden = showProposals;

    proposalsTab.classList.toggle("active", showProposals);
    contractsTab.classList.toggle("active", !showProposals);

    proposalsTab.setAttribute("aria-selected", String(showProposals));
    contractsTab.setAttribute("aria-selected", String(!showProposals));
}

if ($("tabProposals")) {
    $("tabProposals").addEventListener("click", () => {
        switchMainTab("proposals");
    });
}

if ($("tabContracts")) {
    $("tabContracts").addEventListener("click", () => {
        switchMainTab("contracts");
    });
}


/* ============================================================
   INICIALIZAÇÃO DA EXTENSÃO
   ============================================================ */

// Preenche os modelos disponíveis.
fillTemplateSelect();

// Recupera os dados guardados.
restore().catch(error => {
    console.error("Erro ao inicializar a extensão:", error);

    if ($("status")) {
        $("status").textContent =
            "Erro ao carregar a extensão: " + error.message;
    }
});