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
number and address from the sheet — fields stay editable so staff can correct outdated details. Reservation
categories (Fisheries, Girls Only, SC / ST, Rural Area, PWD) can be combined freely; picking **No
Reservations** clears the others.

The form intentionally does **not** collect classes, teacher coordinator, email, accessibility/consent or
medical info — that's already gathered by the separate registration/session-confirmation form that shares
this same spreadsheet. This form is only for institution type, total students and reservation preference.

**District Administration (dashboard):**
- **Overview** — schools confirmed, total students, districts covered, and breakdowns by institution type,
  district and sub-district.
- **Map** — a schematic block map (no external map library, no satellite imagery): each sub-district is a
  region computed from its real-world position, shaded by its educational district (darker/lighter within
  a district just tells the sub-districts apart). A badge shows how many schools registered there; click a
  region to see them. Positions are approximate reference points, not surveyed boundaries.
- **Special Considerations** — a button per reservation category with its count; click one to see the
  sorted list of schools that need it.
- **Submissions** — search/filter all confirmations, edit any field, soft-delete/restore, and for schools
  submitted as "not listed", one click adds them to the managed school list.
- **School Management** — add, edit or remove schools from the dashboard-managed list (`Schools_Extra`).
  This never touches the original master sheet; it only extends what the form can match against.

## Test locally without Google

```bash
python -m http.server 8765
```

Then open <http://localhost:8765/preview/>. The harness runs the real `Code.gs` in the browser
against 15 demo schools and ~11 sample submissions (PIN **1234**). The top bar can simulate a new
submission, a network failure, or reset the demo data.
Dashboard preview: <http://localhost:8765/preview/dashboard.html>.
