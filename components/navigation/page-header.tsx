'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeftIcon } from 'components/ui/icons';
import { hasInAppHistory } from './history-depth';

/** 返回本次来源；没有站内来源时回到 fallback。 */
export function useBack(fallback: string) {
  const router = useRouter();
  return () => {
    if (hasInAppHistory()) router.back();
    else router.replace(fallback);
  };
}

export function PageHeader({
  title,
  fallback,
  right,
}: {
  title: string;
  fallback: string;
  right?: React.ReactNode;
}) {
  const back = useBack(fallback);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-[60px] items-center gap-1 px-2">
        <button
          type="button"
          onClick={back}
          aria-label="返回"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-slate-900">{title}</h1>
        <div className="flex shrink-0 items-center">{right}</div>
      </div>
    </header>
  );
}

export function TabPageHeader({ title }: { title: string }) {
  return (
    <header className="pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between px-6 pb-3 pt-8"><h1 className="text-[28px] font-semibold text-slate-900">{title}</h1><span className="text-[10px] text-slate-400">词间 · WORDSPACE</span></div>
    </header>
  );
}
