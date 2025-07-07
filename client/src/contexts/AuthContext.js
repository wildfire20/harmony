import React, { createContext, useContext, useReducer, useEffect } from 'react';
import ApiService from '../services/api';

// Initial state
const initialState = {
  user: null,
  token: localStorage.getItem('token'),
  loading: true,
  error: null
};

// Auth actions
const authActions = {
  SET_LOADING: 'SET_LOADING',
  SET_USER: 'SET_USER',
  SET_TOKEN: 'SET_TOKEN',
  SET_ERROR: 'SET_ERROR',
  LOGOUT: 'LOGOUT'
};

// Auth reducer
const authReducer = (state, action) => {
  switch (action.type) {
    case authActions.SET_LOADING:
      return {
        ...state,
        loading: action.payload
      };
    case authActions.SET_USER:
      return {
        ...state,
        user: action.payload,
        loading: false,
        error: null
      };
    case authActions.SET_TOKEN:
      return {
        ...state,
        token: action.payload
      };
    case authActions.SET_ERROR:
      return {
        ...state,
        error: action.payload,
        loading: false
      };
    case authActions.LOGOUT:
      return {
        ...state,
        user: null,
        token: null,
        loading: false,
        error: null
      };
    default:
      return state;
  }
};

// Create context
const AuthContext = createContext();

// Auth provider component
export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Set loading state
  const setLoading = (loading) => {
    dispatch({ type: authActions.SET_LOADING, payload: loading });
  };

  // Set error state
  const setError = (error) => {
    dispatch({ type: authActions.SET_ERROR, payload: error });
  };

  // Login function
  const login = async (credentials) => {
    try {
      setLoading(true);
      setError(null);

      const response = await ApiService.login(credentials);
      
      if (response.success) {
        const { token, user } = response;
        
        // Store token in localStorage
        localStorage.setItem('token', token);
        
        // Update state
        dispatch({ type: authActions.SET_TOKEN, payload: token });
        dispatch({ type: authActions.SET_USER, payload: user });
        
        return { success: true };
      } else {
        throw new Error(response.message || 'Login failed');
      }
    } catch (error) {
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // Register function
  const register = async (userData) => {
    try {
      setLoading(true);
      setError(null);

      const response = await ApiService.register(userData);
      
      if (response.success) {
        const { token, user } = response;
        
        // Store token in localStorage
        localStorage.setItem('token', token);
        
        // Update state
        dispatch({ type: authActions.SET_TOKEN, payload: token });
        dispatch({ type: authActions.SET_USER, payload: user });
        
        return { success: true };
      } else {
        throw new Error(response.message || 'Registration failed');
      }
    } catch (error) {
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = async () => {
    try {
      // Call logout API (optional)
      await ApiService.logout();
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      // Clear token from localStorage
      localStorage.removeItem('token');
      
      // Update state
      dispatch({ type: authActions.LOGOUT });
    }
  };

  // Get current user
  const getCurrentUser = async () => {
    try {
      if (!state.token) {
        setLoading(false);
        return;
      }

      const response = await ApiService.getCurrentUser();
      
      if (response.success) {
        dispatch({ type: authActions.SET_USER, payload: response.user });
      } else {
        // Token might be invalid, logout
        logout();
      }
    } catch (error) {
      console.error('Get current user error:', error);
      // Token might be invalid, logout
      logout();
    } finally {
      setLoading(false);
    }
  };

  // Check authentication status on app load
  useEffect(() => {
    getCurrentUser();
  }, [state.token]);

  // Update user data
  const updateUser = (userData) => {
    dispatch({ type: authActions.SET_USER, payload: userData });
  };

  // Context value
  const value = {
    user: state.user,
    token: state.token,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    updateUser,
    setError,
    setLoading,
    isAuthenticated: !!state.user,
    isAdmin: state.user?.role === 'admin' || state.user?.role === 'super_admin',
    isTeacher: state.user?.role === 'teacher',
    isStudent: state.user?.role === 'student'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
