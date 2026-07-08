-- SysPlan Web — Row Level Security e políticas de acesso
-- Modelo: admins têm acesso total; usuários dependem de permissões por tela (tabela permissoes).
-- O service_role (migração/rotinas) tem BYPASSRLS nativo no Supabase.

-- Ajuste no trigger de auditoria: gravações de serviço (sem usuário autenticado,
-- ex.: migração de dados) não geram log automático.
create or replace function trg_audita_controle_compras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col text;
  v_old text;
  v_new text;
begin
  if auth.uid() is null then
    return new;
  end if;
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

-- ---------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- ---------------------------------------------------------------------
alter table usuarios enable row level security;
alter table telas enable row level security;
alter table permissoes enable row level security;
alter table log_transacoes enable row level security;
alter table prm_grupo enable row level security;
alter table prm_combos enable row level security;
alter table prm_grupo_planejamento enable row level security;
alter table prm_definicao_custo enable row level security;
alter table prm_cluster_comprador enable row level security;
alter table prm_ajuste_fob enable row level security;
alter table prm_ajuste_pedido_sap_cadastro enable row level security;
alter table prm_depara_pedido_multiplos_embarques enable row level security;
alter table prm_versao enable row level security;
alter table prm_campos_edicao_massa enable row level security;
alter table prm_cor_pi enable row level security;
alter table prm_depara_campos_pi enable row level security;
alter table prm_lista_compras enable row level security;
alter table usuario_lista_config enable row level security;
alter table cadastro_essential enable row level security;
alter table depara_essential enable row level security;
alter table cadastro_material enable row level security;
alter table cadastro_material_pai enable row level security;
alter table controle_compras enable row level security;
alter table followup_fornecedor enable row level security;
alter table ext_fup_comex enable row level security;
alter table ext_fup_despachante enable row level security;
alter table ext_pedido_sap enable row level security;
alter table ext_sap_pedido_bw enable row level security;
alter table stg_entrada_sap_mb51 enable row level security;
alter table pasta_pi enable row level security;
alter table pi_cores enable row level security;
alter table desenvolvimento_design enable row level security;
alter table cartela_cor_design enable row level security;
alter table pdv_cadastro_loja enable row level security;
alter table pdv_cadastro_pdv enable row level security;
alter table pdv_base_cadastro enable row level security;
alter table pdv_depara enable row level security;
alter table pdv_status enable row level security;
alter table importacoes enable row level security;

-- ---------------------------------------------------------------------
-- Usuários / permissões / telas
-- ---------------------------------------------------------------------
create policy usuarios_select on usuarios for select to authenticated using (true);
create policy usuarios_admin_all on usuarios for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

create policy telas_select on telas for select to authenticated using (true);
create policy telas_admin on telas for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

create policy permissoes_select_propria on permissoes for select to authenticated
  using (usuario_id = auth.uid() or fn_is_admin());
create policy permissoes_admin on permissoes for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

-- Logs: leitura restrita a admins; escrita via funções security definer
create policy log_admin_select on log_transacoes for select to authenticated
  using (fn_tem_permissao('admin_logs'));

-- ---------------------------------------------------------------------
-- Parâmetros: leitura para todos autenticados; escrita admin/parametros
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'prm_grupo', 'prm_combos', 'prm_grupo_planejamento', 'prm_definicao_custo',
    'prm_cluster_comprador', 'prm_ajuste_fob', 'prm_ajuste_pedido_sap_cadastro',
    'prm_versao', 'prm_campos_edicao_massa', 'prm_cor_pi',
    'prm_depara_campos_pi', 'prm_lista_compras',
    'cadastro_material', 'cadastro_material_pai', 'ext_sap_pedido_bw', 'ext_pedido_sap'
  ]
  loop
    execute format('create policy %I_sel on %I for select to authenticated using (true)', t, t);
    execute format(
      'create policy %I_adm on %I for all to authenticated using (fn_tem_permissao(''admin_parametros'', true)) with check (fn_tem_permissao(''admin_parametros'', true))',
      t, t);
  end loop;
end $$;

-- Configuração de lista por usuário: cada um gerencia a sua
create policy lista_config_own on usuario_lista_config for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ---------------------------------------------------------------------
-- Tabelas de negócio: leitura/escrita conforme permissão da tela
-- ---------------------------------------------------------------------
create policy compras_sel on controle_compras for select to authenticated
  using (fn_tem_permissao('lista_compras'));
create policy compras_ins on controle_compras for insert to authenticated
  with check (fn_tem_permissao('lista_compras', true));
create policy compras_upd on controle_compras for update to authenticated
  using (fn_tem_permissao('lista_compras', true));
-- Exclusão física não permitida (exclusão é lógica via DC_Status='EXCLUIDO')

create policy essential_sel on cadastro_essential for select to authenticated using (true);
create policy essential_adm on cadastro_essential for all to authenticated
  using (fn_tem_permissao('admin_parametros', true)) with check (fn_tem_permissao('admin_parametros', true));

