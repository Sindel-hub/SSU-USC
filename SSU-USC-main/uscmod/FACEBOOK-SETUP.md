# Optional Facebook Page publishing

## Deployment

The UI and backend source are implemented; this feature is not active until the database, function, and Meta app are configured. Existing Bulletin Board publishing works without the Facebook service.

1. Apply `supabase/migrations/202610150001_facebook.sql` to the same Supabase project used by this portal. Use the SQL editor or your normal migration workflow. These tables are private to the service role; do not add browser access policies.
2. Configure a Meta app for Facebook Login and Page publishing. Request `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. Configure the exact HTTPS callback URL: `https://YOUR-PORTAL/uscmod/shared/facebook-callback.html` (adjust the deployment base path). Complete the access/review requirements shown in your Meta app dashboard before use outside its permitted test users. The administrator must have content creation access to the intended Page.
3. Set the Edge Function secrets through Supabase secret management:

   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (normally supplied by Supabase)
   - `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY`
   - `PORTAL_URL`: the deployed portal URL; its origin is the only allowed browser origin
   - `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
   - `FACEBOOK_GRAPH_VERSION`: a supported version enabled for your Meta app, such as `v25.0`; verify it in the app dashboard
   - `FACEBOOK_REDIRECT_URI`: the exact callback URL from step 2
   - `FACEBOOK_TOKEN_KEY`: a cryptographically random 32-byte key encoded as base64, used for AES-GCM encryption. Keep it stable; changing it requires reconnecting the Page.

   Never put the App Secret, encryption key, service-role key, or Facebook tokens in frontend files, Firestore, source control, or chat.
4. From `uscmod`, deploy `supabase functions deploy usc-facebook`. The configured `verify_jwt = false` is intentional: the handler validates the Firebase token with Google, checks the current Firestore profile, and separately enforces administrator claims/permissions. It does not trust a browser-supplied role.
5. Set `USC_FACEBOOK_FUNCTION_URL` in `shared/app-config.js` to the deployed function URL if using a different Supabase project, and deploy the updated frontend including the callback page.
6. Sign in as an approved active System Administrator, open **Settings → Facebook Connection**, log in through Facebook, and select the official Page. No Page token is returned to the portal browser.

Reference setup documentation: [Meta Pages API](https://developers.facebook.com/docs/pages-api/), [Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Supabase function authentication](https://supabase.com/docs/guides/functions/auth).

## Publishing and recovery

- The toggle defaults off. A disconnected/unavailable Facebook service disables it and offers the Settings link.
- Bulletin Board persistence completes first. The Facebook request uses that saved announcement ID. Failed Facebook requests never re-run Bulletin Board creation.
- Text announcements use the Page feed endpoint; announcements with a public HTTPS image use the Page photo endpoint and caption. Legacy private/browser-file image references must be migrated to a public HTTPS image before cross-posting.
- Private delivery records retain the original message, image URL, and Page ID. An atomic database reservation permits only one in-flight request per announcement. Successful requests cannot be sent again. Confirmed API rejections can be retried on the original connected Page.
- A timeout, server error, or interrupted response may mean Facebook accepted a post. These are shown as **needs review**, not automatically retried. An administrator can check the Page and use **Confirm existing Facebook post** with its `PAGE_ID_POST_ID`; the server verifies the connected Page and exact message before marking delivery successful. If no post exists, operations staff must investigate before resetting an uncertain delivery to `failed` in the private database. Never reset while an attempt is running.
- Archive/delete/restore operations affect the Bulletin Board only. They do not delete Facebook posts. Delivery records remain to prevent re-posting after restoration. Disconnecting removes the saved connection but does not delete Page posts or revoke the app in Facebook; revoke access in Facebook if needed.
- Expired OAuth sessions are unusable after ten minutes and are removed on subsequent connection attempts. Schedule additional cleanup if your retention requirements require immediate physical deletion.

## Validation before enabling for staff

Run `node --test tests/facebook-publishing.test.mjs tests/announcement-retention.test.mjs tests/js-syntax.test.mjs`.

The backend tests use mocked Google, Facebook, and database responses. They do not replace deployed integration testing or execute the SQL against Postgres. In a test Page: connect as admin; verify an officer cannot connect/disconnect; publish with the toggle off; publish text and a photo with it on; revoke Page permission and confirm a retry does not duplicate the Bulletin post; double-click/retry concurrently; verify secrets are absent from browser responses and unauthenticated database reads are denied. Live Meta OAuth, database migration, and publishing have not been verified by the local tests.
