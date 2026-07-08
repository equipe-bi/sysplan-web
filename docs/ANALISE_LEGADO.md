# SysPlan — Engenharia Reversa do Sistema Access

Análise completa dos arquivos `SysPlan_BD.accdb` (backend) e `SysPlan_Front_V1.39.accdb` (frontend),
base para a recriação do sistema como aplicação web (Supabase + React).

## 1. Visão geral

O SysPlan é o sistema de **planejamento de compras e importação de produtos** (óculos, relógios,
smart watches, materiais consumíveis) usado pelo time de Planejamento. Principais domínios:

1. **Controle de Compras** (`DM_ControleCompras`) — carteira de compras com ~18.800 registros.
   Cada linha é uma compra (SKU pai + pedido) com atributos de produto, valores (FOB, preço
   varejo, margem), datas (recebimento, delivery, revised delivery) e status.
2. **Follow-up de Fornecedor** (`DM_FollowUp_Fornecedor`) — ciclos de cobrança de status junto
   ao fornecedor, com proposta de nova data de delivery, avaliação do comprador e baixa automática.
3. **Follow-up Comex / Despachante** (`EXT_FUP_Comex`, `EXT_FUP_Despachante`) — rastreamento de
   embarques (entrega na origem, embarque, atraque, chegada CB) vindos de bases externas
   (Comex e planilha do despachante Hoffen).
4. **Cadastro de PI** (Proforma Invoice) — importação de arquivos Excel de PI do fornecedor com
   extração automática de campos, foto do produto e mapa de cores (C1..C8), tradução
   inglês→português e vínculo com a compra.
5. **Cadastro de PDV** — vínculo entre lojas SAP e PDVs (tabelas `CIG_*` em SQL Server externo).
6. **Parâmetros** — combos por grupo (`PRM_Combos`), grupo de planejamento
   (`PRM_Grupo_Planejamento`), custos para cálculo de margem (`PRM_Definicao_Custo`),
   cluster de compradores (`PRM_Cluster_Comprador`), ajustes de FOB e pedido SAP, de-para de
   múltiplos embarques.
7. **Usuários e Log** (`DM_Usuarios`, `DM_RegistroTransacao_Usuario`) — acesso por login de rede
   e auditoria completa (285 mil registros).

## 2. Arquitetura legada

- Frontend `.accdb` com formulários/VBA, vinculado ao backend por rede (`\\srvfs\...\SysPlan_BD.accdb`).
- Backend também possui links: extrator SAP BW (`dbo./BIC/OHZSETTB023` via ODBC "ServidorIntermediario",
  base OTB), base Comex (`EXT_FUP_Comex` em `DB_BaseRentabilidade.accdb`) e cadastro de materiais
  (`DB_Cadastro.accdb`, indisponível no momento da análise).
- Frontend liga também no SQL Server "ServerBI", database PLANEJAMENTO, schema CIG (PDV/Lojas).
- Controle de versão manual: `PRM_Versao.VersaoAtual` vs cópia local (`Aux_Local`); ao divergir,
  copia novo frontend da rede e recria atalho (função `Check_Versao`).

## 3. Tabelas (backend)

