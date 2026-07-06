import type { DataSource } from '../types'
import { MODELS } from './fixtures'

export function createMockDataSource(): DataSource {
  return {
    async listModels() {
      return structuredClone(MODELS)
    }
  }
}
