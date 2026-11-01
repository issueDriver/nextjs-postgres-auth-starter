import Link from 'next/link';
import { buttonClass } from './button';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} aria-hidden="true" />;
}

/** 中性加载态：固定高度占位，不显示虚构数据。 */
export function LoadingBlock({ rows = 3, label = '加载中' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 py-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

type Action = { label: string; onClick?: () => void; href?: string };

export function StatusView({
  title,
  description,
  actions = [],
  compact = false,
}: {
  title: string;
  description?: string;
  actions?: Action[];
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center text-center ${compact ? 'gap-3 py-6' : 'gap-4 px-6 py-20'}`}
    >
      <p className={compact ? 'text-[15px] text-slate-600' : 'text-lg font-medium text-slate-800'}>{title}</p>
      {description && <p className="text-sm text-slate-500">{description}</p>}
      {actions.length > 0 && (
        <div className="flex w-full max-w-[240px] flex-col gap-3">
          {actions.map((action, i) =>
            action.href ? (
              <Link key={action.label} href={action.href} className={buttonClass(i === 0 ? 'primary' : 'secondary')}>
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={buttonClass(i === 0 ? 'primary' : 'secondary')}
              >
                {action.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
