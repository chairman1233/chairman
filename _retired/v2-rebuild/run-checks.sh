#!/bin/sh
set -e
for c in core app; do node "$(dirname "$0")/$c-check.js"; done
echo "V0 GATES PASS"
