export function devRuntimeConfiguration(env) {
  const selected = {};
  for (const line of env.split(/\r\n|\r|\n/)) {
    const match = /^(TRANSLATION_ENGINE|NMT_REQUEST_PROFILE|TEST_RUNTIME_SERVICE_ACCOUNT|SOL_REVIEW_ENABLED)=(.*)$/.exec(line);
    if (!match) continue;
    if (Object.hasOwn(selected, match[1])) throw Error('Test runtime configuration mismatch: duplicate controlled parameter');
    selected[match[1]] = match[2];
  }
  const engine = selected.TRANSLATION_ENGINE, profile = selected.NMT_REQUEST_PROFILE ?? 'legacy-glossary';
  const legacy = engine === 'nmt-glossary' && profile === 'legacy-glossary';
  const direct = engine === 'nmt-direct' && ['nmt-direct-v1', 'nmt-direct-glossary-v1'].includes(profile);
  if ((!legacy && !direct) || selected.TEST_RUNTIME_SERVICE_ACCOUNT !== 'nmt-test-runtime@line-auto-translate-bot-dev.iam.gserviceaccount.com') throw Error('Test runtime configuration mismatch');
  if (selected.SOL_REVIEW_ENABLED !== undefined && !['true', 'false'].includes(selected.SOL_REVIEW_ENABLED)) throw Error('Invalid Sol review switch');
  if (selected.SOL_REVIEW_ENABLED === 'true' && !direct) throw Error('Sol review requires NMT direct');
  return {engine, profile, ...(selected.SOL_REVIEW_ENABLED === 'true' ? {solReviewEnabled: true} : {}), glossaryRequired: profile !== 'nmt-direct-v1'};
}
