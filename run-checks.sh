#!/bin/sh
# Every gate, in one command. Run before every push.
#   parse  — the file actually parses (C-117 shipped one that didn't)
#   form   — no duplicate field ids in the job form
#   match  — estimate PDFs land on the right job
#   money  — fee() still returns what he invoices
#   ui     — his typing survives; stale tabs can't overwrite it
set -e
for c in parse form match money ui; do node "$c-check.js"; done
echo
echo "ALL GATES PASS"
