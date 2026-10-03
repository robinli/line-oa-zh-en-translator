import {describe, expect, it} from "vitest";
import {
  SEMANTIC_DIMENSIONS, SemanticContractError, compareSemanticAnnotations,
  parseSemanticAnnotation, resolveSemanticEvidence, type EvidenceAnchor, type SemanticDimension,
} from "./semantic-contract.js";

type RawFact = {state: "known" | "unknown"; value: string | null; evidence: EvidenceAnchor[]; reason: string};
type RawEvent = {id: string; facts: Record<SemanticDimension, RawFact>};
type RawRelation = {id: string; kind: string; from: string; to: string; evidence: EvidenceAnchor[]};
function known(value: string, quote: string, occurrence = 0): RawFact {
  return {state: "known", value, evidence: [{quote, occurrence}], reason: ""};
}
function unknown(reason = "Not explicitly determined from this text."): RawFact {
  return {state: "unknown", value: null, evidence: [], reason};
}
function event(id: string, facts: Partial<Record<SemanticDimension, RawFact>> = {}): RawEvent {
  return {id, facts: Object.fromEntries(SEMANTIC_DIMENSIONS.map(key => [key, facts[key] ?? unknown()])) as Record<SemanticDimension, RawFact>};
}
function annotation(events: RawEvent[], relations: RawRelation[] = [],
  unresolved: {evidence: EvidenceAnchor[]; reason: string}[] = []) {
  return {schemaVersion: 1, events, relations, unresolved};
}
function compare(sourceText: string, targetText: string, source: RawEvent, target: RawEvent) {
  return compareSemanticAnnotations({
    sourceText, targetText, sourceAnnotation: annotation([source]), targetAnnotation: annotation([target]),
    eventAlignment: [{source: source.id, target: target.id}], relationAlignment: [],
  });
}
function relation(id: string, from: string, to: string, quote: string): RawRelation {
  return {id, kind: "only_after", from, to, evidence: [{quote, occurrence: 0}]};
}

describe("grounded semantic research annotations", () => {
  it("resolves repeated occurrences with UTF-16 offsets without guessing actor identity", () => {
    expect(resolveSemanticEvidence("😀 @Alex asks @Alex.", {quote: "@Alex", occurrence: 1}))
      .toEqual({quote: "@Alex", occurrence: 1, start: 14, length: 5});
    expect(resolveSemanticEvidence("aaaa", {quote: "aa", occurrence: 2}).start).toBe(2);
    expect(() => resolveSemanticEvidence("😀", {quote: "\ud83d", occurrence: 0})).toThrow("invalid_evidence_anchor");
  });
  it.each([
    {quote: "not in text", occurrence: 0}, {quote: "Alex", occurrence: 1},
    {quote: "Alex", occurrence: -1}, {quote: "Alex", occurrence: 0.5},
    {quote: "Alex", occurrence: 4500}, {quote: "", occurrence: 0},
    {quote: "Alex", occurrence: 0, start: 0},
  ])("rejects fabricated, ambiguous or malformed anchors: %j", anchor => {
    expect(() => resolveSemanticEvidence("Alex", anchor)).toThrow(SemanticContractError);
  });
  it("requires evidence for every known fact and rejects source/target quote substitution", () => {
    const source = event("s", {action: {...known("arrange_payment", "安排付款"), evidence: []}});
    expect(() => parseSemanticAnnotation("安排付款", annotation([source]))).toThrow("missing_semantic_evidence");
    const otherLanguage = event("s", {action: known("arrange_payment", "arrange payment")});
    expect(() => parseSemanticAnnotation("安排付款", annotation([otherLanguage]))).toThrow("evidence_not_found");
  });
  it("keeps unknown explicit and rejects an invented value or empty reason", () => {
    for (const fact of [{...unknown(), value: "completed"}, {...unknown(), reason: ""}]) {
      expect(() => parseSemanticAnnotation("請回覆", annotation([event("s", {completion: fact})])))
        .toThrow("invalid_semantic_fact");
    }
  });
  it("rejects missing dimensions and self-reported complete coverage", () => {
    const item = event("s");
    const {completion: _removed, ...incomplete} = item.facts;
    expect(() => parseSemanticAnnotation("請回覆", annotation([{...item, facts: incomplete} as RawEvent])))
      .toThrow("invalid_semantic_shape");
    expect(() => parseSemanticAnnotation("請回覆", {...annotation([item]), complete: true}))
      .toThrow("invalid_semantic_shape");
  });
  it("rejects duplicate evidence, ids and dangling relation references", () => {
    const duplicate = known("reply", "回覆");
    duplicate.evidence.push({...duplicate.evidence[0]!});
    expect(() => parseSemanticAnnotation("請回覆", annotation([event("s", {action: duplicate})])))
      .toThrow("duplicate_semantic_evidence");
    expect(() => parseSemanticAnnotation("請回覆", annotation([event("s"), event("s")])))
      .toThrow("duplicate_semantic_id");
    expect(() => parseSemanticAnnotation("請回覆後確認", annotation([event("s")], [relation("r", "s", "missing", "後")])))
      .toThrow("invalid_relation_event");
    expect(() => parseSemanticAnnotation("請回覆後確認", annotation([event("s")], [relation("r", "s", "s", "後")])))
      .toThrow("invalid_relation_event");
  });
  it("limits input and result sizes and keeps error messages free of private contents", () => {
    const privateText = "PRIVATE SOURCE";
    try {parseSemanticAnnotation(privateText, annotation([event("s", {action: known("reply", "MISSING PRIVATE QUOTE")})]));}
    catch (error) {
      expect(error).toBeInstanceOf(SemanticContractError);
      expect(String(error)).not.toContain("PRIVATE");
    }
    expect(() => parseSemanticAnnotation("x".repeat(4501), annotation([]))).toThrow("invalid_semantic_shape");
    expect(() => parseSemanticAnnotation("\ud800", annotation([]))).toThrow("invalid_semantic_text");
    expect(() => parseSemanticAnnotation("x", annotation(Array.from({length: 33}, (_, i) => event("s" + i)))))
      .toThrow("invalid_semantic_shape");
  });
  it("freezes returned annotations and does not retain mutable model payload references", () => {
    const raw = annotation([event("s", {action: known("reply", "回覆")})]);
    const parsed = parseSemanticAnnotation("請回覆", raw);
    raw.events[0]!.facts.action.value = "pay";
    expect(parsed.events[0]!.facts.action.value).toBe("reply");
    expect(Object.isFrozen(parsed.events[0]!.facts.action.evidence[0])).toBe(true);
    expect(Object.isFrozen(parsed.events)).toBe(true);
  });
});

