import type { StepHandler } from '../types/pipeline.js';

const stepHandlers = new Map<string, StepHandler>();

export function registerStep(name: string, handler: StepHandler): void {
  stepHandlers.set(name, handler);
}

export function getStep(name: string): StepHandler | undefined {
  return stepHandlers.get(name);
}

export function getStepNames(): string[] {
  return [...stepHandlers.keys()];
}
