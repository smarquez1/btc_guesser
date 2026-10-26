import { onMount } from 'svelte';
import { type Price, request } from './api';

export function createPrice() {
  let price = $state<Price | null>(null);
  let error = $state('');

  onMount(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const latest = await request<Price>('/price');

        if (cancelled) {
          return;
        }

        price = latest;
        error = '';
      } catch {
        if (!cancelled) {
          error = 'Live price unavailable. Retrying automatically…';
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
  });

  return {
    get price() {
      return price;
    },
    get error() {
      return error;
    },
  };
}
