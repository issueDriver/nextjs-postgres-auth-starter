/** 进度条使用真实比例，文字由调用方同时展示，不只依赖颜色。 */
export function ProgressBar({ learned, total, label }: { learned: number; total: number; label: string }) {
  const ratio = total > 0 ? Math.min(learned / total, 1) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={learned}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
