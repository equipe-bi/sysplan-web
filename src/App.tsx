import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/misc';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ListaCompras from '@/pages/compras/ListaCompras';
import AtualizacaoSAP from '@/pages/compras/AtualizacaoSAP';
import FollowupFornecedor from '@/pages/followup/FollowupFornecedor';
import CadastroPI from '@/pages/pi/CadastroPI';
import ControleImportacao from '@/pages/comex/ControleImportacao';
import AcompanhamentoImportacoes from '@/pages/comex/AcompanhamentoImportacoes';
import LancarAcompanhamento from '@/pages/comex/LancarAcompanhamento';
import MultiplosEmbarques from '@/pages/comex/MultiplosEmbarques';
import ChecksRecebimento from '@/pages/comex/ChecksRecebimento';
import CadastroPDV from '@/pages/pdv/CadastroPDV';
import Design from '@/pages/design/Design';
import AdminUsuarios from '@/pages/admin/Usuarios';
import AdminPermissoes from '@/pages/admin/Permissoes';
import AdminParametros from '@/pages/admin/Parametros';
import AdminImportacoes from '@/pages/admin/Importacoes';
import AdminLogs from '@/pages/admin/Logs';

function Protegida({ tela, children }: { tela: string | null; children: React.ReactNode }) {
  const { session, usuario, carregando, podeVer } = useAuth();
  // sessão existente com perfil ainda carregando não pode redirecionar,
  // senão entra em loop com o redirect inverso da tela de login
  if (carregando || (session && !usuario)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-72 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (tela && !podeVer(tela)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-lg font-medium">Acesso negado</p>
        <p className="text-sm">Você não possui permissão para esta tela. Contate o administrador.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protegida tela={null}>
            <AppLayout />
          </Protegida>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="/compras" element={<Protegida tela="lista_compras"><ListaCompras /></Protegida>} />
        <Route path="/atualizacao-sap" element={<Protegida tela="lista_compras"><AtualizacaoSAP /></Protegida>} />
        <Route path="/followup" element={<Protegida tela="followup_fornecedor"><FollowupFornecedor /></Protegida>} />
        <Route path="/cadastro-pi" element={<Protegida tela="cadastro_pi"><CadastroPI /></Protegida>} />
        <Route path="/controle-importacao" element={<Protegida tela="controle_importacao"><ControleImportacao /></Protegida>} />
        <Route path="/acompanhamento-importacoes" element={<Protegida tela="acompanhamento_importacoes"><AcompanhamentoImportacoes /></Protegida>} />
        <Route path="/lancar-acompanhamento" element={<Protegida tela="lancar_acompanhamento"><LancarAcompanhamento /></Protegida>} />
        <Route path="/multiplos-embarques" element={<Protegida tela="multiplos_embarques"><MultiplosEmbarques /></Protegida>} />
        <Route path="/checks-recebimento" element={<Protegida tela="checks_recebimento"><ChecksRecebimento /></Protegida>} />
        <Route path="/cadastro-pdv" element={<Protegida tela="cadastro_pdv"><CadastroPDV /></Protegida>} />
        <Route path="/design" element={<Protegida tela="design"><Design /></Protegida>} />
        <Route path="/admin/usuarios" element={<Protegida tela="admin_usuarios"><AdminUsuarios /></Protegida>} />
        <Route path="/admin/permissoes" element={<Protegida tela="admin_permissoes"><AdminPermissoes /></Protegida>} />
        <Route path="/admin/parametros" element={<Protegida tela="admin_parametros"><AdminParametros /></Protegida>} />
        <Route path="/admin/importacoes" element={<Protegida tela="admin_importacoes"><AdminImportacoes /></Protegida>} />
        <Route path="/admin/logs" element={<Protegida tela="admin_logs"><AdminLogs /></Protegida>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
