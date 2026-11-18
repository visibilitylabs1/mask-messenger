# Veil Chat

Veil is an Android-first, one-to-one messenger built with React Native, Expo, and a Node.js + SQLite backend. Two devices connected to the same server can exchange text messages after a chat request is accepted.

## Run on Android

**Requirements** — Node.js 22.13 or newer and an Android emulator or phone with an Expo Go version that supports SDK 55. A locally installed Android SDK and JDK 17 are recommended for a standalone APK build.

```bash
npm ci
npm run server
```

In a second terminal:

```bash
cp .env.example .env
npm start
```

With an Android Studio emulator open, press `a` in Expo. The default development address `http://10.0.2.2:8787` points to the server on your computer. For a physical phone, put the phone and computer on the same trusted network, set `EXPO_PUBLIC_API_URL` in `.env` to your computer’s LAN address, and start the backend with `HOST=0.0.0.0 npm run server`. Restart Expo after changing the address. Scan Expo’s QR code in Expo Go.

Use two Android devices or two emulators for a complete check. On the first device, create an alias, then open **Identity → Create invite code**. On the second, create a separate alias, open **New chat**, and paste the invite. Accept the request on the first device and exchange messages.

## Build a standalone APK

Run the backend behind HTTPS on a reachable server. Enter that URL on the welcome screen, or use `EXPO_PUBLIC_API_URL` to prefill it when building. Keep `.env` out of source control. For a local debug build over HTTP, start Expo with `VEIL_ALLOW_DEV_HTTP=1 npx expo run:android` on a trusted network. To create an installable release preview with Expo’s build service, configure the project with your Expo account and run:

```bash
EXPO_PUBLIC_API_URL=https://chat.example.com npx eas-cli build --platform android --profile preview
```

Replace the sample address with your HTTPS server, or omit it and enter the URL after installing. Configure the variable in the Expo build environment when prefilling the address for cloud builds.

For a local release build with Android Studio, run `npx expo prebuild --platform android`, then run `./gradlew :app:assembleRelease` from the generated `android/` directory. The APK is written to `android/app/build/outputs/apk/release/`. Set up your own release signing key before distributing builds publicly.

The backend binds to `127.0.0.1:8787` by default. Put a TLS reverse proxy in front of that address. Set `VEIL_DB_PATH` to a writable path on persistent storage and back it up according to your retention needs.

## Identity and privacy

- Signup takes an alias. The app collects no phone number, email address, or address book.
- Discovery defaults to invite-only. Codes expire in 24 hours and are consumed when someone creates a new chat request. Issuing a new code revokes the previous one. Copy or share a code while it is displayed.
- You can opt into discovery through your exact handle or close incoming requests. The other person sees your conversation alias. The recipient can choose that alias before accepting.
- You can block or unblock identities. Deleting an identity or deleting a conversation from the app removes its related chats and messages from the active server database for both participants. Recipients can retain copies they already made.
- The session credential lives in Android SecureStore. There is no recovery or account transfer after reinstalling or clearing app data.
- The API stores message text and aliases in SQLite. HTTPS protects data in transit when deployed behind a TLS proxy. The server operator can read stored messages and may see connection metadata. End-to-end encryption and network anonymity are outside this version.
- Messages sync while the app is open. This version supports text DMs and leaves out group chats, media, calls, and push notifications.

## Verification

```bash
npm test
npx expo install --check
npx expo export --platform android --output-dir dist
```

The integration suite uses separate authenticated sessions to test invite rotation and reuse, request consent, alias visibility, sending and reading messages, pagination, unauthorized access, blocking, and deletion. The Expo export checks the Android JavaScript bundle. It does not produce an APK.
