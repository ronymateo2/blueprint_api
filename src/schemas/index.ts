import { z } from 'zod';

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const habitCreateSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(50).optional(),
  type: z.enum(['count', 'time', 'yn', 'qty', 'at']),
  goal: z.number().int().min(1).max(100000).optional(),
  unit: z.string().max(50).optional().nullable(),
  points: z.number().int().min(0).max(100).optional(),
  sort_order: z.number().int().min(0).optional(),
  frequency_type: z.string().max(50).optional(),
  frequency_config: z
    .string()
    .max(1000)
    .refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, 'must be valid JSON')
    .optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const habitUpdateSchema = habitCreateSchema.partial();

const fiveYearsAgo = () => new Date(Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000);

export const entryCreateSchema = z.object({
  habit_id: z.string().min(1),
  value: z.number().min(0).max(100000).optional(),
  note: z.string().max(500).optional().nullable(),
  logged_at: z
    .string()
    .datetime({ offset: true })
    .refine(
      (s) => new Date(s) <= new Date() && new Date(s) >= fiveYearsAgo(),
      'logged_at must be in the past and within 5 years',
    )
    .optional(),
});

export const reminderCreateSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.string().regex(/^[LMXJVSD]+$/).optional(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const reminderUpdateSchema = reminderCreateSchema.partial();

export const meUpdateSchema = z.object({
  timezone: z
    .string()
    .refine((tz) => VALID_TIMEZONES.has(tz), 'invalid timezone')
    .optional(),
  display_name: z.string().min(1).max(100).optional(),
});

export const skipCreateSchema = z.object({
  habit_id: z.string().min(1),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
