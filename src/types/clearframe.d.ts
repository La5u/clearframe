export {};

interface ClearFrameTerm {
  phrase: string;
  type: string;
  neutral: string;
  hasNeutral: boolean;
  stemType: string;
  regex: string;
  remove: boolean;
}

interface ClearFrameIndex {
  termsById: Record<string, ClearFrameTerm>;
  buckets: Record<string, { phraseNorm: string; termId: string; length: number }[]>;
  regexTerms: { termId: string; pattern: string }[];
}

interface ClearFrameData {
  index: ClearFrameIndex;
  types: Record<string, string>;
  categories: Record<string, string>;
  colorConfig: { colors: Record<string, { name: string; category: string; types: string[] }> };
}

declare global {
  var ClearFrame: ClearFrameData;
}
