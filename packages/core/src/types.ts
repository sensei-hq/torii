import { z } from 'zod'

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  route: z.string(),
  tier: z.enum(['frontier', 'balanced', 'fast', 'local']),
  price: z.number(),
  context: z.number(),
  localCapable: z.boolean().default(false)
})
export type Model = z.infer<typeof ModelSchema>

// One narrow read surface per entity; grows as screens need it. Adapters implement this.
export interface DataSource {
  listModels(): Promise<Model[]>
}
