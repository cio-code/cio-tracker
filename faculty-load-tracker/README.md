# Document Tracker - XAMPP-ready (department submissions + other documents)

1. Apps Script: paste backend/Code.gs (replace everything), Save.
2. Run setupSheets once (adds the "DocTypes" row to the Settings sheet, plus any missing tabs). Approve permissions if asked.
3. Deploy > Manage deployments > pencil > Version: New version > Deploy.
4. XAMPP: start Apache, copy this whole "faculty-load-tracker" folder into C:\xampp\htdocs\ (replace the old one).
5. Open http://localhost/faculty-load-tracker/frontend/ , sign in, press Ctrl + Shift + R once, then "Refresh lists" in the menu.

frontend/js/config.js already has your Apps Script URL.

## Receive a document (one page)
Menu: Dashboard | Receive | Submissions | Other documents.
On the Receive page, the FIRST field is "Document type":
  - Faculty submission (Faculty Load + IDP): the department form with faculty names and ticks
  - Memorandum, Request Letter, Travel Order, ...: a simple form (campus, office, title, reference, received from)
The other types are the "DocTypes" row in the Settings sheet (comma separated). Edit it, then click "Refresh lists".
Other documents get numbers like DOC-MAIN-2026-0001 and are followed in the "Other documents" page.
The Dashboard has an "Other documents" strip.

## Files that are new or changed in this version
backend/Code.gs
frontend/receive.html, other-documents.html, dashboard.html
frontend/js/receive.js, other-documents.js, dashboard.js, ui.js
(other-receive.html / other-receive.js no longer exist: their form is now inside receive.html)
