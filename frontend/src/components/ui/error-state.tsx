import { AlertTriangle } from 'lucide-react';
import { Btn } from './btn';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Something went wrong.', onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'var(--aurora-danger-bg)', color: 'var(--aurora-danger-text)' }}
      >
        <AlertTriangle className="w-6 h-6" aria-hidden />
      </div>
      <p
        className="text-[14px] font-medium max-w-md leading-relaxed"
        style={{ color: 'var(--aurora-text)' }}
      >
        {message}
      </p>
      {onRetry && (
        <div className="mt-4">
          <Btn onClick={onRetry} variant="secondary">
            Try again
          </Btn>
        </div>
      )}
    </div>
  );
}
