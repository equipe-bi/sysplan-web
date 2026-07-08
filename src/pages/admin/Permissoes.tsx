import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, Skeleton } from '@/components/ui/misc';
import type { Permissao, Tela, Usuario } from '@/types';

export default function AdminPermissoes() {
  const { registraLog } = useAuth();
  const qc = useQueryClient();
  const [usuarioId, setUsuarioId] = useState('');
  const [alteracoes, setAlteracoes] = useState<Map<string, Permissao>>(new Map());

  const { data: usuarios } = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data, error } = await supabase.from('usuarios').select('*').order('nome');
      if (error) throw error;
      return data as Usuario[];
    },
  });

  const { data: telas } = useQuery({
    queryKey: ['telas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('telas').select('*').order('ordem');
      if (error) throw error;
      return data as Tela[];
    },
  });

  const { data: permissoes, isLoading } = useQuery({
    queryKey: ['permissoes', usuarioId],
    enabled: !!usuarioId,
    queryFn: async () => {
      const { data, error } = await supabase.from('permissoes').select('*').eq('usuario_id', usuarioId);
      if (error) throw error;
      setAlteracoes(new Map());
      return data as Permissao[];
    },
  });

  const usuarioSel = usuarios?.find((u) => u.id === usuarioId);

  const efetiva = (tela: string): Permissao => {
    const alterada = alteracoes.get(tela);
    if (alterada) return alterada;
    return (
      permissoes?.find((p) => p.tela_codigo === tela) ?? {
        usuario_id: usuarioId,
        tela_codigo: tela,
        pode_visualizar: false,
        pode_editar: false,
      }
    );
  };

  const alterna = (tela: string, campo: 'pode_visualizar' | 'pode_editar') => {
    const atual = efetiva(tela);
    const nova = { ...atual, [campo]: !atual[campo] };
    if (campo === 'pode_editar' && nova.pode_editar) nova.pode_visualizar = true;
    if (campo === 'pode_visualizar' && !nova.pode_visualizar) nova.pode_editar = false;
    setAlteracoes((m) => new Map(m).set(tela, nova));
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const linhas = [...alteracoes.values()];
      if (linhas.length === 0) return;
      const { error } = await supabase.from('permissoes').upsert(linhas, { onConflict: 'usuario_id,tela_codigo' });
      if (error) throw error;
      registraLog('Admin - Alteracao Permissoes', 0, '', usuarioSel?.email ?? '');
    },
    onSuccess: () => {
      toast.success('Permissões salvas.');
      qc.invalidateQueries({ queryKey: ['permissoes', usuarioId] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const grupos = useMemo(() => {
    const m = new Map<string, Tela[]>();
    for (const t of telas ?? []) {
      if (!m.has(t.grupo)) m.set(t.grupo, []);
      m.get(t.grupo)!.push(t);
    }
    return m;
  }, [telas]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Permissões</h1>
        <p className="text-sm text-muted-foreground">Acesso por tela para cada usuário (administradores têm acesso total)</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-72">
            <Label>Usuário</Label>
            <Select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} placeholder="Selecione...">
              {(usuarios ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.nome} ({u.email})</option>
              ))}
            </Select>
          </div>
          {usuarioSel?.perfil === 'admin' && <Badge>Administrador — acesso total independente das marcações</Badge>}
          {usuarioId && (
            <Button className="ml-auto" loading={salvar.isPending} disabled={alteracoes.size === 0} onClick={() => salvar.mutate()}>
              <Save /> Salvar ({alteracoes.size})
            </Button>
          )}
        </CardContent>
      </Card>

      {usuarioId &&
        (isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...grupos.entries()].map(([grupo, itens]) => (
              <Card key={grupo}>
                <CardContent className="p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{grupo}</p>
                  <div className="space-y-2">
                    {itens.map((t) => {
                      const p = efetiva(t.codigo);
                      return (
                        <div key={t.codigo} className="flex items-center justify-between gap-2 text-sm">
                          <span>{t.nome}</span>
                          <div className="flex gap-3">
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" className="h-4 w-4" checked={p.pode_visualizar} onChange={() => alterna(t.codigo, 'pode_visualizar')} />
                              Ver
                            </label>
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" className="h-4 w-4" checked={p.pode_editar} onChange={() => alterna(t.codigo, 'pode_editar')} />
                              Editar
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
    </div>
  );
}
