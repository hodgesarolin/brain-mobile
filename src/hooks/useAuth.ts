import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import * as client from '../api/client';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  serverConfigured: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setServer: (url: string) => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  isLoading: true,
  isAuthenticated: false,
  serverConfigured: false,
  login: async () => {},
  logout: async () => {},
  setServer: async () => {},
  checkAuth: async () => {},
});

export function useAuthProvider(): AuthState {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = await client.getServerUrl();
      setServerConfigured(!!url);
      if (url) {
        const authed = await client.isAuthenticated();
        setIsAuthenticated(authed);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Listen for 401s from any API call — push back to login immediately
  useEffect(() => {
    const unsubscribe = client.onAuthExpired(() => {
      setIsAuthenticated(false);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await client.login(username, password);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await client.logout();
    setIsAuthenticated(false);
  }, []);

  const setServer = useCallback(async (url: string) => {
    // Verify server is reachable before saving
    const reachable = await client.isServerReachable(url.replace(/\/+$/, ''));
    if (!reachable) {
      throw new Error('Cannot reach server');
    }
    await client.setServerUrl(url);
    setServerConfigured(true);
    // Check if we already have a valid token for this server
    const authed = await client.isAuthenticated();
    setIsAuthenticated(authed);
  }, []);

  return { isLoading, isAuthenticated, serverConfigured, login, logout, setServer, checkAuth };
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
