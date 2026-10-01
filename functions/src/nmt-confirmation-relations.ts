export const NMT_CONFIRMATION_RELATIONS_VERSION = "nmt-confirmation-relations-b3";
export type ConfirmationObject = "coverage" | "delivery_date" | "quantity" | "color";
export type ConfirmationModality = "required" | "not_required" | "prohibited" | "request" | "neutral";
export type ConfirmationActor = "we" | "I" | "you" | "unspecified";
export type CoverageCategory = "service" | "freight";
export interface SemanticSpan {start: number; end: number}
export interface CoverageRestrictions {categories: CoverageCategory[]; only: boolean; spans: SemanticSpan[]}
export interface ConfirmationRelation {
  actor: ConfirmationActor; action: "confirm"; object: ConfirmationObject; modality: ConfirmationModality;
  restrictions: CoverageRestrictions; span: SemanticSpan;
}
export interface ConfirmationExclusion {
  actor: ConfirmationActor; object: ConfirmationObject; modality: ConfirmationModality;
  excludedObject: ConfirmationObject; span: SemanticSpan;
}
export interface IndependentFeeRelation {
  categories: CoverageCategory[]; negated: boolean; only: boolean; span: SemanticSpan;
}
export interface ConfirmationExtraction {
  relations: ConfirmationRelation[]; exclusions: ConfirmationExclusion[]; independentFees: IndependentFeeRelation[];
  unknown: Array<{reason: string; span: SemanticSpan}>;
}
export interface ConfirmationCheck {
  status: "consistent" | "violation" | "unknown" | "not_applicable";
  reasons: string[]; source: ConfirmationExtraction; target: ConfirmationExtraction;
  scope: "explicit_en_zh_confirmation_object_modality_coverage";
}
const costCategories = (text: string, language: "en" | "zh-TW"): CoverageCategory[] => {
  const result: CoverageCategory[] = [];
  if (language === "en" ? /\bservices?(?:\s+fees?)?\b/iu.test(text) : /服務(?:費|項目)?/u.test(text)) result.push("service");
  if (language === "en" ? /\b(?:freight|shipping)(?:\s+(?:fees?|charges?|costs?))?\b/iu.test(text) : /(?:運費|貨運費|運送費|運輸費)/u.test(text)) result.push("freight");
  return result;
};
const onlyRestriction = (text: string, language: "en" | "zh-TW") => language === "en" ? /\b(?:only|solely|limited to)\b/iu.test(text) : /(?:僅|只|限於|限定|限服務|限運費)/u.test(text);
function clauses(text: string): Array<{text: string; span: SemanticSpan}> {
  return [...text.matchAll(/[^。.!?；;\r\n]+[。.!?；;]?/gu)].map(match => ({text: match[0], span: {start: match.index, end: match.index + match[0].length}}));
}
function independentFeeRelations(text: string, language: "en" | "zh-TW"): {frames: IndependentFeeRelation[]; unknown: ConfirmationExtraction["unknown"]} {
  const category = language === "en"
    ? "(?:services?(?:\\s+fees?)?|freight(?:\\s+(?:charges?|costs?))?|shipping(?:\\s+(?:fees?|charges?|costs?))?)"
    : "(?:服務費|運費|貨運費|運送費|運輸費)";
  const predicate = language === "en"
    ? "(?:only\\s+)?(?:the\\s+)?" + category + "(?:\\s+(?:and|&)\\s+" + category + ")*\\s+(?:(?:is|are)\\s+)?(?:not\\s+)?(?:(?:charged|payable|billed|listed)\\s+separately|separate)"
    : "(?:僅|只)?" + category + "(?:\\s*(?:及|與|和)\\s*" + category + ")*\\s*(?:僅|只)?(?:不|未)?(?:另(?:外|行)?(?:計(?:費)?|收取)|分開(?:計費|收取))";
  const end = language === "en" ? "(?=\\s*(?:$|[,.;!?\\r\\n]|\\b(?:and|but)\\b))" : "(?=\\s*(?:$|[，,。.;!?！？；\\r\\n]|(?:並且|而且|並|且)))";
  const complete = new RegExp("^" + predicate + end, language === "en" ? "iu" : "u");
  const starts = [0, ...[...text.matchAll(/[，,。.;!?！？；\r\n]/gu)].map(item => item.index + item[0].length),
    ...[...text.matchAll(language === "en" ? /\b(?:and|but)\b/giu : /(?:並且|而且|並|且)/gu)].map(item => item.index + item[0].length)];
  const candidates = [...new Set(starts.map(start => {
    const tail = text.slice(start), prefix = tail.match(language === "en" ? /^\s*(?:(?:and|but)\s+)?/iu : /^\s*(?:(?:並且|而且|並|且)\s*)?/u)![0];
    return start + prefix.length;
  }))].sort((a, b) => a - b);
  const frames: IndependentFeeRelation[] = [], unknown: ConfirmationExtraction["unknown"] = [];
  // A boundary offers a candidate; only a complete category + fee predicate is
  // excluded. Category-list conjunctions stay inside the longest complete span.
  for (const start of candidates) {
    if (frames.some(frame => start >= frame.span.start && start < frame.span.end)) continue;
    const match = text.slice(start).match(complete);
    if (!match) continue;
    const body = match[0];
    frames.push({categories: costCategories(body, language), negated: language === "en" ? /\bnot\b/iu.test(body) : /(?:不|未)(?:另|分開)/u.test(body),
      only: onlyRestriction(body, language), span: {start, end: start + body.length}});
  }
  for (const start of candidates) {
    if (frames.some(frame => start >= frame.span.start && start < frame.span.end)) continue;
    const body = text.slice(start).split(/[，,。.;!?！？；\r\n]/u)[0]!.trim();
    const beginsCost = language === "en" ? /^(?:only\s+)?(?:the\s+)?(?:services?|freight|shipping)\b/iu.test(body) : /^(?:僅|只)?(?:服務(?:費|項目)?|運費|貨運費|運送費|運輸費)/u.test(body);
    const feePredicate = language === "en" ? /\b(?:charged|billed|payable|listed|separate|separately)\b/iu.test(body) : /(?:另|分開|計費|收取|核算)/u.test(body);
    // Unrecognized predicates remain visible and unknown. A bare only/category
    // fragment stays available to the coverage restriction check.
    if (beginsCost && (!onlyRestriction(body, language) || feePredicate)) unknown.push({reason: "unsupported_independent_cost_relation", span: {start, end: start + body.length}});
  }
  return {frames, unknown};
}
function withoutIndependentFees(text: string, fees: readonly IndependentFeeRelation[]): string {
  let residual = text;
  for (const {span} of fees) residual = residual.slice(0, span.start) + " ".repeat(span.end - span.start) + residual.slice(span.end);
  return residual;
}
function feeFramesMatch(left: readonly IndependentFeeRelation[], right: readonly IndependentFeeRelation[]): boolean {
  const signature = (fee: IndependentFeeRelation) => JSON.stringify([fee.categories, fee.negated, fee.only]);
  const remaining = right.map(signature);
  for (const fee of left) {
    const index = remaining.indexOf(signature(fee));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}
function coverageRestrictions(text: string, language: "en" | "zh-TW"): CoverageRestrictions {
  const categories = new Set<CoverageCategory>(), spans: SemanticSpan[] = [];
  let only = false;
  for (const clause of clauses(text)) {
    const coverage = language === "en" ? /\b(?:covers?|includes?|coverage)\b/iu.test(clause.text) : /(?:涵蓋|包含|包括|範圍)/u.test(clause.text);
    const narrow = onlyRestriction(clause.text, language);
    const types = costCategories(clause.text, language);
    // An unsupported independent fee predicate is unknown, not an invented
    // coverage restriction. Explicit only/coverage fragments remain constrained.
    if (types.length && !coverage && !narrow) continue;
    // An unbound restrictive fragment may refer back across punctuation or another confirmation.
    // For source, only explicit coverage predicates grant a restriction; arbitrary cost mentions do not.
    if (language === "en" ? !coverage : !(coverage || narrow || types.length)) continue;
    if (types.length || narrow) {types.forEach(type => categories.add(type)); only ||= narrow; spans.push(clause.span);}
  }
  return {categories: [...categories].sort(), only, spans};
}
function objectFor(text: string, language: "en" | "zh-TW"): {object: ConfirmationObject; length: number} | null {
  const patterns: Array<[ConfirmationObject, RegExp]> = language === "en" ? [
    ["coverage", /^(?:(?:what|which)\s+(?:(?:items?|services?)\s+)?(?:it|this|that)\s+(?:covers?|includes?)|whether\s+(?:it|this|that)\s+(?:only\s+)?(?:covers?|includes?)|(?:the\s+)?coverage)\b/iu],
    ["delivery_date", /^(?:(?:the|our|its)\s+)?delivery\s+date\b/iu],
    ["quantity", /^(?:(?:the|our|its)\s+)?quantit(?:y|ies)\b/iu],
    ["color", /^(?:(?:the|our|its)\s+)?colou?r\b/iu],
  ] : [
    ["coverage", /^(?:(?:其|它|這|該項|所|是否|僅|只|服務費是否|運費是否|哪些項目被)*)(?:涵蓋|包含|包括|範圍)/u],
    ["delivery_date", /^(?:其|我們的|該)?(?:交貨日期|交付日期|交期|送貨日期|出貨日期)/u],
    ["quantity", /^(?:其|我們的|該)?數量/u],
    ["color", /^(?:其|我們的|該)?(?:顏色|颜色)/u],
  ];
  for (const [object, pattern] of patterns) {
    const match = text.trim().match(pattern);
    if (match) return {object, length: match[0].length};
  }
  return null;
}
function prefixFor(text: string, actionStart: number, language: "en" | "zh-TW"): {prefix: string; start: number} {
  const before = text.slice(0, actionStart);
  const boundaries = language === "en" ? /[.!?;\r\n]|\b(?:but|and)\b/giu : /[。！？；\r\n]|(?:但是|但|而|並且|並|也)/gu;
  const last = [...before.matchAll(boundaries)].at(-1);
  const start = last ? last.index + last[0].length : 0;
  return {prefix: before.slice(start).replace(/^[\s,，]+/u, "").trim(), start};
}
function prefixFeatures(prefix: string, language: "en" | "zh-TW", inherited: ConfirmationActor): {actor: ConfirmationActor; modality: ConfirmationModality | null; supported: boolean} {
  let actor: ConfirmationActor = inherited;
  if (language === "en") {
    const actorMatch = prefix.match(/^(we|I|you)\b/iu);
    if (actorMatch) actor = actorMatch[1]!.toLowerCase() === "i" ? "I" : actorMatch[1]!.toLowerCase() as "we" | "you";
    const remainder = prefix.replace(/^(?:we|I|you)\b\s*/iu, "").replace(/^(?:also\s+)?/iu, "").trim();
    const alternatives: Array<[ConfirmationModality, RegExp]> = [
      ["not_required", /^(?:need not|do not need to|don't need to|are not required to|do not have to)$/iu],
      ["prohibited", /^(?:must not|must never|may not|do not|don't)$/iu],
      ["required", /^(?:must|need to|have to|are required to)$/iu],
      ["request", /^please$/iu], ["neutral", /^$/u],
    ];
    const modality = alternatives.find(([, pattern]) => pattern.test(remainder))?.[0] ?? null;
    if (modality === "request" && !actorMatch) actor = "you";
    return {actor, modality, supported: modality !== null};
  }
  const actorMatch = prefix.match(/^(我們|我|你們|你|您)/u);
  if (actorMatch) actor = actorMatch[1] === "我們" ? "we" : actorMatch[1] === "我" ? "I" : "you";
  const remainder = prefix.replace(/^(?:我們|我|你們|你|您)/u, "").trim();
  const alternatives: Array<[ConfirmationModality, RegExp]> = [
    ["not_required", /^(?:不必|不需要|無須|毋須|不用|无需)$/u],
    ["prohibited", /^(?:不得|不可|禁止|不要|不准)$/u],
    ["required", /^(?:必須|務必|需要|一定要)$/u], ["request", /^請$/u], ["neutral", /^$/u],
  ];
  const modality = alternatives.find(([, pattern]) => pattern.test(remainder))?.[0] ?? null;
  if (modality === "request" && !actorMatch) actor = "you";
  return {actor, modality, supported: modality !== null};
}
function extract(text: string, language: "en" | "zh-TW", coreOnly = false): ConfirmationExtraction {
  const feeExtraction = coreOnly ? {frames: [], unknown: []} : independentFeeRelations(text, language), independentFees = feeExtraction.frames;
  const residual = withoutIndependentFees(text, independentFees);
  const relations: ConfirmationRelation[] = [], exclusions: ConfirmationExclusion[] = [], unknown: ConfirmationExtraction["unknown"] = [...feeExtraction.unknown];
  const actions = [...residual.matchAll(language === "en" ? /\bconfirm\b/giu : /確認/gu)];
  if (!actions.length) return {relations, exclusions, independentFees, unknown};
  if (/["“”「」]/u.test(text) || (language === "en" ? /\b(?:if|unless|would|not not)\b/iu.test(text) : /(?:如果|假如|除非|並非不|不是不)/u.test(text))) {
    unknown.push({reason: "conditional_quotation_or_double_negation", span: {start: 0, end: text.length}});
  }
  const fragments = [...residual.matchAll(language === "en"
    ? /[^,.;!?\r\n]+/gu : /[^，,。.;!?！？；\r\n]+/gu)];
  for (const fragment of fragments) {
    const parts = fragment[0].split(language === "en" ? /\b(?:and|but)\b/iu : /(?:並且|但是|並|但)/u);
    if (parts.some(part => (language === "en" ? /\b(?:must|need(?: not| to)|required to|have to|do not|please)\b/iu : /(?:必須|務必|不必|不需要|無須|毋須|不得|不可|禁止|不准|需要|請)/u).test(part)
      && !(language === "en" ? /\bconfirm\b/iu : /確認/u).test(part))) {
      unknown.push({reason: "unsupported_independent_obligation", span: {start: fragment.index, end: fragment.index + fragment[0].length}});
    }
  }
  let inherited: ConfirmationActor = "unspecified";
  for (const [index, action] of actions.entries()) {
    const before = prefixFor(residual, action.index, language);
    const features = prefixFeatures(before.prefix, language, inherited);
    const next = actions[index + 1];
    const end = next ? prefixFor(residual, next.index, language).start : text.length;
    const rawComplement = residual.slice(action.index + action[0].length, end);
    const complement = rawComplement.split(/[,，。.!?！？；;\r\n]/u)[0]!.trim()
      .replace(language === "en" ? /\b(?:and|but)\s*$/iu : /(?:並且|但是|並|但|而)\s*$/u, "").trim();
    const parsed = objectFor(complement, language);
    const span = {start: before.start, end};
    if (!parsed || !features.supported) {unknown.push({reason: !parsed ? "unsupported_confirmation_object" : "unsupported_confirmation_actor_or_modality", span}); continue;}
    if (parsed.object !== "coverage" && complement.slice(parsed.length).trim().replace(language === "en" ? /^(?:too|also)$/iu : /^也$/u, "")) {
      unknown.push({reason: "unsupported_confirmation_object_modifier_or_compound", span}); continue;
    }
    if (parsed.object === "coverage") {
      const known = language === "en"
        ? /^(?:what|which|whether|items?|services?|fees?|freight|shipping|charges?|costs?|it|this|that|the|covers?|includes?|coverage|only|solely|limited|to|and|too|also|\s)+$/iu
        : /^(?:其|它|這|該項|所|是否|僅|只|涵蓋|包含|包括|範圍|內容|項目|部分|具體|實際|什麼|甚麼|哪些|服務費?|運費|貨運費|運送費|運輸費|及|與|和|的|了|是|\s)+$/u;
      if (!known.test(complement)) unknown.push({reason: "unsupported_coverage_complement", span});
    }
    inherited = features.actor;
    relations.push({actor: features.actor, action: "confirm", object: parsed.object, modality: features.modality!, restrictions: {categories: [], only: false, spans: []}, span});
    // Punctuation does not prove that the remaining complement is independent.
    // Keep contrast/compound suffixes visible even when their frame is unsupported.
    const suffixes = [...rawComplement.matchAll(language === "en"
      ? /[,.;]\s*([^,.;!?\r\n]+)/gu : /[，,。；;]\s*([^，,。；;!?！？\r\n]+)/gu)];
    for (const suffix of suffixes) {
      const body = suffix[1]!.trim();
      const contrast = body.match(language === "en"
        ? /^(?:(?:but|and)\s+)?(?:not|rather than|instead of)\s+(.+)$/iu
        : /^(?:而非|而不是|並非|不是)(.+)$/u);
      const candidate = contrast?.[1]?.trim() ?? body.replace(language === "en" ? /^(?:and|but)\s+/iu : /^(?:及|與|和)/u, "").trim();
      const excluded = objectFor(candidate, language);
      if (contrast || excluded && excluded.object !== "coverage") {
        const suffixSpan = {start: action.index + action[0].length + suffix.index, end: action.index + action[0].length + suffix.index + suffix[0].length};
        unknown.push({reason: "unsupported_confirmation_object_modifier_or_compound", span: suffixSpan});
        if (contrast && excluded && excluded.object !== "coverage" && !candidate.slice(excluded.length).trim()) {
          exclusions.push({actor: features.actor, object: parsed.object, modality: features.modality!, excludedObject: excluded.object, span: suffixSpan});
        }
      }
    }
  }
  const actors = new Set(relations.map(relation => relation.actor).filter(actor => actor !== "unspecified"));
  if (actors.size > 1) unknown.push({reason: "multiple_actors", span: {start: 0, end: text.length}});
  else if (actors.size === 1) {
    const inheritedActor = [...actors][0]!;
    for (const relation of relations) if (relation.actor === "unspecified") relation.actor = inheritedActor;
    for (const exclusion of exclusions) if (exclusion.actor === "unspecified") exclusion.actor = inheritedActor;
  }
  const coverage = relations.filter(relation => relation.object === "coverage");
  if (coverage.length > 1) unknown.push({reason: "ambiguous_multiple_coverage_relations", span: {start: 0, end: text.length}});
  if (!coreOnly && coverage.length === 1) coverage[0]!.restrictions = coverageRestrictions(residual, language);
  for (const clause of coreOnly ? [] : clauses(residual)) {
    const cost = costCategories(clause.text, language).length > 0;
    const coveragePredicate = language === "en" ? /\b(?:covers?|includes?|coverage)\b/iu.test(clause.text) : /(?:涵蓋|包含|包括|範圍)/u.test(clause.text);
    const mappedCoverage = coveragePredicate && (language !== "en" || /\bconfirm\b/iu.test(clause.text));
    if (cost && !mappedCoverage && !onlyRestriction(clause.text, language)) unknown.push({reason: "unsupported_independent_cost_relation", span: clause.span});
  }
  return {relations, exclusions, independentFees, unknown};
}
export function extractConfirmationRelations(text: string, language: "en" | "zh-TW"): ConfirmationExtraction {
  return extract(text, language);
}
function actorMatches(source: ConfirmationActor, target: ConfirmationActor): boolean {
  return source === target || source === "unspecified" || target === "unspecified";
}
// A complete one-to-one matching preserves bound fields and multiplicity. A
// target frame cannot be reused, and explicit matches precede allowed omission.
function matchFrames<T extends {actor: ConfirmationActor}>(left: readonly T[], right: readonly T[], compatible: (source: T, target: T) => boolean): boolean {
  if (left.length !== right.length) return false;
  const matched = new Map<number, number>();
  const assign = (sourceIndex: number, visited: Set<number>): boolean => {
    const targets = right.map((_, index) => index).sort((a, b) => Number(right[b]!.actor === left[sourceIndex]!.actor) - Number(right[a]!.actor === left[sourceIndex]!.actor));
    for (const targetIndex of targets) {
      if (visited.has(targetIndex) || !compatible(left[sourceIndex]!, right[targetIndex]!)) continue;
      visited.add(targetIndex);
      const previous = matched.get(targetIndex);
      if (previous === undefined || assign(previous, visited)) {matched.set(targetIndex, sourceIndex); return true;}
    }
    return false;
  };
  return left.every((_, index) => assign(index, new Set()));
}
// Four outcomes are deliberately distinct: a bounded consistency check is not a general quality pass.
export function checkConfirmationRelations(sourceText: string, targetText: string, sourceLanguage = "en", targetLanguage = "zh-TW"): ConfirmationCheck {
  const empty: ConfirmationExtraction = {relations: [], exclusions: [], independentFees: [], unknown: []};
  const base = {scope: "explicit_en_zh_confirmation_object_modality_coverage" as const, source: empty, target: empty};
  if (sourceLanguage !== "en" || targetLanguage !== "zh-TW" || !/\bconfirm\b/iu.test(sourceText)) return {...base, status: "not_applicable", reasons: []};
  const source = extract(sourceText, "en"), target = extract(targetText, "zh-TW");
  const result = {...base, source, target};
  const ambiguous = [...source.unknown, ...target.unknown].some(item => ["conditional_quotation_or_double_negation", "multiple_actors"].includes(item.reason));
  // This only checks exclusions with known outer and excluded objects. Faithful
  // compounds stay unknown; general unknown fragments do not become rejections.
  if (!ambiguous && source.relations.length && target.relations.length && !matchFrames(source.exclusions, target.exclusions,
    (left, right) => left.object === right.object && left.modality === right.modality && left.excludedObject === right.excludedObject && actorMatches(left.actor, right.actor))) {
    return {...result, status: "violation", reasons: ["confirmation_exclusion_changed"]};
  }
  if (source.unknown.length || target.unknown.length || !target.relations.length) return {...result, status: "unknown", reasons: [...source.unknown, ...target.unknown].map(item => item.reason).concat(!target.relations.length ? ["target_confirmation_not_recognized"] : [])};
  const reasons: string[] = [];
  // The same extracted spans feed both fee alignment and coverage analysis.
  // Every complete target fee is consumed once, including category, polarity,
  // only and multiplicity; punctuation and clause order are not signatures.
  if (!feeFramesMatch(source.independentFees, target.independentFees)) reasons.push("independent_cost_relation_changed");
  for (const object of ["coverage", "delivery_date", "quantity", "color"] as const) {
    const left = source.relations.filter(relation => relation.object === object), right = target.relations.filter(relation => relation.object === object);
    if (left.length !== right.length) {reasons.push("confirmation_object_changed"); continue;}
    if (!matchFrames(left, right, (original, translated) => original.action === translated.action && original.object === translated.object && original.modality === translated.modality && actorMatches(original.actor, translated.actor))) {
      const modalities = (relations: ConfirmationRelation[]) => relations.map(relation => relation.modality).sort().join();
      reasons.push(modalities(left) !== modalities(right) ? "confirmation_modality_changed" : "confirmation_actor_changed");
    }
    if (object === "coverage" && left.length === 1 && right.length === 1) {
      const original = left[0]!.restrictions, translated = right[0]!.restrictions;
      if (translated.categories.some(category => !original.categories.includes(category)) || translated.only && !original.only) reasons.push("coverage_restriction_added");
      if (original.categories.some(category => !translated.categories.includes(category)) || original.only && !translated.only) reasons.push("coverage_restriction_removed");
    }
  }
  return {...result, status: reasons.length ? "violation" : "consistent", reasons: [...new Set(reasons)]};
}

export const NMT_CONFIRMATION_CORE_VERSION = "nmt-confirmation-core-v1";
export interface ConfirmationCoreCheck {
  status: "consistent" | "violation" | "unknown" | "not_applicable";
  reasons: string[]; scope: "confirmation_actor_object_modality_multiplicity_exclusion";
}
// Runtime projection only. Fee parsing, fee masking, coverage restrictions and
// experimental consistency never participate in this decision. Consistent does
// not certify the remainder and cannot exempt the existing coverage policy.
export function checkConfirmationCore(sourceText: string, targetText: string, sourceLanguage = "en", targetLanguage = "zh-TW"): ConfirmationCoreCheck {
  const result = {scope: "confirmation_actor_object_modality_multiplicity_exclusion" as const};
  if (sourceLanguage !== "en" || targetLanguage !== "zh-TW" || !/\bconfirm\b/iu.test(sourceText)) return {...result, status: "not_applicable", reasons: []};
  const source = extract(sourceText, "en", true), target = extract(targetText, "zh-TW", true);
  const ambiguous = [...source.unknown, ...target.unknown].some(item => ["conditional_quotation_or_double_negation", "multiple_actors"].includes(item.reason));
  if (!ambiguous && source.relations.length && target.relations.length && !matchFrames(source.exclusions, target.exclusions,
    (left, right) => left.object === right.object && left.modality === right.modality && left.excludedObject === right.excludedObject && actorMatches(left.actor, right.actor))) {
    return {...result, status: "violation", reasons: ["confirmation_exclusion_changed"]};
  }
  if (source.unknown.length || target.unknown.length || !target.relations.length) return {...result, status: "unknown", reasons: [...source.unknown, ...target.unknown].map(item => item.reason).concat(!target.relations.length ? ["target_confirmation_not_recognized"] : [])};
  const reasons: string[] = [];
  for (const object of ["coverage", "delivery_date", "quantity", "color"] as const) {
    const left = source.relations.filter(relation => relation.object === object), right = target.relations.filter(relation => relation.object === object);
    if (left.length !== right.length) {reasons.push("confirmation_object_changed"); continue;}
    if (!matchFrames(left, right, (original, translated) => original.action === translated.action && original.object === translated.object && original.modality === translated.modality && actorMatches(original.actor, translated.actor))) {
      const modalities = (relations: ConfirmationRelation[]) => relations.map(relation => relation.modality).sort().join();
      reasons.push(modalities(left) !== modalities(right) ? "confirmation_modality_changed" : "confirmation_actor_changed");
    }
  }
  return {...result, status: reasons.length ? "violation" : "consistent", reasons: [...new Set(reasons)]};
}
