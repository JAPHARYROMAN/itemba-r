import { useAuthContext } from '@/contexts/auth-context';

/**
 * Primary hook for consuming auth state.
 * Must be used inside a component wrapped by <AuthProvider>.
 */
export function useAuth() {
  return useAuthContext();
}
