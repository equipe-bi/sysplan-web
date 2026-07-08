-- SysPlan Web — Funções e views (regras de negócio convertidas do VBA/consultas Access)

-- =====================================================================
-- FUNÇÕES DE NEGÓCIO
-- =====================================================================

-- Define_TamanhoProduto (VBA Módulo1)
create or replace function fn_tamanho_produto(p_grupo text, p_medidas text, p_sexo text)
returns text language plpgsql immutable as $$
declare
  v_partes text[];
  v_lente numeric := 0;
  v_ponte numeric := 0;
  v_lente_ponte numeric := 0;
  v_medida numeric := 0;
begin
  if p_grupo in ('OCULOS', 'MULTI', 'VISTA') then
    v_partes := string_to_array(replace(replace(coalesce(p_medidas, ''), '#', '-'), ' ', '-'), '-');
    begin
      v_lente := coalesce(nullif(trim(v_partes[1]), ''), '0')::numeric;
      v_ponte := coalesce(nullif(trim(v_partes[2]), ''), '0')::numeric;
    exception when others then
      v_lente := 0; v_ponte := 0;
    end;
    if v_lente < 1 or v_ponte < 1 or v_ponte > 40 then
      v_lente_ponte := 0;
    else
      v_lente_ponte := v_lente + v_ponte;
    end if;
    if v_lente_ponte > 0 then
      return case
        when v_lente_ponte <= 68 then 'P'
        when v_lente_ponte <= 73 then 'M'
        when v_lente_ponte <= 76 then 'G'
        else 'GG'
      end;
    end if;
    return 'N/I';
  elsif p_grupo in ('RELOGIO', 'SMART WATCH', 'RELOGIOS') then
    begin
      v_medida := coalesce(nullif(trim(p_medidas), ''), '0')::numeric;
    exception when others then
      v_medida := 0;
    end;
    if p_sexo in ('MASCULINO', 'UNISSEX') then
      return case
        when v_medida <= 1 then 'N/I'
        when v_medida <= 36 then 'PPP'
        when v_medida <= 40 then 'PP'
        when v_medida <= 43 then 'P'
        when v_medida <= 47 then 'M'
        when v_medida <= 51 then 'G'
        else 'GG'
      end;
    elsif p_sexo = 'FEMININO' then
      return case
        when v_medida <= 1 then 'N/I'
        when v_medida <= 28 then 'PPP'
        when v_medida <= 32 then 'PP'
        when v_medida <= 36 then 'P'
        when v_medida <= 40 then 'M'
        when v_medida <= 43 then 'G'
        else 'GG'
      end;
    end if;
    return 'N/I';
  end if;
  return null;
end;
$$;

-- CalcMargem (VBA Módulo1): margem = 1 - custo/atacado
create or replace function fn_calc_margem(
  p_canal text, p_grupo text, p_modal text,
  p_fob double precision, p_pv_varejo double precision, p_dt_rec date
) returns double precision language sql stable as $$
  select case
    when c.nr_markup is null or c.nr_markup = 0 then null
    when (p_pv_varejo / c.nr_markup - c.nr_valor_agregado) = 0 then null
    else 1 - (p_fob * c.nr_fator_imp * c.nr_dolar)
             / (p_pv_varejo / c.nr_markup - c.nr_valor_agregado)
  end
  from prm_definicao_custo c
  where c.dc_canal = p_canal and c.dc_grupo = p_grupo and c.dc_modal = p_modal
    and c.nr_anomes = to_char(coalesce(p_dt_rec, '1899-12-30'::date), 'YYYYMM')::numeric
  limit 1;
$$;

-- PriorizaInfo_Comex (VBA): 3=Comex, 2=Despachante, 1=Fornecedor, 0=sem info
create or replace function fn_prioriza_info_comex(
  p_status_produto text, p_status_despachante text, p_status_comex text
) returns integer language sql immutable as $$
  select case
    when coalesce(p_status_comex, '') <> '' and coalesce(p_status_comex, '') <> 'AE - AG ENTREGA NA ORIGEM' then
      case
        when coalesce(p_status_comex, '') = 'LE - AG EMBARQUE' and coalesce(p_status_despachante, '') = 'Embarcado' then 2
        else 3
      end
    when coalesce(p_status_despachante, '') <> ''
      and coalesce(p_status_despachante, '') not in ('Pendente entrega na origem - ATRASADO', 'Pendente entrega na origem - NO PRAZO', 'ID Origem não informado') then 2
    when coalesce(p_status_produto, '') <> '' then 1
    else 0
  end;
