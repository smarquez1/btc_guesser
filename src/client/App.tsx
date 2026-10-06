import { Button } from "@/components/ui/button";

export function App() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12 sm:px-6">
      <section
        aria-labelledby="setup-heading"
        className="w-full max-w-lg rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
      >
        <p className="mb-4 text-sm font-medium text-muted-foreground">
          BTC Guesser
        </p>
        <h1
          id="setup-heading"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Game setup is in progress
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          This is the project starter screen. Live BTC/USD prices, player
          scores, and guessing are not available yet.
        </p>
        <Button className="mt-6" disabled>
          Play unavailable
        </Button>
      </section>
    </main>
  );
}
