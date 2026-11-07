Student registered-name lock

The profile UI marks student Full Name read-only and omits fullName from student profile writes. firestore.rules rejects student self-updates that change fullName, including mixed name/photo writes. Photo and permitted metadata updates remain allowed; officer and trusted administrator behavior is preserved. No account records are migrated.

Validation uses the local Firestore emulator only. Four focused profile authorization tests pass. The full emulator suite has 12 passes and two unrelated election failures also reproduced on unchanged main (candidate publication and canvasser private-tally fixtures). The maintained npm suite passes separately.

The Vercel preview includes the UI, not a deployment of Firebase rules. Existing live Firebase rules have not been inspected or changed; backend enforcement is not active merely because the UI preview is available. Before using this as an enforced policy, deploy and validate these rules against an approved isolated staging Firebase project. After separate explicit production-backend authorization, coordinate a rules-only deployment through the existing Firebase workflow. Never deploy unrelated indexes, functions or account changes for this fix. Prefer deploying the approved rule before releasing the matching UI; older clients attempting to edit a student name will then receive permission-denied as intended.

Rollback, if needed after authorization, is a reviewed reversion of the name-lock rule and presentation code, not a data reset.