$$;

-- GrupoStatus_Comex (VBA): classificação para o painel de importação
create or replace function fn_grupo_status_comex(
  p_status text, p_delivery date, p_info_usar integer, p_processo text, p_base_despachante text
) returns text language sql stable as $$
  select case
    when p_info_usar = 1 then
      case
        when p_delivery is not null and p_delivery > current_date - 7 then 'PRODUTO - Delivery futuro'
        when p_status = 'DELIVERED' then
          case
            when p_base_despachante = 'Nao' then 'PRODUTO - Fora base despachante'
            when coalesce(p_processo, '') <> '' then 'COMEX - Confirmar entrega na origem'
            else 'PRODUTO - Delivery sem numero BL'
          end
        when p_status = 'WAITING - BOARDING INSTRUCTION' then 'COMEX - Pendente SO'
        else 'PRODUTO - Pendencia Follow up'
      end
    else p_status
  end;
$$;

-- Validacao_ListaEntrega (VBA)
create or replace function fn_validacao_lista_entrega(
  p_lead_time double precision, p_material_pai text, p_pedido_sap text, p_status text, p_modal text
) returns text language plpgsql immutable as $$
declare
  v_modal text := left(coalesce(p_modal, ''), 3);
  v_ini integer; v_fim integer;
  v_erros text := '';
begin
  v_ini := case when v_modal = 'AIR' then 15 else 60 end;
  v_fim := case when v_modal = 'AIR' then 59 else 100 end;
  if coalesce(p_lead_time, 0) < v_ini or coalesce(p_lead_time, 0) > v_fim then
    v_erros := 'Modal Fora do espetado';
  end if;
  if coalesce(p_status, '') = 'Aberto' or coalesce(p_status, '') = 'ABERTO' then
    v_erros := v_erros || case when v_erros <> '' then ' | ' else '' end || 'Pedido em Aberto';
  end if;
  if length(coalesce(p_material_pai, '')) <> 8 then
    v_erros := v_erros || case when v_erros <> '' then ' | ' else '' end || 'Erro Material Pai';
  end if;
  if length(coalesce(p_pedido_sap, '')) <> 10 then
    v_erros := v_erros || case when v_erros <> '' then ' | ' else '' end || 'Erro Pedido SAP';
  end if;
  if v_erros = '' then
    return 'OK';
  end if;
  return 'Erro: ' || v_erros;
end;
$$;

-- AvaliacaoFollow_fornecedor (VBA)
create or replace function fn_avaliacao_followup(
  p_status_forn text, p_delivery_atual date, p_delivery_proposta date
) returns text language sql immutable as $$
  select case
    when coalesce(p_status_forn, '') ilike '%WAIT%' then 'PENDENTE'
    when p_delivery_proposta is distinct from p_delivery_atual then 'PENDENTE'
    else 'OK'
  end;
$$;

-- Helpers de autorização
create or replace function fn_usuario_atual() returns uuid
language sql stable security definer set search_path = public as $$
  select id from usuarios where id = auth.uid() and not bloqueado;
$$;

create or replace function fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios where id = auth.uid() and perfil = 'admin' and not bloqueado
  );
$$;

