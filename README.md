# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

A dependency-free CSV parser that returns exactly what csv-reader 1.0.0
returns for `{text, header}` — `{columns, rows, errors}` — and does it
about 1.8x faster on the practice set (~0.80s vs the baseline's ~1.46s
for 10.65 MB over 6 cases).

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/funfunin/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/funfunin/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

## How it is fast

A single pass driven by `indexOf`. A line with no quote at all takes a
tight `indexOf(',')` loop with no per-field function call and no per-field
object allocation; only lines that actually contain a quote drop to the
field-by-field scanner. Stray CRs are tracked with one amortised pointer
instead of a scan per field. The field readers return just the field string
and report where the field ended through shared variables, so nothing is
allocated per field. `main.ts` turns V8's incremental marking off before
importing `solve.js`, exactly as the baseline does.

## Semantics (from the competition spec)

- A U+FEFF at the very start is dropped.
- Records end at LF or CRLF; empty lines are skipped.
- A CR outside quotes not followed by LF is dropped and is a `stray_cr` error.
- A field opening with a quote runs to the next non-doubled quote (`""` is
  one quote; CRLF / lone CR inside is read as LF); junk after the closing
  quote is appended as it stands (`quote_junk`). A quote that never closes
  is literal and the rest is re-read as unquoted (`unterminated_quote`).
- Rows are padded (`short_row`) or cut (`long_row`) to the first record's
  width. Every error carries the line its record starts on and the record's
  index in rows (null for the header).

## Run it

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every case from `cases.json`, answers each with `run`, and
writes `answers.json`. Verified 6/6 on the practice set, deterministic
across runs.
