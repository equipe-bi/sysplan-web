import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { exportarExcel } from '@/lib/exportar';
import { formatDateTime } from '@/lib/utils';
import type { LogTransacao } from '@/types';

const TIPOS = [
  'Entrada', 'Saida', 'EdicaoCompra - Criacao', 'EdicaoCompra - Alteracao', 'EdicaoCompra - Excluir',
  'EdicaoCompra - Consulta', 'EdicaoCompra - IMPORT PI', 'FollowFornecedor - Importacao',
  'FollowFornecedor - Exportacao', 'FollowFornecedor - Avaliacao',
  'ListaCompras - Alteracao Massa - Importacao', 'ListaCompras - Alteracao Massa - Exportacao',
];

export default function AdminLogs() {
  const [tipo, setTipo] = useState('');
  const [item, setItem] = useState('');
  const [dataInicio, setDataInicio] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['logs', tipo, item, dataInicio],
    queryFn: async () => {
      let q = supabase
        .from('log_transacoes')
        .select('*, usuario:usuarios(nome, email)')
        .order('dt_transacao', { ascending: false })
        .limit(2000);
      if (tipo) q = q.ilike('transacao', `${tipo}%`);
      if (item) q = q.eq('cd_item_transacao', Number(item));
      if (dataInicio) q = q.gte('dt_transacao', dataInicio);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((l: any) => ({
        ...l,
        usuario_nome: l.usuario?.nome ?? (l.cd_usuario_legado ? `Legado #${l.cd_usuario_legado}` : ''),
      }));
    },
  });

  const colunas: Coluna<LogTransacao & { usuario_nome: string }>[] = [
    { key: 'cd_transacao', titulo: 'ID' },
    { key: 'dt_transacao', titulo: 'Data/Hora', render: (l) => formatDateTime(l.dt_transacao) },
    { key: 'usuario_nome', titulo: 'Usuário' },
    { key: 'transacao', titulo: 'Transação' },
    { key: 'cd_item_transacao', titulo: 'Item' },
    { key: 'campo_editado', titulo: 'Campo' },
    { key: 'info_anterior', titulo: 'Anterior' },
    { key: 'info_atual', titulo: 'Atual' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">
            Auditoria completa — login, alterações, exclusões, importações e exportações
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
          <Button
            variant="outline"
            onClick={() => exportarExcel(colunas.map((c) => ({ key: c.key, titulo: c.titulo })), data ?? [], 'SysPlan_Logs')}
          >
            <FileDown /> Exportar
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-72">
            <Label>Tipo de transação</Label>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Todas" options={TIPOS} />
          </div>
          <div className="w-32">
            <Label>Item (CD)</Label>
            <Input value={item} onChange={(e) => setItem(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div className="w-40">
            <Label>A partir de</Label>
            <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <DataTable colunas={colunas} dados={data ?? []} carregando={isLoading} rowKey={(l) => l.cd_transacao} paginacao={100} />
    </div>
  );
}
