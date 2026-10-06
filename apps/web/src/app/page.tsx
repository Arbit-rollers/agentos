export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8">
        <h1 className="text-2xl font-semibold">AgentOS</h1>
        <p className="mt-2 text-text-muted">
          Scaffolding is running. The app shell and dashboard arrive in M2.
        </p>
        <a
          href="/api/health"
          className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Check system health
        </a>
      </div>
    </main>
  );
}
