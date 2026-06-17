'use client';

import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setTheme('light');
    } else {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setTheme('dark');
    }
  };

  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-xl bg-surface-hover flex items-center justify-center text-text-secondary opacity-50" />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="w-9 h-9 rounded-xl bg-surface-hover flex items-center justify-center text-text-secondary hover:text-text-primary transition-all duration-200"
      aria-label="Toggle theme"
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {theme === 'dark' ? (
        <Sun size={17} className="text-amber-400 hover:rotate-45 transition-transform duration-300" />
      ) : (
        <Moon size={17} className="text-indigo-600 dark:text-indigo-400 hover:-rotate-12 transition-transform duration-300" />
      )}
    </button>
  );
}
