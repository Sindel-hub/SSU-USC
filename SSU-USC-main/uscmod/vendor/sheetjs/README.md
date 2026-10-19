# SheetJS CE 0.20.3

`xlsx.full.min.js` is vendored from the pinned npm distribution `@e965/xlsx@0.20.3`, a mirror of SheetJS Community Edition, to support XLS, XLSX and CSV in a local Web Worker without sending files to a third-party service. The distribution is installed through the checked-in npm lockfile. License: Apache-2.0, included here. Upstream: https://sheetjs.com/ ; mirror publisher: https://github.com/e965/sheetjs-npm-publisher .

SHA-256 of the vendored JavaScript:
`cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`

To refresh after a deliberate version upgrade, install the pinned dependency, copy its `dist/xlsx.full.min.js` and `LICENSE`, update this record, and run the worker/import tests. Do not use the older `xlsx@0.18.5` npm release.
