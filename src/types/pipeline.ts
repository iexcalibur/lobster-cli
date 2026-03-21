import type { IPage } from './page.js';

export interface PipelineContext {
  page: IPage | null;
  args: Record<string, unknown>;
  data: unknown;
  debug?: boolean;
}

export type StepHandler = (
  context: PipelineContext,
  params: unknown
) => Promise<unknown>;

export interface PipelineStepDef {
  [stepName: string]: unknown;
}
