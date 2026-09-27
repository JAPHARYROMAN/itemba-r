import type { Graph, Thing, WithContext } from 'schema-dts';
import JsonLd from '@/components/JsonLd';

/**
 * A top-level JSON-LD entity built by src/lib/jsonld.ts. schema-dts lets
 * some types (Organization, LocalBusiness…) also be a bare string, so
 * `WithContext<Organization>` carries a `string & {…}` member; the builders
 * only ever return objects, and this type accepts what they return.
 */
export type JsonLdEntity = WithContext<Thing> | Graph;

/**
 * Renders JSON-LD entities through the frozen JsonLd component (which
 * escapes `<`). One script per call; pass an array for several entities.
 */
export function StructuredData({ data }: { data: JsonLdEntity | readonly JsonLdEntity[] }) {
  const payload = (Array.isArray(data) ? [...data] : data) as unknown as Record<string, unknown> | Array<Record<string, unknown>>;
  return <JsonLd data={payload} />;
}
