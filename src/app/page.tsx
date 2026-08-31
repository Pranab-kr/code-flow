import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[68ch] flex-col justify-center gap-6 px-6 py-16">
      <p
        className="font-mono text-xs uppercase tracking-[0.08em]"
        style={{ color: 'var(--color-ink-3)' }}
      >
        code-flow
      </p>
      <h1
        className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl"
        style={{ color: 'var(--color-ink)' }}
      >
        See the real control flow of your code.
      </h1>
      <p className="text-lg leading-relaxed" style={{ color: 'var(--color-ink-2)' }}>
        Paste a solution. Read its branches and loops as a diagram derived from the
        source, never a drawing that can drift out of step with it.
      </p>
      <div>
        <ThemeToggle />
      </div>
    </main>
  );
}
