# GitHub settings for the CasaTorch repository

For the maintainers: the settings the workflows in `.github/workflows` expect, as click paths on github.com
(repository **casatorch/casatorch** unless it says Organization). Turn them on once; Scorecard
(Security › Code scanning) shows what is still missing.

## 1. Security features

**Settings › Advanced Security** (called "Code security" on older layouts):

1. **Private vulnerability reporting** › Enable.
2. **Dependency graph** › Enable (on by default for public repositories).
3. **Dependabot alerts** › Enable. **Dependabot security updates** › Enable. **Grouped security updates** › Enable.
4. **Secret Protection** › Enable, then **Push protection** › Enable (blocks a push that contains a token or key).
   Under Push protection, leave **Allow bypass** to repository admins only.
5. **Code scanning** › **CodeQL analysis** › choose **Advanced** (the `CodeQL` workflow). Do not turn on "Default
   setup" as well: the two would conflict. Turn on **Copilot Autofix** if you want suggested fixes.
6. **Code scanning** › **Protection rules** › **Check runs failure threshold**: Security alert severity **High or higher**,
   Standard alert severity **Errors**.

## 2. Actions

**Settings › Actions › General**:

1. **Actions permissions** › "Allow casatorch, and select non-casatorch, actions and reusable workflows", tick
   **Allow actions created by GitHub** and **Allow actions by Marketplace verified creators**, and add to the list:
   `docker/*, softprops/action-gh-release@*, azure/artifact-signing-action@*, gradle/actions/*, anchore/sbom-action@*, sigstore/cosign-installer@*, ossf/scorecard-action@*`.
2. Tick **Require actions to be pinned to a full-length commit SHA**.
3. **Approval for running fork pull request workflows from contributors** › "Require approval for all external
   contributors".
4. **Workflow permissions** › "Read repository contents and packages permissions"; untick **Allow GitHub Actions to
   create and approve pull requests**.

**Settings › Environments › New environment** › name it `release`:

1. **Deployment branches and tags** › "Selected branches and tags" › **Add deployment branch or tag rule** › Ref type
   **Tag**, pattern `v*`.
2. **Required reviewers** › add yourself (each release then waits for one click; optional, but it means a leaked
   token alone can't publish a release).
3. **Environment secrets** › add `CASATORCH_RELEASE_KEY` here, then delete it from **Settings › Secrets and variables ›
   Actions › Repository secrets**.

## 3. Rules for `main` and for release tags

**Settings › Rules › Rulesets › New ruleset › New branch ruleset**:

1. Name `main`, **Enforcement status** Active, **Bypass list** › add Repository admin (for emergencies only).
2. **Target branches** › Add target › Include default branch.
3. Tick **Restrict deletions**, **Block force pushes**, **Require linear history**.
4. Tick **Require a pull request before merging** (Required approvals 0 while you are the only maintainer, 1 once
   there are two; tick **Dismiss stale pull request approvals when new commits are pushed** and **Require conversation
   resolution before merging**).
5. Tick **Require status checks to pass** › **Require branches to be up to date before merging**, and add:
   `Build, unit and security (Node 22)`, `Build, unit and security (Node 24)`, `Setup wizard end to end`,
   `Personal-data scrub and dependency audit`, `docker`, `review` (Dependency review) and
   `JavaScript/TypeScript and workflows (javascript-typescript)`.
6. Tick **Require code scanning results** › add **CodeQL** with Security alerts "High or higher" and Alerts "Errors".
7. Tick **Require signed commits** once every maintainer signs commits (Settings › SSH and GPG keys on your account,
   then `git config commit.gpgsign true`). Commits made in the GitHub web editor are signed by GitHub.

**Settings › Rules › Rulesets › New ruleset › New tag ruleset**:

1. Name `releases`, Enforcement Active, **Bypass list** › Repository admin.
2. **Target tags** › Include by pattern `v*`.
3. Tick **Restrict creations**, **Restrict updates**, **Restrict deletions** (only admins create release tags, and a
   published tag can never be moved or removed).
4. Sign release tags: `git tag -s v0.9.4 -m "CasaTorch 0.9.4"` (GitHub shows them as Verified).

**Settings › General › Releases** › tick **Enable release immutability** (a published release's files and tag can't be
changed afterwards).

## 4. Packages and the organization

1. **Packages › casatorch › Package settings** › **Manage Actions access** › only `casatorch/casatorch` with Write;
   **Danger Zone › Change visibility** › Public (so `cosign verify` and `docker pull` work without signing in).
2. **Organization › Settings › Authentication security** › tick **Require two-factor authentication for everyone**.
3. **Organization › Settings › Member privileges** › Base permissions **Read**; untick **Allow members to create public
   repositories** if only CasaTorch's own repositories should exist.
4. **Organization › Settings › Third-party access › OAuth app policy** › keep **Access restricted**.
