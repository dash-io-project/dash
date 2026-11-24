export {
  OpenSearchAdapter,
  createOpenSearchAdapter,
  fieldsFromMapping,
  toPlain,
} from "./adapter.ts";
export {
  createOpenSearchClient,
  isLoopbackHost,
  openSearchPublicSummary,
  openSearchSecrets,
  openSearchSession,
  parseOpenSearchNode,
  scrubSecrets,
} from "./connection.ts";
export type { OpenSearchAuth, OpenSearchService, OpenSearchSession, OpenSearchSummary } from "./connection.ts";
export { compileSearch, indexName } from "./query.ts";
export type { CompiledSearch, FieldTarget } from "./query.ts";
