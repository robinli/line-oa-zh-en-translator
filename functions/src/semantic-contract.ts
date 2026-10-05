/**
 * Offline research contract. Exact evidence validates grounding, not semantic truth.
 * This module neither translates text nor returns a runtime allow/block decision.
 */
export const SEMANTIC_DIMENSIONS = [
  "actor", "action", "completion", "modality", "negation", "time", "quantity", "money",
] as const;
export type SemanticDimension = typeof SEMANTIC_DIMENSIONS[number];

export interface EvidenceAnchor {quote: string; occurrence: number}
export interface SemanticEvidence extends EvidenceAnchor {start: number; length: number}
export interface SemanticFact {
  state: "known" | "unknown";
  value: string | null;
  evidence: readonly SemanticEvidence[];
  reason: string;
}
export interface SemanticEvent {
  id: string;
  facts: Readonly<Record<SemanticDimension, SemanticFact>>;
}
export interface SemanticRelation {
  id: string;
  kind: string;
  from: string;
  to: string;
  evidence: readonly SemanticEvidence[];
}
export interface SemanticAnnotation {
  schemaVersion: 1;
  events: readonly SemanticEvent[];
  relations: readonly SemanticRelation[];
  unresolved: readonly {evidence: readonly SemanticEvidence[]; reason: string}[];
}
export interface SemanticAlignment {source: string; target: string}
export type AnnotationComparison = "same_annotation" | "different_annotation" | "unknown";
export interface SemanticAnnotationComparison {
  scope: "offline_research";
  semanticTruth: "not_verified";
  wholeSentence: "not_certified";
  runtimeDecision: "none";
  observations: readonly {
    sourceEvent: string;
    targetEvent: string;
    dimension: SemanticDimension;
    comparison: AnnotationComparison;
    source: SemanticFact;
    target: SemanticFact;
  }[];
  relations: readonly {
    source: SemanticRelation;
    target: SemanticRelation;
    comparison: AnnotationComparison;
  }[];
  unknowns: readonly {
    side: "source" | "target";
    kind: "unresolved_fragment" | "unaligned_event" | "unaligned_relation";
    id: string | null;
    evidence: readonly SemanticEvidence[];
    reason: string;
  }[];
}

export class SemanticContractError extends Error {
  constructor(readonly reason: string) {
    // No source text, model payload or personal data in diagnostic messages.
    super(reason);
    this.name = "SemanticContractError";
  }
}

function fail(reason: string): never {throw new SemanticContractError(reason);}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_semantic_shape");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("invalid_semantic_shape");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) {
    fail("invalid_semantic_shape");
  }
  return record;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail("invalid_semantic_shape");
  return value;
}
function string(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim())) {
    fail("invalid_semantic_shape");
  }
  return value;
}
function id(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(result)) fail("invalid_semantic_id");
  return result;
}
function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function researchText(value: unknown): string {
  const text = string(value, 4500);
  if (!validUnicode(text)) fail("invalid_semantic_text");
  return text;
}

/** Resolve the explicitly numbered occurrence; never guess among repeated quotes. */
export function resolveSemanticEvidence(text: string, input: unknown): SemanticEvidence {
  researchText(text);
  const anchor = object(input, ["quote", "occurrence"]);
  const quote = string(anchor.quote, 4500);
  if (!validUnicode(quote)) fail("invalid_evidence_anchor");
  if (!Number.isSafeInteger(anchor.occurrence) || (anchor.occurrence as number) < 0
      || (anchor.occurrence as number) >= 4500) fail("invalid_evidence_anchor");
  const occurrence = anchor.occurrence as number;
  let start = -1;
  for (let count = 0; count <= occurrence; count++) {
    start = text.indexOf(quote, start + 1);
    if (start < 0) fail("evidence_not_found");
  }
  return Object.freeze({quote, occurrence, start, length: quote.length});
}
function evidence(text: string, input: unknown, required: boolean): readonly SemanticEvidence[] {
  const values = array(input, 8);
  if (required && !values.length) fail("missing_semantic_evidence");
  const result = values.map(value => resolveSemanticEvidence(text, value));
  const identities = new Set(result.map(value => value.start + ":" + value.length));
  if (identities.size !== result.length) fail("duplicate_semantic_evidence");
  return Object.freeze(result);
}
function fact(text: string, input: unknown): SemanticFact {
  const value = object(input, ["state", "value", "evidence", "reason"]);
  const reason = string(value.reason, 500, true);
  if (value.state === "known") {
    return Object.freeze({
      state: "known", value: string(value.value, 500),
      evidence: evidence(text, value.evidence, true), reason,
    });
  }
  if (value.state !== "unknown" || value.value !== null || !reason.trim()) {
    fail("invalid_semantic_fact");
  }
  return Object.freeze({
    state: "unknown", value: null, evidence: evidence(text, value.evidence, false), reason,
  });
}

