import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog';

/**
 * Message box personalizada com a cara do sistema (substitui window.confirm/alert).
 * Uso: `const ok = await confirmar({ titulo, mensagem, ... })`.
 * Um único <ConfirmHost/> é montado no layout; a função `confirmar` pode ser
 * chamada de qualquer lugar (inclusive fora de componentes React).
 */
export interface OpcoesConfirmacao {
  titulo?: string;
  mensagem: ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  variante?: 'default' | 'destructive';
  /** Oculta o botão cancelar (vira um "alerta" só com OK) */
  somenteOk?: boolean;
}

type Estado = (OpcoesConfirmacao & { resolver: (v: boolean) => void }) | null;

let setarEstado: ((e: Estado) => void) | null = null;

export function confirmar(opts: OpcoesConfirmacao | string): Promise<boolean> {
  const o: OpcoesConfirmacao = typeof opts === 'string' ? { mensagem: opts } : opts;
  return new Promise((resolve) => {
    if (!setarEstado) {
      // fallback caso o host ainda não esteja montado
      resolve(window.confirm(typeof o.mensagem === 'string' ? o.mensagem : (o.titulo ?? 'Confirmar?')));
      return;
    }
    setarEstado({ ...o, resolver: resolve });
  });
}

/** Alerta simples (um só botão OK) com a cara do sistema */
export function avisar(opts: Omit<OpcoesConfirmacao, 'somenteOk'> | string): Promise<boolean> {
  const o: OpcoesConfirmacao = typeof opts === 'string' ? { mensagem: opts } : opts;
  return confirmar({ ...o, somenteOk: true });
}

export function ConfirmHost() {
  const [estado, setEstado] = useState<Estado>(null);
  useEffect(() => {
    setarEstado = setEstado;
    return () => {
      setarEstado = null;
    };
  }, []);

  const fechar = (valor: boolean) => {
    estado?.resolver(valor);
    setEstado(null);
  };

  const destrutiva = estado?.variante === 'destructive';

  return (
    <Dialog open={!!estado} onOpenChange={(o) => !o && fechar(false)}>
      {estado && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {destrutiva ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <HelpCircle className="h-5 w-5 text-primary" />
              )}
              {estado.titulo ?? 'Confirmação'}
            </DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-line text-sm text-muted-foreground">{estado.mensagem}</div>
          <DialogFooter>
            {!estado.somenteOk && (
              <Button variant="outline" onClick={() => fechar(false)}>
                {estado.textoCancelar ?? 'Cancelar'}
              </Button>
            )}
            <Button variant={destrutiva ? 'destructive' : 'default'} onClick={() => fechar(true)} autoFocus>
              {estado.textoConfirmar ?? 'OK'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
