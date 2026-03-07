# Threat Model — Email Code Flows

## Assets
- User accounts with local password
- Email verification status
- Password reset capability
- Brevo delivery channel
- Authenticated session tokens

## Trust Boundaries
- Browser/app -> backend auth routes
- Backend -> Brevo HTTP API
- User inbox -> code entry surfaces
- Backend -> database persistence

## Main Abuse Paths
1. Brute force against 6-digit codes
   - Mitigation: 5 failed attempts, challenge lock, 15 min expiry, resend cooldown 60/90/120, daily limit.
2. Account enumeration via recovery flow
   - Mitigation: generic success for request stage when account is absent or Google-only.
3. Replay of previously issued code
   - Mitigation: latest challenge only, explicit status transitions, consumed reset sessions.
4. Password reset session theft
   - Mitigation: reset session token hashed in DB, TTL 15 min, consumed on first successful use.
5. Log leakage of code or password
   - Mitigation: only store code hash, never log code, retain log sanitization for password fields.
6. Delivery abuse / resend spam
   - Mitigation: auth-sensitive rate limiter plus per-email cooldown and daily limit.

## Residual Risks
- Email inbox compromise remains out of scope; possession of inbox still enables reset.
- Existing Google-only accounts rely on UI-level block plus backend generic handling.
- Old link-based verification routes remain as legacy fallback and must not regain centrality.

## Operational Checks
- Keep `BREVO_API_KEY`, `EMAIL_FROM`, and Firebase Admin credentials in secrets only.
- Validate `NEXT_PUBLIC_FIREBASE_API_KEY` parity between app and site environments.
- Monitor spikes in `EMAIL_RESEND_RATE_LIMITED`, `EMAIL_CODE_LOCKED`, and `PASSWORD_RESET_CODE_LOCKED`.
