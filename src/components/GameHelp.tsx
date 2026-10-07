export function GameHelp() {
  return (
    <footer className="space-y-2 border-t border-neutral-200 pt-7 text-center text-xs text-neutral-600">
      <p className="text-neutral-900">A little higher. Or a little lower.</p>
      <p>Guess where Bitcoin’s price will move after 60 seconds.</p>
      <p>If the price is unchanged, we’ll keep waiting until it moves.</p>
      <p>Every correct guess +1 point. Every incorrect guess −1 point.</p>
    </footer>
  );
}
