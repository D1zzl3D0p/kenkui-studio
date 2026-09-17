# Google sign-in name

Google's “continue to WorkOS” text comes from WorkOS's shared test OAuth
application. Studio CSS and AuthKit's display name cannot change that label.
Use a Kenkui-owned Google OAuth application in staging and production.

1. Create or select the Google Cloud project owned by Kenkui.
2. Configure its OAuth consent screen with app name **Kenkui Studio**, a
   monitored support email, and Kenkui's homepage, privacy policy and terms:
   `https://kenkui.fm/`, `https://kenkui.fm/privacy/`,
   `https://kenkui.fm/terms/`.
3. Create an OAuth client of type **Web application**. Copy the exact Google
   callback URI shown by the WorkOS Google OAuth integration into Google's
   authorized redirect URIs. This is the WorkOS callback, not Studio's
   `/v1/auth/callback`.
4. Configure the Google client ID and secret in the relevant WorkOS Google
   OAuth integration. Keep the secret out of the frontend and Git.
5. Complete Google's publishing/verification requirements where applicable,
   then test a fresh Google sign-in from staging and production. Confirm that
   Google displays **Kenkui Studio**, and that the callback returns to the
   correct Studio environment.

AuthKit's own name/logo/colors are separate; see the existing branding notes.
These Google settings have not been applied by this code change.

Source: [WorkOS Google OAuth integration](https://workos.com/docs/integrations/google-oauth).
