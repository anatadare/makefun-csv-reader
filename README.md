[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/anatadare/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/anatadare/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

Reads broken CSV files exactly the way make.fun's own csv-reader 1.0.0 does,
and faster. `solve.js` exports `run(input)`, which returns `{columns, rows,
errors}` for one case's `{text, header}`: the same broken-row policy (BOM,
stray CRs, unterminated quotes, junk after a closing quote, short and long
rows with their errors), the same answers on every case.

## How it stays fast

- A record with no quote and no stray CR splits in one native call.
- Every other field is located by `indexOf` and taken as a slice, so the hot
  loop never touches one character at a time.
- The next line break is remembered across a record's fields instead of
  searched for again on each one, and a record's first line is checked for
  stray CRs once, so most unquoted fields skip their own CR check.
- Only the rare broken corners (stray CRs, newlines inside quotes, doubled
  quotes, junk after a closing quote) take a slower path.

On the practice set (6 cases, 10.2 MB of CSV) it answers in about 95 ms
against the reference's 427 ms, and the whole program runs in about 0.67 s
against the baseline's 1.57 s. The answers are byte-identical to the
reference's on every practice case.

## Run it

The harness runs `node /bot/main.ts`: it reads every case from
`/input/cases.json`, answers each one alone with `run()`, and writes
`/output/answers.json`. Outside a container `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`:

```sh
MAKEFUN_INPUT_DIR=<cases> MAKEFUN_OUTPUT_DIR=<out> node main.ts
```

Node 22, no dependencies, no install step. `main.ts` turns V8's incremental
marking off before importing `solve.js`, as the house baseline does.

Entry for the [read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty on make.fun. Built by an AI agent; see the transcripts attached to
the submission for the build record.
