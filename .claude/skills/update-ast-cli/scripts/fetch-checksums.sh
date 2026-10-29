#!/usr/bin/env bash
# Download the five Checkmarx AST CLI archives for a given version, compute
# SHA-256 for each, cross-check against the checksums file on the GitHub
# release, and print the JSON body of checkmarx-ast-cli.checksums to stdout.
#
# Usage: fetch-checksums.sh <version> [download-dir]
#   version       e.g. 2.3.69 (no leading "v")
#   download-dir  where archives are saved; defaults to a fresh mktemp dir
#
# Mirrors the "Download CLI and generate checksums" step in
# .github/workflows/update-cli.yml so manual and automated updates agree.
set -euo pipefail

VERSION="${1:?usage: fetch-checksums.sh <version> [download-dir]}"
DL_DIR="${2:-$(mktemp -d)}"
mkdir -p "$DL_DIR"

# key,extension. Key doubles as the <os>_<arch> part of the archive name and
# as the property name in checkmarx-ast-cli.checksums. Order matters: it is
# the order CxInstaller expects and the order the existing file uses.
PLATFORMS=(
  "windows_x64,zip"
  "darwin_x64,tar.gz"
  "linux_x64,tar.gz"
  "linux_arm64,tar.gz"
  "linux_armv6,tar.gz"
)

declare -A SUMS
for cfg in "${PLATFORMS[@]}"; do
  IFS=',' read -r KEY EXT <<< "$cfg"
  URL="https://download.checkmarx.com/CxOne/CLI/${VERSION}/ast-cli_${VERSION}_${KEY}.${EXT}"
  OUT="${DL_DIR}/ast-cli_${VERSION}_${KEY}.${EXT}"
  echo "downloading ${KEY} ..." >&2
  if ! curl -sfL --retry 3 -o "$OUT" "$URL"; then
    echo "ERROR: download failed: $URL" >&2
    exit 1
  fi
  SUMS["$KEY"]="$(sha256sum "$OUT" | awk '{print $1}')"
  echo "  ${KEY}: ${SUMS[$KEY]} ($(stat -c %s "$OUT") bytes)" >&2
done

# Cross-check against the checksums the ast-cli release itself publishes.
# A mismatch means the download mirror and the GitHub release disagree, which
# must be investigated rather than committed.
GH_SUMS="${DL_DIR}/ast-cli_${VERSION}_checksums.txt"
GH_URL="https://github.com/Checkmarx/ast-cli/releases/download/${VERSION}/ast-cli_${VERSION}_checksums.txt"
if curl -sfL -o "$GH_SUMS" "$GH_URL"; then
  for cfg in "${PLATFORMS[@]}"; do
    IFS=',' read -r KEY EXT <<< "$cfg"
    EXPECTED="$(grep -E " ast-cli_${VERSION}_${KEY}\.${EXT}\$" "$GH_SUMS" | awk '{print $1}' || true)"
    if [ -z "$EXPECTED" ]; then
      echo "WARN: ${KEY} not listed in GitHub release checksums; skipping cross-check" >&2
    elif [ "$EXPECTED" != "${SUMS[$KEY]}" ]; then
      echo "ERROR: ${KEY} hash mismatch. local=${SUMS[$KEY]} github=${EXPECTED}" >&2
      exit 2
    fi
  done
  echo "all hashes match GitHub release checksums" >&2
else
  echo "WARN: could not fetch ${GH_URL}; hashes were NOT cross-checked" >&2
fi

# Emit JSON in the same key order as the existing checksums file.
{
  echo "{"
  n=${#PLATFORMS[@]}; i=0
  for cfg in "${PLATFORMS[@]}"; do
    IFS=',' read -r KEY EXT <<< "$cfg"
    i=$((i+1)); sep=","; [ "$i" -eq "$n" ] && sep=""
    printf '  "%s": "%s"%s\n' "$KEY" "${SUMS[$KEY]}" "$sep"
  done
  echo "}"
}
