import { BookOpen } from 'lucide-react';
import { StatusView } from 'components/ui/states';

export default function NotFound() {
  return <main className="flex min-h-screen flex-col items-center justify-center"><BookOpen className="text-emerald-600" size={36} strokeWidth={1.5} /><StatusView title="内容暂不可用" actions={[{ label: '返回首页', href: '/' }]} /></main>;
}
