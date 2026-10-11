import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  githubId: text('github_id').unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(orgMembers),
  sessions: many(sessions),
}));

// ---------------------------------------------------------------------------
// Sessions (for web authentication)
// ---------------------------------------------------------------------------
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export const orgs = pgTable('orgs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').default('free').notNull(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status').default('none').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orgsRelations = relations(orgs, ({ many }) => ({
  members: many(orgMembers),
  projects: many(projects),
  apiKeys: many(apiKeys),
}));

// ---------------------------------------------------------------------------
// Organization Members
// ---------------------------------------------------------------------------
export const orgRoleEnum = ['owner', 'member', 'viewer'] as const;
export type OrgRole = (typeof orgRoleEnum)[number];

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    role: text('role', { enum: orgRoleEnum }).notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('org_members_org_user_idx').on(table.orgId, table.userId),
  ]
);

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(orgs, {
    fields: [orgMembers.orgId],
    references: [orgs.id],
  }),
  user: one(users, {
    fields: [orgMembers.userId],
    references: [users.id],
  }),
}));

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    repo: text('repo').notNull(), // e.g. "shubham-core/dwarflens"
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('projects_org_slug_idx').on(table.orgId, table.slug),
    index('projects_org_id_idx').on(table.orgId),
  ]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, {
    fields: [projects.orgId],
    references: [orgs.id],
  }),
  analyses: many(analyses),
  apiKeys: many(apiKeys),
}));

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
    index('api_keys_org_id_idx').on(table.orgId),
    index('api_keys_project_id_idx').on(table.projectId),
  ]
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  org: one(orgs, {
    fields: [apiKeys.orgId],
    references: [orgs.id],
  }),
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
}));

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------
export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    buildName: text('build_name').notNull().default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    totalSize: bigint('total_size', { mode: 'number' }).notNull(),
    flashSize: bigint('flash_size', { mode: 'number' }).notNull().default(0),
    ramSize: bigint('ram_size', { mode: 'number' }).notNull().default(0),
    structCount: integer('struct_count').notNull().default(0),
    symbolCount: integer('symbol_count').notNull().default(0),
    paddingBytes: bigint('padding_bytes', { mode: 'number' }).notNull().default(0),
    cacheLineCrossings: integer('cache_line_crossings').notNull().default(0),
    rawData: jsonb('raw_data').notNull(),
  },
  (table) => [
    uniqueIndex('analyses_project_commit_build_idx').on(
      table.projectId,
      table.commitSha,
      table.buildName
    ),
    index('analyses_project_created_idx').on(table.projectId, table.createdAt),
    index('analyses_project_branch_idx').on(table.projectId, table.branch),
  ]
);

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  project: one(projects, {
    fields: [analyses.projectId],
    references: [projects.id],
  }),
  shareLinks: many(shareLinks),
}));

// ---------------------------------------------------------------------------
// Share Links
// ---------------------------------------------------------------------------
export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    analysisId: uuid('analysis_id').references(() => analyses.id, { onDelete: 'cascade' }).notNull(),
    token: text('token').notNull().unique(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('share_links_token_idx').on(table.token),
    index('share_links_analysis_id_idx').on(table.analysisId),
  ]
);

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
  analysis: one(analyses, {
    fields: [shareLinks.analysisId],
    references: [analyses.id],
  }),
}));
