export interface PriceObservation {
  tradeId: number;
  price: number;
  observedAt: number;
}

export interface CachedPrice extends PriceObservation {
  symbol: 'BTC-USD';
  freshUntil: number;
  expiresAt: number;
}

export interface PriceState {
  symbol: 'BTC-USD';
  price: number;
  observedAt: number;
  stale: boolean;
}
