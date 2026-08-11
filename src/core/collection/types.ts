import { z } from "zod";

export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const AuthSchema = z.union([
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }),
  z.object({ type: z.literal("apiKey"), header: z.string(), value: z.string() }),
]);
export type Auth = z.infer<typeof AuthSchema>;

export const RequestStepSchema = z.object({
  id: z.string().min(1),
  method: HttpMethodSchema,
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  auth: AuthSchema.optional(),
  depends_on: z.array(z.string()).optional(),
});
export type RequestStep = z.infer<typeof RequestStepSchema>;

export const CollectionSchema = z.object({
  meta: z.object({
    name: z.string().min(1),
    base_url: z.string().min(1),
    // Named request groups pulled in from .shimwire/workflows/<name>.toml —
    // e.g. include = ["authentication_flow"] to reuse a login step across
    // collections instead of duplicating it in every one that needs auth.
    include: z.array(z.string()).optional(),
  }),
  request: z.array(RequestStepSchema).min(1),
});
export type Collection = z.infer<typeof CollectionSchema>;

// A workflow is just a reusable request-list fragment — no [meta]/base_url
// of its own, since it inherits whatever collection includes it. Kept as a
// separate schema (rather than a partial Collection) so a workflow file
// can't accidentally declare its own `include` and create a cycle.
export const WorkflowSchema = z.object({
  request: z.array(RequestStepSchema).min(1),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const EnvironmentSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
export type Environment = z.infer<typeof EnvironmentSchema>;
