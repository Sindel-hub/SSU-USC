# Survey creator review branch

Draft integration for review only. Uses USC cyan #00AEF0 on dedicated creator and public questionnaire; dashboard stylesheet and HTML remain unchanged. Existing public /survey/index.html?id= links remain valid. Officer create/edit/duplicate opens the dedicated editor, using existing authentication and Manage API. Publishing, response access and department filtering remain in the original module.

This is a partial implementation, not merge-ready. Eleven answer types, forward section navigation, local non-submitting respondent preview and basic rich text are implemented in source. File upload is deliberately disabled; question images, full accessible menu keyboard interactions, full regression/browser tests and real staging integration remain incomplete. Anonymous upload needs isolated private storage, server-enforced size/type/content validation, abuse controls and authorized retrieval. No production database migrations.

Run npm run test:needs-assessment, npm run test:syntax, and npm test; revise browser fixtures to match the dedicated editor and test against isolated staging before merging. No end-to-end test is claimed.
