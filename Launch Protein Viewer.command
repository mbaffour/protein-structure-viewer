#!/bin/bash
set -e

VIEWER_DIR="$(cd "$(dirname "$0")" && pwd)"
open "$VIEWER_DIR/index.html"