create or replace function fn_tem_permissao(p_tela text, p_editar boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select fn_is_admin() or exists (
    select 1 from permissoes p
    join usuarios u on u.id = p.usuario_id
    where p.usuario_id = auth.uid()
      and p.tela_codigo = p_tela
      and not u.bloqueado
      and p.pode_visualizar
      and (not p_editar or p.pode_editar)
  );
$$;

-- Registro de log (equivalente a RegistraTransacao do VBA)
create or replace function fn_registra_transacao(
  p_transacao text, p_item integer default 0,
  p_info_anterior text default '', p_info_atual text default '', p_campo text default ''
) returns void language sql security definer set search_path = public as $$
  insert into log_transacoes (usuario_id, transacao, cd_item_transacao, info_anterior, info_atual, campo_editado)
  values (auth.uid(), p_transacao, coalesce(p_item, 0), p_info_anterior, p_info_atual, p_campo);
$$;

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Auditoria campo a campo em controle_compras (equivalente a Registra_Info/PRM_Campos_EdicaoMassa)
create or replace function trg_audita_controle_compras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col text;
  v_old text;
  v_new text;
begin
  if tg_op = 'INSERT' then
    insert into log_transacoes (usuario_id, transacao, cd_item_transacao)
    values (auth.uid(), 'EdicaoCompra - Criacao', new.cd_compra);
    return new;
  end if;
  for v_col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'controle_compras'
      and column_name not in ('atualizado_em', 'criado_em', 'bloqueio_edicao', 'usuario_bloqueio', 'bloqueio_em', 'nr_margem', 'nr_anomes', 'nr_lead_time')
  loop
    execute format('select ($1).%I::text, ($2).%I::text', v_col, v_col) into v_old, v_new using old, new;
    if v_old is distinct from v_new then
      insert into log_transacoes (usuario_id, transacao, cd_item_transacao, info_anterior, info_atual, campo_editado)
      values (auth.uid(), 'EdicaoCompra - Alteracao', new.cd_compra, coalesce(v_old, ''), coalesce(v_new, ''), v_col);
    end if;
  end loop;
  return new;
end;
$$;

create trigger audita_controle_compras
  after insert or update on controle_compras
  for each row execute function trg_audita_controle_compras();

-- Campos calculados mantidos pelo banco (lead time, ano-mês, tamanho, exclusão lógica)
create or replace function trg_calcula_controle_compras() returns trigger
language plpgsql as $$
begin
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

create trigger calcula_controle_compras
  before insert or update on controle_compras
  for each row execute function trg_calcula_controle_compras();

-- Perfil criado automaticamente ao registrar usuário no Auth
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nome, perfil)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when (new.raw_user_meta_data ->> 'perfil') = 'admin' then 'admin'::perfil_usuario else 'usuario'::perfil_usuario end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- VIEWS (consultas do Access)
-- =====================================================================

-- Qry_FOB_SAP
create or replace view vw_fob_sap as
select cd_material_pai, cd_pedido_sap,
       sum(nr_valor_fob) / nullif(sum(nr_quantidade), 0) as fob_sap
from ext_pedido_sap
group by cd_material_pai, cd_pedido_sap;

-- Qry_Resumo_FUP_Comex (com ajuste de múltiplos embarques)
create or replace view vw_resumo_fup_comex as
select
  max(f.cd_embarque) as cd_embarque,
  coalesce(m.cd_pedido_sap_ajuste, f.cd_pedido_sap) as cd_pedido_sap,
  f.cd_material_pai,
  max(f.dt_entrega_origem) as dt_entrega_origem,
  max(f.dt_previsao_embarque) as dt_previsao_embarque,
  max(f.dt_embarque_real) as dt_embarque_real,
  max(f.dt_previsao_atraque) as dt_previsao_atraque,
  max(f.dt_atraque_real) as dt_atraque_real,
  max(f.dt_chegada_cb) as dt_chegada_cb,
  sum(f.nr_quantidade) as nr_quantidade,
  sum(f.nr_fob_total) as nr_fob_total,
  max(f.dc_status_comex) as dc_status_comex
from ext_fup_comex f
left join prm_depara_pedido_multiplos_embarques m
  on f.cd_embarque = m.cd_embarque
 and f.cd_material_pai = m.cd_material_pai
 and f.cd_pedido_sap = m.cd_pedido_sap
group by coalesce(m.cd_pedido_sap_ajuste, f.cd_pedido_sap), f.cd_material_pai
having max(f.dc_status_comex) <> 'AE - AG ENTREGA NA ORIGEM';

-- Qry_Resumo_FUP_Despachante
create or replace view vw_resumo_fup_despachante as
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
from ext_fup_despachante
group by cd_pedido_sap, cd_material_pai;

-- Qry_FiltroFollow_Forn_UltimaResp + ComResp: último follow respondido por compra
create or replace view vw_followup_ultima_resposta as
select f.cd_compra, max(f.cd_follow_forn) as cd_follow
from followup_fornecedor f
join (
  select cd_compra, max(dt_fim_followup) as max_fim
  from followup_fornecedor
  where dt_fim_followup is not null
  group by cd_compra
) u on u.cd_compra = f.cd_compra and u.max_fim = f.dt_fim_followup
where f.dt_fim_followup is not null
group by f.cd_compra;

-- Qry_FiltroFollow_Forn_SemResp: follows abertos
create or replace view vw_followup_sem_resposta as
select cd_compra, max(cd_follow_forn) as cd_follow
from followup_fornecedor
where dt_fim_followup is null
group by cd_compra;

