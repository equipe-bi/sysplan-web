-- SysPlan Web — Ajustes v2
-- 1) Módulo Acompanhamento de Importações (substitui a planilha do despachante Hoffen)
-- 2) Check de recebimento MB51 x Controle de Compras (com ações)
-- Rodar no SQL Editor do Supabase.

-- =====================================================================
-- 1. ACOMPANHAMENTO DE IMPORTAÇÕES (despachante)
-- =====================================================================

create table if not exists acompanhamento_importacoes (
  id bigint generated always as identity primary key,
  -- snapshot da compra (preenchido pelo planejamento ao gerar pendências)
  cd_compra integer default 0,
  dc_grupo text,
  dc_linha text,
  dc_griffe text,
  dc_canal text,
  dc_fornecedor text,
  cd_ref_fornecedor text,
  cd_material_pai text,
  cd_pedido_fornecedor text,
  cd_pedido_sap text,
  nr_quantidade double precision default 0,
  dt_recebimento date,
  dc_modal text,
  dt_delivery date,
  nr_lead_time double precision,
  dc_data_inicio text,
  -- campos do despachante
  cd_embarque text,               -- Cod Hoffen / processo
  id_origem text,
  dt_entrega_origem_real date,
  dt_etd date,                    -- previsão embarque
  dt_atd date,                    -- embarque real
  dt_eta date,                    -- previsão atraque
  dt_ata date,                    -- atraque real
  hbl text,
  vessel text,
  ctnr text,
  dc_observacoes text,
  -- controle
  dc_status_calculado text,
  chave text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references usuarios (id)
);

create index if not exists idx_acomp_imp_chave on acompanhamento_importacoes (cd_pedido_sap, cd_material_pai);
create index if not exists idx_acomp_imp_status on acompanhamento_importacoes (dc_status_calculado);

-- Status calculado (lógica da planilha BaseHoffen)
create or replace function fn_status_despachante(
  p_atd date, p_entrega_origem date, p_id_origem text, p_etd date, p_delivery date
) returns text language sql immutable as $$
  select case
    when p_atd is not null then 'Embarcado'
    when p_entrega_origem is not null then 'Aguardando Embarque'
    when coalesce(trim(p_id_origem), '') = '' then 'ID Origem não informado'
    when p_etd is not null then 'Data entrega não informada'
    when p_delivery is not null and p_delivery < current_date then 'Pendente entrega na origem - ATRASADO'
    else 'Pendente entrega na origem - NO PRAZO'
  end;
$$;

create or replace function trg_calc_acompanhamento() returns trigger
language plpgsql as $$
begin
  new.dc_status_calculado := fn_status_despachante(
    new.dt_atd, new.dt_entrega_origem_real, new.id_origem, new.dt_etd, new.dt_delivery);
  new.chave := coalesce(new.cd_pedido_sap, '') || coalesce(new.cd_material_pai, '');
  new.nr_lead_time := case
    when new.dt_recebimento is not null and new.dt_delivery is not null
    then new.dt_recebimento - new.dt_delivery
    else new.nr_lead_time
  end;
  new.atualizado_em := now();
  if auth.uid() is not null then
    new.atualizado_por := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists calc_acompanhamento on acompanhamento_importacoes;
create trigger calc_acompanhamento
  before insert or update on acompanhamento_importacoes
  for each row execute function trg_calc_acompanhamento();

-- Gera pendências a partir do Controle de Compras (substitui a lista de entrega enviada ao despachante)
create or replace function fn_gerar_acompanhamento_importacoes() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  insert into acompanhamento_importacoes
    (cd_compra, dc_grupo, dc_linha, dc_griffe, dc_canal, dc_fornecedor, cd_ref_fornecedor,
     cd_material_pai, cd_pedido_fornecedor, cd_pedido_sap, nr_quantidade, dt_recebimento,
     dc_modal, dt_delivery, dc_data_inicio)
  select
    c.cd_compra,
    case when c.dc_grupo = 'MATERIAIS CONSUMIVEIS' then c.dc_subgrupo else c.dc_grupo end,
    c.dc_linha, c.dc_griffe, c.dc_canal, c.dc_fornecedor, c.cd_material_fornecedor,
    c.cd_material_pai, c.cd_pedido_fornecedor, c.cd_pedido_sap, c.nr_quantidade,
    c.dt_recebimento, c.dc_modal, c.dt_revised_delivery,
    upper(to_char(coalesce(c.dt_revised_delivery, c.dt_recebimento), 'TMMon/YY'))
  from controle_compras c
  left join acompanhamento_importacoes a
    on coalesce(c.cd_pedido_sap, '') || coalesce(c.cd_material_pai, '') = a.chave
  where a.id is null
    and c.dc_status is distinct from 'EXCLUIDO'
    and c.dc_modal is distinct from 'ROAD'
    and coalesce(c.cd_pedido_sap, '') <> '' and c.cd_pedido_sap <> 'N/I'
    and to_char(c.dt_recebimento, 'YYYYMM') >= to_char(current_date - interval '1 month', 'YYYYMM');
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Consolidação FUP do despachante agora considera legado + módulo novo
create or replace view vw_resumo_fup_despachante as
with unificado as (
  select cd_pedido_sap, cd_material_pai, cd_embarque, dt_entrega_origem,
         dt_previsao_embarque, dt_embarque_real, dt_previsao_atraque, dt_atraque_real,
         hbl, dc_status_comex, dc_observacao, origem
  from ext_fup_despachante
  union all
  select cd_pedido_sap, cd_material_pai, cd_embarque, dt_entrega_origem_real,
         dt_etd, dt_atd, dt_eta, dt_ata,
         hbl, dc_status_calculado, dc_observacoes, 'App'
  from acompanhamento_importacoes
  where coalesce(cd_pedido_sap, '') <> ''
)
select
  cd_pedido_sap,
  cd_material_pai,
  max(cd_embarque) as cd_embarque,
  max(dt_entrega_origem) as dt_entrega_origem,
  max(dt_previsao_embarque) as dt_previsao_embarque,
  max(dt_embarque_real) as dt_embarque_real,
  max(dt_previsao_atraque) as dt_previsao_atraque,
  max(dt_atraque_real) as dt_atraque_real,
  max(hbl) as hbl,
  max(dc_status_comex) as dc_status_comex,
  max(dc_observacao) as dc_observacao,
  max(origem) as origem
