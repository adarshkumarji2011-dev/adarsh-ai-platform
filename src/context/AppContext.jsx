import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, patch, post } from '../lib/api.js';

const AppContext = createContext(null);

const THEME_KEY = 'adarsh.theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const data = await get('/conversations/status');
      setCapabilities(data.capabilities || null);
      setUsage(data.usage || null);
    } catch {
      /* status is best-effort; the UI keeps its last known values */
    }
  }, []);

  const refreshUsage = useCallback(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/auth/me');
        if (cancelled) return;
        setUser(data.user);
        setUsage(data.usage || null);
        const theme = data.user?.theme || localStorage.getItem(THEME_KEY) || 'dark';
        applyTheme(theme);
        await loadStatus();
      } catch (error) {
        if (cancelled) return;
        if (error.status && error.status !== 401) setAuthError(error.message);
        applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  const finishAuth = useCallback(
    async (data) => {
      setUser(data.user);
      setUsage(data.usage || null);
      setAuthError('');
      if (data.user?.theme) {
        applyTheme(data.user.theme);
        localStorage.setItem(THEME_KEY, data.user.theme);
      }
      await loadStatus();
      return data.user;
    },
    [loadStatus],
  );

  const login = useCallback(
    async (email, password) => finishAuth(await post('/auth/login', { email, password })),
    [finishAuth],
  );

  const register = useCallback(
    async ({ email, password, name }) => finishAuth(await post('/auth/register', { email, password, name })),
    [finishAuth],
  );

  const continueAsGuest = useCallback(async () => finishAuth(await post('/auth/guest', {})), [finishAuth]);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout', {});
    } catch {
      /* the local session state is cleared regardless */
    }
    setUser(null);
    setCapabilities(null);
    setUsage(null);
  }, []);

  const updateProfile = useCallback(async (changes) => {
    const data = await patch('/auth/me', changes);
    setUser(data.user);
    if (data.usage) setUsage(data.usage);
    if (data.user?.theme) {
      applyTheme(data.user.theme);
      localStorage.setItem(THEME_KEY, data.user.theme);
    }
    return data.user;
  }, []);

  const setTheme = useCallback(
    async (theme) => {
      applyTheme(theme);
      localStorage.setItem(THEME_KEY, theme);
      setUser((current) => (current ? { ...current, theme } : current));
      if (user) {
        try {
          await updateProfile({ theme });
        } catch {
          /* theme still applies locally for this session */
        }
      }
    },
    [user, updateProfile],
  );

  const value = useMemo(
    () => ({
      user,
      usage,
      capabilities,
      loading,
      authError,
      login,
      register,
      continueAsGuest,
      logout,
      updateProfile,
      setTheme,
      refreshUsage,
      reloadStatus: loadStatus,
      theme: user?.theme === 'light' ? 'light' : 'dark',
    }),
    [
      user,
      usage,
      capabilities,
      loading,
      authError,
      login,
      register,
      continueAsGuest,
      logout,
      updateProfile,
      setTheme,
      refreshUsage,
      loadStatus,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
