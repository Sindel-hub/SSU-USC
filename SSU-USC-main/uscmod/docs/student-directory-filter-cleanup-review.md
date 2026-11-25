# Student directory filter cleanup

Removed the extra filter panel shown in the request: Name, Department, Program, Year level, Academic year, Enrollment classification and Account status. Removed its unused department suggestions, change/reset handlers and panel-specific CSS so no empty panel or initialization error remains.

The separate exact Student ID lookup, Show all, Student status filter, Refresh, registration/directory links, pagination, student table and record modal remain functional. The import form, account eligibility rules, backend filters and stored records are unchanged.

## Modified files

- `usc-admin/admin-dashboard/student-records.html`: removes the panel and updates controller/style cache versions.
- `usc-admin/admin-dashboard/js/student-records.js`: removes panel initialization/handlers and sends only the retained standing filter from this UI.
- `usc-admin/admin-dashboard/css/student-records-layout.css`: removes the unused filter-panel layout rules.
- `tests/browser/student-import-correction.cjs`: checks absent controls, exact Student ID lookup, Show all and desktop/tablet/mobile screenshots alongside existing import, standing and detail flows.
- This document.

Before: a seven-field panel sat between the lookup row and the student table. After: the table follows the retained lookup/status controls directly.

## Validation

- Student Records suite: **51 passed, 0 failed**.
- JavaScript syntax check passed.
- Browser check passed against the actual page/controller and synthetic backend records: panel and datalist absent, exact ID lookup and Show all work, retained status filtering and record details work, import/correction behavior preserved, layouts fit 1440/768/390 widths. Synthetic records only; no production accounts, emails or records were changed.
- `git diff --check` passed.

Screenshots are local review artifacts, not a hosted Preview. No backend or rules deployment is required. Changes are committed locally; pushing requires user approval and the user performs the final merge.
