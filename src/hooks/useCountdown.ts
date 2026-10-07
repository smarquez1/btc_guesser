import { useEffect, useState } from 'react';

export function useCountdown(deadline: number | undefined) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (deadline === undefined) {
      return;
    }

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [deadline]);

  return deadline === undefined ? 0 : Math.max(0, Math.ceil((deadline * 1000 - now) / 1000));
}
