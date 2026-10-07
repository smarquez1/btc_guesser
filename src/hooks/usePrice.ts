import { useEffect, useState } from 'react';
import { type Price, request } from '../lib/api';

export function usePrice() {
  const [price, setPrice] = useState<Price | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const latest = await request<Price>('/price');

        if (cancelled) {
          return;
        }

        setPrice(latest);
        setError('');
      } catch {
        if (!cancelled) {
          setError('Live price unavailable. Retrying automatically…');
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refresh, 5000);
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { price, error };
}
