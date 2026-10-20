# KAF AGC Third-Party Notice Checker (Chrome extension)

One click checks https://lom.agc.gov.my/subsid.php?type=pub for
"NOTIS KEPADA PIHAK KETIGA / NOTICE TO THIRD PARTIES" under Act 613, opens each new PDF,
pulls out every named party, and appends them to:

- IBL_DD_MM_YYYY.xlsx  (Sheet1, columns A–I)
- AGC_Consolidated_List.xlsx  (Sheet1 list + Sheet2 detail)

Existing formatting, filters and hyperlinks in both workbooks are kept; new rows copy the style
of the last row, the "No" column continues, and the date is the AGC publication date.

## Install (once)
1. Unzip this folder somewhere permanent (e.g. Documents\AGC-IBL-Checker).
2. Chrome → chrome://extensions → turn on Developer mode → Load unpacked → pick the folder.
3. Pin the extension and click its icon.

## Daily use — one click
Click the extension icon. The page opens and immediately:
1. reads the AGC listing,
2. keeps only Act 613 "Notis Kepada Pihak Ketiga" notices dated from your last run
   (or the latest date already in your workbooks; first time with nothing loaded: last 30 days),
3. opens every PDF and pulls out each named party,
4. compares them with your IBL and AGC lists (duplicates are unticked).

Clicking the icon again re-runs the check. Notices you already added are skipped.

## Make it fully hands-off (recommended, one-time setup)
- "Link folder" under each workbook: the IBL and the AGC Consolidated List can be in different folders.
  Pick each file's folder and allow editing ("Allow on every visit").
  Each run searches that folder and its sub-folders (up to 3 levels) for the newest file and saves the update:
    * folder organised as "9. September › 25.09.2026" → saved into the day folder for the notice date (created if needed);
    * any other folder → saved next to the file it was read from.
  If a file with the same name already exists there, the old one is copied to a _backup sub-folder first.
- Tick "Update the workbooks automatically after each check". Notices that read cleanly are added straight away;
  any notice that fails or where the Malay and English name lists differ is left for you to review.
- Without a linked folder, load the two files once by hand; the extension keeps the latest version it creates,
  and updated files go to Downloads.

Then upload the new IBL file to KAF ID Screen.

## Branch verification email
Two ways, chosen at the top of "Email to branches":
- "Gmail opens in another Chrome profile (Work) — copy & paste" (default): after the update the email body is
  copied and the notice PDF is saved into the AGC folder (next to the AGC list, or its day folder). In your Work Chrome: Gmail › Compose, press
  "Copy To" / "Copy subject" and paste, click in the message and press Ctrl+V, drag in the PDF.
- "Gmail works in this Chrome — open the draft for me": opens the Gmail draft with everything filled in (below).

### Gmail draft mode
Below the notices, "Email to branches" prepares the "AGC - Notice to Third Parties dated …" email:
one draft per publication date, listing every name from that date's notices (No / Name / Date of Publication),
with the notice PDF(s) attached. It opens in Gmail for you to check and press Send — it never sends by itself.
- One-time: open "Email settings" and fill in To (and Cc). Wording, greeting and signature can be edited there.
  Leave Signature empty if Gmail adds your signature already. If you are signed in to several Google accounts,
  put firdausfauzi@kaf.com.my in "Gmail account".
- "Open the draft automatically after the workbooks are updated" makes it part of the one click.
- If Gmail's layout blocks the automatic attachment, the page says so and downloads the PDF for you to drag in.
  The email body is also copied to the clipboard as a backup (Ctrl+V into the message).

## If something doesn't work
- "No PDF link found" / layout changed: open the notice PDF yourself and use "Add a notice PDF manually".
- Scanned (image-only) PDFs can't be read — key those names in by hand.
- Always confirm names against the PDF before uploading; this is a compliance record.

Column values written (edit CONFIG at the top of app.js if the house format changes):
C/D/E/G = "Not Specified ", H = "Notice to Third Parties published by the AGC Federal Legislation ",
I = the AGC listing URL. If a MyKad / company number appears in the notice it goes in column C.
