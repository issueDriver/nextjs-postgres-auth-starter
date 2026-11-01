'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, UserIcon } from 'components/ui/icons';

const TABS = [
  { href: '/', label: '首页', Icon: HomeIcon },
  { href: '/me', label: '我的', Icon: UserIcon },
];

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg"
    >
      <ul className="flex">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[68px] flex-col items-center justify-center gap-1 text-[11px] transition-colors ${
                  active ? 'font-medium text-emerald-600' : 'text-slate-500'
                }`}
              >
                <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2 : 1.6} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
