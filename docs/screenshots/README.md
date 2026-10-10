# Local prototype screenshots

`local-dashboard.png` and `local-mobile-events.png` are captured by `npm run test:e2e` from the running application using **actual SQLite-backed sample test records**. They demonstrate frontend/local API functionality only. They are not AWS console screenshots, deployment evidence, or real organization data. The browser test uses an isolated temporary database and removes it after completion.

Recreate them with an installed Edge/Chrome/Chromium browser; set `HUB_BROWSER_PATH` if its location differs from the script default. No browser is downloaded by that command.
