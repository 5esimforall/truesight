export type RulesEdition = '2014' | '2024';

export type ChangeDomain = 'identity' | 'names' | 'access' | 'sources' | 'review' | 'display';

export interface DomainChangeEvent {
  readonly changes: readonly ChangeDomain[];
  [key: string]: unknown;
}

export type ReviewReason =
  | 'edition'
  | 'source'
  | 'rules'
  | 'identifier'
  | 'spell'
  | 'identity'
  | 'excluded'
  | 'no-match'
  | 'awaiting-review'
  | 'unknown-type'
  | 'type-context'
  | 'owner-context'
  | 'context-conflict'
  | 'context-difference'
  | 'context-size'
  | 'origin'
  | 'retained-members'
  | 'provider-loading'
  | 'provider-unavailable'
  | 'provider-identity';

export type CanonicalUuidInput =
  | string
  | { uuid?: string | null; documentType?: string | null }
  | null
  | undefined;

export interface LookupCollection<T> {
  get(key: string): T | undefined;
  values(): IterableIterator<T>;
  entries?(): IterableIterator<[string, T]>;
}

export interface PublicationInput {
  id?: string;
  family?: string;
  familyLabel?: string;
  label?: string;
  title?: string;
  rules?: string | null;
  strictRules?: boolean;
  year?: number | null;
  category?: string;
  aliases?: readonly string[];
  familyAliases?: readonly string[];
  externalCodes?: readonly string[];
}

export interface PublicationRecord {
  readonly id: string;
  readonly family: string;
  readonly familyLabel: string;
  readonly label: string;
  readonly title: string;
  readonly rules: RulesEdition | null;
  readonly strictRules: boolean;
  readonly year: number | null;
  readonly category: string;
}

export interface LookupOptions {
  external?: boolean;
}

export interface DeclareOptions {
  external?: boolean;
  abbreviation?: unknown;
  year?: number;
}

export interface ParsedCitation {
  raw: string;
  text: string;
  page: string;
  candidates: PublicationRecord[];
}

export interface PublicationCatalogInstance {
  records: Map<string, PublicationRecord>;
  aliases: Map<string, Set<string>>;
  externalCodes: Map<string, Set<string>>;
  families: Map<string, Set<string>>;
  searchTerms: Map<string, Set<string>>;
  declaredIdentities: Set<string>;
  addAlias(alias: unknown, id: string, target?: Map<string, Set<string>>): void;
  add(input: PublicationInput | null | undefined): PublicationRecord | null;
  lookup(value: unknown, options?: LookupOptions): PublicationRecord[];
  termsFor(id: string): string[];
  declare(code: unknown, title?: unknown, options?: DeclareOptions): void;
}

export interface PublicationCatalogConstructor {
  new (records?: readonly PublicationInput[]): PublicationCatalogInstance;
}

