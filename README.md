# IPL Prediction App

Static mobile-first IPL prediction app built with HTML, CSS, vanilla JavaScript, Firebase Firestore, and Chart.js.

## Deploy

1. Create a Firebase project with:
   - Firestore Database
   - Anonymous Authentication enabled
2. Copy your Firebase web config into [config.js](/Users/OliverAshwin/Documents/New project 2/config.js).
3. Publish [firestore.rules](/Users/OliverAshwin/Documents/New project 2/firestore.rules) to Firestore.
4. Deploy this folder to GitHub Pages.

## Firestore Collections

- `matches`
  - Seeded automatically from `matches.js` the first time an authenticated user opens the app.
- `predictions`
  - Document ID format: `matchId_userKey`
- `results`
  - Add manually in Firestore console.
  - Example:
    - `matchId: "match_50"`
    - `winner: "MI"`

## Notes

- Prize pool is `₹144` per match (`₹18 x 8 players`). Over 28 matches, each player contributes `₹504`.
- Prediction lock is enforced in Firestore rules using `request.time`, not device time.
- The UI also syncs a Firestore server timestamp to show a reliable countdown and lock state.
- Browser reminder notifications work when the app is open or installed and active in the browser context.
- The current hardcoded schedule is based on the 2026 IPL PDF and lives in [matches.js](/Users/OliverAshwin/Documents/New project 2/matches.js).
- Right now the app includes the 7:30 PM IST fixtures from May 1 to May 24, 2026, because the product logic is built around one daily 7:30 PM cutoff.