| Tabela | Linhas | Papel |
|---|---|---|
| DM_ControleCompras | 18.794 | Carteira de compras (tabela central). PK `CD_Compra` autonum |
| DM_FollowUp_Fornecedor | 54.998 | Ciclos de follow-up por compra. PK `CD_FollowForn` |
| DM_RegistroTransacao_Usuario | 285.599 | Log de auditoria. PK implícita `CD_Transacao` |
| DM_Usuarios | 33 | Usuários (login de rede, e-mail, filtro comprador padrão) |
| DM_Cadastro_Essential | 108 | Produtos linha Essential. PK `CD_Essential` |
| DM_DePara_Essential | 501 | De-para MaterialPai/RefExportador → Essential |
| EXT_FUP_Comex | 9.867 | Embarques Comex (linked, snapshot migrado) |
| EXT_FUP_Despachante | 4.890 | Embarques informados pelo despachante (Hoffen) |
| EXT_Pedido_SAP | 0 | Snapshot de pedidos SAP (alimentado do BW) |
| dbo_/BIC/OHZSETTB023 | 77.286 | Extrator SAP BW de pedidos (linked ODBC) |
| PRM_Combos | 900 | Opções de combo por grupo e tipo (`CD_Grupo`, `DC_TipoCombo`, `DC_Combo`) |
| PRM_Grupo | 11 | Grupos de produto |
| PRM_Grupo_Planejamento | 869 | Grupo+SubGrupo+Sexo+Formato → Grupo de Planejamento (PK composta) |
| PRM_Definicao_Custo | 1.512 | Canal+Grupo+Modal+AnoMes → Dólar, Fator Imp., Markup, Valor Agregado |
| PRM_Cluster_Comprador | 43 | Grupo+Canal → Comprador, CompradorGrupo |
| PRM_Ajuste_FOB | 1.297 | Ajuste manual de FOB por PedidoSAP+MaterialPai |
| PRM_Ajuste_PedidoSAP_Cadastro | 2.659 | Correção em massa de PedidoSAP/MaterialPai por ID |
| PRM_DePara_Pedido_MultiplosEmbarques | 232 | Pedido com múltiplos embarques → pedido ajustado |
| PRM_Versao | 1 | Versão atual do frontend |
| Tabela1/2/3, "Erros ao colar" | — | Tabelas temporárias de manutenção (não migradas) |

Tabelas locais do frontend migradas como parâmetros/dados:
`PRM_Campos_EdicaoMassa_Compras` (38 — mapa de campos da edição em massa),
`PRM_Cor_PI` (47 — dicionário de tradução de cores), `PRM_DePara_CamposPI` (444 — de-para de
valores da PI para combos), `PRM_Lista_Compras` (50 — configuração de colunas/filtros da lista),
`DM_Pasta_PI` (6.510 — histórico de arquivos PI processados), `DM_Desenvolvimento_Design` e
`DM_CartelaCor_Design` (módulo de design, vazio). Tabelas `STG_*`/`TEMP_*`/`AUX_*` são staging
de importações e foram substituídas por fluxo web.

## 4. Regras de negócio (extraídas do VBA)

### 4.1 Acesso e auditoria
- `AcessoUsuario`: login de rede deve existir em `DM_Usuarios`, senão bloqueia ("Sem Acesso") e registra log.
- `RegistraTransacao(transacao, item, infoAnterior, infoAtual, campo)`: INSERT em
  `DM_RegistroTransacao_Usuario` com timestamp. Registrado em: entrada/saída do sistema, consulta,
  criação, alteração (campo a campo), exclusão, importações, exportações, avaliações.
- Edição de compra usa **lock de registro**: `DC_BloqueioEdicao='SIM'` + `CD_UsuarioBloqueio` ao
  abrir; liberado ao fechar. Outro usuário não consegue abrir a edição.
- Cada usuário tem `DC_FiltroComprador` — se diferente de "GERAL", a lista de compras abre
  filtrada pelo seu comprador.

### 4.2 Cálculo de margem (`CalcMargem`)
```
parâmetros de PRM_Definicao_Custo (por Canal, Grupo, Modal, AnoMes = YYYYMM da DT_Recebimento):
  Custo   = FOB * NR_Fator_Imp * NR_Dolar
  Atacado = PrecoVarejo / NR_MarkUp - NR_ValorAgregado
  Margem  = 1 - Custo / Atacado
```
FOB usado: FOB SAP (Σ NR_ValorFOB / Σ NR_Quantidade de `EXT_Pedido_SAP` por PedidoSAP+MaterialPai)
se > 0, senão FOB negociado (`Fob_Calc`).

### 4.3 Tamanho do produto (`Define_TamanhoProduto`)
- Grupos OCULOS/MULTI/VISTA: medidas "lente-ponte-haste" → LentePonte = lente+ponte
  (0 se inválido/ponte>40): ≤68 P; ≤73 M; ≤76 G; >76 GG; senão N/I.
- RELOGIO/SMART WATCH: medida única por sexo.
  Masculino/Unissex: ≤36 PPP; ≤40 PP; ≤43 P; ≤47 M; ≤51 G; >51 GG.
  Feminino: ≤28 PPP; ≤32 PP; ≤36 P; ≤40 M; ≤43 G; >43 GG. 0/N-numérico → N/I.

