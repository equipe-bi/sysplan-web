import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Usuario, Permissao } from '@/types';

interface AuthState {
  session: Session | null;
  usuario: Usuario | null;
  permissoes: Permissao[];
  carregando: boolean;
  isAdmin: boolean;
  podeVer: (tela: string) => boolean;
  podeEditar: (tela: string) => boolean;
  sair: () => Promise<void>;
  registraLog: (transacao: string, item?: number, anterior?: string, atual?: string, campo?: string) => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [permissoes, setPermissoes] = useState<Permissao[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
      setSession(s);
      if (!s) {
        setUsuario(null);
        setPermissoes([]);
        setCarregando(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    let ativo = true;
    (async () => {
      const [{ data: u }, { data: p }] = await Promise.all([
        supabase.from('usuarios').select('*').eq('id', session.user.id).single(),
        supabase.from('permissoes').select('*').eq('usuario_id', session.user.id),
      ]);
      if (!ativo) return;
      if (u?.bloqueado) {
        await supabase.auth.signOut();
        return;
      }
      setUsuario(u as Usuario | null);
      setPermissoes((p as Permissao[]) ?? []);
      setCarregando(false);
      if (u) {
        supabase.rpc('fn_registra_transacao', { p_transacao: 'Entrada' }).then(() => {});
      }
    })();
    return () => {
      ativo = false;
    };
  }, [session?.user?.id]);

  const isAdmin = usuario?.perfil === 'admin';
  const podeVer = (tela: string) =>
    isAdmin || permissoes.some((p) => p.tela_codigo === tela && p.pode_visualizar);
  const podeEditar = (tela: string) =>
    isAdmin || permissoes.some((p) => p.tela_codigo === tela && p.pode_editar);

  const sair = async () => {
    await supabase.rpc('fn_registra_transacao', { p_transacao: 'Saida' });
    await supabase.auth.signOut();
  };

  const registraLog = (transacao: string, item = 0, anterior = '', atual = '', campo = '') => {
    supabase
      .rpc('fn_registra_transacao', {
        p_transacao: transacao,
        p_item: item,
        p_info_anterior: anterior,
        p_info_atual: atual,
        p_campo: campo,
      })
      .then(() => {});
  };

  return (
    <AuthContext.Provider
      value={{ session, usuario, permissoes, carregando, isAdmin, podeVer, podeEditar, sair, registraLog }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
