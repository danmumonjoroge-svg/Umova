# My Business Network: Phases 2-5 (copy these into src/pos-erp, same folder layout)

NEW files: everything listed below that is not in "CHANGED". CHANGED (small edits, see CHANGES_TO_EXISTING_FILES.patch):
navigation/navConfig.js, POSApp.jsx, components/workspace/WorkspaceKit.jsx, pages/ProductsPage.jsx, schema/tests/README.md

Order of use
1. Staging DB: run schema/diagnostics/network_precheck.sql (read-only), then schema/phase36_network.sql (needs phase28 and phase35 already applied).
2. Copy the app files in. In Settings, switch on "My Business Network" (it is opt-in; nobody sees it until then).
3. Tests (from src/pos-erp):  node --test tests/network_helpers.test.mjs
   SQL scenarios + race (scratch Postgres only):  sh schema/tests/phase36_run.sh      -> expect: TOTAL 100 FAIL 0
   Screen tests (jsdom + scratch Postgres):  see tests/network-ui/ (npm i react@18 react-dom@18 react-router-dom@6 lucide-react jsdom@24 @testing-library/react@14 @testing-library/dom@9 esbuild pg; sh setup_db.sh; node build.mjs ui.test.jsx dist/ui.test.mjs; node --import ./harness/dom.js --test dist/ui.test.mjs)  -> expect 13 pass.
   (the tests/network-ui paths inside harness/ and ui.test.jsx point at /home/claude/...; adjust them to your machine)
