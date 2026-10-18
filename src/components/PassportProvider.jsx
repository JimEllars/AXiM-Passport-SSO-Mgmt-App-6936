import React, { createContext, useContext, useEffect, useState } from 'react';
import { aximClient } from '../services/passportClient';

const PassportContext = createContext(null);

export const usePassportSession = () => {
  const context = useContext(PassportContext);
  if (!context) {
    throw new Error('usePassportSession must be used within a PassportProvider');
  }
  return context;
};

export const PassportProvider = ({ children, workerUrl, appId, environment = 'production' }) => {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    aximClient.init({ workerUrl, appId, environment });

    let isMounted = true;

    const authenticate = async () => {
      try {
        const { session: authSession, error: authError } = await aximClient.authenticate();
        if (isMounted) {
          if (authSession) {
             setSession(authSession);
          }
          if (authError) {
             setError(authError);
          }
          setIsLoading(false);
        }
      } catch (e) {
        if (isMounted) {
          setError(e.message);
          setIsLoading(false);
        }
      }
    };

    authenticate();

    return () => {
      isMounted = false;
    };
  }, [workerUrl, appId, environment]);

  const logout = () => {
    // Basic logout handling
    setSession(null);
    if (workerUrl) {
      // In a real scenario you might also call a logout endpoint on the workerUrl
      window.location.href = `${workerUrl}/login?redirect_uri=${encodeURIComponent(window.location.href)}`;
    }
  };

  return (
    <PassportContext.Provider value={{ session, isLoading, error, logout }}>
      {children}
    </PassportContext.Provider>
  );
};
