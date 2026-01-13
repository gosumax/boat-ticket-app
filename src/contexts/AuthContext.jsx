import React, { createContext, useState, useContext, useEffect } from 'react';
import apiClient from '../utils/apiClient';

const AuthContext = createContext(null);

function normalizeUser(user) {
  if (!user) return null;
  const u = { ...user };
  if (typeof u.role === 'string') u.role = u.role.toLowerCase();
  return u;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    let alive = true;

    const token = localStorage.getItem('token');
    if (!token) {
      setLoadingAuth(false);
      return;
    }

    (async () => {
      try {
        const data = await apiClient.getCurrentUser();

        // ✅ FIX: поддерживаем оба формата ответа:
        // 1) { user: {...} }
        // 2) {...userFields}
        const user = data?.user ?? data;

        if (alive) setCurrentUser(normalizeUser(user));
      } catch (e) {
        apiClient.logout();
        if (alive) setCurrentUser(null);
      } finally {
        if (alive) setLoadingAuth(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const login = async (username, password) => {
    const data = await apiClient.login(username, password);

    // ✅ FIX: поддерживаем оба формата ответа
    const user = data?.user ?? data;
    setCurrentUser(normalizeUser(user));

    return data;
  };

  const logout = () => {
    apiClient.logout();
    setCurrentUser(null);
  };

  const value = {
    currentUser,
    login,
    logout,
    loadingAuth
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
