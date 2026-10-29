---
name: update-ast-cli
description: Upgrade the bundled Checkmarx AST CLI in this repo to a new release end to end - resolve the latest (or a given) ast-cli version, create the feature/update_<version> branch, refresh checkmarx-ast-cli.version and checkmarx-ast-cli.checksums with verified SHA-256 hashes, bump the package version, make a signed commit, push, and open the PR into main. Invoke explicitly with /update-ast-cli [version]; it creates branches, pushes, and opens PRs, so it is not auto-triggered from conversation.
disable-model-invocation: true
---

# Update the Checkmarx AST CLI version

This repo pins a specific ast-cli release in two files, verifies downloaded
binaries against the pinned checksums at runtime (`CxInstaller`), and ships
each CLI bump as its own wrapper release. A CLI update is therefore a fixed,
four-file change plus a branch and a PR. Automation exists in
`.github/workflows/update-cli.yml`; this skill is the manual equivalent and
deliberately mirrors it so the two never drift.

Files touched, and nothing else:

| File | Change |
|---|---|
| `checkmarx-ast-cli.version` | the new CLI version, single line |
| `checkmarx-ast-cli.checksums` | SHA-256 for the five release archives |
| `package.json` | patch bump of the wrapper version |
| `package-lock.json` | the two root `version` fields only |

Work through the steps in order. Tell the user what you are doing in a line
as you go, and finish with the PR URL. If something fails, see
Troubleshooting at the end before improvising.

## 1. Preflight

Start from an up-to-date `main` with a clean tree. Anything else risks
dragging unrelated changes into the update PR.

```bash
git status --short            # must be empty
git checkout main && git pull --ff-only
```

## 2. Resolve the target version

Take the version from the user if they gave one (strip any leading `v`).
Otherwise ask GitHub for the latest release. `gh` is authenticated, so this
avoids anonymous API rate limits:

```bash
gh api repos/Checkmarx/ast-cli/releases/latest --jq .tag_name
```

Compare with `cat checkmarx-ast-cli.version`. If they are equal, say so and
stop; there is nothing to update. Also record the current `package.json`
version so you can bump it later.

Skim the release notes between the current and target versions for changes
to command output or flags the wrapper parses, and mention anything relevant
in the PR body. The notes are at
`https://github.com/Checkmarx/ast-cli/releases/tag/<version>`, or via
`gh api repos/Checkmarx/ast-cli/releases/tags/<version> --jq .body`.

## 3. Create the branch

The name is `feature/update_<version>`, for example `feature/update_2.3.69`.
This matches the branch the workflow would create, so people can find either
kind of update PR the same way.

```bash
git checkout -b feature/update_<version>
```

If the branch already exists locally or on origin, someone (or the workflow)
has started this update. Check out that branch and inspect it instead of
making a competing one.

## 4. Refresh the checksums

Run the bundled script with `--out`. It downloads all five archives from
`download.checkmarx.com`, hashes them, cross-checks every hash against the
`ast-cli_<version>_checksums.txt` published on the GitHub release, and only
then replaces the checksums file (it writes to a temp file and moves it into
place, so a failure leaves the existing file untouched):

```bash
bash .claude/skills/update-ast-cli/scripts/fetch-checksums.sh <version> --out checkmarx-ast-cli.checksums
```

The script exits non-zero on a failed download, a hash mismatch, or a
cross-check it cannot complete. Do not work around any of these: the
checksums file is the repo's supply-chain pin, and a disagreement between the
download mirror and the GitHub release is exactly what runtime verification
exists to catch. `--skip-crosscheck` exists for the rare case where the
release has no checksums file; use it only when the user explicitly asks,
and say so in the PR. The archives total roughly 230 MB, so allow a few
minutes.

Then write the version file:

```bash
printf '<version>\n' > checkmarx-ast-cli.version
```

## 5. Bump the package version

Each CLI bump ships as a new wrapper release, so the release workflow needs a
new patch version. Let npm bump `package.json` and the two root `version`
fields of `package-lock.json` together. This works offline and never
contacts a registry, which matters because this repo's `.npmrc` points at a
private registry that may not be reachable from a developer machine:

```bash
npm version <new> --no-git-tag-version      # e.g. 1.0.45
```

npm also drops a trailing blank line from `package.json` if one is present;
that is expected. Do not run `npm install` for this: there are no dependency
changes, and a lockfile regenerated against the wrong registry rewrites
every `resolved` URL into an unreviewable diff.

