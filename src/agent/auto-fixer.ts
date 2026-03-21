import type { z } from 'zod';
import type { AgentTool } from '../types/agent.js';

/**
 * Normalize messy LLM responses into valid MacroTool output.
 * Uses tool schemas for validation instead of hardcoded tool names.
 */
export function normalizeResponse(
  raw: Record<string, unknown>,
  toolName: string,
  availableActions: string[],
  toolSchemas?: Record<string, AgentTool>,
): Record<string, unknown> {
  let result = { ...raw };

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

  // Fix 6: Schema-based validation & primitive coercion
  const action = result.action as Record<string, unknown>;
  for (const [name, input] of Object.entries(action)) {
    if (typeof input !== 'object' || input === null) {
      // Use schema to determine expected shape
      if (toolSchemas && toolSchemas[name]) {
        const schema = toolSchemas[name].inputSchema;
        const coerced = coercePrimitiveToSchema(input, schema);
        if (coerced !== null) {
          action[name] = coerced;
          continue;
        }
      }

      // Fallback: hardcoded coercion for known patterns
      if (typeof input === 'number') {
        action[name] = { index: input };
      } else if (typeof input === 'string') {
        action[name] = { text: input };
      } else {
        action[name] = {};
      }
    }

    // Fix 7: Validate action args against schema if available
    if (toolSchemas && toolSchemas[name] && typeof action[name] === 'object') {
      const schema = toolSchemas[name].inputSchema;
      const validation = schema.safeParse(action[name]);
      if (!validation.success) {
        // Try to fix common issues: wrong field names, missing required fields
        const fixed = attemptSchemaFix(action[name] as Record<string, unknown>, schema, validation.error);
        if (fixed) {
          action[name] = fixed;
        }
      }
    }
  }

  return result;
}

/**
 * Coerce a primitive value into an object matching a Zod schema.
 * Inspects the schema to find a single required field and wraps the value.
 */
function coercePrimitiveToSchema(value: unknown, schema: z.ZodType): Record<string, unknown> | null {
  try {
    const def = (schema as any)._def;
    if (def?.typeName !== 'ZodObject') return null;

    const shape = def.shape();
    const keys = Object.keys(shape);

    // Single required field — wrap the primitive
    const requiredKeys = keys.filter((k) => {
      const fieldDef = (shape[k] as any)?._def;
      return fieldDef?.typeName !== 'ZodOptional';
    });

    if (requiredKeys.length === 1) {
      return { [requiredKeys[0]]: value };
    }

    // Multiple fields but value is a number — likely an index field
    const indexField = keys.find((k) => /index|idx|num|number/i.test(k));
    if (indexField && typeof value === 'number') {
      return { [indexField]: value };
    }

    // Value is a string — likely a text field
    const textField = keys.find((k) => /text|value|query|code|question|url/i.test(k));
    if (textField && typeof value === 'string') {
      return { [textField]: value };
    }
  } catch {}

  return null;
}

/**
 * Attempt to fix validation errors by mapping common mistakes.
 */
function attemptSchemaFix(
  input: Record<string, unknown>,
  schema: z.ZodType,
  error: z.ZodError,
): Record<string, unknown> | null {
  try {
    const def = (schema as any)._def;
    if (def?.typeName !== 'ZodObject') return null;

    const shape = def.shape();
    const expectedKeys = Object.keys(shape);
    const inputKeys = Object.keys(input);
    const fixed = { ...input };

    // Fix: wrong key names — try to map by position or type match
    for (const issue of error.issues) {
      if (issue.code === 'invalid_type' && issue.path.length === 1) {
        const key = String(issue.path[0]);
        const val = input[key];
        // Try type coercion
        if (issue.expected === 'number' && typeof val === 'string') {
          const num = Number(val);
          if (!isNaN(num)) fixed[key] = num;
        } else if (issue.expected === 'string' && typeof val === 'number') {
          fixed[key] = String(val);
        } else if (issue.expected === 'boolean' && typeof val === 'string') {
          fixed[key] = val === 'true';
        }
      }

      if (issue.code === 'unrecognized_keys') {
        // Remove unrecognized keys
        for (const k of (issue as any).keys || []) {
          delete fixed[k];
        }
      }
    }

    // Re-validate
    const result = schema.safeParse(fixed);
    if (result.success) return fixed;
  } catch {}

  return null;
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
