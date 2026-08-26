'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Character } from '@/lib/characters/types';

interface AdminContextType {
  characters: Character[];
  loadChars: () => void;
  isAdmin: boolean;
  checking: boolean;
}

const AdminContext = createContext<AdminContextType>({
  characters: [],
  loadChars: () => {},
  isAdmin: false,
  checking: true,
});

export function useAdmin() { return useContext(AdminContext); }

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        setIsAdmin(data.isAdmin === true);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  const loadChars = useCallback(() => {
    fetch('/api/admin/characters').then(r => r.json()).then(d => setCharacters(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (isAdmin) loadChars();
  }, [isAdmin, loadChars]);

  return (
    <AdminContext.Provider value={{ characters, loadChars, isAdmin, checking }}>
      {children}
    </AdminContext.Provider>
  );
}
