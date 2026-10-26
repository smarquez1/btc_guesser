import htmx, { type HtmxBeforeSwapDetails, type HtmxResponseInfo } from 'htmx.org';
import './styles.css';

htmx.config.historyCacheSize = 0;
htmx.config.allowEval = false;
const rememberedGuessKey = 'btc-guesser:last-guess';

function isBeforeSwapEvent(event: Event): event is CustomEvent<HtmxBeforeSwapDetails> {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) {
    return false;
  }

  return 'xhr' in event.detail && event.detail.xhr instanceof XMLHttpRequest &&
    'target' in event.detail && event.detail.target instanceof Element &&
    'shouldSwap' in event.detail && typeof event.detail.shouldSwap === 'boolean' &&
    'isError' in event.detail && typeof event.detail.isError === 'boolean';
}

function isAfterRequestEvent(event: Event): event is CustomEvent<HtmxResponseInfo> {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) {
    return false;
  }

  return 'requestConfig' in event.detail && typeof event.detail.requestConfig === 'object' &&
    event.detail.requestConfig !== null && 'path' in event.detail.requestConfig &&
    typeof event.detail.requestConfig.path === 'string' &&
    'xhr' in event.detail && event.detail.xhr instanceof XMLHttpRequest;
}

function markLastPriceUnavailable(root: HTMLElement) {
  const label = root.querySelector<HTMLElement>('[data-price-label]');

  if (label && !label.textContent?.includes('Last available price')) {
    label.textContent += ' · Last available price';
  }
}

document.body.addEventListener('htmx:configRequest', (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' ||
    event.detail === null || !('elt' in event.detail) ||
    !(event.detail.elt instanceof Element) ||
    !event.detail.elt.getAttribute('hx-get')?.startsWith('/api/ui/game') ||
    !('parameters' in event.detail) || typeof event.detail.parameters !== 'object' ||
    event.detail.parameters === null) {
    return;
  }

  const parameters = event.detail.parameters;

  const requestPath = event.detail.elt.getAttribute('hx-get') ?? '';

  if (!requestPath.includes('guessId=') && !('guessId' in parameters)) {
    const guessId = window.localStorage.getItem(rememberedGuessKey);

    if (guessId) parameters.guessId = guessId;
  }
});

document.body.addEventListener('htmx:afterSwap', () => {
  const guessId = document.querySelector<HTMLElement>('#game')?.dataset.guessId;

  if (guessId) window.localStorage.setItem(rememberedGuessKey, guessId);
});

document.body.addEventListener('htmx:beforeSwap', (event) => {
  if (!isBeforeSwapEvent(event)) return;

  const detail = event.detail;

  if (detail.xhr.status === 401) {
    event.preventDefault();
    htmx.trigger(document.body, 'player-invalid');
    return;
  }

  if (detail.xhr.status >= 400 && detail.xhr.getResponseHeader('content-type')?.includes('text/html')) {
    const alert = document.querySelector<HTMLElement>('#game [role="alert"]');

    if (alert) {
      detail.target = alert;
      detail.swapOverride = 'innerHTML';
      detail.shouldSwap = true;
      detail.isError = false;
    }
  }
});

document.body.addEventListener('htmx:afterRequest', (event) => {
  if (!isAfterRequestEvent(event)) return;

  const detail = event.detail;
  const synchronizationRoot = document.querySelector<HTMLElement>('#game-sync');

  if (!synchronizationRoot) return;

  const path = detail.requestConfig.path;
  const alert = synchronizationRoot.querySelector<HTMLElement>('#game [role="alert"]');

  if (path.startsWith('/api/ui/guesses') && detail.failed) {
    synchronizationRoot.dataset.recovering = 'true';
    markLastPriceUnavailable(synchronizationRoot);

    if (alert) alert.textContent = 'Submission could not be confirmed. Checking your pending guess…';
  } else if (path.startsWith('/api/ui/game') && detail.successful) {
    delete synchronizationRoot.dataset.recovering;
  } else if (detail.failed && alert) {
    alert.textContent = 'Could not connect. Retrying automatically…';
    markLastPriceUnavailable(synchronizationRoot);
  }

  if (path.startsWith('/api/ui/session') && detail.failed) {
    window.setTimeout(() => {
      const session = synchronizationRoot.querySelector<HTMLElement>('[hx-post="/api/ui/session"]');

      if (session) htmx.trigger(session, 'load');
    }, 3000);
  }

  if (synchronizationRoot.dataset.recovering === 'true') {
    synchronizationRoot.querySelectorAll<HTMLButtonElement>('#game button').forEach(button => {
      button.disabled = true;
    });
  }
});

document.body.addEventListener('htmx:sendError', (event) => {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const submission = target.closest('[hx-post^="/api/ui/guesses"]');
  const poll = target.closest('[hx-get^="/api/ui/game"]');
  const root = document.querySelector<HTMLElement>('#game-sync');
  const alert = root?.querySelector<HTMLElement>('#game [role="alert"]');

  if (!root || !alert) return;

  if (submission) {
    root.dataset.recovering = 'true';
    alert.textContent = 'Submission could not be confirmed. Checking your pending guess…';
  } else if (poll) {
    alert.textContent = 'Could not connect. Retrying automatically…';
    markLastPriceUnavailable(root);
  }

  if (root.dataset.recovering === 'true') {
    root.querySelectorAll<HTMLButtonElement>('#game button').forEach(button => {
      button.disabled = true;
    });
  }
});

window.setInterval(() => {
  const countdown = document.querySelector<HTMLElement>('[data-countdown][data-deadline]');

  if (!countdown) return;

  const deadline = Number(countdown.dataset.deadline);

  if (!Number.isFinite(deadline)) return;

  const seconds = Math.max(0, deadline - Math.floor(Date.now() / 1000));
  countdown.textContent = String(seconds);

}, 1000);
