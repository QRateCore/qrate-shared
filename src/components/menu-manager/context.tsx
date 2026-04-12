'use client';

import { createContext, useContext } from 'react';
import type { MenuManagerService } from '../../types/restaurant';

const MenuManagerServiceContext = createContext<MenuManagerService | null>(null);

export const MenuManagerServiceProvider = MenuManagerServiceContext.Provider;

export function useMenuManagerService(): MenuManagerService {
  const ctx = useContext(MenuManagerServiceContext);
  if (!ctx) throw new Error('useMenuManagerService must be used inside MenuManagerClient');
  return ctx;
}
