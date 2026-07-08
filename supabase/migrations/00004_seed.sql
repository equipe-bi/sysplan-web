-- SysPlan Web — Seed: catálogo de telas e função de pós-migração

insert into telas (codigo, nome, grupo, ordem) values
  ('lista_compras',       'Lista de Compras',          'Compras',       1),
  ('followup_fornecedor', 'Follow-up Fornecedor',      'Compras',       2),
  ('cadastro_pi',         'Cadastro de PI',            'Compras',       3),
  ('controle_importacao', 'Controle de Importação',    'Comex',         4),
  ('multiplos_embarques', 'Múltiplos Embarques',       'Comex',         5),
  ('checks_recebimento',  'Checks de Recebimento',     'Comex',         6),
  ('cadastro_pdv',        'Cadastro de PDV',           'Cadastros',     7),
  ('design',              'Desenvolvimento Design',    'Cadastros',     8),
  ('admin_usuarios',      'Usuários',                  'Administração', 20),
  ('admin_permissoes',    'Permissões',                'Administração', 21),
  ('admin_parametros',    'Parâmetros',                'Administração', 22),
  ('admin_logs',          'Logs',                      'Administração', 23),
  ('admin_importacoes',   'Importações',               'Administração', 24)
on conflict (codigo) do nothing;

-- Após importar os dados legados com IDs explícitos, realinha as sequences.
-- Chamada via RPC pelo script de migração (service_role).
create or replace function fn_pos_migracao() returns text
language plpgsql security definer set search_path = public as $$
begin
  perform setval(pg_get_serial_sequence('controle_compras', 'cd_compra'),
                 coalesce((select max(cd_compra) from controle_compras), 0) + 1, false);
  perform setval(pg_get_serial_sequence('followup_fornecedor', 'cd_follow_forn'),
                 coalesce((select max(cd_follow_forn) from followup_fornecedor), 0) + 1, false);
  perform setval(pg_get_serial_sequence('log_transacoes', 'cd_transacao'),
                 coalesce((select max(cd_transacao) from log_transacoes), 0) + 1, false);
  perform setval(pg_get_serial_sequence('cadastro_essential', 'cd_essential'),
                 coalesce((select max(cd_essential) from cadastro_essential), 0) + 1, false);
  perform setval(pg_get_serial_sequence('prm_grupo', 'cd_grupo'),
                 coalesce((select max(cd_grupo) from prm_grupo), 0) + 1, false);
  perform setval(pg_get_serial_sequence('prm_combos', 'cd_combo'),
                 coalesce((select max(cd_combo) from prm_combos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('prm_cluster_comprador', 'cd_cluster'),
                 coalesce((select max(cd_cluster) from prm_cluster_comprador), 0) + 1, false);
  perform setval(pg_get_serial_sequence('prm_depara_pedido_multiplos_embarques', 'codigo'),
                 coalesce((select max(codigo) from prm_depara_pedido_multiplos_embarques), 0) + 1, false);
  perform setval(pg_get_serial_sequence('desenvolvimento_design', 'cd_desenvolv'),
                 coalesce((select max(cd_desenvolv) from desenvolvimento_design), 0) + 1, false);
  perform setval(pg_get_serial_sequence('cartela_cor_design', 'cd_cor_design'),
                 coalesce((select max(cd_cor_design) from cartela_cor_design), 0) + 1, false);
  perform setval(pg_get_serial_sequence('pdv_cadastro_pdv', 'id_pdv'),
                 coalesce((select max(id_pdv) from pdv_cadastro_pdv), 0) + 1, false);
  return 'ok';
end;
$$;

-- Vincula usuários legados (DM_Usuarios) aos novos cadastros por e-mail,
-- preenchendo cd_usuario_legado/login_rede/filtro_comprador quando o usuário
-- do Auth for criado com o mesmo e-mail.
create table if not exists usuarios_legado (
  cd_usuario integer primary key,
  cd_login_rede text,
  dc_email text,
  dc_filtro_comprador text
);
alter table usuarios_legado enable row level security;
create policy usuarios_legado_admin on usuarios_legado for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

create or replace function trg_vincula_usuario_legado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leg usuarios_legado%rowtype;
begin
  select * into v_leg from usuarios_legado
  where lower(dc_email) = lower(new.email) limit 1;
  if found then
    new.cd_usuario_legado := v_leg.cd_usuario;
    new.login_rede := v_leg.cd_login_rede;
    new.filtro_comprador := coalesce(v_leg.dc_filtro_comprador, 'GERAL');
  end if;
  return new;
end;
$$;

create trigger vincula_usuario_legado
  before insert on usuarios
  for each row execute function trg_vincula_usuario_legado();
