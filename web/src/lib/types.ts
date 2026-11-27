// Page JSON, schema 1 (docs/SPEC.md, "מבנה הנתונים").
export type Point = [number, number];
export type Region = "main" | "margin" | "interlinear";

export interface Word {
  text: string;
  confidence: number | null;
  box: [number, number, number, number] | null; // x, y, width, height
  alternatives: string[];
  doubtful: boolean;
}

export interface Line {
  id: string;
  order: number;
  region: Region;
  baseline: Point[];
  boundary: Point[];
  text: string;
  words: Word[];
  engine_text: string;
  llm: unknown;
  source: "engine" | "manual";
  status: "pending" | "approved";
  model_version: string | null;
}

export interface Page {
  schema_version: 1;
  revision: number;
  image: { file: string; width: number; height: number };
  lines: Line[];
  /** Lines deleted in the editor, kept by the engine so an undo restores them. Read only. */
  removed_lines?: Line[];
}

export interface Manuscript {
  slug: string;
  name: string | null;
  active_model: string | null;
  split: { test: number[]; train: number[] } | null;
  page_labels: Record<string, string>;
}

export interface PageSummary {
  page: number;
  label: string | null;
  test: boolean;
  recognized: boolean;
  lines: number;
  approved: number;
  revision: number | null;
}

export interface Score { cer: number | null; wer: number | null; lines: number; chars: number; words: number }

export interface Version {
  version: string;
  trained_from: string;
  created_at: string;
  train_lines: number;
  test_lines: number;
  test_pages: number[];
  before: Score;
  after: Score | null;
  promoted: boolean;
  seconds: number;
  training: { seconds: number; weights: string[] };
}

export interface Models { active_model: string | null; split: Manuscript["split"]; versions: Version[] }

export interface Training {
  approved_train_lines: number;
  last_trained_lines: number;
  last_version: string | null;
  job: null | {
    job_id: string;
    epochs: number;
    started_at: string;
    status: "running" | "done" | "failed";
    epochs_done?: { epoch: number; val_accuracy: number }[];
    error?: string;
    result?: { status: string; metrics?: Version; seconds?: number; estimated_usd?: number; rerecognize_pages?: number[] };
  };
}

export const REGION_LABEL: Record<Region, string> = { main: "גוף", margin: "שוליים", interlinear: "בין השורות" };
export const UNSURE_BELOW = 0.8;
