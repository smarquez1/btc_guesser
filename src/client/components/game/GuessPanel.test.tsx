import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { copy } from "@/components/game/copy";
import { GuessPanel } from "@/components/game/GuessPanel";
import type {
  ActiveGuess,
  Direction,
  LatestGuess,
  PlayerState,
  PriceObservation,
  Pricing,
} from "@/game/types";

const NOW = 1_000_000;

function observation(price: string): PriceObservation {
  return {
    price,
    providerTradeAt: "2026-10-06T12:00:00.000Z",
    receivedAt: 1,
  };
}

function fresh(price: string): Pricing {
  return { status: "fresh", observation: observation(price) };
}

function activeGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  return {
    id: "guess-active",
    direction: "up",
    startingPrice: "64000.00",
    acceptedAt: NOW,
    eligibleAt: NOW + 60_000,
    ...overrides,
  };
}

function latestGuess(overrides: Partial<LatestGuess> = {}): LatestGuess {
  return {
    ...activeGuess(),
    id: "guess-latest",
    result: "correct",
    scoreDelta: 1,
    resolvedAt: NOW,
    observedPrice: "65000.00",
    observedAt: NOW,
    ...overrides,
  };
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1",
    displayName: "Ada",
    score: 0,
    activeGuess: null,
    latestGuess: null,
    pricing: fresh("64000.00"),
    ...overrides,
  };
}

function up() {
  return screen.getByRole("button", { name: copy.guess.up });
}

function down() {
  return screen.getByRole("button", { name: copy.guess.down });
}

function renderPanel(
  overrides: {
    player?: PlayerState;
    submitting?: boolean;
    pendingDirection?: Direction | null;
  } = {},
) {
  const onSubmit = vi.fn();
  const onDismissError = vi.fn();
  render(
    <GuessPanel
      player={overrides.player ?? player()}
      now={NOW}
      submitting={overrides.submitting ?? false}
      pendingDirection={overrides.pendingDirection ?? null}
      actionError={null}
      onSubmit={onSubmit}
      onDismissError={onDismissError}
    />,
  );
  return { onSubmit, onDismissError };
}

describe("GuessPanel controls", () => {
  it("leaves both buttons unpressed and enabled when there is no guess", () => {
    renderPanel();

    expect(up()).toBeEnabled();
    expect(down()).toBeEnabled();
    expect(up()).toHaveAttribute("aria-pressed", "false");
    expect(down()).toHaveAttribute("aria-pressed", "false");
    expect(up().className).not.toContain("disabled:opacity-100");
  });

  it("presses Up, locks both buttons, and ignores further clicks after submitting", () => {
    const onSubmit = vi.fn();
    function Controlled() {
      const [pendingDirection, setPendingDirection] =
        useState<Direction | null>(null);
      const [submitting, setSubmitting] = useState(false);
      return (
        <GuessPanel
          player={player()}
          now={NOW}
          submitting={submitting}
          pendingDirection={pendingDirection}
          actionError={null}
          onSubmit={(direction) => {
            onSubmit(direction);
            setPendingDirection(direction);
            setSubmitting(true);
          }}
          onDismissError={() => {}}
        />
      );
    }

    render(<Controlled />);

    fireEvent.click(up());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("up");
    expect(up()).toHaveAttribute("aria-pressed", "true");
    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();

    // Both controls are locked: neither click reaches the submit handler.
    fireEvent.click(down());
    fireEvent.click(up());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows Down pressed and both buttons disabled while a down submission is in flight", () => {
    renderPanel({ submitting: true, pendingDirection: "down" });

    expect(down()).toHaveAttribute("aria-pressed", "true");
    expect(up()).toHaveAttribute("aria-pressed", "false");
    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();
  });

  it("shows Up pressed and both buttons disabled while an up guess is active", () => {
    renderPanel({
      player: player({ activeGuess: activeGuess({ direction: "up" }) }),
    });

    expect(up()).toHaveAttribute("aria-pressed", "true");
    expect(down()).toHaveAttribute("aria-pressed", "false");
    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();
  });

  it("disables both buttons without pressing either while submitting with no known direction", () => {
    renderPanel({ submitting: true, pendingDirection: null });

    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();
    expect(up()).toHaveAttribute("aria-pressed", "false");
    expect(down()).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the pressed ring classes on the pressed button while it is disabled", () => {
    renderPanel({
      player: player({ activeGuess: activeGuess({ direction: "up" }) }),
    });

    expect(up()).toBeDisabled();
    expect(up().className).toContain("ring-2");
    expect(up().className).toContain("ring-offset-2");
    expect(up().className).toContain("disabled:opacity-100");
    expect(down().className).not.toContain("ring-offset-2");
  });
});

describe("GuessPanel notification slot", () => {
  it("renders the pending card, not the latest result, while a guess is active", () => {
    renderPanel({
      player: player({
        activeGuess: activeGuess({ direction: "up" }),
        latestGuess: latestGuess({ result: "correct" }),
      }),
    });

    expect(
      screen.getByText(/You guessed up from \$64,000\.00/),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.result.correct)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.incorrect)).not.toBeInTheDocument();
  });

  it("renders the latest result when there is no active guess", () => {
    renderPanel({
      player: player({
        latestGuess: latestGuess({ result: "incorrect", scoreDelta: -1 }),
      }),
    });

    expect(screen.getByText(copy.result.incorrect)).toBeInTheDocument();
    expect(screen.getByText(copy.result.deltaNegative)).toBeInTheDocument();
    expect(screen.queryByText(/You guessed/)).not.toBeInTheDocument();
  });

  it("renders nothing in the notification slot with neither guess", () => {
    renderPanel();

    expect(screen.queryByText(/You guessed/)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.correct)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.incorrect)).not.toBeInTheDocument();
  });

  it("places the Up/Down buttons above the notification card", () => {
    renderPanel({ player: player({ activeGuess: activeGuess() }) });

    const buttonRow = up().parentElement;
    expect(buttonRow).not.toBeNull();

    const notification = screen
      .getByText(/You guessed up from/)
      .closest('[data-slot="card"]');
    expect(notification).not.toBeNull();

    const relation = (buttonRow as Node).compareDocumentPosition(
      notification as Node,
    );
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
