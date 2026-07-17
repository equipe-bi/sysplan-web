import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';

export interface Coluna<T> {
  key: string;
  titulo: string;
  render?: (row: T) => ReactNode;
  className?: string;
  ordenavel?: boolean;
  /** valor usado para ordenação/filtro quando `render` devolve JSX (default: row[key]) */
  valor?: (row: T) => string | number | null | undefined;
}

interface DataTableProps<T> {
  colunas: Coluna<T>[];
  dados: T[];
  carregando?: boolean;
  busca?: boolean;
  paginacao?: number;
  /** Recebe também o evento e as linhas visíveis da página (para seleção por intervalo com Shift) */
  onRowClick?: (row: T, event: React.MouseEvent, visiveis: T[]) => void;
  onRowDoubleClick?: (row: T) => void;
  selecionadas?: Set<number>;
  rowKey: (row: T) => number | string;
  rodape?: ReactNode;
  altura?: string;
  /** Ativa filtro estilo Excel (funil) em cada coluna */
  autofiltro?: boolean;
}

const texto = (v: unknown): string => (v == null ? '' : String(v));

export function DataTable<T extends Record<string, any>>({
  colunas,
  dados,
  carregando,
  busca = true,
  paginacao = 50,
  onRowClick,
  onRowDoubleClick,
  selecionadas,
  rowKey,
  rodape,
  altura = 'calc(100vh - 300px)',
  autofiltro = false,
}: DataTableProps<T>) {
  const [filtro, setFiltro] = useState('');
  const [pagina, setPagina] = useState(0);
  const [ordem, setOrdem] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  // por coluna: conjunto de valores selecionados (autofiltro). Ausência = sem filtro.
  const [colFiltros, setColFiltros] = useState<Record<string, Set<string>>>({});
  const [popover, setPopover] = useState<string | null>(null);

  const valorDe = (row: T, c: Coluna<T>): string => texto(c.valor ? c.valor(row) : row[c.key]);

  const filtrados = useMemo(() => {
    let resultado = dados;
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      resultado = resultado.filter((r) => colunas.some((c) => valorDe(r, c).toLowerCase().includes(f)));
    }
    for (const [key, selecionados] of Object.entries(colFiltros)) {
      if (!selecionados || selecionados.size === 0) continue;
      const col = colunas.find((c) => c.key === key);
      if (!col) continue;
      resultado = resultado.filter((r) => selecionados.has(valorDe(r, col)));
    }
    if (ordem) {
      const col = colunas.find((c) => c.key === ordem.key);
      resultado = [...resultado].sort((a, b) => {
        const va = col?.valor ? col.valor(a) : a[ordem.key];
        const vb = col?.valor ? col.valor(b) : b[ordem.key];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'pt-BR');
        return ordem.dir === 'asc' ? cmp : -cmp;
      });
    }
    return resultado;
  }, [dados, filtro, ordem, colunas, colFiltros]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / paginacao));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtrados.slice(paginaAtual * paginacao, (paginaAtual + 1) * paginacao);

  const alternaOrdem = (key: string) => {
    setOrdem((o) => (o?.key === key ? (o.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  };

  return (
    <div className="space-y-2">
      {busca && (
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar..."
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value);
              setPagina(0);
            }}
            className="pl-8"
          />
        </div>
      )}

      <div className="rounded-md border overflow-auto scrollbar-thin" style={{ maxHeight: altura }}>
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-20 bg-secondary">
            <tr className="border-b">
              {colunas.map((c) => {
                const filtroAtivo = (colFiltros[c.key]?.size ?? 0) > 0;
                const podeFiltrar = autofiltro && !c.key.startsWith('__');
                return (
                  <th
                    key={c.key}
                    className={cn(
                      'h-9 whitespace-nowrap px-3 text-left align-middle font-medium text-secondary-foreground',
                      c.className,
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className={cn('inline-flex items-center gap-1', c.ordenavel !== false && 'cursor-pointer hover:text-foreground')}
                        onClick={() => c.ordenavel !== false && alternaOrdem(c.key)}
                      >
                        {c.titulo}
                        {c.ordenavel !== false &&
                          (ordem?.key === c.key ? (
                            ordem.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          ))}
                      </button>
                      {podeFiltrar && (
                        <button
                          type="button"
                          title="Filtrar"
                          className={cn('rounded p-0.5 hover:bg-accent', filtroAtivo ? 'text-primary' : 'text-muted-foreground/60')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPopover(popover === c.key ? null : c.key);
                          }}
                        >
                          <Filter className="h-3 w-3" fill={filtroAtivo ? 'currentColor' : 'none'} />
                        </button>
                      )}
                    </span>
                    {popover === c.key && (
                      <PopoverFiltro
                        valores={[...new Set(dados.map((r) => valorDe(r, c)))]}
                        selecionados={colFiltros[c.key] ?? null}
                        onAplicar={(sel) => {
                          setColFiltros((f) => ({ ...f, [c.key]: sel }));
                          setPagina(0);
                          setPopover(null);
                        }}
                        onFechar={() => setPopover(null)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {carregando
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {colunas.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : visiveis.map((row) => {
                  const k = rowKey(row);
                  return (
                    <tr
                      key={k}
                      className={cn(
                        'border-b transition-colors hover:bg-accent/60 select-none',
                        (onRowClick || onRowDoubleClick) && 'cursor-pointer',
                        selecionadas?.has(k as number) && 'bg-primary/10',
                      )}
                      onClick={(e) => onRowClick?.(row, e, visiveis)}
                      onDoubleClick={() => onRowDoubleClick?.(row)}
                    >
                      {colunas.map((c) => (
                        <td key={c.key} className={cn('whitespace-nowrap px-3 py-1.5', c.className)}>
                          {c.render ? c.render(row) : texto(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            {!carregando && visiveis.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="h-24 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          {filtrados.length.toLocaleString('pt-BR')} registro(s)
          {Object.values(colFiltros).some((s) => s?.size) && (
            <button className="ml-2 text-primary hover:underline" onClick={() => setColFiltros({})}>
              limpar filtros de coluna
            </button>
          )}
          {rodape}
        </div>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>
              <ChevronLeft />
            </Button>
            <span>
              {paginaAtual + 1} / {totalPaginas}
            </span>
            <Button variant="outline" size="icon" disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Popover de autofiltro (estilo Excel): busca + checkboxes dos valores distintos */
function PopoverFiltro({
  valores,
  selecionados,
  onAplicar,
  onFechar,
}: {
  valores: string[];
  selecionados: Set<string> | null;
  onAplicar: (sel: Set<string>) => void;
  onFechar: () => void;
}) {
  const ordenados = useMemo(
    () => [...valores].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [valores],
  );
  const [busca, setBusca] = useState('');
  // seleção local: começa com o filtro atual, ou tudo marcado se não há filtro
  const [sel, setSel] = useState<Set<string>>(() => new Set(selecionados ?? ordenados));

  const visiveis = ordenados.filter((v) => v.toLowerCase().includes(busca.toLowerCase()));
  const rotulo = (v: string) => (v === '' ? '(vazio)' : v);

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onFechar} />
      <div
        className="absolute left-0 top-full z-40 mt-1 w-60 rounded-md border bg-card p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          placeholder="Buscar valor..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="mb-2 h-8"
        />
        <div className="mb-2 flex gap-2 text-xs">
          <button className="text-primary hover:underline" onClick={() => setSel(new Set(ordenados))}>Todos</button>
          <button className="text-primary hover:underline" onClick={() => setSel(new Set())}>Nenhum</button>
          <button className="text-primary hover:underline" onClick={() => setSel(new Set(visiveis))}>Só visíveis</button>
        </div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto scrollbar-thin">
          {visiveis.map((v) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={sel.has(v)}
                onChange={(e) => {
                  setSel((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(v);
                    else n.delete(v);
                    return n;
                  });
                }}
              />
              <span className="truncate" title={rotulo(v)}>{rotulo(v)}</span>
            </label>
          ))}
          {visiveis.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum valor.</p>}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onFechar}>Cancelar</Button>
          <Button
            size="sm"
            onClick={() => {
              // se tudo marcado, sem filtro (Set vazio); senão aplica a seleção
              onAplicar(sel.size === ordenados.length ? new Set() : sel);
            }}
          >
            Aplicar
          </Button>
        </div>
      </div>
    </>
  );
}
