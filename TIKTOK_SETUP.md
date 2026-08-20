# TikTok Content Posting Integration Setup

This guide explains how to configure the KitContent TikTok integration for both development and production.

## 1. TikTok Developer Products Required

To use this integration, your TikTok Developer application MUST have the following product enabled:
- **Content Posting API**

## 2. Required Scopes

Your application requires the following scopes during the OAuth flow:
- `user.info.basic`
- `video.publish`

## 3. Redirect URI Configuration

You must register the **exact** Redirect URI in your TikTok Developer Portal under your application's Login/Login Callback settings:

**Production:**
`https://kitcontent.lexshub.xyz/api/tiktok/callback`

**Local Development (Example):**
`http://localhost:3000/api/tiktok/callback`

## 4. Environment Variables

Add the following to your `.env` (or `.env.local`) file:

```env
TIKTOK_CLIENT_KEY=your_client_key_here
TIKTOK_CLIENT_SECRET=your_client_secret_here
TIKTOK_REDIRECT_URI=https://kitcontent.lexshub.xyz/api/tiktok/callback
TIKTOK_API_BASE=https://open.tiktokapis.com
```

> **Warning:** NEVER expose `TIKTOK_CLIENT_SECRET` to the frontend or check it into version control.

## 5. Domain Verification

Ensure that the domain used in `TIKTOK_REDIRECT_URI` is verified in the TikTok Developer Portal.

## 6. Local Development

When testing locally, TikTok may restrict callbacks to `localhost` or `127.0.0.1`. You may need to use a tunneling service (like ngrok or Cloudflare Tunnels) to provide a publicly accessible HTTPS URL for the redirect callback and image publishing.

Additionally, the KitContent server MUST be accessible via the internet so TikTok can pull the generated images via `PULL_FROM_URL`.

## 7. Production Setup

In production, ensure your environment variables reflect the production domain. The code is identical; the environment variables determine the environment.

## 8. OAuth Flow

The server handles OAuth 2.0 strictly server-side:
1. `GET /api/tiktok/connect` generates a secure state and redirects to TikTok.
2. `GET /api/tiktok/callback` validates the state and exchanges the authorization code for access and refresh tokens.
3. Tokens are securely stored in the SQLite `tiktok_account` table.

## 9. Photo Publishing Flow

1. The frontend invokes `/api/tiktok/publish/:postId`.
2. The server queries creator info to validate allowed privacy levels.
3. The server ensures the access token is valid (refreshing if necessary).
4. The server instructs TikTok to pull the final generated image via a public HTTPS URL.
5. The `tiktok_publish_id` and status are stored in the `posts` table.

## 10. TikTok Approval & Audit Requirement

**IMPORTANT:** While your TikTok application is in "Sandbox" or unaudited status, published content may be forced to private visibility by TikTok. This is an expected limitation of the sandbox environment, NOT an application error. Once TikTok audits and approves the application, production publishing to the public feed will become active automatically.
