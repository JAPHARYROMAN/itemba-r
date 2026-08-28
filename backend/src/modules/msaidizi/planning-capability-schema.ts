import type { RegistryEntry } from './tool-registry';

type JsonObject = Record<string, unknown>;

/** Exact `{path, query, body}` planning schema derived from the registry DTO schema. */
export function planningArgumentsSchema(entry: RegistryEntry): JsonObject {
  const original = entry.tool.input_schema;
  const properties = {
    path:
      original.properties.path ??
      ({ type: 'object', properties: {}, additionalProperties: false } as JsonObject),
    query:
      original.properties.query ??
      ({ type: 'object', properties: {}, additionalProperties: false } as JsonObject),
    ...(original.properties.body ? { body: original.properties.body } : {}),
  };
  return {
    type: 'object',
    properties,
    required: Array.from(new Set(['path', 'query', ...(original.required ?? [])])),
    additionalProperties: false,
  };
}
