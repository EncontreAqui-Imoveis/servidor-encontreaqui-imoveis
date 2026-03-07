# SAST Notes — Email Code Flows

## Local Scan
- Tool: `semgrep`
- Command:
  - `set PYTHONUTF8=1 && semgrep scan --config auto --include=*.ts --include=*.tsx <changed files>`
- Result:
  - `0 findings`
  - focused scan on backend auth/email code files and site auth pages

## CI Coverage
- Backend:
  - `.github/workflows/security_sast.yml`
  - Semgrep on `src` and `tests`
- Painel web:
  - `.github/workflows/security_sast.yml`
- Site:
  - `web_security_scans.yml` already covers Lighthouse and ZAP; Semgrep/CodeQL should remain enabled at repo level if configured externally.

## Manual Review Notes
- No direct code or password logging in the new challenge service.
- Reset session token is hashed at rest.
- Email verification no longer depends on user-clicked Firebase action links in the primary flow.
