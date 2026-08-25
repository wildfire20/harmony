import React, { createContext, useContext, useEffect, useState } from 'react';
import { publicConfigAPI } from '../services/api';

const AppConfigContext = createContext();

export const useAppConfig = () => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context;
};

export const AppConfigProvider = ({ children }) => {
  const [studentPortalEnabled, setStudentPortalEnabled] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    let active = true;

    publicConfigAPI.get()
      .then((response) => {
        if (active) {
          setStudentPortalEnabled(response.data.studentPortalEnabled === true);
        }
      })
      .catch((error) => {
        console.error('Unable to load public application configuration:', error);
        if (active) {
          setStudentPortalEnabled(false);
        }
      })
      .finally(() => {
        if (active) {
          setConfigLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <AppConfigContext.Provider value={{ studentPortalEnabled, configLoading }}>
      {children}
    </AppConfigContext.Provider>
  );
};