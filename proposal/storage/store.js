// ======================================================
// CARTRACK PROPOSAL GENERATOR
// Armazenamento partilhado pelo painel e pré-visualização
// ======================================================

(function (root) {
    "use strict";

    // Referência ao núcleo partilhado da extensão.
    const CT = root.CT;


    // ==================================================
    // CAMPOS E CHAVES DE ARMAZENAMENTO
    // ==================================================

    // Campos principais dos dados do cliente.
    const FIELDS = [
        "company",
        "nif",
        "contact",
        "date",
        "vehicleCount"
    ];

    // Todas as chaves utilizadas para guardar e recuperar uma proposta.
    const KEYS = [
        ...FIELDS,
        "template",
        "greeting",
        "clientType",
        "term",
        "servicesByTpl",
        "services",
        "leadId"
    ];


    // ==================================================
    // CONVERSÃO DOS DADOS PARA O ESTADO DA PROPOSTA
    // ==================================================

    // Combina os dados guardados com os valores por omissão.
    // Devolve um objeto completo, pronto para utilização pelo painel
    // ou pela pré-visualização.
    function toState(saved, { placeholders = false } = {}) {

        // Confirma se o modelo guardado existe.
        // Caso contrário, utiliza o modelo Standard.
        const template = CT.TEMPLATES[saved.template]
            ? saved.template
            : "standard";

        // Recupera os serviços guardados por modelo.
        let byTpl = saved.servicesByTpl;

        // Compatibilidade com versões antigas (v1.2),
        // nas quais os serviços eram guardados numa única lista.
        if (!byTpl && Array.isArray(saved.services)) {
            byTpl = {
                standard: saved.services
            };
        }

        // Recupera os serviços do modelo selecionado.
        // Se ainda não existirem serviços guardados, utiliza os predefinidos.
        const svcs = (byTpl && byTpl[template])
            || CT.TEMPLATES[template].defaults();

        // Devolve o valor guardado ou, quando solicitado,
        // um texto indicativo para os campos ainda vazios.
        const ph = (v, p) =>
            (v && String(v).trim()) || (placeholders ? p : "");

        // Monta o estado completo da proposta.
        return {
            template,

            // Dados do cliente.
            company: ph(saved.company, "[Nome da empresa]"),
            nif: ph(saved.nif, "[NIF]"),
            contact: ph(saved.contact, "[Contacto]"),
            date: ph(saved.date, "[Data]"),
            vehicleCount: ph(saved.vehicleCount, "[N]"),

            // Configurações da proposta.
            greeting: saved.greeting || "auto",
            clientType: saved.clientType || "auto",
            term: saved.term || "36",

            // Serviços normalizados através do núcleo partilhado.
            services: CT.cleanSvcs(svcs)
        };
    }


    // ==================================================
    // EXPORTAÇÃO DO MÓDULO DE ARMAZENAMENTO
    // ==================================================

    // Disponibiliza os campos, as chaves e a função de conversão
    // para os restantes ficheiros da extensão.
    root.CTStore = {
        FIELDS,
        KEYS,
        toState
    };

})(self);


// ======================================================
// CONFIGURAÇÃO DA ASSINATURA DO UTILIZADOR
// ======================================================

// Guarda os dados da assinatura no armazenamento local do Chrome.
// O endereço de e-mail é gerado automaticamente com base no nome.
async function saveUserProfile(name, phone) {
    const profile = {
        name,
        phone,
        email: generateEmail(name),
        configured: true
    };

    await chrome.storage.local.set({
        userProfile: profile
    });
}


// ======================================================
// GERAÇÃO AUTOMÁTICA DO E-MAIL
// ======================================================

// Gera o endereço de e-mail no formato:
// primeiro.ultimo@cartrack.com
//
// Remove acentos e converte os nomes para minúsculas.
function generateEmail(name) {
    const parts = name.trim().split(/\s+/);

    // Normaliza o primeiro nome.
    const first = parts[0]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    // Normaliza o último nome.
    const last = parts[parts.length - 1]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    // Monta o endereço de e-mail.
    return `${first}.${last}@cartrack.com`;
}
