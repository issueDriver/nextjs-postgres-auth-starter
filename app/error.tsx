'use client';

import { StatusView } from 'components/ui/states';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="flex min-h-screen items-center justify-center"><StatusView title="页面加载失败" actions={[{ label: '重试', onClick: reset }, { label: '返回首页', href: '/' }]} /></main>;
}
