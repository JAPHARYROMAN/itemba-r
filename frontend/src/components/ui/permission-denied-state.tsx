import React from 'react';

interface PermissionDeniedStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function PermissionDeniedState({
  title = 'Permission required',
  description = 'Your current role does not allow this action.',
  action,
}: PermissionDeniedStateProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-[13px] text-amber-800">{description}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
