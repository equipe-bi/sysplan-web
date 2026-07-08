import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Tema = 'light' | 'dark';

const ThemeContext = createContext<{ tema: Tema; alternar: () => void }>(null!);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() => {
    const salvo = localStorage.getItem('sysplan-tema');
    if (salvo === 'dark' || salvo === 'light') return salvo;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'dark');
    localStorage.setItem('sysplan-tema', tema);
  }, [tema]);

  const alternar = () => setTema((t) => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ tema, alternar }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
