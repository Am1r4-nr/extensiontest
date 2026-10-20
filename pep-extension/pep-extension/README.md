# Malaysia PEP Register (Chrome extension)

Builds a local register of domestic Politically Exposed Persons under the BNM AML/CFT definition
(FATF R.12) from 88 Malaysian sources, refreshed with one click, plus family members and close associates.

## BNM coverage
| BNM category | How it is covered |
|---|---|
| Head of state / government & cabinet | JPM, 28 ministries, 13 state portals (MB/CM, EXCO) |
| MPs / Senators / ADUN | Parliament, state portals and their DUN sub-sites |
| Political party senior officials | 9 party sites (top office-bearers; committee members marked Review) |
| Senior judicial officers | Judiciary, AGC, Syariah Judiciary (JKSM) |
| Military & law enforcement command | ATM HQ, Army, Navy, Air Force, PDRM, MACC, APMM, Immigration, Customs |
| SOE / GLC / statutory body / SWF | Regulators, statutory bodies, GLICs (board, CEO and C-suite) |
| Royal family (public function) | Istana Negara, Ruler pages on state portals |
| Family members & close associates | Entered or imported (CSV) in the Family & associates tab |

Former PEPs ("is, or has been") stay in the register as "Former PEP" and are included in the default view and export.

## Updating (important)
Do NOT remove the extension to update it: a removed extension loses its register.
Copy the new files over the existing folder, then click the reload icon on the extension in chrome://extensions.

## Install
1. Unzip this folder.
2. Open chrome://extensions and switch on Developer mode (top right).
3. Click "Load unpacked" and select the unzipped `pep-extension` folder.
4. Pin the extension, open it and click "Refresh now". Keep the register tab open until the refresh finishes (a few minutes).

## Staying up to date
- Automatic refresh (Sources tab): every day, week (default) or two weeks, in the background while Chrome is open.
- If Chrome was closed when a refresh was due, it runs the next time Chrome starts.
- A notification reports what changed: new, changed position, no longer listed, and sources needing attention.
- The toolbar icon shows a red ! when the register is out of date, and … while a refresh is running.
- Manual and automatic refreshes never run at the same time.

## Upload documents (v1.7)
- Upload documents tab: PDF (incl. scanned), pictures / screenshots, Excel / CSV, Word (.docx),
  saved web pages and text files. Read inside Chrome; nothing is uploaded anywhere.
- Spreadsheets with Nama/Name, Jawatan/Position, Organisasi/Organisation (and Gelaran/Titles) columns are read
  row by row; a template can be downloaded. Other files are read like web pages.
- Preview before saving: correct names, titles and positions, untick wrong rows, choose the source.
- Add one person by hand.
- Uploaded and hand-added people are never marked "no longer listed" by a web refresh and never removed by
  the automatic clean-up. They show "Uploaded" / "Added by hand" in the register and export.
- Sources tab: "Clear website records" deletes a source's website-collected records (uploads stay).
- Libraries: SheetJS (Apache 2.0) in lib/.

## Sources: links and single-source reading (v1.6)
- v1.6.1: all links are listed under the source (Link 1 = main website, Link 2, Link 3...), each with
  Change / Remove and what it gave in the last read. "+ Add another link" adds a new one.
- Each source has a main link (its website, editable with Change / Use original) and extra links
  (one per line): the exact leadership pages, org chart PDFs or pictures. Extra links are read first;
  if they give fewer than 3 people, the main website is searched as well.
- Read this source now: reads one source immediately. It appears in the Refresh log as a single-source
  read and does not reset the "last full refresh" date.

## Two-stage refresh (v1.5)
- Quick pass: every source is read directly (fast). The register fills as each source finishes.
- Second pass: only sources that could not be read or gave fewer than 3 people get the slow methods
  (opening in Chrome, reading PDF / picture org charts), two at a time.
- A background refresh shows its progress in the register and popup, and can be stopped.

## Reading difficult sites (v1.3)
- Slow or unreachable sites are retried, including www / non-www and http variants.
- If a site refuses the extension's request, or only shows content inside a browser, the page is opened in a
  minimized Chrome window (as any visitor would see it) and read there. A minimized window appears in the
  taskbar during a refresh; it closes by itself. Switch this off in Sources > Automatic refresh if preferred.
- Leadership pages not linked from the homepage are found through the site's sitemap and WordPress page search.
- Sites that ask visitors to prove they are human are never bypassed: the Sources tab shows "Needs you".
  Open the page in Chrome, complete the check, then click the P icon > "Add people from this page".
  That page is then pinned for future refreshes.
- Every failure shows its reason and what to do, directly in the Sources tab.

## Org charts, pictures and staff directories (v1.4)
- PDFs with text are read directly. Pictures (PNG, JPG, WebP) and scanned PDFs are read with text
  recognition (OCR, English + Malay), running inside Chrome; nothing is uploaded. SVG charts are read directly.
- Org chart layouts (boxes side by side) are regrouped box by box, so names stay with their own positions.
- Names read from pictures are marked "From picture: check spelling": OCR can drop or change letters.
- Staff directories (Direktori Pegawai / Kakitangan) are read for senior officials only
  (clear PEP roles plus Timbalan KSU / Timbalan KP); junior staff are ignored.
- Image descriptions (alt text) on leadership pages are also read.
- A PDF or picture open in a tab can be captured with "Add people from this page".
- Switch off in Sources > Automatic refresh if not wanted. Libraries: pdf.js (Apache 2.0), Tesseract.js (Apache 2.0), in lib/.

## What it does
- Reads each enabled source's homepage, follows leadership links (Pengurusan Tertinggi, Lembaga Pengarah,
  Jemaah Menteri, EXCO, Ahli Dewan...) and extracts names with their positions.
- Keeps history: first seen, last seen, position changes, and people no longer listed (never deleted).
- A source that fails or returns nothing does not mark its people as "no longer listed".
- Popup: quick name check. Right-click a selected name on any web page: "Check in PEP register".
- Export CSV (UTF-8, opens in Excel). Refresh log keeps a per-source audit trail of every run.
- Data stays in this browser (IndexedDB). Nothing is sent anywhere except requests to the source sites.

## Tuning
- Sources tab: switch sources on/off, pin the exact leadership page URL when discovery misses it,
  add new sources (e.g. city councils, other GLCs).
- "Review" badge = senior role that may or may not meet your PEP definition.
- "Check name" badge = name had no title or bin/binti, so detection is less certain.
- "Exclude" marks a false positive; it stays excluded across refreshes.

## Limits
- Sites that load their content with JavaScript, or publish leadership only as images/PDF org charts,
  will show "Nothing recognised": pin a different page or add those people manually outside the tool.
- Family members and close associates are not published on these sites: record them in the Family & associates tab.
- Listed GLCs (e.g. Maybank, TNB, CIMB) and party sites not listed here can be added in the Sources tab.
