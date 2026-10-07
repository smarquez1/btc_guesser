import type { ApiError, Direction } from "@/game/types";

/**
 * All user-facing strings for the game UI, grouped by area so copy review
 * does not require touching component structure or behavior.
 */
export const copy = {
  header: {
    title: "BTC Guesser",
    scoreLabel: (score: number) => `· Score: ${score}`,
  },
  session: {
    loading: "Loading your game…",
    errorHeading: "We couldn't load your game",
    retry: "Try again",
    reference: (requestId: string) => `Reference: ${requestId}`,
    readyAnnouncement: "Your game is ready.",
    errorAnnouncement: "We couldn't load your game. You can try again.",
  },
  onboarding: {
    heading: "Choose a display name",
    intro:
      "A display name is just a label for your game — it is not a login. This browser session keeps your score and guesses.",
    label: "Display name",
    hint: "Up to 80 characters.",
    submit: "Start playing",
    submitting: "Starting…",
    serverRejected: "That display name wasn't accepted. Try a different one.",
  },
  price: {
    labelLive: "Latest BTC/USD price",
    unavailableValue: "Price unavailable",
    unavailableHint: "No price data is available right now.",
    staleHint: "Stale — last known price",
    ariaHigher: "Price higher than your starting price",
    ariaLower: "Price lower than your starting price",
  },
  guess: {
    prompt: "Will Bitcoin go up or down?",
    up: "Up",
    down: "Down",
    rules: [
      "Wait at least 60 seconds — your guess is scored by the first fresh price that differs from your starting price.",
      "If the price is unchanged or unavailable, keep waiting.",
    ],
  },
  pending: {
    title: (direction: string, startingPrice: string) =>
      `You guessed ${direction} from ${startingPrice}`,
    waiting: (seconds: number) => `Waiting — ${seconds}s left.`,
    checking: "Checking the latest price…",
  },
  result: {
    correct: "Correct",
    incorrect: "Incorrect",
    deltaPositive: "Score +1",
    deltaNegative: "Score −1",
    correctDetail: "Nailed it. Nice call.",
    incorrectDetail: "Not this time. The market had other plans.",
  },
  notice: {
    dismiss: "Dismiss",
  },
  footer: {
    rules: "+1 correct · −1 incorrect · One active guess at a time",
  },
} as const;

/** Lowercase direction word for sentence copy ("up"/"down"). */
export function directionWord(direction: Direction): string {
  return direction === "up" ? "up" : "down";
}

const actionErrorMessages: Record<string, string> = {
  invalid_display_name: copy.onboarding.serverRejected,
  invalid_direction: "That guess wasn't understood. Use the Up or Down button.",
  invalid_body: "That request wasn't accepted. Try again.",
  unauthorized: "We couldn't confirm your session. Try again.",
  active_guess:
    "You already have an active guess. Wait for it to resolve before guessing again.",
  price_unavailable: "No fresh price right now — try again shortly.",
  persistence_unavailable:
    "The server couldn't save right now. Try again shortly.",
  too_many_requests:
    "Too many new games from this device. Wait a moment, then try again.",
  payload_too_large: "That request wasn't accepted. Try again.",
  unsupported_media_type: "That request wasn't accepted. Try again.",
  invalid_request: "That request wasn't accepted. Try again.",
  network: "Network problem — check your connection and try again.",
  unknown: "Something went wrong. Try again.",
};

/** Maps a submission/creation failure to honest, non-technical wording. */
export function actionErrorMessage(error: ApiError): string {
  return actionErrorMessages[error.code] ?? actionErrorMessages.unknown;
}

/** Session-load failures stay distinct from onboarding: the game may still exist on the server. */
export function sessionErrorMessage(error: ApiError | null): string {
  if (!error) {
    return "Something went wrong while loading your game. Your game stays on the server — try again.";
  }
  if (error.code === "network") {
    return "We couldn't reach the game server. Check your connection, then try again. Your game stays on the server.";
  }
  if (error.code === "persistence_unavailable") {
    return "The game server couldn't reach its storage. Your game stays there — try again in a moment.";
  }
  if (error.code === "unauthorized") {
    return "Your session couldn't be confirmed. Try again.";
  }
  if (error.status !== null && error.status >= 500) {
    return "The game server had a problem. Try again in a moment.";
  }
  return "Something went wrong while loading your game. Try again.";
}
