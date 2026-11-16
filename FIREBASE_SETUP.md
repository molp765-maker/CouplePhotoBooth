# Solo live monitoring setup

Solo broadcasts use PeerJS for the live WebRTC media connection and Firebase for session discovery and completed photo-strip storage. Until Firebase is configured, the booth remains usable locally, but its camera will not appear on the Watch Page.

## Create and configure Firebase

1. Create a Firebase project and register a Web app.
2. Enable **Realtime Database**, **Cloud Storage**, and **Anonymous** sign-in in Authentication.
3. Paste the Web app config values into `js/net/firebase-config.js`. These Web config values are public client identifiers; never add a service-account key to the web app.
4. Link this directory to the project with the Firebase CLI, install the Functions dependencies, and deploy the Realtime Database rules, Storage rules, and scheduled cleanup function:

   ```powershell
   firebase use --add
   npm --prefix functions install
   firebase deploy --only database,storage,functions
   ```

   The deploy uses `database.rules.json`, `storage.rules`, and `functions/index.js`.
6. If using Firebase App Check, register a reCAPTCHA v3 site key and set `firebaseAppCheckSiteKey` in `js/net/firebase-config.js`. Test App Check before enforcing it in the Firebase console.

The scheduled function requires a billing-enabled Firebase project with Cloud Functions scheduling enabled. It removes completed session records and their images after 24 hours (physical deletion runs within 15 minutes after expiry). Active sessions refresh their expiry while the booth remains connected.

## Access and privacy

This setup intentionally allows unauthenticated reads so the Watch Page needs no viewer sign-in. As a result, session metadata and photo URLs are publicly readable; anyone with access to the Firebase project/database URL can inspect them, not only people who open the Watch Page. Anonymous authentication restricts updates to a session's owner, but does not prevent visitors from creating their own sessions. Configure and enforce Firebase App Check before production to reduce automated abuse.

The booth shows a live-monitoring setup/error status if the registry cannot be reached. Camera access is still controlled by the browser permission prompt. No audio is captured or shared.

## Local checks

- Serve the repository over `http://localhost` or HTTPS.
- Open the Watch Page with `?watch=Me`.
- Enter Solo Mode in another tab/device. Its session should appear without pressing Start.
- Start/retake a strip, then leave Solo Mode; the completed strip should remain in the Watch Page until its 24-hour expiry.
