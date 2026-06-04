import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { SamplePoint } from '@shared/types';
import { getAllSamples } from '../lib/indexedDB';
import { syncManager, SyncState } from '../lib/syncManager';

interface AppContextType {
  samples: SamplePoint[];
  isOnline: boolean;
  syncState: SyncState;
  refreshSamples: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [samples, setSamples] = useState<SamplePoint[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState<SyncState>(syncManager.getState());

  const refreshSamples = useCallback(async () => {
    const allSamples = await getAllSamples();
    setSamples(allSamples);
  }, []);

  const triggerSync = useCallback(async () => {
    await syncManager.triggerSync();
    await refreshSamples();
  }, [refreshSamples]);

  useEffect(() => {
    refreshSamples();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = syncManager.subscribe((state) => {
      setSyncState(state);
      refreshSamples();
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [refreshSamples]);

  return (
    <AppContext.Provider value={{ samples, isOnline, syncState, refreshSamples, triggerSync }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
