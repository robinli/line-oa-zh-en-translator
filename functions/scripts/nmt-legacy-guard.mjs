import {readFileSync} from 'node:fs';
// Historical scripts have no atomic NMT ledger; preserve their contents as evidence.
const aliases=JSON.parse(readFileSync(new URL('../../.firebaserc',import.meta.url),'utf8'));
if(aliases.projects?.test==='line-auto-translate-bot-dev')throw Error('Legacy paid entry disabled in isolated NMT checkout; use evaluate-nmt.mjs or nmt-admin.mjs.');
