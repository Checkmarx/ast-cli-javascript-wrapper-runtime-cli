#!/usr/bin/env bash
# Download the five Checkmarx AST CLI archives for a given version, compute
# SHA-256 for each, cross-check every hash against the checksums file on the
# GitHub release, and emit the JSON body of checkmarx-ast-cli.checksums.
#
# Usage: fetch-checksums.sh <version> [--out FILE] [--download-dir DIR] [--skip-crosscheck]
#   version            e.g. 2.3.69 (no leading "v")
#   --out FILE         write the JSON to FILE atomically (temp file + mv), so a
#                      failure never leaves FILE empty or half-written.
#                      Default: print JSON to stdout.
#   --download-dir DIR keep the archives in DIR instead of a temp dir that is
#                      removed on exit.
#   --skip-crosscheck  do not fail when the GitHub checksums file is missing
#                      or incomplete. Off by default: the checksums file is
#                      this repo's supply-chain pin, so a cross-check that
#                      cannot be completed is treated as a failure.
#
# Exit codes: 0 ok, 1 usage/download error, 2 cross-check failure.
#
# Mirrors the "Download CLI and generate checksums" step in
# .github/workflows/update-cli.yml so manual and automated updates agree.
# Written for bash 3.2+ and BSD or GNU userland (macOS and Linux both ship
# a darwin/linux CLI, so contributors on either must be able to run this).
set -euo pipefail

VERSION=""
OUT_FILE=""
DL_DIR=""
SKIP_CROSSCHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_FILE="${2:?--out needs a file}"; shift 2 ;;
    --download-dir) DL_DIR="${2:?--download-dir needs a directory}"; shift 2 ;;
    --skip-crosscheck) SKIP_CROSSCHECK=1; shift ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "ERROR: unknown option $1" >&2; exit 1 ;;
    *) if [ -z "$VERSION" ]; then VERSION="$1"; shift; else echo "ERROR: unexpected argument $1" >&2; exit 1; fi ;;
  esac
done
if [ -z "$VERSION" ]; then
  echo "usage: fetch-checksums.sh <version> [--out FILE] [--download-dir DIR] [--skip-crosscheck]" >&2
  exit 1
fi
VERSION="${VERSION#v}"

CLEANUP_DIR=""
if [ -z "$DL_DIR" ]; then
  DL_DIR="$(mktemp -d)"
  CLEANUP_DIR="$DL_DIR"
fi
mkdir -p "$DL_DIR"
# Only remove what we created; a user-supplied directory is theirs to keep.
trap '[ -n "$CLEANUP_DIR" ] && rm -rf "$CLEANUP_DIR"' EXIT

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "ERROR: need sha256sum or shasum on PATH" >&2
    exit 1
  fi
}

# Parallel arrays (bash 3.2 has no associative arrays). KEY doubles as the
# <os>_<arch> part of the archive name and as the property name in
# checkmarx-ast-cli.checksums. Order matches the existing file.
KEYS=(windows_x64 darwin_x64 linux_x64 linux_arm64 linux_armv6)
EXTS=(zip         tar.gz     tar.gz    tar.gz      tar.gz)
SUMS=()

i=0
while [ $i -lt ${#KEYS[@]} ]; do
  KEY="${KEYS[$i]}"; EXT="${EXTS[$i]}"
  URL="https://download.checkmarx.com/CxOne/CLI/${VERSION}/ast-cli_${VERSION}_${KEY}.${EXT}"
  OUT="${DL_DIR}/ast-cli_${VERSION}_${KEY}.${EXT}"
  echo "downloading ${KEY} ..." >&2
  if ! curl -sfL --retry 3 -o "$OUT" "$URL"; then
    echo "ERROR: download failed: $URL" >&2
    exit 1
  fi
  SUMS[$i]="$(sha256_of "$OUT")"
  echo "  ${KEY}: ${SUMS[$i]} ($(wc -c < "$OUT" | tr -d ' ') bytes)" >&2
  i=$((i + 1))
done

# Cross-check against the checksums the ast-cli release itself publishes.
# A mismatch means the download mirror and the GitHub release disagree; a
# missing file or entry means we cannot prove they agree. Both fail unless
# the caller explicitly opted out.
GH_SUMS="${DL_DIR}/ast-cli_${VERSION}_checksums.txt"
GH_URL="https://github.com/Checkmarx/ast-cli/releases/download/${VERSION}/ast-cli_${VERSION}_checksums.txt"
if curl -sfL -o "$GH_SUMS" "$GH_URL"; then
  i=0
  while [ $i -lt ${#KEYS[@]} ]; do
    KEY="${KEYS[$i]}"; EXT="${EXTS[$i]}"
    NAME="ast-cli_${VERSION}_${KEY}.${EXT}"
    # Exact filename match on the second column; no regex, so dots in the
    # version are literal.
    EXPECTED="$(awk -v f="$NAME" '$2 == f { print $1; exit }' "$GH_SUMS")"
    if [ -z "$EXPECTED" ]; then
      if [ "$SKIP_CROSSCHECK" -eq 1 ]; then
        echo "WARN: ${NAME} not listed in GitHub release checksums (skipped by --skip-crosscheck)" >&2
      else
        echo "ERROR: ${NAME} not listed in ${GH_URL}; cannot cross-check. Use --skip-crosscheck to override." >&2
        exit 2
      fi
    elif [ "$EXPECTED" != "${SUMS[$i]}" ]; then
      echo "ERROR: ${KEY} hash mismatch. local=${SUMS[$i]} github=${EXPECTED}" >&2
      exit 2
    fi
    i=$((i + 1))
  done
  echo "all hashes match GitHub release checksums" >&2
elif [ "$SKIP_CROSSCHECK" -eq 1 ]; then
  echo "WARN: could not fetch ${GH_URL}; hashes NOT cross-checked (skipped by --skip-crosscheck)" >&2
else
  echo "ERROR: could not fetch ${GH_URL}; cannot cross-check. Use --skip-crosscheck to override." >&2
  exit 2
fi

emit_json() {
  echo "{"
  local n=${#KEYS[@]} j=0 sep
  while [ $j -lt $n ]; do
    sep=","; [ $((j + 1)) -eq $n ] && sep=""
    printf '  "%s": "%s"%s\n' "${KEYS[$j]}" "${SUMS[$j]}" "$sep"
    j=$((j + 1))
  done
  echo "}"
}

if [ -n "$OUT_FILE" ]; then
  TMP_OUT="$(mktemp "${OUT_FILE}.XXXXXX")"
  emit_json > "$TMP_OUT"
  mv -f "$TMP_OUT" "$OUT_FILE"
  echo "wrote ${OUT_FILE}" >&2
else
  emit_json
fi
