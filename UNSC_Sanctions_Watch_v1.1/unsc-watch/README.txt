UNSC Sanctions Watch - Chrome extension
=======================================

INSTALL (one time, about 1 minute)
1. Unzip this folder somewhere permanent, e.g. Documents\UNSC Sanctions Watch
   (do not delete or move it afterwards - Chrome loads it from there).
2. In Chrome, go to chrome://extensions
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and select the unzipped folder (the one containing manifest.json).
5. Click the puzzle icon in the toolbar and pin "UNSC Sanctions Watch".

WHAT IT DOES
- Checks the UNSC Consolidated List page every hour (you can change this to 15 min - 3 hours)
  and reads the "last updated on ..." date plus the individual/entity counts.
- Checks the Security Council press release page for new SC/xxxxx releases and flags
  sanctions-related ones (sanctions committees, adds/removes/amends entries, etc.).
- When anything changes: a Windows notification appears and the icon shows a red number.
- "Mark as reviewed" records when you acknowledged the change.
- The first check sets today's date as the baseline, so there is no alert on day one.

EVIDENCE SCREENSHOTS (AUTOMATIC) - new in version 1.1
- Every day at 09:00 (change the time in the popup) the extension opens the Consolidated List
  in a small window, scrolls to and highlights the "last updated on ..." sentence, takes the
  screenshot, and closes the window by itself. This takes about 5-10 seconds.
- It also takes one immediately when a change is detected, and captures the press release
  page when a new sanctions press release appears (you can switch this off).
- Each PNG gets a footer stamped with date/time, time zone, whether it was automatic or manual,
  the list's last-updated date and the page URL. Saved to Downloads\UNSC Evidence\.
- If the PC is locked at 09:00, it waits and takes the screenshot as soon as you unlock.
  If Chrome was closed, it takes it the next time Chrome starts.
- If a screenshot fails, you get a notification and the failure is written to the log.
- "Save evidence screenshot now" in the popup still works at any time.

AUDIT LOG
- "Export log (CSV)" downloads every check, change detected, review and screenshot
  with timestamps - opens in Excel, and can be attached to your monitoring records.

NOTES
- Checks only run while Chrome is open. If Chrome was closed, it checks again on start-up.
- If the UN changes its page layout, the plate turns amber with "Check failed" -
  the extension never silently shows a wrong date. Tell Claude and the parser can be updated.
- Chrome will say the extension can "read and change all your data on all websites".
  Chrome requires this wording for any extension that takes screenshots on its own.
  The code only ever opens and reads main.un.org and press.un.org; nothing is sent anywhere,
  and all data stays in your browser.
- UPGRADING FROM 1.0: replace the files in your extension folder, then click the reload
  icon on the extension's card in chrome://extensions and accept the new permission.
