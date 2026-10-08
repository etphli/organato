import { createRemoteJWKSet, jwtVerify } from "jose";
import { Hono } from "hono";
import { listItems, listSubjects } from "./db";
import type { Env } from "./types";

const defaultStudatoIssuer = "https://knmsrsjfnqdgkdtbvcnb.supabase.co/auth/v1";
const studatoJwksCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function studatoJwks(issuer: string) {
  const cached = studatoJwksCache.get(issuer);
  if (cached) return cached;
  const client = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  studatoJwksCache.set(issuer, client);
  return client;
}

type VerifiedStudatoIdentity = {
  email: string;
  subject: string;
};

type FeedItem = Awaited<ReturnType<typeof listItems>>[number];
type FeedSubject = Awaited<ReturnType<typeof listSubjects>>[number];

type FeedDependencies = {
  verify?: (token: string) => Promise<VerifiedStudatoIdentity>;
  load?: (
    env: Env,
    identity: VerifiedStudatoIdentity,
  ) => Promise<{ items: FeedItem[]; subjects: FeedSubject[] } | null>;
};

export async function verifyStudatoAccessToken(
  token: string,
  issuer: string = defaultStudatoIssuer,
): Promise<VerifiedStudatoIdentity> {
  const { payload } = await jwtVerify(token, studatoJwks(issuer), {
    issuer,
    audience: "authenticated",
  });
  if (
    typeof payload.email !== "string" ||
    !payload.email ||
    typeof payload.sub !== "string" ||
    !payload.sub
  ) {
    throw new Error("Missing signed identity claims.");
  }
  return { email: payload.email.toLowerCase(), subject: payload.sub };
}

async function loadUserScopedFeed(env: Env, identity: VerifiedStudatoIdentity) {
  const allowed = await env.DB.prepare(
    `SELECT workspace_id FROM allowed_identity
     WHERE email_normalized = ? AND enabled = 1`,
  )
    .bind(identity.email)
    .first<{ workspace_id: string }>();
  if (!allowed?.workspace_id) return null;
  const [items, subjects] = await Promise.all([
    listItems(env.DB, allowed.workspace_id, { limit: 500 }),
    listSubjects(env.DB, allowed.workspace_id),
  ]);
  return { items, subjects };
}

export function projectStudatoSources(
  items: FeedItem[],
  subjects: FeedSubject[],
) {
  const subjectNames = new Map(
    subjects.map((subject) => [subject.id, subject.displayName]),
  );
  return items
    .filter((item) => item.kind === "work")
    .map((item) => ({
      canonicalId: `ato:organato:item:${item.id}`,
      sourceVersion: item.version,
      title: item.displayName,
      subject: {
        label: item.subjectId
          ? (subjectNames.get(item.subjectId) ?? "General")
          : "General",
        reference: item.subjectId
          ? `ato:organato:subject:${item.subjectId}`
          : null,
      },
      classification: "assignment",
      state: item.workingStatus,
      priority: item.priority,
      dueAt: item.dueAt,
      dateLocal: item.dueAt ? null : item.dueDateLocal,
      deepLink: "/assignments",
      updatedAt: item.updatedAt,
      dataClassification: "metadata",
      capabilities: ["open"],
    }));
}

export function createStudatoFeedRoutes(dependencies: FeedDependencies = {}) {
  const routes = new Hono<{ Bindings: Env }>();

  routes.get("/feeds/study-sources", async (context) => {
    const verify =
      dependencies.verify ??
      ((token: string) =>
        verifyStudatoAccessToken(
          token,
          context.env.STUDATO_ISSUER ?? defaultStudatoIssuer,
        ));
    const load = dependencies.load ?? loadUserScopedFeed;
    const authorization = context.req.header("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!token) {
      return context.json(
        {
          error: "A signed Studato session is required.",
          code: "unauthorized",
        },
        401,
      );
    }

    let identity: VerifiedStudatoIdentity;
    try {
      identity = await verify(token);
    } catch {
      return context.json(
        {
          error: "The Studato session could not be verified.",
          code: "unauthorized",
        },
        401,
      );
    }

    const scoped = await load(context.env, identity);
    if (!scoped) {
      return context.json(
        {
          error:
            "This Google account is not connected to an Organato workspace.",
          code: "organato_account_not_found",
        },
        403,
      );
    }

    const watermark = new Date().toISOString();
    return context.json({
      items: projectStudatoSources(scoped.items, scoped.subjects),
      nextCursor: watermark,
      hasMore: false,
      watermark,
    });
  });

  return routes;
}

export const studatoFeedRoutes = createStudatoFeedRoutes();
