import { faker } from "@faker-js/faker";
import type { OpenAPIV3 } from "openapi-types";

type Schema = OpenAPIV3.SchemaObject;

function fakeByFormat(format: string | undefined): unknown {
  switch (format) {
    case "email":
      return faker.internet.email();
    case "uuid":
      return faker.string.uuid();
    case "date-time":
      return faker.date.recent().toISOString();
    case "date":
      return faker.date.recent().toISOString().slice(0, 10);
    case "uri":
    case "url":
      return faker.internet.url();
    case "hostname":
      return faker.internet.domainName();
    case "ipv4":
      return faker.internet.ipv4();
    case "password":
      return faker.internet.password();
    default:
      return undefined;
  }
}

function fakeString(schema: Schema): string {
  if (schema.enum && schema.enum.length > 0) {
    return faker.helpers.arrayElement(schema.enum as string[]);
  }
  const byFormat = fakeByFormat(schema.format);
  if (typeof byFormat === "string") return byFormat;

  const max = schema.maxLength ?? Math.max(schema.minLength ?? 5, 15);
  const min = Math.min(schema.minLength ?? 5, max);
  return faker.string.alpha({ length: { min, max } });
}

function fakeNumber(schema: Schema): number {
  if (schema.enum && schema.enum.length > 0) {
    return faker.helpers.arrayElement(schema.enum as number[]);
  }
  const max = schema.maximum ?? Math.max(schema.minimum ?? 0, 100);
  const min = Math.min(schema.minimum ?? 0, max);
  return schema.type === "integer"
    ? faker.number.int({ min, max })
    : faker.number.float({ min, max, fractionDigits: 2 });
}

function fakeArray(schema: OpenAPIV3.ArraySchemaObject): unknown[] {
  const max = schema.maxItems ?? Math.max(schema.minItems ?? 1, 3);
  const min = Math.min(schema.minItems ?? 1, max);
  const length = faker.number.int({ min, max });
  const items = (schema.items ?? {}) as Schema;
  return Array.from({ length }, () => generateFakeValue(items));
}

function fakeObject(schema: Schema): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const out: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    out[key] = generateFakeValue(propSchema as Schema);
  }

  return out;
}

export function generateFakeValue(schema: Schema): unknown {
  if (!schema || typeof schema !== "object") return null;

  if (schema.nullable && faker.datatype.boolean({ probability: 0.1 })) {
    return null;
  }

  switch (schema.type) {
    case "string":
      return fakeString(schema);
    case "number":
    case "integer":
      return fakeNumber(schema);
    case "boolean":
      return faker.datatype.boolean();
    case "array":
      return fakeArray(schema);
    case "object":
      return fakeObject(schema);
    default:
      if (schema.properties) return fakeObject(schema);
      return null;
  }
}
