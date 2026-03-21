import type { z } from 'zod';
import type { LLMTool } from '../types/llm.js';

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Simplified Zod-to-JSON-Schema converter for common types
  if ('_def' in schema) {
    const def = (schema as any)._def;
    const typeName = def.typeName;

    if (typeName === 'ZodObject') {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodType);
        if (!((value as any)._def?.typeName === 'ZodOptional')) {
          required.push(key);
        }
      }
      const result: Record<string, unknown> = { type: 'object', properties };
      if (required.length > 0) result.required = required;
      if (def.description) result.description = def.description;
      return result;
    }

    if (typeName === 'ZodString') {
      const result: Record<string, unknown> = { type: 'string' };
      if (def.description) result.description = def.description;
      return result;
    }

    if (typeName === 'ZodNumber') {
      const result: Record<string, unknown> = { type: 'number' };
      if (def.description) result.description = def.description;
      return result;
    }

    if (typeName === 'ZodBoolean') {
      const result: Record<string, unknown> = { type: 'boolean' };
      if (def.description) result.description = def.description;
      return result;
    }

    if (typeName === 'ZodEnum') {
      return { type: 'string', enum: def.values, ...(def.description ? { description: def.description } : {}) };
    }

    if (typeName === 'ZodArray') {
      return { type: 'array', items: zodToJsonSchema(def.type), ...(def.description ? { description: def.description } : {}) };
    }

    if (typeName === 'ZodOptional') {
      return zodToJsonSchema(def.innerType);
    }

    if (typeName === 'ZodDefault') {
      const inner = zodToJsonSchema(def.innerType);
      return { ...inner, default: def.defaultValue() };
    }

    if (typeName === 'ZodUnion') {
      return { oneOf: def.options.map((opt: z.ZodType) => zodToJsonSchema(opt)) };
    }

    if (typeName === 'ZodRecord') {
      return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) };
    }

    if (typeName === 'ZodLiteral') {
      return { const: def.value };
    }

    if (typeName === 'ZodAny') {
      return {};
    }
  }

  return { type: 'string' };
}

export function zodToOpenAITool(name: string, description: string, schema: z.ZodType): LLMTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: zodToJsonSchema(schema),
    },
  };
}
