'use client';
import { useAuth } from '@/hooks/use-auth';

interface PermissionGateProps {
  permission: string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PermissionGate({ permission, fallback = null, children }: PermissionGateProps) {
  const { hasPermission, loading } = useAuth();
  if (loading) return null;
  const perms = Array.isArray(permission) ? permission : [permission];
  if (!hasPermission(...perms)) return <>{fallback}</>;
  return <>{children}</>;
}