-- Qry_Resumo_FUP_Geral: consolidação Comex > Despachante > Fornecedor por compra
create or replace view vw_resumo_fup_geral as
select
  c.cd_compra,
  fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex) as info_usar,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.cd_embarque
    when 2 then coalesce(x.cd_embarque, d.cd_embarque)
    when 1 then ff.dc_numero_bl
    else ''
  end as processo_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dc_status_comex
    when 2 then d.dc_status_comex || ' - Fora FUP'
    when 1 then ff.dc_status_fornecedor
    else 'SEM FOLLOW UP'
  end as status_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dt_entrega_origem
    when 2 then d.dt_entrega_origem
    else c.dt_revised_delivery
  end as entrega_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dt_previsao_embarque when 2 then d.dt_previsao_embarque else null
  end as prev_embarque_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dt_embarque_real when 2 then d.dt_embarque_real else null
  end as embarque_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dt_previsao_atraque when 2 then d.dt_previsao_atraque else null
  end as prev_atraque_calc,
  case fn_prioriza_info_comex(ff.dc_status_fornecedor, d.dc_status_comex, x.dc_status_comex)
    when 3 then x.dt_atraque_real when 2 then d.dt_atraque_real else null
  end as atraque_calc,
  case when d.cd_pedido_sap is null then 'Nao' else 'Sim' end as consta_despachante
from controle_compras c
left join vw_resumo_fup_comex x
  on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
left join vw_resumo_fup_despachante d
  on c.cd_pedido_sap = d.cd_pedido_sap and c.cd_material_pai = d.cd_material_pai
left join vw_followup_ultima_resposta ur on c.cd_compra = ur.cd_compra
left join followup_fornecedor ff on ur.cd_follow = ff.cd_follow_forn
where c.dc_status is distinct from 'EXCLUIDO';

-- Qry_ControleCompras_Lista: fonte da tela principal
create or replace view vw_controle_compras_lista as
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
  cc.dc_comprador_grupo as dc_comprador_grupo
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
where c.dc_status is distinct from 'EXCLUIDO';

-- Qry_Analise_FUP_Comex: painel de controle de importação
create or replace view vw_analise_fup_comex as
select
  c.cd_compra, c.dc_canal, c.dc_grupo, c.dc_linha, c.dc_griffe,
  c.cd_material_pai, c.cd_pedido_sap, c.nr_quantidade,
  c.dt_recebimento, c.dt_revised_delivery, c.dc_modal,
  g.processo_calc, g.status_calc, g.info_usar,
  g.entrega_calc, g.prev_embarque_calc, g.embarque_calc,
  g.prev_atraque_calc, g.atraque_calc,
  fn_grupo_status_comex(g.status_calc, c.dt_revised_delivery, g.info_usar, g.processo_calc, g.consta_despachante) as grupo_status,
  to_char(c.dt_recebimento, 'YYYYMM')::numeric as nr_anomes
from controle_compras c
join vw_resumo_fup_geral g on c.cd_compra = g.cd_compra
where c.dc_modal is distinct from 'ROAD'
  and to_char(c.dt_recebimento, 'YYYYMM') >= to_char(current_date - 1, 'YYYYMM');

-- Qry_FupComex_ListaEntregaOrigem
create or replace view vw_lista_entrega_origem as
select
  case when c.dc_grupo = 'MATERIAIS CONSUMIVEIS' then c.dc_subgrupo else c.dc_grupo end as grupo,
  c.dc_linha, c.dc_griffe, c.dc_canal, c.dc_fornecedor,
  c.cd_material_pai, c.cd_pedido_fornecedor, c.cd_pedido_sap,
  c.nr_quantidade, c.dt_recebimento, c.dc_modal, c.dt_revised_delivery,
  (c.dt_recebimento - c.dt_revised_delivery) as lead_time,
  fn_validacao_lista_entrega((c.dt_recebimento - c.dt_revised_delivery)::double precision,
    c.cd_material_pai, c.cd_pedido_sap, c.dc_status, c.dc_modal) as avaliacao,
  to_char(c.dt_revised_delivery, 'YYYYMM') as anomes_delivery
from vw_resumo_fup_geral g
join controle_compras c on g.cd_compra = c.cd_compra
where c.dc_modal is distinct from 'ROAD'
  and to_char(c.dt_recebimento, 'YYYYMM') >= to_char(current_date - 1, 'YYYYMM')
  and c.dc_status is distinct from 'EXCLUIDO';

