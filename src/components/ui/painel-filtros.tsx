import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';

/**
 * Cartão de filtros/funções com opção de expandir ou recolher (como o menu lateral).
 * Envolve os filtros de cada página; o cabeçalho tem um botão de recolher que
 * economiza espaço vertical para a tabela.
 */
export function PainelFiltros({
  children,
  titulo = 'Filtros',
  className,
  defaultAberto = true,
}: {
  children: ReactNode;
  titulo?: string;
  className?: string;
  defaultAberto?: boolean;
}) {
  const [aberto, setAberto] = useState(defaultAberto);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        title={aberto ? 'Recolher' : 'Expandir'}
        className="flex w-full items-center justify-between rounded-t-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/50"
      >
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" /> {titulo}
        </span>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {aberto && <CardContent className={cn('flex flex-wrap items-end gap-3 p-3 pt-0', className)}>{children}</CardContent>}
    </Card>
  );
}
