import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
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
}

interface ColunaFiltro {
  key: string;
  tipo?: 'text' | 'select';
  options?: string[];
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
  /** Filtros inline por coluna (opcional) */
  columnFilters?: ColunaFiltro[];
}

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
  columnFilters,
}: DataTableProps<T>) {
  const [filtro, setFiltro] = useState('');
  const [pagina, setPagina] = useState(0);
  const [ordem, setOrdem] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [colFiltros, setColFiltros] = useState<Record<string, string>>(() => ({}));

  const filtrados = useMemo(() => {
    let resultado = dados;
    // global filter
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      resultado = resultado.filter((r) =>
        colunas.some((c) => String(r[c.key] ?? '').toLowerCase().includes(f)),
      );
    }
    // column filters
    if (columnFilters && Object.keys(colFiltros).length > 0) {
      resultado = resultado.filter((r) => {
        for (const cf of columnFilters) {
          const val = (colFiltros[cf.key] ?? '').toString().trim();
          if (!val) continue;
          const cell = r[cf.key];
          if (cf.tipo === 'select') {
            if (String(cell ?? '') !== val) return false;
          } else {
            if (!String(cell ?? '').toLowerCase().includes(val.toLowerCase())) return false;
          }
        }
        return true;
      });
    }

    if (ordem) {
      resultado = [...resultado].sort((a, b) => {
        const va = a[ordem.key];
        const vb = b[ordem.key];
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
  }, [dados, filtro, ordem, colunas, columnFilters, colFiltros]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / paginacao));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtrados.slice(paginaAtual * paginacao, (paginaAtual + 1) * paginacao);

  const alternaOrdem = (key: string) => {
    setOrdem((o) =>
      o?.key === key ? (o.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' },
    );
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
          <thead className="sticky top-0 z-10 bg-secondary">
            <tr className="border-b">
              {colunas.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'h-9 whitespace-nowrap px-3 text-left align-middle font-medium text-secondary-foreground',
                    c.ordenavel !== false && 'cursor-pointer select-none hover:text-foreground',
                    c.className,
                  )}
                  onClick={() => c.ordenavel !== false && alternaOrdem(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.titulo}
                    {c.ordenavel !== false &&
                      (ordem?.key === c.key ? (
                        ordem.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-30" />
                      ))}
                  </span>
                </th>
              ))}
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
                          {c.render ? c.render(row) : String(row[c.key] ?? '')}
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
          {rodape}
        </div>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={paginaAtual === 0}
              onClick={() => setPagina(paginaAtual - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              {paginaAtual + 1} / {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={paginaAtual >= totalPaginas - 1}
              onClick={() => setPagina(paginaAtual + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
