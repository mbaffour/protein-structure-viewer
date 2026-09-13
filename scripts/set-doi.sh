#!/usr/bin/env bash
# Record the Zenodo DOI of a release in README.md and CITATION.cff.
#
#   scripts/set-doi.sh 10.5281/zenodo.1234567           # the DOI of one release
#   scripts/set-doi.sh 10.5281/zenodo.1234567 10.5281/zenodo.1234566   # release DOI, concept DOI
#
# The concept DOI (Zenodo's "cite all versions" DOI) goes on the README badge so the
# badge never goes stale; the release DOI goes into CITATION.cff, which describes
# the version it sits in. Run it after each release once Zenodo has archived it.
set -euo pipefail
cd "$(dirname "$0")/.."

doi="${1:-}"; concept="${2:-$doi}"
if [[ ! "$doi" =~ ^10\.[0-9]{4,9}/ ]]; then echo "usage: scripts/set-doi.sh <release DOI> [concept DOI]" >&2; exit 1; fi

# CITATION.cff: add or replace the doi field (version-level DOI).
if grep -q '^doi: ' CITATION.cff; then
  sed -i '' "s|^doi: .*|doi: $doi|" CITATION.cff
else
  sed -i '' "s|^license: MIT$|doi: $doi\nlicense: MIT|" CITATION.cff
fi

# README: badge under the title and the DOI in the How-to-cite paragraph.
badge="[![DOI](https://zenodo.org/badge/DOI/$concept.svg)](https://doi.org/$concept)"
if grep -q 'zenodo.org/badge/DOI' README.md; then
  sed -i '' "s|\[!\[DOI\](https://zenodo.org/badge/DOI/[^)]*)\](https://doi.org/[^)]*)|$badge|" README.md
else
  # insert after the first heading line
  awk -v badge="$badge" 'NR==1 {print; print ""; print badge; next} {print}' README.md > README.md.tmp && mv README.md.tmp README.md
fi
if grep -q 'cite the DOI of the release you used' README.md; then
  sed -i '' "s|cite the DOI of the release you used\.|cite the DOI of the release you used (this release: https://doi.org/$doi; all versions: https://doi.org/$concept).|" README.md
fi

echo "DOI recorded: release $doi · concept $concept"
git --no-pager diff --stat -- README.md CITATION.cff