describe("comparison of independently annotated facts (no automatic semantic extraction)", () => {
  it.each(["1 p.m.", "1:00 p.m.", "13:00", "one in the afternoon"])(
    "compares manually annotated natural time %s without numeric-form false rejection", time => {
      const result = compare("下週三下午一點裝櫃。", "Load next Wednesday at " + time + ".",
        event("s", {time: known("next_wednesday_13:00", "下週三下午一點")}),
        event("t", {time: known("next_wednesday_13:00", "next Wednesday at " + time)}));
      expect(result.observations.find(value => value.dimension === "time")?.comparison).toBe("same_annotation");
      expect(result.wholeSentence).toBe("not_certified");
      expect(result.runtimeDecision).toBe("none");
    });
  it("exposes arrangement vs executed-payment annotation differences without inventing source tense", () => {
    const result = compare("我們才安排付款。", "We only made payment.",
      event("s", {actor: known("speaker_group", "我們"), action: known("arrange_payment", "安排付款")}),
      event("t", {actor: known("speaker_group", "We"), action: known("execute_payment", "made payment"),
        completion: known("completed", "made payment")}));
    expect(result.observations.filter(value => value.comparison === "different_annotation").map(value => value.dimension))
      .toEqual(["action"]);
    expect(result.observations.find(value => value.dimension === "completion")?.comparison).toBe("unknown");
    expect(result.semanticTruth).toBe("not_verified");
  });
  it.each([
    ["actor", "對方", "We", "other_party", "speaker_group"],
    ["completion", "尚未確認", "confirmed", "unconfirmed", "confirmed"],
    ["modality", "可以", "must", "may", "must"],
    ["negation", "不付款", "pay", "negated", "affirmative"],
    ["time", "下午一點", "2 p.m.", "13:00", "14:00"],
    ["quantity", "兩袋", "two cartons", "2_bags", "2_cartons"],
    ["money", "USD 8", "EUR 8", "USD_8", "EUR_8"],
  ] as const)("keeps %s annotation differences independently visible", (dimension, quote, translated, sourceValue, targetValue) => {
    const result = compare(quote, translated,
      event("s", {[dimension]: known(sourceValue, quote)}),
      event("t", {[dimension]: known(targetValue, translated)}));
    expect(result.observations.find(value => value.dimension === dimension)?.comparison).toBe("different_annotation");
    expect(result.observations.filter(value => value.comparison === "different_annotation")).toHaveLength(1);
  });
  it("compares prerequisite direction using mapped event identity rather than words present", () => {
    const sourceText = "提供報告後才安排付款。";
    const targetText = "Provide the report only after arranging payment.";
    const sourceAnnotation = annotation([
      event("report", {action: known("provide_report", "提供報告")}),
      event("payment", {action: known("arrange_payment", "安排付款")}),
    ], [relation("sR", "report", "payment", "後才")]);
    const targetAnnotation = annotation([
      event("pay", {action: known("arrange_payment", "arranging payment")}),
      event("test", {action: known("provide_report", "Provide the report")}),
    ], [relation("tR", "pay", "test", "only after")]);
    const result = compareSemanticAnnotations({
      sourceText, targetText, sourceAnnotation, targetAnnotation,
      eventAlignment: [{source: "report", target: "test"}, {source: "payment", target: "pay"}],
      relationAlignment: [{source: "sR", target: "tR"}],
    });
    expect(result.observations.filter(value => value.dimension === "action").every(value => value.comparison === "same_annotation"))
      .toBe(true);
    expect(result.relations[0]?.comparison).toBe("different_annotation");
  });
  it("keeps an omitted reply actor unknown instead of declaring role reversal", () => {
    const result = compare("明天下午兩點回覆。", "I will reply tomorrow at 2 p.m.",
      event("s", {action: known("reply", "回覆")}),
      event("t", {actor: known("speaker", "I"), action: known("reply", "reply")}));
    expect(result.observations.find(value => value.dimension === "actor")?.comparison).toBe("unknown");
    expect(result.observations.some(value => value.comparison === "different_annotation")).toBe(false);
  });
  it("never promotes full character coverage or equal annotations to whole-sentence certification", () => {
    const result = compare("安排付款", "arrange payment",
      event("s", Object.fromEntries(SEMANTIC_DIMENSIONS.map(key => [key, known("same", "安排付款")]))),
      event("t", Object.fromEntries(SEMANTIC_DIMENSIONS.map(key => [key, known("same", "arrange payment")]))));
    expect(result.observations.every(value => value.comparison === "same_annotation")).toBe(true);
    expect(result).toMatchObject({wholeSentence: "not_certified", semanticTruth: "not_verified", runtimeDecision: "none"});
  });
  it("retains unparsed remainder and unaligned events without guessing omissions", () => {
    const result = compareSemanticAnnotations({
      sourceText: "確認裝櫃；另有條件尚待說明。", targetText: "Confirm loading.",
      sourceAnnotation: annotation([
        event("s", {action: known("confirm_loading", "確認裝櫃")}), event("extra"),
      ], [], [{evidence: [{quote: "另有條件尚待說明", occurrence: 0}], reason: "Condition is not resolved."}]),
      targetAnnotation: annotation([event("t", {action: known("confirm_loading", "Confirm loading")})]),
      eventAlignment: [{source: "s", target: "t"}], relationAlignment: [],
    });
    expect(result.unknowns.map(value => value.kind)).toEqual(["unresolved_fragment", "unaligned_event"]);
    expect(result.observations.some(value => value.comparison === "different_annotation")).toBe(false);
    expect(result.wholeSentence).toBe("not_certified");
  });
  it("leaves a relation unknown when one endpoint is not aligned", () => {
    const result = compareSemanticAnnotations({
      sourceText: "報告後付款", targetText: "Pay after the report",
      sourceAnnotation: annotation([event("s1"), event("s2")], [relation("sr", "s1", "s2", "後")]),
      targetAnnotation: annotation([event("t1"), event("t2")], [relation("tr", "t1", "t2", "after")]),
      eventAlignment: [{source: "s1", target: "t1"}], relationAlignment: [{source: "sr", target: "tr"}],
    });
    expect(result.relations[0]?.comparison).toBe("unknown");
  });
  it("rejects many-to-one, duplicate and nonexistent event or relation alignments", () => {
    const base = {
      sourceText: "回覆", targetText: "reply",
      sourceAnnotation: annotation([event("s1"), event("s2")]), targetAnnotation: annotation([event("t1"), event("t2")]),
      eventAlignment: [], relationAlignment: [],
    };
    for (const eventAlignment of [
      [{source: "s1", target: "t1"}, {source: "s2", target: "t1"}],
      [{source: "s1", target: "t1"}, {source: "s1", target: "t2"}],
      [{source: "absent", target: "t1"}],
    ]) expect(() => compareSemanticAnnotations({...base, eventAlignment})).toThrow(SemanticContractError);
    expect(() => compareSemanticAnnotations({...base, relationAlignment: [{source: "r", target: "t"}]}))
      .toThrow("invalid_semantic_alignment");
  });
  it("does not certify empty extractions or trust post-extraction mutation", () => {
    const base = {
      sourceText: "安排付款", targetText: "made payment",
      sourceAnnotation: annotation([]), targetAnnotation: annotation([]),
      eventAlignment: [], relationAlignment: [],
    };
    expect(compareSemanticAnnotations(base)).toMatchObject({observations: [], wholeSentence: "not_certified", runtimeDecision: "none"});
    const sourceAnnotation = annotation([event("s", {action: known("arrange_payment", "安排付款")})]);
    parseSemanticAnnotation(base.sourceText, sourceAnnotation);
    sourceAnnotation.events[0]!.facts.action.evidence[0]!.quote = "fabricated";
    expect(() => compareSemanticAnnotations({...base, sourceAnnotation})).toThrow("evidence_not_found");
  });
});
