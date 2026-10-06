import { useEffect, useState } from "react";
import { copy } from "@/components/game/copy";
import { GameFooter } from "@/components/game/GameFooter";
import { GameHeader } from "@/components/game/GameHeader";
import { GuessPanel } from "@/components/game/GuessPanel";
import { OnboardingForm } from "@/components/game/OnboardingForm";
import { PricePanel } from "@/components/game/PricePanel";
import { SessionErrorNotice } from "@/components/game/SessionErrorNotice";
import { SessionLoading } from "@/components/game/SessionLoading";
import { SessionNotice } from "@/components/game/SessionNotice";
import type { SessionStatus } from "@/game/types";
import { useGame } from "@/game/useGame";

export function App() {
  const controller = useGame();
  const { player, sessionStatus } = controller;

  return (
    <main className="flex min-h-svh flex-col items-center bg-background px-4 py-10 text-foreground sm:px-6 sm:py-18">
      <div className="flex w-full max-w-[640px] flex-1 flex-col gap-10">
        <GameHeader player={player} />
        <SessionAnnouncer status={sessionStatus} />
        {sessionStatus === "checking" ? <SessionLoading /> : null}
        {sessionStatus === "error" ? (
          <SessionErrorNotice
            error={controller.sessionError}
            onRetry={controller.retrySession}
          />
        ) : null}
        {sessionStatus === "onboarding" ? (
          <OnboardingForm
            creating={controller.creating}
            actionError={controller.actionError}
            onSubmit={controller.createPlayer}
            onDismissError={controller.dismissActionError}
          />
        ) : null}
        {sessionStatus === "ready" ? (
          player ? (
            <>
              {controller.sessionError ? (
                <SessionNotice
                  error={controller.sessionError}
                  onRetry={controller.refresh}
                />
              ) : null}
              <PricePanel player={player} />
              <GuessPanel
                player={player}
                now={controller.now}
                submitting={controller.submitting}
                pendingDirection={controller.pendingDirection}
                actionError={controller.actionError}
                onSubmit={controller.submitGuess}
                onDismissError={controller.dismissActionError}
              />
              <GameFooter />
            </>
          ) : (
            <SessionLoading />
          )
        ) : null}
      </div>
    </main>
  );
}

/**
 * Visually hidden live region announcing one-shot session transitions
 * (ready, error). Countdown ticks and price polls are intentionally silent.
 */
function SessionAnnouncer({ status }: { status: SessionStatus }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "ready") {
      setMessage(copy.session.readyAnnouncement);
    } else if (status === "error") {
      setMessage(copy.session.errorAnnouncement);
    } else {
      setMessage(null);
    }
  }, [status]);

  if (!message) {
    return null;
  }
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
