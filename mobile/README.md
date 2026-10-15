# CinemaTrack Android — Share Receiver

Share Instagram reels to add movies to your CinemaTrack watchlist.

## How to build the APK

### Requirements
- Android Studio (download from developer.android.com/studio)
- Java 17+

### Steps
1. Open Android Studio
2. File → Open → select this folder
3. Wait for Gradle sync to finish
4. Build → Build Bundle(s) / APK(s) → Build APK(s)
5. APK will be in `app/build/outputs/apk/debug/app-debug.apk`

### Install on phone
1. Copy the APK to your phone
2. On your phone: Settings → Security → Install unknown apps → enable for Files
3. Open the APK file and install

## How to use
1. Open CinemaTrack app on your phone → sign in with your CinemaTrack username & password
2. When you see a movie reel on Instagram → tap Share → select CinemaTrack
3. The app identifies the movie and shows it to you
4. Tap "Add to Watchlist" — done!

## Also need to do in Firebase Console
Go to Firebase Console → Authentication → Sign-in method → 
make sure Email/Password is enabled (already done if desktop app works).