create policy depara_essential_sel on depara_essential for select to authenticated using (true);
create policy depara_essential_edit on depara_essential for all to authenticated
  using (fn_tem_permissao('lista_compras', true)) with check (fn_tem_permissao('lista_compras', true));

create policy followup_sel on followup_fornecedor for select to authenticated
  using (fn_tem_permissao('followup_fornecedor'));
create policy followup_all on followup_fornecedor for all to authenticated
  using (fn_tem_permissao('followup_fornecedor', true)) with check (fn_tem_permissao('followup_fornecedor', true));

create policy fup_comex_sel on ext_fup_comex for select to authenticated
  using (fn_tem_permissao('controle_importacao') or fn_tem_permissao('lista_compras') or fn_tem_permissao('followup_fornecedor'));
create policy fup_comex_edit on ext_fup_comex for all to authenticated
  using (fn_tem_permissao('controle_importacao', true)) with check (fn_tem_permissao('controle_importacao', true));

create policy fup_desp_sel on ext_fup_despachante for select to authenticated
  using (fn_tem_permissao('controle_importacao') or fn_tem_permissao('lista_compras') or fn_tem_permissao('followup_fornecedor'));
create policy fup_desp_edit on ext_fup_despachante for all to authenticated
  using (fn_tem_permissao('controle_importacao', true)) with check (fn_tem_permissao('controle_importacao', true));

create policy mb51_sel on stg_entrada_sap_mb51 for select to authenticated
  using (fn_tem_permissao('checks_recebimento') or fn_tem_permissao('controle_importacao'));
create policy mb51_edit on stg_entrada_sap_mb51 for all to authenticated
  using (fn_tem_permissao('checks_recebimento', true)) with check (fn_tem_permissao('checks_recebimento', true));

create policy pasta_pi_sel on pasta_pi for select to authenticated
  using (fn_tem_permissao('cadastro_pi'));
create policy pasta_pi_all on pasta_pi for all to authenticated
  using (fn_tem_permissao('cadastro_pi', true)) with check (fn_tem_permissao('cadastro_pi', true));

create policy pi_cores_sel on pi_cores for select to authenticated
  using (fn_tem_permissao('cadastro_pi'));
create policy pi_cores_all on pi_cores for all to authenticated
  using (fn_tem_permissao('cadastro_pi', true)) with check (fn_tem_permissao('cadastro_pi', true));

create policy design_sel on desenvolvimento_design for select to authenticated
  using (fn_tem_permissao('design'));
create policy design_all on desenvolvimento_design for all to authenticated
  using (fn_tem_permissao('design', true)) with check (fn_tem_permissao('design', true));

create policy cartela_sel on cartela_cor_design for select to authenticated
  using (fn_tem_permissao('design'));
create policy cartela_all on cartela_cor_design for all to authenticated
  using (fn_tem_permissao('design', true)) with check (fn_tem_permissao('design', true));

do $$
declare
  t text;
begin
  foreach t in array array['pdv_cadastro_loja', 'pdv_cadastro_pdv', 'pdv_base_cadastro', 'pdv_depara', 'pdv_status']
  loop
    execute format('create policy %I_sel on %I for select to authenticated using (fn_tem_permissao(''cadastro_pdv''))', t, t);
    execute format(
      'create policy %I_all on %I for all to authenticated using (fn_tem_permissao(''cadastro_pdv'', true)) with check (fn_tem_permissao(''cadastro_pdv'', true))',
      t, t);
  end loop;
end $$;

create policy multiplos_sel on prm_depara_pedido_multiplos_embarques for select to authenticated
  using (fn_tem_permissao('multiplos_embarques') or fn_tem_permissao('controle_importacao') or fn_tem_permissao('lista_compras'));
create policy multiplos_all on prm_depara_pedido_multiplos_embarques for all to authenticated
  using (fn_tem_permissao('multiplos_embarques', true)) with check (fn_tem_permissao('multiplos_embarques', true));

create policy importacoes_own on importacoes for select to authenticated
  using (usuario_id = auth.uid() or fn_is_admin());
create policy importacoes_ins on importacoes for insert to authenticated
  with check (usuario_id = auth.uid());
create policy importacoes_upd on importacoes for update to authenticated
  using (usuario_id = auth.uid() or fn_is_admin());

-- ---------------------------------------------------------------------
-- Storage: buckets para fotos de produto e arquivos de PI
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos-produto', 'fotos-produto', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('arquivos-pi', 'arquivos-pi', false)
on conflict (id) do nothing;

create policy storage_fotos_read on storage.objects for select to authenticated
  using (bucket_id = 'fotos-produto');
create policy storage_fotos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-produto' and (fn_tem_permissao('cadastro_pi', true) or fn_tem_permissao('lista_compras', true)));
create policy storage_fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos-produto' and (fn_tem_permissao('cadastro_pi', true) or fn_tem_permissao('lista_compras', true)));
create policy storage_pi_read on storage.objects for select to authenticated
  using (bucket_id = 'arquivos-pi' and fn_tem_permissao('cadastro_pi'));
create policy storage_pi_write on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos-pi' and fn_tem_permissao('cadastro_pi', true));
