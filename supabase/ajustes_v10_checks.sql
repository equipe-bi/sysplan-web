-- SysPlan Web — v10: checks de recebimento legados que faltavam.
-- Rodar no SQL Editor do Supabase.

-- Diferença de volume MB51 x Controle (>= 10%) no mesmo ano (Qry_CheckRecebimento_VolumeDif)
create or replace view vw_check_volume_dif as
select
  m.material_pai,
  m.pedido as cd_pedido_sap,
  m.qtde as qtd_mb51,
  c.nr_quantidade as qtd_sysplan,
  m.dt_recebimento as dt_mb51,
  c.dt_recebimento as dt_sysplan,
  round((1 - m.qtde / nullif(c.nr_quantidade, 0))::numeric, 3) as dif_volume
from vw_resumo_entrada_mb51 m
join controle_compras c
  on c.cd_material_pai = m.material_pai and c.cd_pedido_sap = m.pedido
where c.dc_status is distinct from 'EXCLUIDO'
  and extract(year from m.dt_recebimento) = extract(year from c.dt_recebimento)
  and nullif(c.nr_quantidade, 0) is not null
  and abs(1 - m.qtde / c.nr_quantidade) >= 0.1;

-- FUP Comex sem correspondência no Controle de Compras (Qry_CheckRecebimento_FupComex_ForaSysplan)
create or replace view vw_check_fup_comex_fora_sysplan as
select
  x.cd_embarque,
  x.cd_pedido_sap,
  x.cd_material_pai,
  x.dt_embarque_real,
  x.dt_atraque_real,
  x.dt_chegada_cb,
  x.nr_quantidade,
  x.nr_fob_total,
  x.dc_status_comex
from vw_resumo_fup_comex x
left join controle_compras c
  on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
 and c.dc_status is distinct from 'EXCLUIDO'
where c.cd_compra is null
  and x.nr_quantidade >= 200
  and coalesce(x.dt_chegada_cb, x.dt_atraque_real, x.dt_embarque_real) >= '2024-01-01';

-- Diferença de volume FUP Comex x Controle (>= 100 un) por embarque (Qry_CheckRecebimento_FupComex_DifVolume)
create or replace view vw_check_fup_comex_dif_volume as
select
  c.dc_grupo,
  c.dc_canal,
  x.cd_embarque,
  x.cd_pedido_sap,
  x.cd_material_pai,
  sum(x.nr_quantidade) as qtde_fup,
  sum(c.nr_quantidade) as qtde_sysplan,
  sum(x.nr_quantidade) - sum(c.nr_quantidade) as dif_qtde,
  max(c.dt_recebimento) as ult_recebimento
from vw_resumo_fup_comex x
join controle_compras c
  on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
where c.dc_status is distinct from 'EXCLUIDO'
group by c.dc_grupo, c.dc_canal, x.cd_embarque, x.cd_pedido_sap, x.cd_material_pai
having abs(sum(x.nr_quantidade) - sum(c.nr_quantidade)) >= 100
   and max(c.dt_recebimento) >= '2024-01-01';
