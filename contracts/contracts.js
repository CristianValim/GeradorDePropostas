
/* ======================================================
   CARTRACK PROPOSAL GENERATOR
   Registo e configuração dos modelos de contratos
   ====================================================== */

(function (root) {
    "use strict";

    // ==================================================
    // CONFIGURAÇÃO DOS CONTRATOS
    // ==================================================

    const REGISTRY = {

        // ----------------------------------------------
        // CONTRATO DE GESTÃO DE FROTAS
        // ----------------------------------------------

        fleet: {
            id: "fleet",
            name: "Contrato de Gestão de Frotas",
            file: "contracts/templates/contrato-frota.pdf",

            // Secções e campos do formulário.
            sections: [
                {
                    title: "Dados da empresa",
                    fields: [
                        {
                            key: "company",
                            label: "Nome da empresa",
                            pdf: "empresa",
                            required: true
                        },
                        {
                            key: "nif",
                            label: "NIF",
                            pdf: "nif",
                            required: true
                        },
                        {
                            key: "address",
                            label: "Morada",
                            pdf: "morada",
                            required: true
                        },
                        {
                            key: "postalCode",
                            label: "Código postal",
                            pdf: "codigo_postal",
                            required: true
                        },
                        {
                            key: "contact",
                            label: "Pessoa de contacto",
                            pdf: "contacto"
                        },
                        {
                            key: "phone",
                            label: "Telefone",
                            pdf: "telefone"
                        },
                        {
                            key: "email",
                            label: "E-mail",
                            pdf: "email"
                        }
                    ]
                },

                {
                    title: "Dados do contrato",
                    fields: [
                        {
                            key: "date",
                            label: "Data do contrato",
                            pdf: "data_contrato",
                            default: "today",
                            required: true
                        },
                        {
                            key: "term",
                            label: "Período de fidelização",
                            pdf: "fidelizacao",
                            required: true
                        }
                    ]
                }
            ],

            // Configuração da tabela de viaturas.
            vehicles: {
                max: 20,

                attachedFlag: {
                    key: "vehiclesAttached",
                    pdf: "anexo_viaturas"
                },

                rows: [],

                categories: [],
                cutoffs: []
            },

            // Campos obrigatórios adicionais.
            required: [
                ["company", "Nome da empresa"],
                ["nif", "NIF"],
                ["address", "Morada"]
            ]
        }

    };


    // ==================================================
    // FUNÇÕES AUXILIARES
    // ==================================================

    // Formata valores monetários.
    function fmtMoney(value) {
        const number = Number(
            String(value ?? "")
                .replace(",", ".")
                .replace(/[^\d.-]/g, "")
        );

        if (!Number.isFinite(number)) return "";

        return number.toFixed(2).replace(".", ",");
    }


    // ==================================================
    // EXPORTAÇÃO
    // ==================================================

    root.CTContracts = {
        REGISTRY,
        fmtMoney
    };

})(self);
