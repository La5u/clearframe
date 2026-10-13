export {};

interface ClearFrameTerm {
  phrase: string;
  type: string;
  neutral?: string;
  stemType?: string;
  regex?: string;
  remove?: boolean;
  confidence?: string;
  contexts?: string[];
}

interface ClearFrameIndex {
  termsById: Record<string, ClearFrameTerm>;
  regexTerms: { termId: string; pattern?: string }[];
}

interface ClearFrameColor {
  name: string;
  category: string;
  types: string[];
  rgb?: string;
  underline?: string;
  hex?: string;
}

interface ClearFrameLabel {
  term: string;
  plain: string;
  effect: string;
}

interface ClearFrameData {
  labels: { types: Record<string, ClearFrameLabel>; phrases?: Record<string, ClearFrameLabel> };
  index: ClearFrameIndex;
  types: Record<string, string>;
  categories: Record<string, string>;
  colors: Record<string, string>;
  underlines: Record<string, string>;
  intensity: Record<string, number>;
  colorConfig: { colors: Record<string, ClearFrameColor>; intensity?: Record<string, number> };
}

declare global {
  var ClearFrame: ClearFrameData;
}
