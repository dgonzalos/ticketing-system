import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/** Access the current auth state/actions. Must be called under `AuthProvider`. */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