## 6. Verify before committing

```bash
node -e '
const fs = require("fs");
const sums = JSON.parse(fs.readFileSync("checkmarx-ast-cli.checksums", "utf8"));
const want = ["windows_x64", "darwin_x64", "linux_x64", "linux_arm64", "linux_armv6"];
const missing = want.filter(k => !/^[0-9a-f]{64}$/.test(sums[k] || ""));
if (missing.length) { console.error("checksums missing/invalid:", missing); process.exit(1); }
const lock = require("./package-lock.json"), pkg = require("./package.json");
if (lock.version !== pkg.version || lock.packages[""].version !== pkg.version) { console.error("lockfile version mismatch"); process.exit(1); }
console.log("ok", pkg.version, fs.readFileSync("checkmarx-ast-cli.version", "utf8").trim());
'
git diff --stat
```

Expect exactly the four files listed at the top. The five keys are checked
by name because `CxInstaller` looks them up that way and throws if one is
missing.

## 7. Commit

Stage only the four files and commit with this message shape:

```
Update checkmarx-ast-cli to <version>

* bump checkmarx-ast-cli.version to <version>
* refresh SHA-256 checksums for all five CLI archives
* bump package version to <new>
```

`main` has a required-signatures ruleset, so the commit has to be signed.
Never bypass signing with `--no-gpg-sign` or `commit.gpgsign=false`; if
signing fails, see Troubleshooting.

## 8. Push and open the PR

```bash
git push -u origin feature/update_<version>
```

Open the PR with the REST endpoint and explicit `head` and `base`. See
Troubleshooting for why not `gh pr create`.

```bash
gh api -X POST repos/Checkmarx/ast-cli-javascript-wrapper-runtime-cli/pulls \
  -f title="Update checkmarx-ast-cli to <version>" \
  -f head="feature/update_<version>" -f base="main" \
  -F body=@<bodyfile> --jq '.html_url'
```

Before retrying a failed create, check `gh pr list --head feature/update_<version>`
so you never open a duplicate.

PR body template:

```markdown
## Summary

Updates [checkmarx-ast-cli](https://github.com/Checkmarx/ast-cli) from <old-cli> to <version> and bumps the wrapper package to <new>.

## Changes

- `checkmarx-ast-cli.version`: <old-cli> -> <version>
- `checkmarx-ast-cli.checksums`: refreshed SHA-256 for all five archives (windows_x64, darwin_x64, linux_x64, linux_arm64, linux_armv6)
- `package.json` / `package-lock.json`: <old> -> <new>

## Verification

- Each archive was downloaded from `download.checkmarx.com/CxOne/CLI/<version>/` and hashed locally, matching the process in `update-cli.yml`.
- All five hashes match `ast-cli_<version>_checksums.txt` on the [<version> GitHub release](https://github.com/Checkmarx/ast-cli/releases/tag/<version>).
- No dependency changes; lockfile diff is the root version bump only.
- Release notes reviewed: <one line, or "no wrapper-relevant changes">
```

## 9. Report

Give the user the PR URL, the old and new CLI and package versions, and
anything you had to work around. CI and a codeowner review happen on the PR;
do not merge it.

## Troubleshooting

**`gpg failed to sign the data` / `No secret key`.** Git is calling a gpg
whose keyring does not hold the configured `user.signingkey`. This is common
when more than one gpg is installed, for example the one bundled with Git for
Windows versus a separate Gpg4win or Homebrew install. Find the gpg that
lists the key (`gpg --list-secret-keys --keyid-format long` against each
candidate binary) and point git at it, either for one commit with
`git -c gpg.program=<path> commit ...` or permanently with
`git config --global gpg.program <path>`. If no gpg on the machine has the
key, stop and ask the user; only they can supply it.

**`gpg: signing failed: Timeout`.** The passphrase prompt opened and was not
answered before gpg gave up. Tell the user to watch for the pinentry window
and retry the commit.

**`gh pr create` says "No commits between main and <branch>".** This has
happened here even when `gh api .../compare/main...<branch>` showed the
branch ahead. The REST call in step 8 with explicit refs works. Check for an
existing PR before retrying so you do not open a duplicate.

**npm fails with `E401` / "Unable to authenticate".** A command reached the
private registry configured in `.npmrc` without the token it references in
the environment. Nothing in this skill should need the registry; if you got
here, you ran `npm install` instead of `npm version`. Restore the lockfile
with `git checkout -- package-lock.json` and use step 5 as written.
