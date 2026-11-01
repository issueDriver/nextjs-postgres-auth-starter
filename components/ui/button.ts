const base =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed';

const variants = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50',
  secondary: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400',
  text: 'px-2 text-emerald-700 hover:bg-emerald-50 disabled:text-slate-400',
};

export function buttonClass(variant: keyof typeof variants = 'primary', extra = '') {
  return `${base} ${variants[variant]} ${extra}`.trim();
}