### 4.4 Lead time
`NR_LeadTime = DT_Recebimento - DT_RevisedDelivery` (dias).

### 4.5 Grupo de planejamento
Lookup em `PRM_Grupo_Planejamento` por (Grupo, SubGrupo, Sexo, Formato). Obrigatório ao salvar.
Query administrativa `Qry_Recalcular_GrupoPlanejamento` reaplica em massa; `Qry_Valida_GP_NaoCadastrado`
lista combinações sem cadastro.

### 4.6 Validações do formulário de compra (criar/editar)
Obrigatórios: Canal, GrupoPlanejamento, Linha, Griffe, FobNegociado>0, Quantidade>0,
PreçoVarejo>0, Modal, LeadTime>0; se Linha="ESSENTIAL", `CD_Essential` obrigatório.
No cadastro PI adicionalmente: CD Sysplan válido, Delivery, Recebimento, PI, Ref Fornecedor.
Exclusão é **lógica**: `DC_Status='EXCLUIDO'` (nunca delete físico).
`NR_TotalFOB` alterado recalcula `NR_FobNegociado = TotalFOB/Quantidade`.

### 4.7 Combos dinâmicos (`PRM_Combos`)
Tipo de combo + grupo determinam opções. Grupo "2" = combos gerais (STATUS, CANAL, SEXO,
SEGMENTACAO, LINHA, GRIFFE, FORNECEDOR, FUP PRODUTO); os demais (SUB GRUPO, FORMATO,
MATERIAL 1/2, ATRIBUTO 1/2, MODAL, INFO 1..4) dependem do grupo selecionado.
Labels dos campos Info variam por grupo (ex.: RELOGIOS → Tipo Pulseira, Tipo Dial, Numero Dial,
Tipo Visor, Numero CB, Numero Maquina, Codigo Maquina; VISTA/OCULOS/KIDS/TEEN → Spring Hinge,
Nose Pad; MULTI → + Numero/Tipo Clip on).

### 4.8 Lista de compras (tela principal)
- Colunas, larguras, ordem, formato, filtro e ordenação configuráveis por `PRM_Lista_Compras`
  (Campo, Exibir, TipoFiltro [=, <>, Like, Between, >=], Filtro, OrderBy, LarguraColuna...).
- Fonte: `Qry_ControleCompras_Lista` (compras não excluídas + Margem_Calc + Tamanho_Calc +
  Fob_Calc + dados FUP consolidados + comprador via cluster + Essential_Calc).
- Filtro padrão ao abrir: comprador do usuário (se não GERAL) + AnoMes >= (hoje-10 dias).
- Ações: novo registro, edição (com lock), exclusão lógica, ajuste de DT_Recebimento em massa
  para linhas selecionadas, filtros avançados, redimensionar colunas, foto do produto
  (`\\srvfs\...\13. FOTOS MIX\NAY -MIX\{RefFornecedor}.jpg`).

### 4.9 Edição em massa (Excel)
- **Exportar**: exige grupo/comprador selecionado; gera Excel com base filtrada + abas de listas
  suspensas alimentadas por PRM_Combos/PRM_Grupo/Essential/GrupoPlanejamento.
- **Importar**: valida `DC_StatusEdicao` ∈ {OK - Edição, OK - Nova Linha} e datas preenchidas.
  Compara linha editada vs original via hash (campo `Chave` concatenando todos os campos).
  Para cada campo do mapa `PRM_Campos_EdicaoMassa_Compras` com diferença: UPDATE do campo em
  `DM_ControleCompras` + log campo a campo (info anterior/atual). Novas linhas
  (`OK - Nova linha`, CD_Compra nulo) → INSERT. Mostra contagem antes de aplicar.

### 4.10 Follow-up de fornecedor
- **Geração de necessidade** (`Qry_Necessidade_FollowUp_Fornecedor`): compras com
  DT_Recebimento >= início do mês, com PI válida, sem entrega na origem no Comex e sem follow
  pendente → cria follow "PENDENTE" com snapshot de delivery/recebimento/modal originais.
