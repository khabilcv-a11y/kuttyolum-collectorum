# Kuttyolum Collectorum – Reservation Preference Form & Dashboard

A Google Sheets + Apps Script backend with static pages hosted on Cloudflare Pages.

| Part | URL | Who |
|---|---|---|
| **Reservation Form** | `https://<your-site>/` | Schools |
| **Dashboard** | `https://<your-site>/dashboard.html` | District Administration (PIN protected) |
| API (Apps Script) | `https://script.google.com/macros/s/…/exec` | used by the pages only |

It reads the existing school master spreadsheet (the one already listing schools with their contact,
phone and address) and never writes to it. It keeps its own tabs in the **same spreadsheet**:

| Tab | Purpose |
|---|---|
| `Schools_Extra` | Schools added or corrected from the dashboard's **School Management** tab. Merged into the form's search automatically; the original master list is never modified. |
| `Reservation_Submissions` | One row per submitted form. |
| `Reservation_Audit` | Every submit / edit / delete / school-list change, with previous and new values. |

## Files

```
apps-script/         → pasted into Google Apps Script (the backend / API)
  Code.gs
  appsscript.json
web/                  → hosted on Cloudflare Pages (build output directory)
  index.html          Reservation Preference Form (school-facing)
  dashboard.html       Insights + School Management (PIN protected)
  config.js           ← the Apps Script /exec URL goes here
  _headers             noindex + no-cache headers
preview/              local test harness only
```

## Deploy

### Part A – Apps Script backend (Google)
1. <https://script.google.com> → **New project** → name it *Kuttyolum Collectorum*.
2. Replace `Code.gs` with `apps-script/Code.gs`. ⚙ Project Settings → tick *Show "appsscript.json" manifest file* → paste `apps-script/appsscript.json`.
3. ⚙ Project Settings → **Script Properties** → add `SPREADSHEET_ID` = the part of the school master sheet's URL between `/d/` and `/edit`.
4. **School list detection:** the script looks for a tab named `Schools`, `School List`, `Master List`, `Master` or `Sheet1` (in that order), then falls back to the first tab that isn't one of its own. If your tab has a different name, add Script Property `SCHOOLS_SHEET_NAME` = the exact tab name.
   Columns are matched by header text (case/punctuation don't matter): a school name column, and optionally UDISE code, `H.M/ contact` (or `Contact`, `Headmaster`, `Principal`…), `Phone`/`Mobile`, and `Address`. Only the school name column is required — the rest just won't prefill if missing.
5. Select **`setup`** → **Run** → approve the permissions. The execution log shows the **admin PIN** (change it under Script Properties → `ADMIN_PIN`).
6. **Deploy → New deployment** → ⚙ type **Web app** → Execute as **Me**, Who has access **Anyone** → **Deploy** → copy the URL ending in `/exec`.

### Part B – GitHub
7. Put the `/exec` URL into `web/config.js` (`window.KC_CONFIG.apiUrl`), then commit and push this project to its own GitHub repo.

### Part C – Cloudflare Pages
8. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
9. Build settings: Framework preset **None**, Build command **empty**, Build output directory **`web`** → **Save and Deploy**.
10. You get `https://<project>.pages.dev` (form) and `https://<project>.pages.dev/dashboard.html` (dashboard).

### Part D – make the dashboard private (Cloudflare Access)
11. **Zero Trust → Access → Applications → Add → Self-hosted**. Domain: `<project>.pages.dev`, Path `dashboard.html`.
12. Add a policy: Action **Allow**, Include **Emails** → the district administration officials' emails (login method: One-time PIN by email).

> The `/exec` API URL itself is not behind Cloudflare Access. Reads used by the public form are harmless
> (no personal data beyond the school directory); every write and every dashboard read needs the admin PIN.
> Never commit the PIN to GitHub.

## Using it

**Schools:** search their school by name (autocomplete from the master list) or use **"Can't find your
school? Add it manually"** to type one in. Selecting a listed school prefills the contact person, mobile
number and address from the sheet — fields stay editable so staff can correct outdated details.

Instead of a blunt reservation-category checklist, the form asks four milder profile questions: the
institution's geographical setting (Rural / Semi-Urban-Urban), its student-enrollment classification
(Girls-Only / Co-educational), whether it serves a significant SC/ST demographic (Yes/No, with an optional
note), and whether it's specifically structured for a specialized group such as coastal/fishing community
welfare schools (Yes/No). The dashboard still surfaces these as filterable "special considerations" tags.

The form intentionally does **not** collect classes, teacher coordinator, email, accessibility/consent or
medical info — that's already gathered by the separate registration/session-confirmation form that shares
this same spreadsheet.

Both the form and the dashboard carry a branded header: the Kuttyolum Collectorum programme logo, and the
three initiative partner logos (District Administration Kozhikode, Kozhikode City of Literature, DCIP)
under "An initiative of".

**District Administration (dashboard):**
- **Overview** — KPIs (schools confirmed, total students, districts covered, schools with a special
  consideration), breakdowns by institution type and district, and a **Consolidated Summary by
  Sub-District** table — every sub-district (including ones with zero submissions yet, so coverage gaps
  are visible), with schools, students, institution-type split and all four special-consideration counts
  in one place.
- **Special Considerations** — a button per tag (Rural Area, Girls-Only Institution, SC/ST Community
  Representation, Fishing/Coastal Community Focus) derived from the four profile questions, with its
  count; click one to see the sorted list of schools.
- **Submissions** — search/filter all confirmations, edit any field, soft-delete/restore, and for schools
  submitted as "not listed", one click adds them to the managed school list.
- **Reports** — filter by special consideration, educational district, sub-district, institution type and
  status, sort by any column, and download the result as a **CSV** or a branded, print-ready **PDF**
  (via the browser's print dialog — a header with the logo/title/generated time/filters repeats on every
  page, with a footer; enable "Headers and footers" in the print dialog for page numbers).
- **School Management** — add, edit or remove schools from the dashboard-managed list (`Schools_Extra`).
  This never touches the original master sheet; it only extends what the form can match against.

## Performance

- The form's bootstrap (school list, districts, question options) is cached server-side for 6 hours and
  only invalidated by writes that actually change it (`addSchool`/`updateSchool`/`setSchoolStatus`) —
  submitting or editing a reservation no longer busts the cache for the next visitor.
- `setup()` installs a time-based trigger (`warmFormCache`, every 4 hours) that proactively re-populates
  the cache before it would expire, so in practice almost nobody hits a cold read — only whoever first
  runs `setup()`. Re-run `installFormCacheWarmer_()` manually if you ever need to reinstall it.
- The form also keeps a 2-hour client-side copy in `localStorage`: a repeat visit on the same device
  renders instantly from that cache while a fresh copy loads silently in the background.

## Test locally without Google

```bash
python -m http.server 8765
```

Then open <http://localhost:8765/preview/>. The harness runs the real `Code.gs` in the browser
against 15 demo schools and ~11 sample submissions (PIN **1234**). The top bar can simulate a new
submission, a network failure, or reset the demo data.
Dashboard preview: <http://localhost:8765/preview/dashboard.html>.
