import {describe, expect, it} from "vitest";
import {excludeTextRanges, getMentionRanges} from "./message-text.js";

describe("message text classification", () => {
  it("excludes Chinese mention names while preserving English body text", () => {
    const name = "@Niranjan Prakash @B5-海屏 Eric胡哲榮";
    const text = name + "\nKumar said he gave $1295 to Xmold.";
    const ranges = getMentionRanges({text, mention: {mentionees: [{index: 0, length: name.length}]}});
    expect(excludeTextRanges(text, ranges)).toBe(" \nKumar said he gave $1295 to Xmold.");
  });

  it("uses LINE UTF-16 indices after emoji without trimming the original text", () => {
    const text = " 😀 @小林 Hello";
    const ranges = getMentionRanges({text, mention: {mentionees: [{index: 4, length: 3}]}});
    expect(excludeTextRanges(text, ranges)).toBe(" 😀   Hello");
  });

  it.each([
    undefined, {}, {mentionees: null}, {mentionees: [null, "bad"]},
    {mentionees: [{index: -1, length: 5}]},
    {mentionees: [{index: 0, length: 100}]},
    {mentionees: [{index: 0.5, length: 3}]},
    {mentionees: [{index: 1, length: 2}]},
  ])("ignores malformed mention metadata %j", (mention) => {
    expect(getMentionRanges({text: "@甲 Hello", mention})).toEqual([]);
  });

  it("sorts multiple mentions and ignores duplicate overlapping ranges", () => {
    const text = "@甲 @乙 Hello";
    expect(getMentionRanges({text, mention: {mentionees: [
      {index: 3, length: 2}, {index: 0, length: 2}, {index: 0, length: 2},
    ]}})).toEqual([{start: 0, length: 2}, {start: 3, length: 2}]);
  });

});
