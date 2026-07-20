<div align="center">

# 🛒 SysPlan Web

**Planejamento de compras e importação da Chilli Beans**

Recriação do sistema legado em Microsoft Access como aplicação web moderna,
segura e multiusuário.

`React 18` · `TypeScript` · `Vite` · `Tailwind CSS` · `Supabase (PostgreSQL + Auth + Storage + RLS)` · `Vercel`

</div>

---

## 📌 O que é

O **SysPlan** controla toda a carteira de compras da Chilli Beans — do pedido ao
fornecedor até a chegada da mercadoria no CD — passando por follow-up com
fornecedores e com o agente de carga (comex). Cobre óculos, relógios, smart watches,
acessórios e materiais consumíveis.

Toda a regra de negócio do Access foi preservada, e foram incorporados os controles
de **relógios** (antes uma planilha à parte) e do **agente de carga** (antes a
planilha do despachante Hoffen).

> 📄 Contexto completo da aplicação (para uso com outras IAs): [`docs/CONTEXTO_APLICACAO.md`](docs/CONTEXTO_APLICACAO.md)
> 🔎 Análise do sistema legado: [`docs/ANALISE_LEGADO.md`](docs/ANALISE_LEGADO.md)

## ✨ Principais recursos

- **Lista de Compras** — carteira central com colunas configuráveis, autofiltro estilo
  Excel, filtros em cascata, foto do produto, edição individual (com lock) e em massa.
- **Follow-up Fornecedor** — geração da máscara oficial protegida (senha `Plan8`) por
  chave *Material Pai + Pedido SAP*, e importação da resposta com aplicação na carteira.
- **Follow-up Agente de Carga** e **Lançar no Acompanhamento** — controle do comex com
  status calculado, KPIs e lançamento em lote por modal.
- **Múltiplos Embarques** e **Checks de Recebimento** — conferência MB51 × carteira e
  checks de consistência (PI/PO duplicado, volume, FUP fora do Sysplan).
- **Cadastro de PI** — leitura da Proforma Invoice em Excel, com extração de campos,
  foto e mapa de cores.
- **Administração** — usuários, permissões por tela, parâmetros, importações e logs.
- **Fotos de produto** — comprimidas para ≤ 300 KB antes do upload (Cloudinary), com
  cópia local opcional na máquina do usuário.

## 🔒 Segurança

- **RLS** habilitada em todas as tabelas; acesso por `fn_tem_permissao(tela, editar)`.
- Novos usuários **sempre** nascem com perfil `usuario` (o trigger ignora o perfil
  enviado no cadastro); promoção a admin só por um administrador.
- **Headers** no `vercel.json`: CSP restritivo, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy` e HSTS.
- Segredos (service_role, API secret do Cloudinary) ficam **apenas** em `.env.migration`
  e nunca vão para o navegador.

## 🚀 Implantação

### 1. Criar o banco (uma vez)
No **SQL Editor** do Supabase, execute [`supabase/schema.sql`](supabase/schema.sql)
(consolida as migrations de `supabase/migrations/`): cria tabelas, views, funções,
triggers, RLS, buckets de storage e o catálogo de telas.

> As migrations de ajustes (`supabase/migrations/000NN_*.sql`) também têm cópias avulsas
> em `supabase/ajustes_*.sql` para colar direto no SQL Editor — o DDL é sempre aplicado
> manualmente pelo usuário.

### 2. Migrar os dados do Access
```bash
npm install
npm run migrate:data
```
Usa a chave service_role de `.env.migration`, importa os CSVs de `migration/data/`
em lote (~475 mil registros), ignora duplicados em re-execuções e realinha as sequences.

### 3. Criar o administrador inicial
Defina `ADMIN_EMAIL` / `ADMIN_PASSWORD` em `.env.migration` e rode:
```bash
npm run create-admin
```

### 4. Rodar a aplicação
```bash
npm run dev        # desenvolvimento — http://localhost:5173
npm run build      # build de produção — pasta dist/
npm run preview    # pré-visualiza o build
```
A URL e a chave anônima do Supabase ficam em `.env`. O deploy é automático na **Vercel**
a cada push no repositório da organização.

## 🗂️ Estrutura

```
supabase/           migrations SQL + schema.sql consolidado + ajustes avulsos
migration/data/     CSVs exportados do Access (não versionar)
scripts/            migração de dados, criação do admin e upload de fotos (Node)
docs/               contexto da aplicação e análise do legado
public/             assets estáticos (favicon)
src/
  components/       UI (shadcn-style) + DataTable genérica + layout
  context/          Auth (sessão, perfil, permissões) e tema claro/escuro
  lib/              cliente Supabase, regras de negócio, exportações, imagem, parser de PI
  pages/            compras, followup, comex, pi, pdv, design, admin
  services/         hooks de dados (combos, grupos, essentials, compradores)
  types/            tipos das entidades
```

## 👥 Perfis

| Perfil | Acesso |
| --- | --- |
| **Administrador** | Total. Gerencia usuários, permissões por tela, parâmetros, importações e logs. |
| **Usuário** | Somente as telas liberadas em *Administração → Permissões* (visualizar/editar por tela), aplicado no banco via RLS. |

## 🔌 Fontes externas do legado

Os vínculos ODBC/rede do Access viraram *snapshots* atualizáveis por importação de
planilha em **Administração → Importações** (SAP BW, cadastro de materiais, FUP Comex,
bases de PDV) e no **Follow-up Agente de Carga**. Fotos e arquivos de PI usam Cloudinary
e Supabase Storage.
