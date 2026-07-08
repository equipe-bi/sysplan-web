import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Container, ShoppingCart, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { anoMes, formatNumber } from '@/lib/utils';

export default function Dashboard() {
  const { usuario } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const mesAtual = anoMes();
      const [compras, abertas, followsAbertos, qtdMes] = await Promise.all([
        supabase.from('controle_compras').select('cd_compra', { count: 'exact', head: true }).neq('dc_status', 'EXCLUIDO'),
        supabase.from('controle_compras').select('cd_compra', { count: 'exact', head: true }).eq('dc_status', 'ABERTO'),
        supabase.from('followup_fornecedor').select('cd_follow_forn', { count: 'exact', head: true }).is('dt_fim_followup', null),
        supabase.from('controle_compras').select('nr_quantidade').eq('nr_anomes', mesAtual).neq('dc_status', 'EXCLUIDO'),
      ]);
      const qtdeMes = (qtdMes.data ?? []).reduce((s, r: any) => s + (r.nr_quantidade ?? 0), 0);
      return {
        totalCompras: compras.count ?? 0,
        pedidosAbertos: abertas.count ?? 0,
        followsAbertos: followsAbertos.count ?? 0,
        qtdeMes,
      };
    },
  });

  const cards = [
    { titulo: 'Compras na carteira', valor: data?.totalCompras, icone: ShoppingCart },
    { titulo: 'Pedidos em aberto', valor: data?.pedidosAbertos, icone: TrendingUp },
    { titulo: 'Follow-ups aguardando resposta', valor: data?.followsAbertos, icone: ClipboardCheck },
    { titulo: 'Qtde recebimento mês atual', valor: data?.qtdeMes, icone: Container },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bem-vindo, {usuario?.nome}</h1>
        <p className="text-muted-foreground">Visão geral do planejamento de compras.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.titulo}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.titulo}</CardTitle>
              <c.icone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <p className="text-2xl font-bold">{formatNumber(c.valor ?? 0, 0)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
