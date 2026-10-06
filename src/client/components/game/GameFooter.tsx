import { copy } from "./copy";

export function GameFooter() {
  return (
    <footer className="text-center text-sm text-muted-foreground">
      {copy.footer.rules}
    </footer>
  );
}
