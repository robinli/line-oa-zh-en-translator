import type {TranslationMode} from "./domain.js";
import type {Translator} from "./services.js";
import type {MentionAlias} from "./mentions.js";

export interface TranslationProgram {
  translator: Translator;
  mentionAliases: readonly MentionAlias[];
}

// Initialization is lazy and cached only on success. A failed English branch cannot break Vietnamese.
export function createTranslationProgramRouter(
  createEnglish: () => TranslationProgram, createVietnamese: () => Translator,
): (mode: TranslationMode) => TranslationProgram {
  let english: TranslationProgram | undefined;
  let vietnamese: TranslationProgram | undefined;
  return mode => {
    if (mode === "zh-vi") return vietnamese ??= {translator: createVietnamese(), mentionAliases: []};
    return english ??= createEnglish();
  };
}
