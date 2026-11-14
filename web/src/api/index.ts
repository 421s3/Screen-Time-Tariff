import { USE_MOCK } from '../config'
import type { Api } from './base'
import { mockApi } from './mockApi'
import { realApi } from './realApi'

export { ApiError } from './base'
export type { Api } from './base'

/** The single data-access object for the whole app. */
export const api: Api = USE_MOCK ? mockApi : realApi
