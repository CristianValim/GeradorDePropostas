# CARTRACK PROPOSAL GENERATOR — v1.9.0

## INSTALAÇÃO / ATUALIZAÇÃO

1. Extrai o ZIP para uma pasta.
2. No Chrome, acede a `chrome://extensions` e ativa o **Modo de programador**.
3. Clica em **Carregar expandida** e seleciona a pasta extraída.
4. Para atualizar uma versão existente, substitui os ficheiros antigos pelos novos e clica em **Recarregar** na extensão.

## UTILIZAÇÃO

1. Clica no ícone da extensão para abrir o painel lateral.
2. Escolhe o tipo de proposta e preenche os dados do cliente.
3. Ajusta os serviços, preços e sub-pontos.
4. Para adicionar um serviço predefinido, seleciona-o diretamente no menu suspenso. A linha é adicionada automaticamente.
5. Clica em **Pré-visualizar proposta** para consultar o documento antes de o gerar.
6. Clica em **Gerar documento Word preenchido** para descarregar o ficheiro DOCX.

## ALTERAÇÕES v1.9.0

- Adicionado botão de configuração (⚙) junto ao logótipo CARTRACK para editar os dados da assinatura.
- A edição da assinatura permite atualizar o nome e o número de telemóvel.
- O endereço de e-mail é gerado automaticamente com base no nome introduzido.
- Removida a necessidade de apresentar permanentemente a secção de configuração da assinatura.
- O tratamento da saudação passou a ser totalmente automático, sem necessidade de seleção manual no painel.
- Driver ID passa a aparecer como primeira opção no menu de serviços predefinidos.
- Removida a opção inicial "Seleciona um serviço…" do menu suspenso.
- Melhorada a organização e documentação interna do código.

## ALTERAÇÕES v1.8.0 — MODELOS VISION

- Novos modelos no seletor: **Vision** e **Vision TVDE** (ficheiros `template-vision.docx` e `template-vision-tvde.docx`).
- Vision: identificação automática de empresa ou particular pelo nome (termina em Lda, Limitada, Unipessoal, SA, S.A., SGPS ou CRL = empresa).
- A identificação pode ser corrigida no campo "Tipo de cliente" (Automático / Empresa / Particular).
- Empresa: capa com Empresa, Nº Contribuinte, A/c e Data.
- Particular: capa só com Nome e Data (as linhas de NIF e A/c são removidas e a Data sobe).
- Vision TVDE: capa só com Nome e Data, sem informação sobre IA.
- Vision TVDE: tabela com Cartrack Dual Vision, Sistema Base – Localização (OFERTA) e E-taco Lite (OFERTA).
- A quantidade de viaturas no modelo TVDE fica definida como 1 quando o campo está vazio.
- Nos modelos Vision, o painel esconde NIF/Contacto quando não se aplicam, muda "Empresa" para "Nome" e esconde o tratamento (sem saudação).
- A fidelização escolhida atualiza "Fidelização: N meses" no modelo Vision.
- Sub-pontos com * continuam a sair da tabela para um parágrafo abaixo.
- Corrigida a ordem do alinhamento nas células (o Word podia assinalar o documento como inválido).

## ALTERAÇÕES v1.7.0

- Ao adicionar Inibição de arranque, o Driver ID é incluído automaticamente caso ainda não exista na lista.
- Lembretes e Formação da Plataforma ficam sempre nas duas últimas linhas, por esta ordem.
- Novos serviços são posicionados após Sistema Base/Ligação CAN-BUS e antes das duas linhas finais.

## ALTERAÇÕES v1.5

- Removido o modelo de proposta Driver ID.
- Removido o serviço pronto Driver ID. A Inibição de arranque mantém a indicação de que requer Driver ID.
- A seleção de um serviço pronto no menu suspenso adiciona-o automaticamente; removido o botão de confirmação.
- Removidos os botões e a funcionalidade de exportação PDF da extensão e da pré-visualização.

## ALTERAÇÕES v1.4

- Valores numéricos e ofertas centrados horizontal e verticalmente nas células da tabela.
- Notas adicionais iniciadas por * são retiradas da tabela e apresentadas num parágrafo imediatamente abaixo, em fonte 10 pt.
- Nomes dos modelos simplificados no seletor (sem as indicações "sem CAN-BUS" / "exige CAN-BUS").
- Máquinas usa a linha unificada "Sistema Base + Ligação CAN-BUS – Localização + Controlo de abastecimentos" a 11,00 €.
- Serviços prontos: Imobilização remota (0,00 € mensal / 100,00 € instalação) e Inibição de arranque.

## PRIVACIDADE

Os dados das propostas e a configuração da assinatura continuam guardados localmente no Chrome, através do armazenamento local da extensão.