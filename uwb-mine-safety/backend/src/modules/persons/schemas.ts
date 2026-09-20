import { z } from 'zod';

export const createPersonSchema = z.object({
  tagId: z.string().min(1, '标签号必填').max(64),
  name: z.string().min(1, '姓名必填').max(50),
  employeeNo: z.string().max(50).optional().nullable(),
  jobTitle: z.string().max(50).optional().nullable(),
  team: z.string().max(50).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
});
export type CreatePersonBody = z.infer<typeof createPersonSchema>;

export const updatePersonSchema = createPersonSchema.partial().omit({ tagId: true }).extend({
  tagId: z.string().min(1).max(64).optional(),
});

export const listPersonsSchema = z.object({
  keyword: z.string().optional(),
  team: z.string().optional(),
  status: z.enum(['active', 'stationary', 'offline']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
