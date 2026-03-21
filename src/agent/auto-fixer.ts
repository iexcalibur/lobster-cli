import { z } from 'zod';

/**
 * Normalize messy LLM responses into valid MacroTool output.
 * Handles: double-stringified JSON, missing action field, wrong tool name,
 * nested function wrapper, primitive action inputs, etc.
 */
export function normalizeResponse(
  raw: Record<string, unknown>,
  toolName: string,
  availableActions: string[]
): Record<string, unknown> {
  let result = raw;

  // Fix 1: Nested function wrapper — unwrap {type: 'function', function: {arguments}}
  if (result.type === 'function' && result.function) {
    const fn = result.function as Record<string, unknown>;
    if (typeof fn.arguments === 'string') {
      try { result = JSON.parse(fn.arguments); } catch {}
    } else if (typeof fn.arguments === 'object') {
      result = fn.arguments as Record<string, unknown>;
    }
  }

  // Fix 2: Double-stringified arguments
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
          result[key] = parsed;
        }
      } catch {}
    }
  }

  // Fix 3: If no action field, try to infer one
  if (!result.action) {
    // Check if any top-level key matches an action name
    for (const actionName of availableActions) {
      if (actionName in result) {
        result = {
          ...result,
          action: { [actionName]: result[actionName] },
        };
        delete result[actionName];
        break;
      }
    }
  }

  // Fix 4: Still no action — fallback to wait
  if (!result.action) {
    result.action = { wait: { seconds: 1 } };
  }

  // Fix 5: Action is a string instead of object
  if (typeof result.action === 'string') {
    if (availableActions.includes(result.action)) {
      result.action = { [result.action]: {} };
    } else {
      result.action = { wait: { seconds: 1 } };
    }
  }

  // Fix 6: Primitive action inputs — coerce to object
  const action = result.action as Record<string, unknown>;
  for (const [name, input] of Object.entries(action)) {
    if (typeof input !== 'object' || input === null) {
      // Single-field tool: wrap primitive in expected shape
      if (name === 'click_element_by_index' && typeof input === 'number') {
        action[name] = { index: input };
      } else if (name === 'wait' && typeof input === 'number') {
        action[name] = { seconds: input };
      } else if (name === 'scroll' && typeof input === 'string') {
        action[name] = { direction: input };
      }
    }
  }

  return result;
}

export function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export function extractJsonFromString(str: string): unknown | null {
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(str.slice(start, end + 1));
  } catch {
    return null;
  }
}