-- Qry_FollowFornecedor_Pendente
create or replace view vw_followup_pendente as
select
  f.cd_follow_forn, f.cd_compra, c.dc_fornecedor, c.cd_pedido_fornecedor,
  c.cd_material_fornecedor, c.cd_pedido_sap, c.cd_material_pai,
  c.dc_grupo || ' ' || coalesce(c.dc_canal, '') as grupo,
  coalesce(c.dc_linha, '') || ' | ' || coalesce(c.dc_griffe, '') as colecao,
  f.dt_revised_delivery_original as delivery_date_atual,
  f.dt_recebimento_cb_original as dt_recebimento_atual,
  f.dc_modal_original as dc_modal_atual,
  cc.dc_comprador, cc.dc_comprador_grupo
from followup_fornecedor f
join controle_compras c on f.cd_compra = c.cd_compra
left join vw_resumo_fup_comex x
  on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
left join prm_cluster_comprador cc
  on c.dc_canal = cc.dc_canal and c.dc_grupo = cc.dc_grupo
where f.dt_recebimento_cb_original >= date_trunc('month', current_date)
  and f.dt_fim_followup is null
  and x.dt_entrega_origem is null
  and c.dc_status is distinct from 'EXCLUIDO';

-- Qry_Resumo_EntradaSAP_MB51
create or replace view vw_resumo_entrada_mb51 as
select
  s.deposito as cd_deposito,
  left(s.material, 8) as material_pai,
  s.pedido,
  max(s.dt_lancamento) as dt_recebimento,
  sum(s.qtd_um_registro) as qtde
from stg_entrada_sap_mb51 s
left join cadastro_material m on s.material = m.cd_material
where s.deposito in ('3003', '3008', '3001')
  and (m.grupo2 is null or m.grupo2 in ('OCULOS', 'RELOGIOS', 'MULTI', 'VISTA', 'MATERIAIS CONSUMIVEIS', 'KIDS'))
group by s.deposito, left(s.material, 8), s.pedido;

-- Múltiplos embarques: pedidos com mais de um embarque
create or replace view vw_fup_multiplos_embarques as
select cd_pedido_sap, cd_material_pai, count(distinct cd_embarque) as qtde_embarques
from ext_fup_comex
group by cd_pedido_sap, cd_material_pai
having count(distinct cd_embarque) > 1;

-- Qry_MultiplosEmbarques_PendenteAbertura_ControleCompras
create or replace view vw_multiplos_embarques_pendentes as
select
  m.cd_pedido_sap, m.cd_material_pai, m.cd_pedido_sap_ajuste, m.cd_embarque,
  f.dc_status_comex,
  max(f.dt_chegada_cb) as rec_fup,
  sum(f.nr_quantidade) as qtde_fup,
  cc.dc_comprador, cc.dc_comprador_grupo,
  c.dt_recebimento as rec_compra
from prm_depara_pedido_multiplos_embarques m
join ext_fup_comex f
  on m.cd_embarque = f.cd_embarque
 and m.cd_material_pai = f.cd_material_pai
 and m.cd_pedido_sap = f.cd_pedido_sap
left join controle_compras c
  on m.cd_pedido_sap_ajuste = c.cd_pedido_sap and m.cd_material_pai = c.cd_material_pai
 and c.dc_status is distinct from 'EXCLUIDO'
left join prm_cluster_comprador cc
  on c.dc_canal = cc.dc_canal and c.dc_grupo = cc.dc_grupo
where coalesce(m.cd_pedido_sap_ajuste, '') <> ''
group by m.cd_pedido_sap, m.cd_material_pai, m.cd_pedido_sap_ajuste, m.cd_embarque,
         f.dc_status_comex, cc.dc_comprador, cc.dc_comprador_grupo, c.dt_recebimento
having c.dt_recebimento >= '2024-01-01' or c.dt_recebimento is null;

-- Checks de recebimento (auditoria)
create or replace view vw_check_pi_duplicado as
select dc_grupo as grupo, cd_pedido_fornecedor as pi, cd_material_fornecedor as material,
       max(dt_recebimento) as rec, count(cd_compra) as qtd_linhas,
       max(dc_canal) as canal1, min(dc_canal) as canal2
