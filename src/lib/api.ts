export interface Player {
  name: string;
  score: number;
  pendingGuessId?: string;
}

export interface Price {
  price: number;
  observedAt: number;
  stale: boolean;
}

export interface Guess {
  id: string;
  direction: 'up' | 'down';
  status: 'pending' | 'resolved';
  startingPrice: number;
  deadline: number;
  correct?: boolean;
  finalPrice?: number;
  finalObservedAt?: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'Request failed. Please try again.', response.status);
  }

  return data;
}
