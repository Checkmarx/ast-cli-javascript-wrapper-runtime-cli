---
name: update-ast-cli
description: Upgrade the bundled Checkmarx AST CLI in this repo to a new release end to end - resolve the latest (or a given) ast-cli version, create the feature/update_<version> branch, refresh checkmarx-ast-cli.version and checkmarx-ast-cli.checksums with verified SHA-256 hashes, bump package.json / package-lock.json, make a signed commit, push, and open the PR into main. Use this whenever the user mentions a new ast-cli release, says "update/upgrade/bump the CLI", names an ast-cli version like 2.3.70, asks to refresh the CLI checksums or version file, or asks for the "update CLI" branch/PR - even if they only ask for one of those steps, because the steps depend on each other.
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
as you go, and finish with the PR URL.

## 1. Preflight

Start from an up-to-date `main` with a clean tree. Anything else risks
dragging unrelated changes into the update PR.

```bash
git status --short            # must be empty
git checkout main && git pull --ff-only
```

## 2. Resolve the target version

Take the version from the user if they gave one (strip any leading `v`).
Otherwise ask GitHub for the latest release:

```bash
curl -sL https://api.github.com/repos/Checkmarx/ast-cli/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
```

Compare with `cat checkmarx-ast-cli.version`. If they are equal, say so and
stop; there is nothing to update. Also record the current `package.json`
version so you can bump it later.

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

Run the bundled script. It downloads all five archives from
`download.checkmarx.com`, hashes them, cross-checks every hash against the
`ast-cli_<version>_checksums.txt` published on the GitHub release, and prints
the JSON for the checksums file. Write that output over the file:

```bash
bash .claude/skills/update-ast-cli/scripts/fetch-checksums.sh <version> > checkmarx-ast-cli.checksums
```

The script exits non-zero on a failed download or a hash mismatch. Do not
work around either: a mismatch between the download mirror and the GitHub
release is exactly what the runtime checksum verification exists to catch.
The archives total roughly 230 MB, so allow a few minutes. Progress goes to
stderr, only the JSON goes to stdout, so the redirect above is safe.

Then write the version file:

```bash
printf '<version>\n' > checkmarx-ast-cli.version
```

## 5. Bump the package version and lockfile

Increment the patch component of `version` in `package.json` (1.0.43 to
1.0.44). Each CLI bump ships as a new wrapper release, so this is required
for the release workflow to publish.

The lockfile needs the same bump in its two root `version` fields. Prefer
letting npm do it:

```bash
npm install --package-lock-only
```

This repo's `.npmrc` routes npm through the Echo Artifactory registry and
needs `ECHO_LIBRARIES_ACCESS_KEY` in the environment. Without it npm fails
with `E401`. In that case do not point npm at the public registry: the
lockfile's 590-odd `resolved` URLs all reference Echo, and a public
regeneration would rewrite every one of them into an unreviewable diff.
Since dependencies have not changed, a real regeneration would only bump the
two root versions anyway, so apply exactly that by hand:

```bash
sed -i '0,/"version": "<old>"/s//"version": "<new>"/; 0,/"version": "<old>"/s//"version": "<new>"/' package-lock.json
```

Mention in your final message that you did this and why.

## 6. Verify before committing

```bash
node -e "JSON.parse(require('fs').readFileSync('checkmarx-ast-cli.checksums','utf8')); const l=require('./package-lock.json'); console.log(l.version, l.packages[''].version)"
git diff --stat
```

Expect exactly the four files listed at the top. The checksums file must
have the five keys `windows_x64`, `darwin_x64`, `linux_x64`, `linux_arm64`,
`linux_armv6`, because `CxInstaller` looks them up by that name and throws
if one is missing.

## 7. Commit

Stage only the four files and commit with this message shape:

```
Update checkmarx-ast-cli to <version>

* bump checkmarx-ast-cli.version to <version>
* refresh SHA-256 checksums for all five CLI archives
* bump package version to <new>
```

Append whatever attribution trailer the session requires.

`main` has a required-signatures ruleset, so the commit has to be GPG
signed; never bypass signing with `--no-gpg-sign` or `commit.gpgsign=false`.
If git reports `gpg: skipped "<keyid>": No secret key`, the usual cause on
Windows is that git is calling the gpg bundled with Git for Windows while the
key lives in Gpg4win. Confirm with:

```bash
"/c/Program Files/GnuPG/bin/gpg.exe" --list-secret-keys --keyid-format long
```

If the key is listed there, sign with that gpg for this commit:

```bash
git -c gpg.program="C:/Program Files/GnuPG/bin/gpg.exe" commit -F <msgfile>
```

and tell the user they can make it permanent with
`git config --global gpg.program "C:/Program Files/GnuPG/bin/gpg.exe"`.
If the key is not there either, stop and ask; only the user can supply it.

## 8. Push and open the PR

```bash
git push -u origin feature/update_<version>
```

Open the PR with the REST endpoint rather than `gh pr create`. The latter
has failed here with a bogus "No commits between main and <branch>" error
even when the compare API showed the branch ahead; the REST call with
explicit `head` and `base` works first time.

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
```

Append the session's PR attribution line if one is required.

## 9. Report

Give the user the PR URL, the old and new CLI and package versions, and
anything you had to work around (lockfile done by hand, gpg program
override). CI and a codeowner review happen on the PR; do not merge it.
