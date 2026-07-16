-- SysPlan Web — v6
-- 1) Trava: data de recebimento passada (ontem para trás) só pode ser alterada
--    pela tela de Check de Recebimento (via fn_corrigir_recebimento)
-- 2) Unificação: dc_info7 (demais categorias) migra para dc_gaveta (nome final: GAVETA)
-- 3) Últimas alterações (log) expostas na view da lista de compras
-- Rodar no SQL Editor do Supabase.

-- =====================================================================
-- 1. TRAVA DA DATA DE RECEBIMENTO PASSADA
-- =====================================================================
create or replace function trg_calcula_controle_compras() returns trigger
language plpgsql as $$
begin
  -- Recebimento já ocorrido (ontem para trás) é imutável fora do Check de Recebimento.
  -- A tela de Check usa fn_corrigir_recebimento, que arma a flag de liberação.
  if tg_op = 'UPDATE'
     and old.dt_recebimento is not null
     and old.dt_recebimento < current_date
     and new.dt_recebimento is distinct from old.dt_recebimento
     and coalesce(current_setting('app.liberar_recebimento', true), '') <> '1'
  then
    raise exception 'Data de recebimento passada (%) não pode ser alterada pela lista de compras. Use a tela Checks de Recebimento.', old.dt_recebimento;
  end if;

  new.nr_lead_time := case
    when new.dt_recebimento is not null and new.dt_revised_delivery is not null
    then new.dt_recebimento - new.dt_revised_delivery
    else new.nr_lead_time
  end;
  new.nr_anomes := case
    when new.dt_recebimento is not null then to_char(new.dt_recebimento, 'YYYYMM')::numeric
    else new.nr_anomes
  end;
  new.dc_tamanho := coalesce(fn_tamanho_produto(new.dc_grupo, new.dc_medidas, new.dc_sexo), new.dc_tamanho);
  new.atualizado_em := now();
  return new;
end;
$$;

-- Correção de recebimento autorizada (usada pela tela Checks de Recebimento)
create or replace function fn_corrigir_recebimento(p_cd_compra integer, p_data date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not fn_tem_permissao('checks_recebimento', true) then
    raise exception 'Sem permissão para corrigir recebimento (tela Checks de Recebimento).';
  end if;
  perform set_config('app.liberar_recebimento', '1', true);
  update controle_compras set dt_recebimento = p_data where cd_compra = p_cd_compra;
  perform set_config('app.liberar_recebimento', '', true);
end;
$$;

-- =====================================================================
-- 2. UNIFICAÇÃO GAVETA (dc_info7 -> dc_gaveta em todas as categorias)
-- =====================================================================
update controle_compras
set dc_gaveta = coalesce(nullif(dc_gaveta, ''), nullif(dc_info7, '')),
    dc_info7 = null
where coalesce(dc_info7, '') <> '';

-- Coluna disponível na configuração da lista (oculta por padrão)
insert into prm_lista_compras (campo, exibir, legenda_exibicao, tipo_dado, ordem, largura_coluna, tipo_filtro, filtro, order_by)
values ('DC_Gaveta', 'NAO', 'Gaveta', 'Texto', 60, 100, '', '', 'NAO')
on conflict (campo) do nothing;

-- =====================================================================
-- 3. ÚLTIMA ALTERAÇÃO NA VIEW DA LISTA
-- =====================================================================
drop view if exists vw_controle_compras_lista;
create view vw_controle_compras_lista as
select
  c.*,
  case when fob.fob_sap > 0 then fob.fob_sap else c.nr_fob_negociado end as fob_calc,
  case
    when cu.nr_markup is null or cu.nr_markup = 0 then null
    when (c.nr_preco_varejo / cu.nr_markup - cu.nr_valor_agregado) = 0 then null
    else 1 - ((case when fob.fob_sap > 0 then fob.fob_sap else c.nr_fob_negociado end) * cu.nr_fator_imp * cu.nr_dolar)
           / (c.nr_preco_varejo / cu.nr_markup - cu.nr_valor_agregado)
  end as margem_calc,
  fn_tamanho_produto(c.dc_grupo, c.dc_medidas, c.dc_sexo) as tamanho_calc,
  g.processo_calc as cd_embarque,
  g.entrega_calc as dt_entrega_origem_fup,
  coalesce(g.embarque_calc, g.prev_embarque_calc) as dt_embarque_fup,
  coalesce(g.atraque_calc, g.prev_atraque_calc) as dt_atraque_fup,
  g.status_calc as dc_status_comex,
  case when coalesce(c.cd_essential, 0) <> 0
       then c.cd_essential::text || ' - ' || coalesce(e.dc_essential, '')
       else '' end as essential_calc,
  cc.dc_comprador,
  cc.dc_comprador_grupo as dc_comprador_grupo,
  ult.dt_transacao as ult_alteracao_em,
  ult.campo_editado as ult_alteracao_campo,
  ult.info_anterior as ult_alteracao_de,
  ult.info_atual as ult_alteracao_para,
  ult.usuario_nome as ult_alteracao_usuario
from controle_compras c
left join prm_definicao_custo cu
  on c.dc_grupo = cu.dc_grupo and c.dc_canal = cu.dc_canal
 and c.dc_modal = cu.dc_modal and c.nr_anomes = cu.nr_anomes
left join vw_fob_sap fob
  on c.cd_pedido_sap = fob.cd_pedido_sap and c.cd_material_pai = fob.cd_material_pai
left join prm_cluster_comprador cc
  on c.dc_grupo = cc.dc_grupo and c.dc_canal = cc.dc_canal
left join vw_resumo_fup_geral g on c.cd_compra = g.cd_compra
left join cadastro_essential e on c.cd_essential = e.cd_essential
left join lateral (
  select l.dt_transacao, l.campo_editado, l.info_anterior, l.info_atual,
         coalesce(u.nome, case when l.cd_usuario_legado is not null then 'Legado #' || l.cd_usuario_legado else '' end) as usuario_nome
  from log_transacoes l
  left join usuarios u on l.usuario_id = u.id
  where l.cd_item_transacao = c.cd_compra
    and coalesce(l.campo_editado, '') <> ''
  order by l.dt_transacao desc
  limit 1
) ult on true
where c.dc_status is distinct from 'EXCLUIDO';
