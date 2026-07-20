import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Boxes,
  ClipboardCheck,
  Container,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PackageSearch,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings2,
  ShieldCheck,
  Ship,
  ShoppingCart,
  Store,
  Sun,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { Button } from '@/components/ui/button';
import { ConfirmHost } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';

interface ItemMenu {
  para: string;
  tela: string | null;
  nome: string;
  icone: React.ComponentType<{ className?: string }>;
}

const MENUS: { grupo: string; itens: ItemMenu[] }[] = [
  {
    grupo: 'Geral',
    itens: [{ para: '/', tela: null, nome: 'Início', icone: LayoutDashboard }],
  },
  {
    grupo: 'Compras',
    itens: [
      { para: '/compras', tela: 'lista_compras', nome: 'Lista de Compras', icone: ShoppingCart },
      { para: '/atualizacao-sap', tela: 'lista_compras', nome: 'Atualização Pedido SAP / Material Pai', icone: FileSpreadsheet },
      { para: '/followup', tela: 'followup_fornecedor', nome: 'Follow-up Fornecedor', icone: ClipboardCheck },
      { para: '/cadastro-pi', tela: 'cadastro_pi', nome: 'Cadastro de PI', icone: FileSpreadsheet },
    ],
  },
  {
    grupo: 'Comex',
    itens: [
      { para: '/controle-importacao', tela: 'controle_importacao', nome: 'Controle de Importação', icone: Container },
      { para: '/acompanhamento-importacoes', tela: 'acompanhamento_importacoes', nome: 'Follow-up Agente de Carga', icone: Ship },
      { para: '/lancar-acompanhamento', tela: 'lancar_acompanhamento', nome: 'Lançar no Acompanhamento', icone: Upload },
      { para: '/multiplos-embarques', tela: 'multiplos_embarques', nome: 'Múltiplos Embarques', icone: Boxes },
      { para: '/checks-recebimento', tela: 'checks_recebimento', nome: 'Checks de Recebimento', icone: ListChecks },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { para: '/cadastro-pdv', tela: 'cadastro_pdv', nome: 'Cadastro de PDV', icone: Store },
      { para: '/design', tela: 'design', nome: 'Desenvolvimento Design', icone: Palette },
    ],
  },
  {
    grupo: 'Administração',
    itens: [
      { para: '/admin/usuarios', tela: 'admin_usuarios', nome: 'Usuários', icone: Users },
      { para: '/admin/permissoes', tela: 'admin_permissoes', nome: 'Permissões', icone: ShieldCheck },
      { para: '/admin/parametros', tela: 'admin_parametros', nome: 'Parâmetros', icone: Settings2 },
      { para: '/admin/importacoes', tela: 'admin_importacoes', nome: 'Importações', icone: Upload },
      { para: '/admin/logs', tela: 'admin_logs', nome: 'Logs', icone: ScrollText },
    ],
  },
];

export function AppLayout() {
  const [aberta, setAberta] = useState(true);
  const { usuario, podeVer, sair } = useAuth();
  const { tema, alternar } = useTheme();
  const navigate = useNavigate();

  const grupos = MENUS.map((g) => ({
    ...g,
    itens: g.itens.filter((i) => !i.tela || podeVer(i.tela)),
  })).filter((g) => g.itens.length > 0);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-blue-950/40 bg-gradient-to-b from-blue-800 to-blue-950 text-blue-50 shadow-lg transition-all duration-200',
          aberta ? 'w-60' : 'w-14',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
            <PackageSearch className="h-5 w-5 text-white" />
          </div>
          {aberta && <span className="text-lg font-bold tracking-tight text-white">SysPlan</span>}
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto scrollbar-thin p-2">
          {grupos.map((g) => (
            <div key={g.grupo}>
              {aberta && (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/80">
                  {g.grupo}
                </p>
              )}
              {g.itens.map((item) => (
                <NavLink
                  key={item.para}
                  to={item.para}
                  end={item.para === '/'}
                  title={item.nome}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-white/20 font-semibold text-white shadow-sm ring-1 ring-white/10'
                        : 'text-blue-100 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  <item.icone className="h-4 w-4 shrink-0" />
                  {aberta && <span className="truncate">{item.nome}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-blue-900/50 bg-gradient-to-r from-blue-800 to-blue-600 px-4 text-white shadow-md">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={() => setAberta(!aberta)}
          >
            {aberta ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={alternar}
              title="Alternar tema"
            >
              {tema === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{usuario?.nome}</p>
              <p className="text-xs text-blue-200 leading-tight">
                {usuario?.perfil === 'admin' ? 'Administrador' : 'Usuário'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/15 hover:text-white"
              title="Sair"
              onClick={async () => {
                await sair();
                navigate('/login');
              }}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <Outlet />
        </main>
      </div>
      <ConfirmHost />
    </div>
  );
}
