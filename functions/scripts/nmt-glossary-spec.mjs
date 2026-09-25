// Immutable prior resources remain available for producer-evidence validation.
export const glossaryRecordFile='nmt-glossary-resources-v12.json';
export const glossarySpecs=[
 {direction:'zh-en',id:'nmt-trade-zh-en-v12',file:'zh-en-v12.tsv',source:'zh-TW',target:'en',count:17},
 {direction:'en-zh',id:'nmt-trade-en-zh-v9',file:'en-zh-v9.tsv',source:'en',target:'zh-TW',count:32},
];
export const priorGlossarySpecs=[{direction:'zh-en',id:'nmt-trade-zh-en-v8',file:'zh-en-v8.tsv',source:'zh-TW',target:'en',count:16},glossarySpecs[1]];
export const legacyGlossarySpecs=[priorGlossarySpecs[0],{direction:'en-zh',id:'nmt-trade-en-zh-v8',file:'en-zh-v8.tsv',source:'en',target:'zh-TW',count:28}];
