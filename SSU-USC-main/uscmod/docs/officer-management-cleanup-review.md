# Officer Management card cleanup

Removed the two permanent cards shown in the request: **Records by term** and **System Administrator: responsibilities and limits**. Removed the Administration guide anchor because its target card no longer exists.

The existing **View tracklist** action still retrieves the selected assignment's records through the same authorized backend. Results now open on demand in a native modal rather than occupying a permanent page card. Pagination, preserved-record viewing and download are retained. The modal scrolls independently, closes through its Close button or Escape, and returns focus to the invoking button. The existing registered-officer roster, promotion form, term actions and activity overview remain in the page.

No account reconciliation or position change was implemented. The user clarified that the Executive Secretary and President are separate accounts; both remain untouched. No database/history deletion, API, permissions, authentication or production service changes are included.

## Modified files

- `usc-admin/admin-dashboard/officer-management.html`: removes the two cards/dead guide link, places the tracklist and preserved-record viewer in an initially closed dialog, and updates asset cache versions.
- `usc-admin/admin-dashboard/css/officer-management.css`: responsive dialog using existing module colors, borders and typography.
- `shared/officer-history.js`: opens the dialog only on View tracklist, closes it, preserves viewing/download handlers and restores focus.
- `tests/browser/officer-management-only.cjs`: verifies removal plus actual on-demand tracklist/report viewing, independent modal sizing, Close/Escape and focus return at desktop/tablet/mobile widths.
- This review document.

## Before and after

Before: two permanent lower-page cards, including an empty term-record panel and lengthy administrator description.

After: both cards are absent from the normal page. Clicking View tracklist opens only that assignment's records in a closable window. The corresponding backend queries and permission checks are unchanged.

## Validation

- JavaScript syntax check passed.
- Officer history suite: **45 passed, 0 failed**.
- Management browser passed against real pages/controllers and the management HTTP handler using synthetic Auth/Firestore data. Checked the removed cards and guide link; preserved report viewing; desktop, tablet and mobile modal layout; Close/Escape; focus restoration; and the existing registration, roster, conversion and completion flows. No browser errors.
- `git diff --check` passed.
- No live accounts, emails or production records were used. Local screenshots are review artifacts, not a hosted Preview. No new backend or rules deployment is required by this UI change.

Changes are committed locally for review. A push requires explicit approval, and the user retains the final merge action.
