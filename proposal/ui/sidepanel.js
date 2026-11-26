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
   DADOS DO CONTRATO FLEET
   ============================================================ */

const CONTRACT_FIELDS = [
    "contractCompany",
    "contractNif",
    "contractContact",
    "contractPhone",
    "contractEmail",
    "contractAddressSearch",
    "contractStreet",
    "contractPostalCode",
    "contractLocality",
    "contractParish",
    "contractMunicipality",
    "contractDistrict",
    "contractCountry"
];

// Guarda os campos do contrato sem alterar os dados da proposta.
async function saveContractData() {
    const { contractData = {} } =
        await chrome.storage.local.get("contractData");

    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element) {
            contractData[id] = element.value;
        }
    });

    await chrome.storage.local.set({ contractData });
}

// Recupera os dados guardados do contrato.
async function restoreContractData() {
    const { contractData } =
        await chrome.storage.local.get("contractData");

    if (!contractData) return;

    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element && contractData[id] !== undefined) {
            element.value = contractData[id];
        }
    });
}
/* ============================================================
   LIMPAR DADOS DO CONTRATO FLEET
   ============================================================ */

async function clearContractData() {
    const confirmed = confirm(
        "Tens a certeza de que pretendes limpar todos os dados do contrato?"
    );

    if (!confirmed) return;

    // Limpa todos os campos do contrato.
    CONTRACT_FIELDS.forEach(id => {
        const element = $(id);

        if (element) {
            element.value = "";
        }
    });

    // Limpa também os resultados da pesquisa de moradas.
    geoapifyAddressResults = [];

    const addressSelect = $("contractAddressSelect");

    if (addressSelect) {
        addressSelect.replaceChildren(
            new Option("Selecione uma morada...", "")
        );
    }

    const addressResults = $("contractAddressResults");

    if (addressResults) {
        addressResults.hidden = true;
    }

    // Remove os dados guardados do contrato.
    await chrome.storage.local.remove([
        "contractData",
        "contractLeadId"
    ]);

    // Atualiza o estado.
    const status = $("contractStatus");

    if (status) {
        status.textContent = "Dados do contrato limpos.";
    }
}

// Evento do botão.
if ($("clearContract")) {
    $("clearContract").addEventListener(
        "click",
        clearContractData
    );
}
/* =========================================================
   PESQUISA DE MORADAS — GEOAPIFY
   Utilizada no contrato Fleet
========================================================= */

const GEOAPIFY_API_KEY = "b0a25f539fa84f26a9de74f05c014268";

let geoapifyAddressResults = [];


async function searchContractAddress() {
    const input = $("contractAddressSearch");
    const button = $("searchContractAddress");
    const select = $("contractAddressSelect");
    const resultsContainer = $("contractAddressResults");
    const status = $("contractStatus");

    if (!input || !button || !select || !resultsContainer) return;

    const query = input.value.trim();

    if (query.length < 3) {
        resultsContainer.hidden = true;

        if (status) {
            status.textContent =
                "Introduza pelo menos 3 caracteres para pesquisar.";
        }

        return;
    }

    button.disabled = true;
    button.textContent = "A pesquisar...";

    resultsContainer.hidden = false;
    select.replaceChildren(
        new Option("A procurar moradas...", "")
    );

    try {
        const params = new URLSearchParams({
            text: query,
            filter: "countrycode:pt",
            format: "json",
            lang: "pt",
            limit: "8",
            apiKey: GEOAPIFY_API_KEY
        });

        const response = await fetch(
            `https://api.geoapify.com/v1/geocode/autocomplete?${params}`
        );

        if (!response.ok) {
            throw new Error(`Erro HTTP ${response.status}`);
        }

        const data = await response.json();

        geoapifyAddressResults = data.results || [];

        select.replaceChildren();

        if (!geoapifyAddressResults.length) {
            select.add(
                new Option("Nenhuma morada encontrada", "")
            );

            if (status) {
                status.textContent =
                    "Não foram encontradas moradas. Experimente outra pesquisa.";
            }

            return;
        }

        select.add(
            new Option("Selecione uma morada...", "")
        );

        geoapifyAddressResults.forEach((result, index) => {
            const address =
                result.formatted ||
                result.address_line1 ||
                "Morada sem descrição";

            select.add(
                new Option(address, String(index))
            );
        });

        // Torna visível a área que contém as opções.
        resultsContainer.hidden = false;

        // Seleciona automaticamente a primeira opção como destaque visual.
        select.focus();

        if (status) {
            status.textContent =
                `${geoapifyAddressResults.length} resultado(s) encontrado(s). Selecione a morada pretendida.`;
        }

    } catch (error) {
        console.error("Erro na pesquisa de moradas:", error);

        select.replaceChildren(
            new Option("Erro ao pesquisar moradas", "")
        );

        resultsContainer.hidden = false;

        if (status) {
            status.textContent =
                "Não foi possível pesquisar moradas. Verifique a ligação ou a configuração da API.";
        }

    } finally {
        button.disabled = false;
        button.textContent = "Localizar morada";
    }
}


/* Preencher os campos quando uma morada é selecionada */
function selectContractAddress() {
    const select = $("contractAddressSelect");

    if (!select) return;

    const index = select.value;

    if (index === "") return;

    const result = geoapifyAddressResults[Number(index)];

    if (!result) return;

    const address = result;

    const street = [
        address.street,
        address.housenumber
    ].filter(Boolean).join(", ");

    const locality =
        address.city ||
        address.town ||
        address.village ||
        address.suburb ||
        "";

    const fields = {
        contractStreet: street || address.address_line1 || "",
        contractPostalCode: address.postcode || "",
        contractLocality: locality,
        contractMunicipality: address.county || "",
        contractDistrict: address.state || "",
        contractCountry: address.country || "Portugal"
    };

    Object.entries(fields).forEach(([id, value]) => {
        const field = $(id);
        if (field && value) field.value = value;
    });

    // A Geoapify nem sempre fornece a freguesia de forma estruturada.
    // Não vamos preencher este campo com dados administrativos incertos.

    if (typeof saveContractData === "function") {
        saveContractData();
    }

    const status = $("contractStatus");
    if (status) {
        status.textContent = "Morada selecionada. Confirme os dados antes de gerar o contrato.";
    }
}

/* Eventos da pesquisa */
if ($("searchContractAddress")) {
    $("searchContractAddress").addEventListener("click", searchContractAddress);
}

if ($("contractAddressSearch")) {
    $("contractAddressSearch").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchContractAddress();
        }
    });
}

if ($("contractAddressSelect")) {
    $("contractAddressSelect").addEventListener("change", selectContractAddress);
}
// Regista a gravação automática dos campos que existem no HTML.
CONTRACT_FIELDS.forEach(id => {
    const element = $(id);

    if (element) {
        element.addEventListener("input", saveContractData);
        element.addEventListener("change", saveContractData);
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