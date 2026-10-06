import {readFileSync} from 'node:fs';
// Historical scripts have no atomic NMT ledger; preserve their contents as evidence.
const aliases=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
if(Object.values(aliases.projects ?? {}).some(project => ['line-auto-translate-bot-dev', 'line-auto-translate-bot'].includes(project)))throw Error('Legacy paid entry disabled in isolated NMT checkout; use evaluate-nmt.mjs or nmt-admin.mjs.');
