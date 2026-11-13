// Shapes for the legal and support pages. Content lives in plain data so the same text can be
// reviewed by an attorney, shown in the app, and served on the website.

export type LegalBlock =
  | { k: 'p'; t: string }
  | { k: 'ul'; items: string[] }
  | { k: 'steps'; items: string[] }
  | { k: 'note'; t: string };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** Shown under the title. */
  effective: string;
  /** Plain-language summary shown in a card at the top. */
  summary?: string[];
  sections: LegalSection[];
}
