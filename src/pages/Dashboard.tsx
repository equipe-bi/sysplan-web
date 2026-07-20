import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, Container, ShoppingCart, TrendingUp } from 'lucide-react';
import { supabase, fetchPaginasParalelo } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { PainelFiltros } from '@/components/ui/painel-filtros';
import { Skeleton } from '@/components/ui/misc';
import { formatDate, formatNumber } from '@/lib/utils';

interface LinhaRec {
  dt_recebimento: string | null;
  nr_quantidade: number | null;
  dc_canal: string | null;
  dc_grupo: string | null;
  dc_griffe: string | null;
}

/** YYYY-MM-DD -> 'MM/AAAA' */
function rotuloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split('-');
  return `${mes}/${ano}`;
}

export default function Dashboard() {
  const { usuario } = useAuth();

  const [fCanal, setFCanal] = useState('');
  const [fGrupo, setFGrupo] = useState('');
  const [fGriffe, setFGriffe] = useState('');

  // Cartões-resumo (rápido, com count)
  const { data: resumo, isLoading: carregandoResumo } = useQuery({
    queryKey: ['dashboard_resumo'],
    queryFn: async () => {
      const [compras, abertas, followsAbertos] = await Promise.all([
        supabase.from('controle_compras').select('cd_compra', { count: 'exact', head: true }).neq('dc_status', 'EXCLUIDO'),
        supabase.from('controle_compras').select('cd_compra', { count: 'exact', head: true }).eq('dc_status', 'ABERTO'),
        supabase.from('followup_fornecedor').select('cd_follow_forn', { count: 'exact', head: true }).is('dt_fim_followup', null),
      ]);
      return {
        totalCompras: compras.count ?? 0,
        pedidosAbertos: abertas.count ?? 0,
        followsAbertos: followsAbertos.count ?? 0,
      };
    },
  });

  // Base de recebimento (para os gráficos) — carregada uma vez e cacheada
  const { data: linhas, isLoading: carregandoRec } = useQuery({
    queryKey: ['dashboard_recebimento'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from('controle_compras')
        .select('cd_compra', { count: 'exact', head: true })
        .neq('dc_status', 'EXCLUIDO')
        .not('dt_recebimento', 'is', null);
      return fetchPaginasParalelo<LinhaRec>(
        (i, f) =>
          supabase
            .from('controle_compras')
            .select('dt_recebimento, nr_quantidade, dc_canal, dc_grupo, dc_griffe')
            .neq('dc_status', 'EXCLUIDO')
            .not('dt_recebimento', 'is', null)
            .order('dt_recebimento')
            .range(i, f),
        count ?? 0,
      );
    },
  });

  const opcoes = (campo: keyof LinhaRec) =>
    [...new Set((linhas ?? []).map((l) => l[campo]).filter(Boolean))].sort() as string[];

  const filtradas = useMemo(() => {
    let r = linhas ?? [];
    if (fCanal) r = r.filter((l) => l.dc_canal === fCanal);
    if (fGrupo) r = r.filter((l) => l.dc_grupo === fGrupo);
    if (fGriffe) r = r.filter((l) => l.dc_griffe === fGriffe);
    return r;
  }, [linhas, fCanal, fGrupo, fGriffe]);

  // Recebimento (peças) por Ano/Mês
  const porMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtradas) {
      if (!l.dt_recebimento) continue;
      const chave = l.dt_recebimento.slice(0, 7); // YYYY-MM
      m.set(chave, (m.get(chave) ?? 0) + (l.nr_quantidade ?? 0));
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, qtde]) => ({ mes, qtde }));
  }, [filtradas]);

  // Recebimento (peças) por Griffe + última data de chegada de cada griffe
  const porGriffe = useMemo(() => {
    const m = new Map<string, { qtde: number; ultima: string }>();
    for (const l of filtradas) {
      const g = l.dc_griffe || '(sem griffe)';
      const atual = m.get(g) ?? { qtde: 0, ultima: '' };
      atual.qtde += l.nr_quantidade ?? 0;
      if (l.dt_recebimento && l.dt_recebimento > atual.ultima) atual.ultima = l.dt_recebimento;
      m.set(g, atual);
    }
    return [...m.entries()]
      .map(([griffe, v]) => ({ griffe, ...v }))
      .sort((a, b) => b.qtde - a.qtde)
      .slice(0, 12);
  }, [filtradas]);

  // Data final de recebimento (último CD_Compra que chega)
  const dataFinal = useMemo(() => {
    let max = '';
    for (const l of filtradas) if (l.dt_recebimento && l.dt_recebimento > max) max = l.dt_recebimento;
    return max || null;
  }, [filtradas]);

  const totalQtde = useMemo(() => filtradas.reduce((s, l) => s + (l.nr_quantidade ?? 0), 0), [filtradas]);
  const maxMes = Math.max(1, ...porMes.map((x) => x.qtde));
  const maxGriffe = Math.max(1, ...porGriffe.map((x) => x.qtde));

  const cards = [
    { titulo: 'Compras na carteira', valor: resumo?.totalCompras, icone: ShoppingCart },
    { titulo: 'Pedidos em aberto', valor: resumo?.pedidosAbertos, icone: TrendingUp },
    { titulo: 'Follow-ups aguardando resposta', valor: resumo?.followsAbertos, icone: ClipboardCheck },
    { titulo: 'Peças a receber (filtro)', valor: totalQtde, icone: Container },
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
              {carregandoResumo && c.valor === undefined ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <p className="text-2xl font-bold">{formatNumber(c.valor ?? 0, 0)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <PainelFiltros titulo="Filtros do recebimento">
        <div className="w-44">
          <Label>Canal</Label>
          <Select value={fCanal} onChange={(e) => setFCanal(e.target.value)} placeholder="Todos" options={opcoes('dc_canal')} />
        </div>
        <div className="w-44">
          <Label>Grupo</Label>
          <Select value={fGrupo} onChange={(e) => setFGrupo(e.target.value)} placeholder="Todos" options={opcoes('dc_grupo')} />
        </div>
        <div className="w-44">
          <Label>Griffe</Label>
          <Select value={fGriffe} onChange={(e) => setFGriffe(e.target.value)} placeholder="Todas" options={opcoes('dc_griffe')} />
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5">
          <CalendarClock className="h-4 w-4 text-primary" />
          <div className="text-right leading-tight">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Data final de recebimento</p>
            <p className="text-sm font-semibold">{dataFinal ? formatDate(dataFinal) : '—'}</p>
          </div>
        </div>
      </PainelFiltros>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recebimento por Ano/Mês */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recebimento em peças por Ano/Mês</CardTitle>
          </CardHeader>
          <CardContent>
            {carregandoRec ? (
              <Skeleton className="h-56 w-full" />
            ) : porMes.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Sem dados no filtro atual.</p>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <div className="flex h-56 items-end gap-2" style={{ minWidth: porMes.length * 44 }}>
                  {porMes.map((x) => (
                    <div key={x.mes} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${rotuloMes(x.mes)}: ${formatNumber(x.qtde, 0)} peças`}>
                      <span className="text-[9px] text-muted-foreground">{formatNumber(x.qtde, 0)}</span>
                      <div
                        className="w-full min-w-[24px] rounded-t bg-primary transition-all hover:bg-primary/80"
                        style={{ height: `${Math.max(2, (x.qtde / maxMes) * 190)}px` }}
                      />
                      <span className="whitespace-nowrap text-[9px] text-muted-foreground">{rotuloMes(x.mes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recebimento por Griffe */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recebimento por Griffe (top 12) — última chegada</CardTitle>
          </CardHeader>
          <CardContent>
            {carregandoRec ? (
              <Skeleton className="h-56 w-full" />
            ) : porGriffe.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Sem dados no filtro atual.</p>
            ) : (
              <div className="space-y-1.5">
                {porGriffe.map((x) => (
                  <div key={x.griffe} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 truncate" title={x.griffe}>{x.griffe}</span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-primary/80" style={{ width: `${(x.qtde / maxGriffe) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right font-medium">{formatNumber(x.qtde, 0)}</span>
                    <span className="w-20 shrink-0 text-right text-muted-foreground">{x.ultima ? formatDate(x.ultima) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
