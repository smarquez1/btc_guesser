import { type ChangeEvent, type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiError } from "@/game/types";
import { validateDisplayName } from "@/game/types";
import { actionErrorMessage, copy } from "./copy";
import { Notice } from "./Notice";

interface OnboardingFormProps {
  creating: boolean;
  actionError: ApiError | null;
  onSubmit: (displayName: string) => void;
  onDismissError: () => void;
}

/**
 * Display-name onboarding. Validates locally with the shared rule, also
 * surfaces the server's invalid_display_name rejection inline, and blocks
 * repeat submission while creation is in flight. Other failures (network,
 * server, persistence) show in a separate dismissible notice.
 */
export function OnboardingForm({
  creating,
  actionError,
  onSubmit,
  onDismissError,
}: OnboardingFormProps) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const serverRejectedName = actionError?.code === "invalid_display_name";
  const fieldError =
    localError ?? (serverRejectedName ? copy.onboarding.serverRejected : null);
  const otherError = actionError && !serverRejectedName ? actionError : null;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
    if (localError) {
      setLocalError(null);
    }
    if (serverRejectedName) {
      onDismissError();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) {
      return;
    }
    const message = validateDisplayName(value);
    if (message) {
      setLocalError(message);
      return;
    }
    onSubmit(value.trim());
  }

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="flex w-full max-w-[400px] flex-1 flex-col justify-center gap-6 self-center py-10"
    >
      <div className="flex flex-col gap-2 text-center">
        <h2
          id="onboarding-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          {copy.onboarding.heading}
        </h2>
        <p className="text-sm text-muted-foreground">{copy.onboarding.intro}</p>
      </div>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {copy.onboarding.label}
          </label>
          <Input
            id={inputId}
            name="displayName"
            type="text"
            autoComplete="nickname"
            value={value}
            onChange={handleChange}
            disabled={creating}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
            className="h-11"
          />
          <p id={hintId} className="text-sm text-muted-foreground">
            {copy.onboarding.hint}
          </p>
          {fieldError ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {fieldError}
            </p>
          ) : null}
        </div>
        {otherError ? (
          <Notice
            error={otherError}
            message={actionErrorMessage(otherError)}
            actionLabel={copy.notice.dismiss}
            onAction={onDismissError}
          />
        ) : null}
        <Button type="submit" className="h-11 text-base" disabled={creating}>
          {creating ? copy.onboarding.submitting : copy.onboarding.submit}
        </Button>
      </form>
    </section>
  );
}