/**
 * Accept only grounded annotations. All dimensions are explicit, including unknowns.
 * Omitting a field or claiming "complete" cannot silently certify a whole sentence.
 */
export function parseSemanticAnnotation(text: string, input: unknown): SemanticAnnotation {
  researchText(text);
  const data = object(input, ["schemaVersion", "events", "relations", "unresolved"]);
  if (data.schemaVersion !== 1) fail("unsupported_semantic_schema");
  const eventIds = new Set<string>();
  const events = array(data.events, 32).map(inputEvent => {
    const event = object(inputEvent, ["id", "facts"]);
    const eventId = id(event.id);
    if (eventIds.has(eventId)) fail("duplicate_semantic_id");
    eventIds.add(eventId);
    const fields = object(event.facts, SEMANTIC_DIMENSIONS);
    const facts = Object.fromEntries(SEMANTIC_DIMENSIONS.map(dimension =>
      [dimension, fact(text, fields[dimension])])) as Record<SemanticDimension, SemanticFact>;
    return Object.freeze({id: eventId, facts: Object.freeze(facts)});
  });
  const relationIds = new Set<string>();
  const relations = array(data.relations, 64).map(inputRelation => {
    const relation = object(inputRelation, ["id", "kind", "from", "to", "evidence"]);
    const relationId = id(relation.id);
    if (relationIds.has(relationId)) fail("duplicate_semantic_id");
    relationIds.add(relationId);
    const from = id(relation.from), to = id(relation.to);
    if (!eventIds.has(from) || !eventIds.has(to) || from === to) fail("invalid_relation_event");
    return Object.freeze({
      id: relationId, kind: string(relation.kind, 64), from, to,
      evidence: evidence(text, relation.evidence, true),
    });
  });
  const unresolved = array(data.unresolved, 64).map(inputFragment => {
    const fragment = object(inputFragment, ["evidence", "reason"]);
    return Object.freeze({
      evidence: evidence(text, fragment.evidence, true), reason: string(fragment.reason, 500),
    });
  });
  return Object.freeze({
    schemaVersion: 1, events: Object.freeze(events),
    relations: Object.freeze(relations), unresolved: Object.freeze(unresolved),
  });
}
function alignments(input: unknown, sources: Set<string>, targets: Set<string>): readonly SemanticAlignment[] {
  const usedSources = new Set<string>(), usedTargets = new Set<string>();
  return Object.freeze(array(input, 64).map(inputAlignment => {
    const value = object(inputAlignment, ["source", "target"]);
    const source = id(value.source), target = id(value.target);
    if (!sources.has(source) || !targets.has(target)) fail("invalid_semantic_alignment");
    if (usedSources.has(source) || usedTargets.has(target)) fail("ambiguous_semantic_alignment");
    usedSources.add(source); usedTargets.add(target);
    return Object.freeze({source, target});
  }));
}

/**
 * Compare independently supplied annotations and explicit one-to-one alignments.
 * Equal canonical values mean equal annotations only. An unmatched event/relation
 * is unknown, not proof of an omission or addition. No lexical or time parser runs.
 */
