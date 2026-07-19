import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(), key: varchar('key', { length: 80 }).notNull(), name: varchar('name', { length: 160 }).notNull(),
  hypothesis: text('hypothesis').notNull(), primaryMetric: varchar('primary_metric', { length: 120 }).notNull(), status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(1), createdBy: uuid('created_by'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ keyIdx: uniqueIndex('experiments_key_idx').on(table.key), statusIdx: index('experiments_status_idx').on(table.status) }));
export const experimentVariants = pgTable('experiment_variants', {
  id: uuid('id').primaryKey().defaultRandom(), experimentId: uuid('experiment_id').notNull().references(() => experiments.id), key: varchar('key', { length: 40 }).notNull(), name: varchar('name', { length: 120 }).notNull(), weightBasisPoints: integer('weight_basis_points').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ keyIdx: uniqueIndex('experiment_variants_experiment_key_idx').on(table.experimentId, table.key) }));
export const experimentAssignments = pgTable('experiment_assignments', {
  id: uuid('id').primaryKey().defaultRandom(), experimentId: uuid('experiment_id').notNull().references(() => experiments.id), subjectHash: varchar('subject_hash', { length: 64 }).notNull(), variantKey: varchar('variant_key', { length: 40 }).notNull(), assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ subjectIdx: uniqueIndex('experiment_assignments_subject_idx').on(table.experimentId, table.subjectHash), variantIdx: index('experiment_assignments_variant_idx').on(table.experimentId, table.variantKey) }));
export const experimentExposures = pgTable('experiment_exposures', {
  id: uuid('id').primaryKey().defaultRandom(), assignmentId: uuid('assignment_id').notNull().references(() => experimentAssignments.id), experimentId: uuid('experiment_id').notNull().references(() => experiments.id), exposureKey: varchar('exposure_key', { length: 160 }).notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ exposureIdx: uniqueIndex('experiment_exposures_key_idx').on(table.experimentId, table.exposureKey), experimentIdx: index('experiment_exposures_experiment_idx').on(table.experimentId, table.occurredAt) }));
