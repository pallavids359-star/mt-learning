# MT Learning — student tablet app

Flutter app for college-issued Android tablets.

## Features

- **Setup and sign-in.** The device administrator sets up the device once. The student signs in with a password or PIN.
- **Navigation.** A navy rail on tablets (Home, Practice, Mock tests, Live tests, Revise, Analytics, Profile); on phones a bottom bar with Home, Practice, Mock tests, Live tests and More.
- **Exam choice.** The student picks NEET, JEE or KCET once; it can be changed on Home, Practice, Mock tests or Profile.
- **Home.** Continue an unfinished attempt, an open live test, quick start, accuracy / questions / streak tiles, this week's bars, chapters to work on and recent attempts.
- **Practice.** Subjects, chapters by class 11 and 12 with your accuracy, then topics, difficulty and size (10–60).
- **Mock tests.** The exam pattern, KCET stream choice, start or continue, and every past mock with its score and review.
- **Answering screen** (practice, mocks, revision). Maths and pictures (`$...$`, `{{IMG::...}}`), single and multiple correct, numerical answers, mark for review, question palette by subject, timer, autosave every 20 seconds and when the app is hidden.
- **Result.** Score, accuracy, time, a breakdown by subject, and a review of every question with explanations and a bookmark.
- **Revise.** Retry wrong answers, practise saved questions, remove saved ones.
- **Analytics.** Practice and mock analytics, plus a *Live test marks* tab with the college tests.
- **Live tests.** Instructions, server-clock countdown, palette, autosave, offline papers that upload by themselves, and a review once the test closes.
- **Profile.** Details, exam, a link to attendance in the Bridge app (`--dart-define=BRIDGE_URL=https://…`), PIN, password, sync and sign-out.
- **Heartbeat** every 15 minutes. A tablet marked lost signs itself out and wipes its local data.

Practice needs Wi-Fi (questions come from the bank). Live tests can run offline when the teacher allows it.

## Run

```bash
./tool/setup_android.sh        # first time: generates android/ with the required settings
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
flutter test
```

`API_BASE_URL` must be the API origin without `/api/v1`.

## Code map

| Path | Purpose |
|---|---|
| `lib/core/app_state.dart` | Session, offline cache, sync status, heartbeat, chosen exam and practice dashboard |
| `lib/core/math_text.dart` | Shows question text with maths, pictures and bold |
| `lib/data/api_client.dart` | HTTP client with single-flight token refresh and clear offline/session errors |
| `lib/data/prep_api.dart`, `prep_models.dart` | Practice, mocks, revision, bookmarks and analytics (`/me/prep/...`) |
| `lib/data/test_store.dart` | Live tests: start online or from a downloaded paper, autosave, submit, offline outbox |
| `lib/features/prep/` | Home, practice, mock tests, revise, analytics, answering screen and result |
| `lib/features/tests/` | Live tests list, player and review |
| `lib/features/shell/` | Navigation rail / bottom bar, top bar, sync pill, offline band |

Why a serial is typed in: since Android 10, normal apps cannot read the hardware serial. In Phase 4 the MDM will supply it through managed configuration and this screen will go away.
