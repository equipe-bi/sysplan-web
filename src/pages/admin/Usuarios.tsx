import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, LockOpen, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, supabaseAdminAux } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { formatDateTime } from '@/lib/utils';
import type { Usuario } from '@/types';

export default function AdminUsuarios() {
  const { registraLog } = useAuth();
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [edicao, setEdicao] = useState<Usuario | null>(null);
  const [form, setForm] = useState({ nome: '', email: '', senha: '', perfil: 'usuario', filtro_comprador: 'GERAL' });

  const { data, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data, error } = await supabase.from('usuarios').select('*').order('nome');
      if (error) throw error;
      return data as Usuario[];
    },
  });

  const { data: compradores } = useQuery({
    queryKey: ['compradores_filtro'],
    queryFn: async () => {
      const { data } = await supabase.from('prm_cluster_comprador').select('dc_comprador');
      return ['GERAL', ...new Set((data ?? []).map((c: any) => c.dc_comprador).filter(Boolean))] as string[];
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      if (!form.email || !form.senha || form.senha.length < 6) {
        throw new Error('Informe e-mail e senha (mínimo 6 caracteres).');
      }
      // signUp em cliente auxiliar para não derrubar a sessão do admin
      const { data: nova, error } = await supabaseAdminAux.auth.signUp({
        email: form.email,
        password: form.senha,
        options: { data: { nome: form.nome, perfil: form.perfil } },
      });
      if (error) throw error;
      if (nova.user) {
        await supabase
          .from('usuarios')
          .update({ nome: form.nome, perfil: form.perfil, filtro_comprador: form.filtro_comprador })
          .eq('id', nova.user.id);
      }
      registraLog('Admin - Criacao Usuario', 0, '', form.email);
    },
    onSuccess: () => {
      toast.success('Usuário criado. Se a confirmação de e-mail estiver ativa no Supabase, ele deve confirmar antes do primeiro login.');
      setNovo(false);
      setForm({ nome: '', email: '', senha: '', perfil: 'usuario', filtro_comprador: 'GERAL' });
      qc.invalidateQueries({ queryKey: ['usuarios'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const salvarEdicao = useMutation({
    mutationFn: async () => {
      if (!edicao) return;
      const { error } = await supabase
        .from('usuarios')
        .update({
          nome: edicao.nome,
          perfil: edicao.perfil,
          filtro_comprador: edicao.filtro_comprador,
          login_rede: edicao.login_rede,
        })
        .eq('id', edicao.id);
      if (error) throw error;
      registraLog('Admin - Alteracao Usuario', 0, '', edicao.email);
    },
    onSuccess: () => {
      toast.success('Usuário atualizado.');
      setEdicao(null);
      qc.invalidateQueries({ queryKey: ['usuarios'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const bloquear = useMutation({
    mutationFn: async (u: Usuario) => {
      const { error } = await supabase.from('usuarios').update({ bloqueado: !u.bloqueado }).eq('id', u.id);
      if (error) throw error;
      registraLog(u.bloqueado ? 'Admin - Desbloqueio Usuario' : 'Admin - Bloqueio Usuario', 0, '', u.email);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const resetSenha = async (u: Usuario) => {
    const { error } = await supabase.auth.resetPasswordForEmail(u.email);
    if (error) toast.error(error.message);
    else {
      registraLog('Admin - Reset Senha', 0, '', u.email);
      toast.success(`E-mail de redefinição enviado para ${u.email}.`);
    }
  };

  const colunas: Coluna<Usuario>[] = [
    { key: 'nome', titulo: 'Nome' },
    { key: 'email', titulo: 'E-mail' },
    { key: 'perfil', titulo: 'Perfil', render: (u) => (u.perfil === 'admin' ? <Badge>Administrador</Badge> : <Badge variant="secondary">Usuário</Badge>) },
    { key: 'filtro_comprador', titulo: 'Filtro Comprador' },
    { key: 'login_rede', titulo: 'Login Rede (legado)' },
    { key: 'bloqueado', titulo: 'Situação', render: (u) => (u.bloqueado ? <Badge variant="destructive">Bloqueado</Badge> : <Badge variant="success">Ativo</Badge>) },
    { key: 'criado_em', titulo: 'Criado em', render: (u) => formatDateTime(u.criado_em) },
    {
      key: '__acoes',
      titulo: 'Ações',
      ordenavel: false,
      render: (u) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" title={u.bloqueado ? 'Desbloquear' : 'Bloquear'} onClick={(e) => { e.stopPropagation(); bloquear.mutate(u); }}>
            {u.bloqueado ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Redefinir senha (e-mail)" onClick={(e) => { e.stopPropagation(); resetSenha(u); }}>
            <KeyRound className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Cadastro, bloqueio e redefinição de senha</p>
        </div>
        <Button onClick={() => setNovo(true)}><Plus /> Novo usuário</Button>
      </div>

      <DataTable
        colunas={colunas}
        dados={data ?? []}
        carregando={isLoading}
        rowKey={(u) => u.id}
        onRowDoubleClick={(u) => setEdicao({ ...u })}
        paginacao={25}
      />

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>O usuário receberá o perfil e permissões definidos aqui.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Senha inicial</Label><Input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></div>
            <div>
              <Label>Perfil</Label>
              <Select value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value })}>
                <option value="usuario">Usuário</option>
                <option value="admin">Administrador</option>
              </Select>
            </div>
            <div>
              <Label>Filtro Comprador padrão</Label>
              <Select value={form.filtro_comprador} onChange={(e) => setForm({ ...form, filtro_comprador: e.target.value })} options={compradores ?? ['GERAL']} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(false)}>Cancelar</Button>
            <Button loading={criar.isPending} onClick={() => criar.mutate()}>Criar usuário</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edicao && (
        <Dialog open onOpenChange={(o) => !o && setEdicao(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} /></div>
              <div><Label>E-mail</Label><Input value={edicao.email} disabled /></div>
              <div>
                <Label>Perfil</Label>
                <Select value={edicao.perfil} onChange={(e) => setEdicao({ ...edicao, perfil: e.target.value as any })}>
                  <option value="usuario">Usuário</option>
                  <option value="admin">Administrador</option>
                </Select>
              </div>
              <div>
                <Label>Filtro Comprador padrão</Label>
                <Select value={edicao.filtro_comprador ?? 'GERAL'} onChange={(e) => setEdicao({ ...edicao, filtro_comprador: e.target.value })} options={compradores ?? ['GERAL']} />
              </div>
              <div><Label>Login de rede (legado)</Label><Input value={edicao.login_rede ?? ''} onChange={(e) => setEdicao({ ...edicao, login_rede: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdicao(null)}>Cancelar</Button>
              <Button loading={salvarEdicao.isPending} onClick={() => salvarEdicao.mutate()}><Save /> Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
