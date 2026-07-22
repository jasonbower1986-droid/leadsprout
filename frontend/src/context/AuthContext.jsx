import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);
  const [personas, setPersonas] = useState({});
  const [features, setFeatures] = useState({ opportunity_workspace: false });

  // Fetch persona configs once on mount
  useEffect(() => {
    const fetchPersonas = async () => {
      try {
        const res = await fetch('/api/config/personas');
        if (res.ok) {
          const data = await res.json();
          setPersonas(data);
        }
      } catch (err) {
        console.error('Failed to load personas:', err);
      }
    };
    fetchPersonas();
    fetch('/api/config/features').then(res => res.ok ? res.json() : null).then(data => data && setFeatures(data)).catch(() => {});
  }, []);

  // Helper to get current persona config
  const personaConfig = user && personas[user.persona] ? personas[user.persona] : null;

  // Set Authorization Header Helper
  const getHeaders = () => {
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  };

  // Load User Profile on Mount or Token Change
  const refreshUser = async () => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: getHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        // Token expired or invalid
        logout();
      }
    } catch (err) {
      console.error('Failed to load user profile:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  // Login Action
  const login = async (email, password) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Register Action
  const register = async (email, password, company_name) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, company_name })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Logout Action
  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setLoading(false);
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    refreshUser,
    getHeaders,
    personaConfig,
    features
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
