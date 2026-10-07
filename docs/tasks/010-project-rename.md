# Project rename

Rename the project and workspace from btc_guess to btc_guesser.

## Acceptance criteria
- The workspace directory is named `btc_guesser`.
- Package metadata uses `btc-guesser` and the displayed title is BTC Guesser.
- Existing DynamoDB tables, local data, and AWS profile examples keep their names
  to preserve the current setup; these are independently configured resources.

## Validation and limitations

- Updated package metadata, HTML title, README, and mockup artboard names.
- No dependency changes; the lockfile contains no root package name to update.
- Workspace directory is renamed to `btc_guesser`. Lint and typecheck pass;
  no formatter was run.
- GitHub origin is `smarquez1/btc_guesser`. Its main branch has unrelated history,
  so this project is published on `assignment/anonymous-players`.
