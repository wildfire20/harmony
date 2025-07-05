import React, { createContext, useContext, useState, useEffect } from 'react';

// Theme Context
const ThemeContext = createContext();

// Theme Provider Component
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('light');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for saved theme preference or default to light
    const savedTheme = localStorage.getItem('harmony-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (prefersDark) {
      setTheme('dark');
    }
    
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('harmony-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const value = {
    theme,
    setTheme,
    toggleTheme,
    isLoading
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Theme Toggle Button Component
export const ThemeToggle = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`
        inline-flex items-center justify-center p-2 rounded-lg 
        transition-all duration-300 hover:scale-105 focus:outline-none 
        focus:ring-2 focus:ring-harmony-primary focus:ring-offset-2
        ${theme === 'dark' 
          ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-300' 
          : 'bg-gray-800 text-yellow-400 hover:bg-gray-700'
        }
        ${className}
      `}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
    >
      {theme === 'light' ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
};

// Theme-aware Card Component
export const ThemedCard = ({ children, className = "", variant = "default" }) => {
  const { theme } = useTheme();
  
  const variants = {
    default: theme === 'dark' 
      ? 'bg-gray-800 border-gray-700 text-white' 
      : 'bg-white border-gray-200 text-gray-900',
    primary: theme === 'dark'
      ? 'bg-blue-900 border-blue-800 text-blue-100'
      : 'bg-blue-50 border-blue-200 text-blue-900',
    secondary: theme === 'dark'
      ? 'bg-red-900 border-red-800 text-red-100'
      : 'bg-red-50 border-red-200 text-red-900',
    accent: theme === 'dark'
      ? 'bg-green-900 border-green-800 text-green-100'
      : 'bg-green-50 border-green-200 text-green-900'
  };

  return (
    <div className={`
      p-6 rounded-lg border shadow-lg transition-all duration-300
      ${variants[variant]}
      ${className}
    `}>
      {children}
    </div>
  );
};

// Theme-aware Button Component
export const ThemedButton = ({ 
  children, 
  variant = "primary", 
  size = "md", 
  className = "",
  disabled = false,
  ...props 
}) => {
  const { theme } = useTheme();
  
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg"
  };
  
  const variants = {
    primary: theme === 'dark'
      ? 'bg-blue-600 hover:bg-blue-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: theme === 'dark'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-red-600 hover:bg-red-700 text-white',
    accent: theme === 'dark'
      ? 'bg-green-600 hover:bg-green-700 text-white'
      : 'bg-green-600 hover:bg-green-700 text-white',
    outline: theme === 'dark'
      ? 'border-2 border-gray-400 text-gray-100 hover:bg-gray-700'
      : 'border-2 border-gray-400 text-gray-700 hover:bg-gray-100',
    ghost: theme === 'dark'
      ? 'text-gray-100 hover:bg-gray-700'
      : 'text-gray-700 hover:bg-gray-100'
  };

  return (
    <button
      className={`
        inline-flex items-center justify-center font-medium rounded-lg
        transition-all duration-300 focus:outline-none focus:ring-2 
        focus:ring-harmony-primary focus:ring-offset-2
        ${sizes[size]}
        ${variants[variant]}
        ${disabled 
          ? 'opacity-50 cursor-not-allowed' 
          : 'hover:scale-105 hover:shadow-lg'
        }
        ${className}
      `}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

// Theme-aware Input Component
export const ThemedInput = ({ 
  label, 
  error, 
  helperText, 
  className = "",
  ...props 
}) => {
  const { theme } = useTheme();
  
  const inputStyles = theme === 'dark'
    ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-blue-500'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:border-blue-500';

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className={`block text-sm font-medium ${
          theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
        }`}>
          {label}
        </label>
      )}
      <input
        className={`
          w-full px-3 py-2 border rounded-lg shadow-sm
          focus:outline-none focus:ring-2 focus:ring-harmony-primary focus:ring-offset-2
          transition-all duration-300
          ${inputStyles}
          ${error ? 'border-red-500' : ''}
        `}
        {...props}
      />
      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}
      {helperText && !error && (
        <p className={`text-sm ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          {helperText}
        </p>
      )}
    </div>
  );
};

// Page Layout with Theme Support
export const ThemedLayout = ({ children, className = "" }) => {
  const { theme } = useTheme();
  
  return (
    <div className={`
      min-h-screen transition-colors duration-300
      ${theme === 'dark' 
        ? 'bg-gray-900 text-white' 
        : 'bg-gray-50 text-gray-900'
      }
      ${className}
    `}>
      {children}
    </div>
  );
};

export default {
  ThemeProvider,
  useTheme,
  ThemeToggle,
  ThemedCard,
  ThemedButton,
  ThemedInput,
  ThemedLayout
};