- **Baixa automática** (`Qry_FollowFornecedor_BaixaAutomatica` + update): follows abertos com
  recebimento antigo (< mês corrente) ou já embarcados no Comex → status
  "Embarcado processo: X"/"Recebimento mês anterior", avaliação "BAIXA AUTOMATICA", encerra.
- **Exportar**: um arquivo Excel por fornecedor (template Orders protegido) com follows pendentes.
- **Importar resposta**: valida preenchimento (Production Status, Revised Delivery; avaliação do
  comprador, novos recebimento/delivery/modal, avaliação final ≠ pendências). Atualiza follow
  (status fornecedor, obs, delivery proposta, BL, avaliações, datas, fim follow-up = hoje) e
  aplica na compra: novo delivery (sempre que difere), novo modal (se difere), novo recebimento
  (somente se recebimento da compra ainda é o original). Tudo logado campo a campo.
- **Avaliação individual**: comprador avalia proposta (tela Avaliação), grava
  DC_Avaliacao_Comprador/observação/data.
- `AvaliacaoFollow_fornecedor`: status com "WAIT" ou delivery proposta ≠ atual → "PENDENTE", senão "OK".
- Filtros de listagem: último follow com resposta (`DT_Fim_FollowUp` máximo), aguardando resposta
  (fim nulo), por fornecedor/canal/grupo/PI/Ref/PO/MaterialPai/Griffe/comprador.

### 4.11 Consolidação FUP (Comex > Despachante > Fornecedor)
- `Qry_Resumo_FUP_Comex`: agrega EXT_FUP_Comex por PedidoSAP(+ajuste múltiplos embarques)+MaterialPai,
  excluindo status "AE - AG ENTREGA NA ORIGEM"; pega máximos de datas e soma de qtde/FOB.
- `Qry_Resumo_FUP_Despachante`: agrega EXT_FUP_Despachante por PedidoSAP+MaterialPai.
- `PriorizaInfo_Comex` → InfoUsar: 3=Comex (exceto AG ENTREGA ORIGEM; caso especial
  "LE - AG EMBARQUE"+"Embarcado" no despachante → 2), 2=Despachante (exceto pendente origem /
  ID não informado), 1=Fornecedor, 0=sem info.
- `Qry_Resumo_FUP_Geral` consolida por compra: ProcessoCalc (embarque/BL), StatusCalc,
  EntregaCalc, PrevEmbarque/Embarque, PrevAtraque/Atraque conforme InfoUsar.
- `GrupoStatus_Comex` classifica para o painel: Delivery futuro (delivery > hoje-7);
  DELIVERED → fora base despachante / confirmar entrega origem (com processo) / delivery sem BL;
  WAITING - BOARDING INSTRUCTION → "COMEX - Pendente SO"; senão "PRODUTO - Pendencia Follow up".
- Painel Controle Importação: status agrupados com Σ quantidade + detalhe por status; filtros
  canal/grupo/griffe/AnoMes início-fim (default mês atual → +100 dias); exclui Modal ROAD e
  recebimento < mês anterior.
- **Sincronizar despachante**: importa planilha Hoffen → `STG_FupComex_Hoffen` → recarrega
  `EXT_FUP_Despachante` (exclui cancelados, exige Pedido SAP e Material Pai válidos).
- **Lista de entrega na origem**: por mês de delivery, com validação
  `Validacao_ListaEntrega`: lead time dentro do esperado por modal (AIR 15–59; outros 60–100),
  status "Aberto"=erro "Pedido em Aberto", MaterialPai com 8 chars, PedidoSAP com 10 chars.
- **Múltiplos embarques**: detecta pedidos com >1 embarque (`Qry_FupComex_MultiplosEmbarques`),
  alimenta de-para, usuário informa `CD_PedidoSAP_Ajuste`; exporta pendentes de abertura.
- **Checks de recebimento** (consultas de auditoria): FupComex fora do Sysplan, diferença de
  volume (>±100 un. ou ±10%), mês/ano divergente SAP vs Sysplan, pedido duplicado, pedido manual,
  sem recebimento, processo com 2 datas.

