# SysPlan Web

Recriação do SysPlan (Microsoft Access) como aplicação web moderna:
**Supabase (PostgreSQL + Auth + Storage + RLS) · React 18 · TypeScript · Vite · Tailwind CSS · Lucide Icons**.

A análise completa do sistema legado está em [docs/ANALISE_LEGADO.md](docs/ANALISE_LEGADO.md).

## Passo a passo de implantação

### 1. Criar o banco (uma vez)
Abra o **SQL Editor** do projeto Supabase e execute o conteúdo de
[`supabase/schema.sql`](supabase/schema.sql) (o arquivo consolida as migrations de
`supabase/migrations/`). Isso cria todas as tabelas, views, funções, triggers, RLS,
buckets de storage e o catálogo de telas.

### 2. Migrar os dados do Access
Os dados exportados do Access estão em `migration/data/*.csv` (~475 mil registros).
Com o schema aplicado:

```bash
npm install
npm run migrate:data
```

O script usa a chave service_role de `.env.migration`, importa todos os CSVs em lote,
ignora duplicados em re-execuções e realinha as sequences ao final.

### 3. Criar o administrador inicial
Defina `ADMIN_EMAIL` / `ADMIN_PASSWORD` em `.env.migration` (já preenchidos) e rode:

```bash
npm run create-admin
```

### 4. Rodar a aplicação

```bash
npm run dev        # desenvolvimento (http://localhost:5173)
npm run build      # build de produção (pasta dist/)
```

A URL e a chave anônima do Supabase ficam em `.env`.

## Estrutura

```
supabase/           migrations SQL + schema.sql consolidado
migration/data/     CSVs exportados do Access (não versionar)
scripts/            migração de dados e criação do admin (Node)
src/
  components/       UI (shadcn-style) + DataTable genérica + layout
  context/          Auth (sessão, perfil, permissões) e tema claro/escuro
  lib/              supabase client, regras de negócio, exportações, parser de PI
  pages/            compras, followup, comex, pi, pdv, design, admin
  services/         hooks de dados (combos, grupos, essentials, compradores)
  types/            tipos das entidades
```

## Perfis e permissões

- **Administrador**: acesso total; gerencia usuários (criar, editar, bloquear, resetar senha),
  permissões por tela, parâmetros (PRM Combos, Grupo Planejamento, Definição de Custo etc.),
  importações de bases externas e logs.
- **Usuário**: acessa apenas as telas liberadas em *Administração → Permissões*
  (visualizar/editar por tela). O controle é feito no banco via RLS
  (`fn_tem_permissao`), não apenas na interface.

## Fontes externas do legado

Os vínculos ODBC/rede do Access viraram *snapshots* atualizáveis por importação de
planilha em **Administração → Importações** (extrator SAP BW, cadastro de materiais,
base FUP Comex, bases de PDV) e **Controle de Importação → Sincronizar Despachante**
(planilha Hoffen). As fotos de produto e arquivos de PI usam o Supabase Storage
(buckets `fotos-produto` e `arquivos-pi`).
