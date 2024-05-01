import { z } from 'zod';

export const contractEventConfigSchema = z.object({
  name: z.string(),
  fn: z.string()
});

export const contractSourceConfigSchema = z.object({
  contract: z.string(),
  abi: z.string().optional(),
  start: z.number().gte(0),
  deploy_fn: z.string().optional(),
  events: z.array(contractEventConfigSchema)
});

export const contractTemplateSchema = z.object({
  abi: z.string().optional(),
  events: z.array(contractEventConfigSchema)
});

export const checkpointConfigSchema = z.object({
  network_node_url: z.string().url(),
  optimistic_indexing: z.boolean().optional(),
  decimal_types: z
    .record(
      z.object({
        p: z.number(),
        d: z.number()
      })
    )
    .optional(),
  start: z.number().gte(0).optional(),
  tx_fn: z.string().optional(),
  global_events: z.array(contractEventConfigSchema).optional(),
  sources: z.array(contractSourceConfigSchema).optional(),
  templates: z.record(contractTemplateSchema).optional()
});