export interface SourcePackageLike {
  active?: boolean;
  title?: string;
  flags?: {
    dnd5e?: { sourceBooks?: Record<string, string> };
    truesight?: { publications?: PublicationInput[] };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SourcePackLike {
  metadata?: {
    packageType?: string;
    packageName?: string;
    label?: string;
    flags?: {
      dnd5e?: { sourceBook?: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  title?: string;
  [key: string]: unknown;
}

export interface SourceEnvironment {
  publications?: readonly PublicationInput[];
  localize?: (key: string) => string;
  system?: SourcePackageLike | null;
  world?: SourcePackageLike | null;
  modules?: LookupCollection<SourcePackageLike> | null;
  packs?: LookupCollection<SourcePackLike> | null;
  sourceBooks?: Record<string, string> | null;
  publicationProviders?: LookupCollection<readonly PublicationInput[]> | Record<string, readonly PublicationInput[]> | Iterable<readonly PublicationInput[]> | null;
  externalPublications?: {
    titles?: Record<string, string>;
    abbreviations?: Record<string, string>;
    dates?: Record<string, string>;
  } | null;
  sourceCatalog?: PublicationCatalogInstance;
  sourceCache?: WeakMap<object, IdentifiedSource>;
  [key: string]: unknown;
}

export interface PreparedSourceEnvironment extends SourceEnvironment {
  sourceCatalog: PublicationCatalogInstance;
  sourceCache: WeakMap<object, IdentifiedSource>;
}

export interface SourceItemInput {
  uuid?: string | null;
  package?: string | null;
  packageName?: string | null;
  source?: string | null;
  system?: {
    source?: {
      book?: unknown;
      custom?: unknown;
      rules?: unknown;
      page?: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface SourceContext {
  external: boolean;
  origin: 'external' | 'compendium' | 'world';
  packId: string | undefined;
  location: string;
  packageName: string;
  book: string;
  custom: string;
  externalSource: string;
  rules: RulesEdition | null;
  page: string;
  packBook: string;
  packageBook: string;
}

export type SourceConfidence =
  | 'document'
  | 'external'
  | 'pack'
  | 'package'
  | 'ambiguous'
  | 'container'
  | 'rules';

export interface SourceReference {
  record: PublicationRecord | null;
  candidates: PublicationRecord[];
  page: string;
  raw: string;
  confidence: SourceConfidence;
}

export type SourceStatus =
  | 'edition-conflict'
  | 'source-conflict'
  | 'unknown'
  | 'ambiguous'
  | 'edition-unknown'
  | 'partial'
  | 'confirmed';

export interface RawSourceField {
  field: 'book' | 'custom' | 'external' | 'pack' | 'package';
  value: string;
}

export interface IdentifiedSource extends SourceContext {
  status: SourceStatus;
  references: SourceReference[];
  unresolved: string[];
  documentRules: RulesEdition | null;
  raw: RawSourceField[];
}

export interface TruesightSourcesApi {
  publicationKey: (value: unknown) => string;
  isVersionNumber: (value: unknown) => boolean;
  titleAliases: (title: unknown) => string[];
  PublicationCatalog: PublicationCatalogConstructor;
  buildPublicationCatalog: (environment?: SourceEnvironment) => PublicationCatalogInstance;
  DEFAULT_PUBLICATION_CATALOG: PublicationCatalogInstance;
  parseCitations: (value: unknown, catalog?: PublicationCatalogInstance, options?: LookupOptions) => ParsedCitation[];
  prepareSourceEnvironment: (environment?: SourceEnvironment) => PreparedSourceEnvironment;
  sourceContext: (item: SourceItemInput, environment?: SourceEnvironment) => SourceContext;
  identifySource: (item: SourceItemInput, environment?: SourceEnvironment) => IdentifiedSource;
}

export interface CatalogRevisions {
  index: number;
  sources: number;
  names: number;
  access: number;
  review: number;
  packs: number;
}

export type CatalogStatusState = 'not-ready' | 'ready' | 'unreviewed' | 'failed' | 'unavailable';

export interface CatalogStatus {
  apiVersion: 1;
  ruleVersion: number;
  revision: number;
  generation: number;
  status: CatalogStatusState;
  revisions?: CatalogRevisions;
  scope?: 'world';
  reviewed?: boolean;
  canManage?: boolean;
  canPublish?: boolean;
  publishReason?: string | null;
  publisherId?: string | null;
  canUndo?: boolean;
  includeRisk?: boolean;
  reason?: string;
  message?: string;
}

export interface WhenReadyOptions {
  timeout?: number;
}

export type CatalogMemberStatus =
  | 'member'
  | 'invalidated'
  | 'conflict'
  | 'pending'
  | 'independent'
  | 'not-indexed';

export interface CatalogMemberEvidence {
  identifier: string | null;
  level: unknown;
  school: unknown;
  context: Record<string, unknown> | null;
  source: IdentifiedSource | null;
  provider: unknown;
}

export interface CatalogIndexedMemberEntry {
  uuid: string;
  documentType: string;
  key: string | null;
  type: string;
  img: string | null;
  kind: string;
  rules: RulesEdition | null;
  warning: ReviewReason | null;
  risk: 'implementation' | null;
  status: Exclude<CatalogMemberStatus, 'not-indexed'>;
  names: string[];
  tags: string[];
  srd: boolean;
  reason: string | null;
  evidence: CatalogMemberEvidence;
}

export interface CatalogNotIndexedMemberEntry {
  uuid: string;
  key: null;
  status: 'not-indexed';
  warning: null;
  reason: 'outside-index';
}

export type CatalogMemberEntry = CatalogIndexedMemberEntry | CatalogNotIndexedMemberEntry;

export interface CatalogGroupEntry {
  key: string;
  kind: string;
  rules: RulesEdition | null;
  reason: string;
  risk: 'implementation' | null;
  members: string[];
}

export interface CatalogReadResult extends CatalogStatus {
  changed: number;
  excludedCount?: number;
  entries: Map<string, CatalogMemberEntry>;
  groups: Map<string, CatalogGroupEntry>;
}

export interface CatalogMembershipEntry {
  key: string | null;
  rules: RulesEdition | null;
}

export interface CatalogMembershipResult {
  apiVersion: 1;
  status: CatalogStatusState;
  entries: Map<string, CatalogMembershipEntry>;
}

export interface ReviewRecord {
  fingerprint: string;
  nameFingerprint: string | null;
  key: string | null;
  warning: ReviewReason | null;
  reason: ReviewReason | null;
}

export interface ReviewGroup {
  kind: string;
  rules: RulesEdition | null;
  risk: 'implementation' | null;
  reason: string;
  members: string[];
  context?: Record<string, unknown> | null;
  level?: number;
  school?: string;
}

export interface ReviewDecision {
  key: string;
  kind: 'same' | 'different';
  reason: string;
  members: string[];
  sides: [string[], string[]] | null;
  evidence: Record<string, string>;
}

export interface ReviewSnapshot {
  version: 1;
  ruleVersion: number;
  createdAt?: number;
  includeRisk?: boolean;
  records: Record<string, ReviewRecord>;
  groups: Record<string, ReviewGroup>;
  decisions: ReviewDecision[];
}

export interface ReviewUndoState {
  active: ReviewSnapshot | null;
  excluded: string[];
}

export interface ReviewState {
  schemaVersion: 1;
  revision: number;
  active: ReviewSnapshot | null;
  previous: ReviewUndoState | null;
  excluded: string[];
  publisherId?: string;
  publishedAt?: number;
  operation?: string;
}

export interface RuleEvidenceResult {
  uuid: string;
  status: 'ready' | 'unavailable';
  text?: string;
  source?: IdentifiedSource;
  provider?: unknown;
  usage?: { max: unknown; recovery: unknown[] } | null;
  progressions?: Array<{ uuid: string; name: string; scale: Record<string, unknown> }>;
}

export interface NameDecisionSummary {
  key: string;
  kind: 'same' | 'different';
  reason: string;
  members: string[];
  sides: [string[], string[]] | null;
  current: boolean;
}

export interface NameReviewOptions {
  previewId?: string | null;
}

export interface NameSetGroupSummary {
  key: string | null;
  members: string[];
}

export interface NameSetSummary {
  key: string;
  name: string;
  members: string[];
  matches: string[];
  differences: string[];
  warnings: ReviewReason[];
  groups: NameSetGroupSummary[];
  entryCount: number;
  groupCount: number;
}

export interface NameReviewSummary {
  sets: NameSetSummary[];
  count: number;
  entries: number;
  previewId: string | null;
}

export interface NameSetOptions {
  previewId?: string | null;
  offset?: number;
  limit?: number;
}

export interface PairClue {
  field: string;
  kind: 'difference' | 'missing' | 'diagnostic';
  left?: unknown;
  right?: unknown;
  member?: string;
  code?: ReviewReason;
}

export interface ComparedPair {
  left: string;
  right: string;
  status: 'grouped' | 'separate' | 'pending';
  basis: 'reviewed-group' | 'user' | 'generation' | 'object' | 'unresolved';
  reason?: string;
  clues: PairClue[];
}

export interface NameSetDetail extends NameSetSummary {
  pairs: ComparedPair[];
  total: number;
  offset: number;
  limit: number;
  evidence: Record<string, {
    names: Array<{ key: string; value: string; source: 'display' | 'original' | 'bilingual' }>;
    fields: Record<string, unknown>;
    warning: ReviewReason | null;
  }>;
}

export type NameDecisionRequest =
  | { left: string; right: string; kind: 'same' | 'different'; reason: string }
  | { kind: 'revoke'; key: string };

export interface PreviewOptions {
  includeRisk?: boolean;
}

export interface ExclusionRequest {
  uuid: string;
  excluded: boolean;
}

export interface CatalogPreview extends CatalogStatus {
  id: string;
  decision: Record<string, unknown> | null;
  exclusion: {
    request: ExclusionRequest;
    members: string[];
    beforeMembers: string[];
    afterMembers: string[];
    restored: boolean;
  } | null;
  retained: number;
  diff: {
    added: number;
    merged: number;
    split: number;
    groups: number;
    joined: number;
    independent: number;
    risky: number;
  };
  groups: Array<ReviewGroup & { key: string; members: Array<{ uuid: string; name: string | undefined }> }>;
  independent: Array<{ uuid: string; name: string | undefined; reason: ReviewReason | null }>;
}

export interface OpenReviewOptions {
  memberUuid?: string | null;
  [key: string]: unknown;
}

export interface TruesightCatalogApi {
  readonly apiVersion: 1;
  readonly affects: (change: DomainChangeEvent | null | undefined, domains: readonly ChangeDomain[]) => boolean;
  readonly getStatus: () => CatalogStatus;
  readonly whenReady: (options?: WhenReadyOptions) => Promise<CatalogStatus>;
  readonly read: (uuids?: readonly CanonicalUuidInput[] | null) => CatalogReadResult;
  readonly getMember: (uuid: CanonicalUuidInput) => CatalogMemberEntry | undefined;
  readonly loadRuleEvidence: (uuids: readonly string[]) => Promise<RuleEvidenceResult[]>;
  readonly readNameDecisions: () => NameDecisionSummary[];
  readonly readNameReview: (options?: NameReviewOptions) => NameReviewSummary;
  readonly readNameSet: (key: string, options?: NameSetOptions) => NameSetDetail;
  readonly previewNameDecision: (request: NameDecisionRequest) => CatalogPreview;
  readonly preview: (options?: PreviewOptions) => CatalogPreview;
  readonly apply: (id: string) => Promise<CatalogStatus>;
  readonly undo: () => Promise<CatalogStatus>;
  readonly previewExclusion: (request: ExclusionRequest) => CatalogPreview;
  readonly openReview: (options?: OpenReviewOptions) => unknown;
  readonly registerPublications: (id: string, records: readonly PublicationInput[]) => () => boolean;
  readonly unregisterPublications: (id: string) => boolean;
  readonly sourceEnvironment: () => SourceEnvironment;
}

export interface AliasScope {
  rules?: RulesEdition | null;
  type?: string;
  types?: readonly string[];
  category?: string;
  excludeCategories?: readonly string[];
  actorType?: string;
}

export interface ScopeEvidence {
  rules?: unknown;
  type?: string | null;
  category?: string | null;
  actorType?: string | null;
}

export interface RefreshRequestOptions {
  delay?: number;
  retract?: boolean;
  idle?: boolean;
  idleTimeout?: number;
  [key: string]: unknown;
}

export interface RefreshQueueConfig<TOptions extends RefreshRequestOptions = RefreshRequestOptions> {
  invalidate: (options?: TOptions) => void;
  build: (isCurrent: () => boolean, options?: TOptions) => void | Promise<void>;
}

export interface RefreshQueue<TOptions extends RefreshRequestOptions = RefreshRequestOptions> {
  request(options?: TOptions): Promise<void>;
  stop(): void;
}

export interface CorpusItemRow {
  _id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  originalName?: string;
  actorType?: string;
  actor?: { type?: string | null; items?: unknown } | null;
  parent?: { items?: unknown } | null;
  flags?: { babele?: { originalName?: string }; [key: string]: unknown };
  system?: {
    identifier?: string;
    source?: { rules?: unknown; [key: string]: unknown };
    type?: { value?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CorpusItemMetadata {
  _id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  originalName?: string;
  actorType?: string;
  flags?: { babele?: { originalName?: string }; [key: string]: unknown };
  system?: {
    identifier?: string;
    source?: { rules?: unknown; [key: string]: unknown };
    type?: { value?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PackIndexLike {
  values(): IterableIterator<CorpusItemRow>;
  get?(key: string): CorpusItemRow | undefined;
}

export interface PackLike {
  visible: boolean;
  documentName: string;
  index?: PackIndexLike | null;
  getIndex?(options: { fields: string[] }): Promise<PackIndexLike>;
}

export interface PackMapLike {
  get(id: string): PackLike | undefined;
  entries(): IterableIterator<[string, PackLike]>;
}

export type TitleIndex = Record<string, { titles?: Record<string, unknown> } | undefined>;

export interface NamePair {
  translatedName: string;
  englishName: string | null;
  source: string;
  type: string | undefined;
  rules: unknown;
  category?: string;
  identifier?: string;
}

export interface NameEvidenceEntry {
  displayName: string;
  source: string;
  type: string | undefined;
  rules: unknown;
  category?: string;
  identifier?: string;
  actorType?: string;
  originalName: string | undefined;
  lookupNames: string[];
}

export type ExtraEvidenceFn = (row: CorpusItemRow) => string[];
export type CatalogMembershipLookup = (items: readonly CorpusItemRow[]) => Map<string, CatalogMembershipEntry>;

export interface SourceErrorReport {
  status: 'source-error';
  source: string | null;
  detail: string;
}

export interface LoadCorpusOptions {
  fields?: readonly string[];
}

export interface ReadCorpusOptions {
  packs: PackMapLike;
  loadTitleIndex: () => Promise<TitleIndex | null>;
  loadGrouping: () => Promise<CatalogMembershipLookup>;
  localItems?: Iterable<CorpusItemRow>;
  fields?: readonly string[];
}

export interface RawCorpusData {
  indexes: Map<string, Map<string | number, CorpusItemMetadata>>;
  sources: Map<string, { visible: boolean; documentName: string; index: Map<string | number, CorpusItemMetadata> | undefined }>;
  titleIndex: TitleIndex | null;
  catalogFor: CatalogMembershipLookup;
  localItems: CorpusItemMetadata[];
}

export interface CorpusSnapshot extends RawCorpusData {
  isCurrent: () => boolean;
  isAccessCurrent: () => boolean;
}

export interface PlanAliasesInput {
  pairs: readonly NamePair[];
  lookupNames: Set<string>;
  existingAliases?: Record<string, unknown>;
  groups?: Map<string, readonly NameEvidenceEntry[]>;
  scope?: AliasScope | null;
}

export interface AliasCandidateDescription {
  englishName: string | null;
  sources: string[];
}

export interface AliasConflictEntry {
  displayName: string;
  reason: 'unknown-original' | 'ambiguous-name';
  candidates: AliasCandidateDescription[];
}

export interface AliasClusterError {
  reason: 'multiple-lookup-targets' | 'conflicting-originals' | 'unknown-original';
  groups: string[];
  members: NameEvidenceEntry[];
  candidates: AliasCandidateDescription[];
}

export interface AliasPlanReport {
  status: 'ready' | 'cluster-conflict';
  planned: number;
  existing: number;
  unsupported: number;
  conflicts: AliasConflictEntry[];
  clusterErrors: AliasClusterError[];
  scope: AliasScope | null;
}

export interface AliasGroupTarget {
  target: string;
  displays: Set<string>;
}

export interface AliasDisambiguation {
  identifiers: Map<string, Set<string>>;
  groupTargets: Map<string, AliasGroupTarget>;
  candidates: Map<string, Set<string | null>>;
  lookupNames: Set<string>;
  existingAliases: Record<string, unknown>;
}

export interface AliasPlan {
  aliases: Map<string, string>;
  report: AliasPlanReport;
  disambiguation: AliasDisambiguation;
}

export interface AliasLookupItem {
  name?: unknown;
  uuid?: unknown;
  originalName?: unknown;
  _stats?: { compendiumSource?: unknown } | null;
  flags?: { babele?: { originalName?: unknown }; [key: string]: unknown } | null;
  system?: { identifier?: unknown; [key: string]: unknown } | null;
}

export interface TruesightNamesApi {
  readonly apiVersion: 1;
  readonly affects: (change: DomainChangeEvent | null | undefined, domains: readonly ChangeDomain[]) => boolean;
  readonly createRefreshQueue: <TOptions extends RefreshRequestOptions = RefreshRequestOptions>(
    config: RefreshQueueConfig<TOptions>
  ) => RefreshQueue<TOptions>;
  readonly loadCorpus: (options?: LoadCorpusOptions) => Promise<CorpusSnapshot>;
  readonly readCorpus: (options: ReadCorpusOptions) => Promise<RawCorpusData>;
  readonly sourceError: (error: unknown, source?: string | null) => SourceErrorReport;
  readonly collectNamePairs: (
    packs: PackMapLike,
    titleIndex: TitleIndex | null,
    knownNames: Set<string>,
    extraPackIds?: readonly string[]
  ) => NamePair[];
  readonly itemGroups: (
    indexes: Map<string, PackIndexLike>,
    catalogFor: CatalogMembershipLookup,
    localItems?: readonly CorpusItemMetadata[],
    extraEvidence?: ExtraEvidenceFn
  ) => Map<string, NameEvidenceEntry[]>;
  readonly planAliases: (input: PlanAliasesInput) => AliasPlan;
  readonly resolveItemAlias: (plan: AliasPlan | null | undefined, item: AliasLookupItem | null | undefined) => string | null;
  readonly inScope: (evidence: ScopeEvidence, scope: AliasScope | null | undefined) => boolean;
  readonly rulesEdition: (rules: unknown) => RulesEdition | null;
}

export interface TruesightApi {
  readonly apiVersion: 1;
  readonly catalog: TruesightCatalogApi;
  readonly names: TruesightNamesApi;
  readonly sources: TruesightSourcesApi;
}