export function compareSemanticAnnotations(input: {
  sourceText: string;
  targetText: string;
  sourceAnnotation: unknown;
  targetAnnotation: unknown;
  eventAlignment: unknown;
  relationAlignment: unknown;
}): SemanticAnnotationComparison {
  // Revalidate raw annotations at the public boundary; typed casts never skip checks.
  const source = parseSemanticAnnotation(input.sourceText, input.sourceAnnotation);
  const target = parseSemanticAnnotation(input.targetText, input.targetAnnotation);
  const sourceEvents = new Map(source.events.map(event => [event.id, event]));
  const targetEvents = new Map(target.events.map(event => [event.id, event]));
  const eventAlignment = alignments(input.eventAlignment, new Set(sourceEvents.keys()), new Set(targetEvents.keys()));
  const eventMap = new Map(eventAlignment.map(value => [value.source, value.target]));
  const observations: SemanticAnnotationComparison["observations"][number][] = [];
  for (const aligned of eventAlignment) {
    const sourceEvent = sourceEvents.get(aligned.source)!;
    const targetEvent = targetEvents.get(aligned.target)!;
    for (const dimension of SEMANTIC_DIMENSIONS) {
      const sourceFact = sourceEvent.facts[dimension], targetFact = targetEvent.facts[dimension];
      const comparison: AnnotationComparison = sourceFact.state === "unknown" || targetFact.state === "unknown"
        ? "unknown" : sourceFact.value === targetFact.value ? "same_annotation" : "different_annotation";
      observations.push(Object.freeze({
        sourceEvent: sourceEvent.id, targetEvent: targetEvent.id, dimension, comparison,
        source: sourceFact, target: targetFact,
      }));
    }
  }
  const sourceRelations = new Map(source.relations.map(value => [value.id, value]));
  const targetRelations = new Map(target.relations.map(value => [value.id, value]));
  const relationAlignment = alignments(input.relationAlignment, new Set(sourceRelations.keys()), new Set(targetRelations.keys()));
  const relations: SemanticAnnotationComparison["relations"][number][] = [];
  for (const aligned of relationAlignment) {
    const sourceRelation = sourceRelations.get(aligned.source)!;
    const targetRelation = targetRelations.get(aligned.target)!;
    const mappedFrom = eventMap.get(sourceRelation.from), mappedTo = eventMap.get(sourceRelation.to);
    const comparison: AnnotationComparison = !mappedFrom || !mappedTo ? "unknown"
      : sourceRelation.kind === targetRelation.kind
        && mappedFrom === targetRelation.from && mappedTo === targetRelation.to
        ? "same_annotation" : "different_annotation";
    relations.push(Object.freeze({source: sourceRelation, target: targetRelation, comparison}));
  }
  const unknowns: SemanticAnnotationComparison["unknowns"][number][] = [];
  for (const [side, document] of [["source", source], ["target", target]] as const) {
    for (const fragment of document.unresolved) unknowns.push(Object.freeze({
      side, kind: "unresolved_fragment", id: null, ...fragment,
    }));
    const eventIds = new Set(eventAlignment.map(value => value[side]));
    for (const event of document.events) if (!eventIds.has(event.id)) unknowns.push(Object.freeze({
      side, kind: "unaligned_event", id: event.id,
      evidence: Object.freeze(Object.values(event.facts).flatMap(value => value.evidence)),
      reason: "Event alignment is absent; no omission/addition inference.",
    }));
    const relationIds = new Set(relationAlignment.map(value => value[side]));
    for (const relation of document.relations) if (!relationIds.has(relation.id)) unknowns.push(Object.freeze({
      side, kind: "unaligned_relation", id: relation.id, evidence: relation.evidence,
      reason: "Relation alignment is absent; no omission/addition inference.",
    }));
  }
  return Object.freeze({
    scope: "offline_research", semanticTruth: "not_verified", wholeSentence: "not_certified",
    runtimeDecision: "none", observations: Object.freeze(observations),
    relations: Object.freeze(relations), unknowns: Object.freeze(unknowns),
  });
}