### 4.12 Cadastro de PI (importação de Proforma Invoice)
- Seleciona Excel; copia para pasta temp com nome `usuario - data - arquivo`.
- `AvaliaPI` procura células por rótulos ("Sysplan number", "PI number", "Delivery Date",
  "Ref. Supplier", "Supplier Name", "Qty Total", "Total:", materiais/atributos, "SIZE CODE" etc.),
  extrai foto do produto (shape próximo de "PRODUCT PHOTO") e mapa de cores C1..C8
  (Lens/Frame/Temple Color+Description, Qty per Color, Unit Price).
- Tradução automática de cores/acabamentos EN→PT via `PRM_Cor_PI` (por tipo: COR BASE,
  DETALHE LENTE, ACABAMENTO PINTURA, TIPO PINTURA; ordem de pesquisa) e de valores de combos
  via `PRM_DePara_CamposPI` (por grupo+tipo de combo).
- Se PI contém "Sysplan number" busca a compra e preenche; senão o usuário pesquisa
  (por CD ou lista de pedidos em aberto — status ABERTO).
- Ao salvar: mesmas validações de compra + atualiza `DM_ControleCompras`
  (Delivery e RevisedDelivery = Delivery da PI), log campo a campo ("EdicaoCompra - IMPORT PI"),
  arquiva PI em `PI_Carregada_Sysplan/{PI}.ext` e foto em pastas de fotos (nome = RefFornecedor).
- `ImportPI`/`Mapear_ArquivosPI`: varredura em lote da pasta `PI_FORNECEDor` → `DM_Pasta_PI`.

### 4.13 Cadastro PDV
- Lista lojas SAP (`CIG_EXT_0002_BaseCadastroPDV` + `CIG_DM_0002_CadastroLoja`) com filtros e
  opção "somente pendentes" (sem `Id_PDV` no de-para).
- Vincular: valida PDV existente e CD_SAP não vinculado → INSERT no de-para.
- Novo PDV: cria PDV a partir da loja (INSERT em `CIG_DM_0002_CadastroPDV`), pega Id máximo e
  vincula no de-para.

### 4.14 Rotinas administrativas (backend)
- `Qry_Atualizar_Pedido_SAP`: recarrega `EXT_Pedido_SAP` do extrator BW (+cores do cadastro de material).
- `Qry_AjusteManual_Fob`: aplica `PRM_Ajuste_FOB` nas compras (FobNegociado, FobReal, TotalFOB=Qtde*Fob).
- `Qry_Atualizacao_AtualizacaoCadastro`: aplica `PRM_Ajuste_PedidoSAP_Cadastro` (por ID + conferência
  PI/Ref) atualizando PedidoSAP/MaterialPai; `Qry_Erro_AtualizacaoCadastro` lista divergências.
- `Qry_Atualiza_DePara_Essential_*`: alimenta `DM_DePara_Essential` a partir das compras Essential.
- Checks de duplicidade: `Qry_Check_PI_Duplicado`, `Qry_Check_PO_Duplicado`.

## 5. Decisões de migração

| Legado | Web |
|---|---|
| Login por usuário de rede | Supabase Auth (e-mail/senha) + perfis Admin/Usuário + permissões por tela no banco |
| Lock de edição via campo | Lock mantido (campos `bloqueio_edicao`/`usuario_bloqueio`) com liberação automática |
| `PRM_Lista_Compras` global | Configuração de colunas/filtros por usuário (tabela própria), com padrão do sistema |
| Excel de edição em massa | Exportar/importar Excel/CSV na própria tela com validação e relatório de inconsistências |
| Excel de follow-up por fornecedor | Exportação por fornecedor + importação de respostas com validação |
| PI via macro Excel/COM | Upload do arquivo PI (xlsx) com parser no navegador + Supabase Storage para arquivo/foto |
| Fotos em rede (`\\srvfs`) | Supabase Storage (bucket `fotos-produto`), nome = ref fornecedor |
| Links ODBC (SAP BW, CIG SQL Server) | Snapshots migrados + telas de importação para atualização periódica |
| Funções VBA | Funções SQL (margem, tamanho, lead time, status comex) + serviços TypeScript |
| `DM_RegistroTransacao_Usuario` | `log_transacoes` + triggers/serviço de auditoria |
| Versionamento manual do front | Deploy web (irrelevante) — tabela mantida apenas como histórico |
