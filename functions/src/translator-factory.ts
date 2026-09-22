import {BusinessTranslator, VertexTextGenerator} from "./business-translator.js";
import {GoogleCloudTranslator, type Translator} from "./services.js";

export interface TranslationConfiguration {
  engine: string;
  projectId: string;
  model: string;
  location: string;
  protectedNames: string;
  onValidationRetry?: (reason: string) => void;
}

export function createTranslator(config: TranslationConfiguration): Translator {
  if (config.engine === "google") return new GoogleCloudTranslator(config.projectId);
  if (config.engine !== "business") throw new Error("Unknown translation engine.");
  return new BusinessTranslator(new VertexTextGenerator({
    projectId: config.projectId,
    model: config.model,
    location: config.location,
  }), {
    protectedNames: config.protectedNames.split(",").map((name) => name.trim()).filter(Boolean),
    onValidationRetry: config.onValidationRetry,
  });
}