from controle_compras
where dc_status is distinct from 'EXCLUIDO'
group by dc_grupo, cd_pedido_fornecedor, cd_material_fornecedor
having dc_grupo <> 'MATERIAIS CONSUMIVEIS'
   and coalesce(cd_pedido_fornecedor, '') not in ('', 'N/I')
   and max(dt_recebimento) >= '2025-01-01'
   and count(cd_compra) > 1;

create or replace view vw_check_po_duplicado as
select dc_grupo as grupo, cd_pedido_sap as po, cd_material_pai as material,
       max(dt_recebimento) as rec, count(cd_compra) as qtd_linhas,
       max(dc_canal) as canal1, min(dc_canal) as canal2
from controle_compras
where dc_status is distinct from 'EXCLUIDO'
group by dc_grupo, cd_pedido_sap, cd_material_pai
having dc_grupo <> 'MATERIAIS CONSUMIVEIS'
   and coalesce(cd_pedido_sap, '') > '0' and cd_pedido_sap <> 'N/I'
   and max(dt_recebimento) >= '2025-01-01'
   and count(cd_compra) > 1;

create or replace view vw_check_gp_nao_cadastrado as
select c.dc_grupo, c.dc_subgrupo, c.dc_formato, c.dc_sexo
from controle_compras c
left join prm_grupo_planejamento g
  on c.dc_grupo = g.dc_grupo and c.dc_subgrupo = g.dc_subgrupo
 and c.dc_sexo = g.dc_sexo and c.dc_formato = g.dc_formato
where g.dc_grupo is null
group by c.dc_grupo, c.dc_subgrupo, c.dc_formato, c.dc_sexo;

-- =====================================================================
-- PROCEDURES DE NEGÓCIO (rotinas do legado)
-- =====================================================================

-- Geração de necessidade de follow-up (Qry_Necessidade_FollowUp_Fornecedor)
create or replace function fn_gerar_necessidade_followup() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  insert into followup_fornecedor
    (cd_compra, dt_revised_delivery_original, dt_recebimento_cb_original, dc_modal_original,
     dt_inicio_followup, dc_status_fornecedor, dc_avaliacao_comprador)
  select c.cd_compra, c.dt_revised_delivery, c.dt_recebimento, c.dc_modal,
         current_date, 'PENDENTE', 'PENDENTE'
  from controle_compras c
  left join vw_resumo_fup_comex x
    on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
  left join vw_followup_pendente p on c.cd_compra = p.cd_compra
  where c.dt_recebimento >= date_trunc('month', current_date)
    and coalesce(c.cd_pedido_fornecedor, '') not in ('', 'N/I')
    and x.dt_entrega_origem is null
    and p.cd_compra is null
    and c.dc_status is distinct from 'EXCLUIDO';
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Baixa automática de follow-ups (Qry_FollowFornecedor_BaixaAutomatica + update)
create or replace function fn_baixa_automatica_followup() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  with alvo as (
    select f.cd_follow_forn,
      case when x.cd_embarque is not null then 'Embarcado processo: ' || x.cd_embarque
           else 'Recebimento mês anterior' end as novo_status
    from followup_fornecedor f
    join controle_compras c on f.cd_compra = c.cd_compra
    left join vw_resumo_fup_comex x
      on c.cd_pedido_sap = x.cd_pedido_sap and c.cd_material_pai = x.cd_material_pai
    where f.dt_fim_followup is null
      and (
        c.dt_recebimento < date_trunc('month', current_date)
        or (x.cd_embarque is not null and x.dc_status_comex not ilike '%ORIGEM%')
      )
  )
  update followup_fornecedor f
  set dc_status_fornecedor = a.novo_status,
      dc_avaliacao_comprador = 'BAIXA AUTOMATICA',
      dc_observacao_avaliacao = a.novo_status,
      dt_fim_followup = current_date,
      dt_avaliacao_comprador = current_date
  from alvo a
  where f.cd_follow_forn = a.cd_follow_forn;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Sincroniza snapshot dos follows abertos com a compra (Qry_AtualizaInfos_FollowUp_Fornecedor)
create or replace function fn_atualiza_infos_followup() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  update followup_fornecedor f
  set dt_revised_delivery_original = c.dt_revised_delivery,
      dt_recebimento_cb_original = c.dt_recebimento,
      dc_modal_original = c.dc_modal
  from controle_compras c
  where f.cd_compra = c.cd_compra and f.dt_fim_followup is null;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Recalcular grupo de planejamento em massa (Qry_Recalcular_GrupoPlanejamento)