from unificado
group by cd_pedido_sap, cd_material_pai;

-- Tela e RLS
insert into telas (codigo, nome, grupo, ordem) values
  ('acompanhamento_importacoes', 'Acompanhamento de Importações', 'Comex', 5)
on conflict (codigo) do nothing;

alter table acompanhamento_importacoes enable row level security;

drop policy if exists acomp_sel on acompanhamento_importacoes;
create policy acomp_sel on acompanhamento_importacoes for select to authenticated
  using (fn_tem_permissao('acompanhamento_importacoes') or fn_tem_permissao('controle_importacao'));

drop policy if exists acomp_all on acompanhamento_importacoes;
create policy acomp_all on acompanhamento_importacoes for all to authenticated
  using (fn_tem_permissao('acompanhamento_importacoes', true))
  with check (fn_tem_permissao('acompanhamento_importacoes', true));

-- =====================================================================
-- 2. CHECK MB51 x CONTROLE DE COMPRAS
-- =====================================================================
-- Reproduz a conferência Python: cruzamento por Pedido SAP, classificação de
-- divergências de material/mês/ano, recebimento futuro, apenas-MB51/apenas-Controle
-- (ignorando controle do mês atual/futuro) e pedidos duplicados.

create or replace view vw_check_mb51 as
with mb51 as (
  select
    left(s.material, 8) as cd_material_pai,
    max(s.dt_lancamento) as dt_lancamento,
    s.pedido as cd_pedido_sap
  from stg_entrada_sap_mb51 s
  where s.dt_lancamento >= make_date(extract(year from current_date)::int - 1, 1, 1)
  group by left(s.material, 8), s.pedido
),
controle as (
  select
    c.cd_compra,
    c.cd_material_pai,
    c.dt_recebimento,
    c.cd_pedido_sap,
    c.dc_canal,
    c.dc_grupo,
    c.dc_status
  from controle_compras c
  where c.dc_status is distinct from 'EXCLUIDO'
    and c.dt_recebimento >= make_date(extract(year from current_date)::int - 1, 1, 1)
)
select
  coalesce(m.cd_pedido_sap, c.cd_pedido_sap) as cd_pedido_sap,
  m.cd_material_pai as material_mb51,
  c.cd_material_pai as material_controle,
  m.dt_lancamento as dt_mb51,
  c.dt_recebimento as dt_controle,
  c.cd_compra,
  c.dc_canal,
  c.dc_grupo,
  case
    when c.cd_pedido_sap is null then 'Pedido existe apenas no MB51'
    when m.cd_pedido_sap is null then
      case
        when to_char(c.dt_recebimento, 'YYYYMM') < to_char(current_date, 'YYYYMM')
        then 'Pedido existe apenas no Controle'
        else 'OK'
      end
    when c.dt_recebimento > m.dt_lancamento then 'Recebimento futuro'
    when m.cd_material_pai = c.cd_material_pai
     and to_char(m.dt_lancamento, 'YYYYMM') = to_char(c.dt_recebimento, 'YYYYMM') then 'OK'
    when m.cd_material_pai <> c.cd_material_pai
     and to_char(m.dt_lancamento, 'YYYYMM') = to_char(c.dt_recebimento, 'YYYYMM') then 'Material diferente'
    when m.cd_material_pai = c.cd_material_pai
     and to_char(m.dt_lancamento, 'YYYYMM') <> to_char(c.dt_recebimento, 'YYYYMM') then 'Recebido em outro mês'
    when m.cd_material_pai <> c.cd_material_pai
     and to_char(m.dt_lancamento, 'YYYYMM') <> to_char(c.dt_recebimento, 'YYYYMM') then 'Material e mês divergentes'
    else 'Outra divergência'
  end as status
from mb51 m
full outer join controle c on m.cd_pedido_sap = c.cd_pedido_sap;

create or replace view vw_check_mb51_duplicados as
select cd_pedido_sap, count(*) as quantidade
from vw_check_mb51
group by cd_pedido_sap
having count(*) > 1;

create or replace view vw_check_mb51_resumo as
select status, count(*) as quantidade
from vw_check_mb51
where status <> 'OK'
group by status
order by count(*) desc;
