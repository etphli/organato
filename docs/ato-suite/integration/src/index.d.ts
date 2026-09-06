export const ATO_CONTRACT_VERSION: "1.0";
export const ATO_APPS: readonly [
  "organato",
  "emailato",
  "calandato",
  "ato-centre",
];

export type AtoApp = (typeof ATO_APPS)[number] | (string & {});
export type DataClassification = "metadata" | "personal" | "sensitive";

export interface AtoEventEnvelope<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  specVersion: "1.0";
  id: string;
  source: AtoApp;
  type: `${string}.${string}.${"created" | "updated" | "deleted" | "archived" | "restored"}`;
  occurredAt: string;
  sequence: number;
  subject: string;
  resourceVersion: number;
  traceId: string;
  correlationId?: string;
  dataClassification: DataClassification;
  data: T;
}

export class AtoContractError extends Error {
  readonly issues: string[];
  constructor(issues: string[]);
}

export function canonicalId(
  app: string,
  resourceType: string,
  localId: string,
): string;
export function parseCanonicalId(value: string): {
  app: string;
  resourceType: string;
  localId: string;
};
export function validateEventEnvelope(value: unknown): string[];
export function createEventEnvelope<T extends Record<string, unknown>>(
  input: Omit<
    AtoEventEnvelope<T>,
    "specVersion" | "id" | "occurredAt" | "traceId" | "dataClassification"
  > &
    Partial<Pick<AtoEventEnvelope<T>, "traceId" | "dataClassification">>,
  options?: { now?: () => Date; uuid?: () => string },
): AtoEventEnvelope<T>;
export function canonicalJson(value: unknown): string;
export function idempotencyKey(scope: string, value: unknown): Promise<string>;
export function nextRetryDelay(
  attempt: number,
  options?: { baseMs?: number; capMs?: number; jitter?: number },
): number;