create or replace function fn_recalcular_grupo_planejamento() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  update controle_compras c
  set dc_grupo_planejamento = g.dc_grupo_planejamento
  from prm_grupo_planejamento g
  where c.dc_grupo = g.dc_grupo and c.dc_subgrupo = g.dc_subgrupo
    and c.dc_sexo = g.dc_sexo and c.dc_formato = g.dc_formato;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Ajuste manual de FOB (Qry_AjusteManual_Fob)
create or replace function fn_aplicar_ajuste_fob() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  update controle_compras c
  set nr_fob_negociado = a.nr_fob,
      nr_fob_real = a.nr_fob,
      nr_total_fob = c.nr_quantidade * a.nr_fob
  from prm_ajuste_fob a
  where c.cd_material_pai = a.cd_material_pai and c.cd_pedido_sap = a.cd_pedido_sap;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Atualização de cadastro PedidoSAP/MaterialPai (Qry_Atualizacao_AtualizacaoCadastro)
create or replace function fn_aplicar_ajuste_pedido_sap() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  update controle_compras c
  set cd_pedido_sap = a.cd_pedido_sap,
      cd_material_pai = a.cd_material_pai
  from prm_ajuste_pedido_sap_cadastro a
  where a.id_sysplan = c.cd_compra
    and a.cd_pedido_fornecedor = c.cd_pedido_fornecedor
    and a.cd_material_fornecedor = c.cd_material_fornecedor;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Alimenta de-para de múltiplos embarques (Qry_Alimenta_DePara_MultiplosEmbarques)
create or replace function fn_alimentar_depara_multiplos_embarques() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  insert into prm_depara_pedido_multiplos_embarques (cd_pedido_sap, cd_material_pai, cd_embarque)
  select distinct me.cd_pedido_sap, me.cd_material_pai, f.cd_embarque
  from vw_fup_multiplos_embarques me
  left join ext_fup_comex f
    on me.cd_pedido_sap = f.cd_pedido_sap and me.cd_material_pai = f.cd_material_pai
  left join prm_depara_pedido_multiplos_embarques d
    on f.cd_embarque = d.cd_embarque
   and f.cd_material_pai = d.cd_material_pai
   and f.cd_pedido_sap = d.cd_pedido_sap
  where d.codigo is null and f.cd_embarque is not null;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Atualiza EXT_Pedido_SAP a partir do snapshot BW (Qry_Atualizar_Pedido_SAP + Qry_Limpar_PedidoSAP)
create or replace function fn_atualizar_pedido_sap_bw() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  delete from ext_pedido_sap;
  insert into ext_pedido_sap
    (cd_pedido_sap, cd_material, cd_material_pai, nr_valor_fob, nr_quantidade, dc_modal, dc_cor_lente_solar, dc_cor_armacao)
  select b.oi_ebeln, b.material, left(b.material, 8),
         sum(b.net_po_val), sum(b.ttlqty), b.ca_modal,
         max(m.dc_cor_lente_solar), max(m.dc_cor_armacao)
  from ext_sap_pedido_bw b
  left join cadastro_material m on b.material = m.cd_material
  group by b.oi_ebeln, b.material, left(b.material, 8), b.ca_modal;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Bloqueio/desbloqueio de registro para edição (BloqueioRegistro do VBA)
create or replace function fn_bloquear_compra(p_cd_compra integer, p_bloquear boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_lock_user uuid;
  v_lock boolean;
begin
  select bloqueio_edicao, usuario_bloqueio into v_lock, v_lock_user
  from controle_compras where cd_compra = p_cd_compra for update;

  if p_bloquear then
    -- lock expirado (>2h) é liberado automaticamente
    if v_lock and v_lock_user is not null and v_lock_user <> auth.uid()
       and exists (select 1 from controle_compras
                   where cd_compra = p_cd_compra and bloqueio_em > now() - interval '2 hours') then
      return false;
    end if;
    update controle_compras
    set bloqueio_edicao = true, usuario_bloqueio = auth.uid(), bloqueio_em = now()
    where cd_compra = p_cd_compra;
  else
    update controle_compras
    set bloqueio_edicao = false, usuario_bloqueio = null, bloqueio_em = null
    where cd_compra = p_cd_compra
      and (usuario_bloqueio = auth.uid() or fn_is_admin());
  end if;
  return true;
end;
$$;
