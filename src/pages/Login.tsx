import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  if (session) return <Navigate to="/" replace />;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setEnviando(false);
    if (error) {
      toast.error('Falha no login', { description: 'E-mail ou senha inválidos.' });
      return;
    }
    navigate('/');
  };

  const esqueceu = async () => {
    if (!email) {
      toast.info('Informe seu e-mail para redefinir a senha.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) toast.error(error.message);
    else toast.success('E-mail de redefinição enviado.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-secondary p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <PackageSearch className="mb-2 h-10 w-10 text-primary" />
          <CardTitle className="text-2xl">SysPlan</CardTitle>
          <CardDescription>Planejamento de Compras e Importação</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" loading={enviando}>
              Entrar
            </Button>
            <Button type="button" variant="link" className="w-full" onClick={esqueceu}>
              Esqueci minha senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
