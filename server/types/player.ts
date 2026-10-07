export interface Player {
  id: string;
  name: string;
  score: number;
  createdAt: number;
  pendingGuessId?: string;
}
