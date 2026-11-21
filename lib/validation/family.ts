import { z } from "zod";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const cartLineSchema = z.object({
  childId: uuid,
  menuItemId: uuid,
  deliveryDate: isoDate,
  quantity: z.number().int().min(1).max(20),
});
export const cartLinesSchema = z.array(cartLineSchema).max(100);

export const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code.");

export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+()\d\s.-]*$/, "Use digits, spaces, dashes or brackets.")
  .optional()
  .or(z.literal(""));

export const householdSchema = z.object({
  name: z.string().trim().min(1, "Give your household a name.").max(120),
  phone: phoneSchema,
});

export const addressSchema = z.object({
  id: uuid.optional(),
  line1: z.string().trim().min(1, "Enter a street address.").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Enter a city.").max(100),
  state: z.string().trim().min(2).max(40).default("CA"),
  zip: zipSchema,
  deliveryNotes: z.string().trim().max(500).optional().or(z.literal("")),
  makeDefault: z.boolean().default(true),
});

export const childSchema = z.object({
  id: uuid.optional(),
  firstName: z.string().trim().min(1, "Enter a first name.").max(40),
  // Data minimization (CLAUDE.md §5.11): an initial, never a surname.
  lastInitial: z
    .string()
    .trim()
    .regex(/^[A-Za-z]?$/, "Just one letter.")
    .optional()
    .or(z.literal("")),
  grade: z.string().trim().max(20).optional().or(z.literal("")),
  schoolId: uuid.optional().or(z.literal("")),
  classroomId: uuid.optional().or(z.literal("")),
  allergies: z.array(z.object({ allergenId: uuid, severity: z.enum(["intolerance", "allergy", "severe"]) })).max(30),
  dietary: z.array(z.string().trim().min(1).max(40)).max(12),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const placeOrderSchema = z.object({
  weekId: uuid,
  fulfillment: z.enum(["delivery", "school_dropoff"]),
  addressId: uuid.optional().nullable(),
  discountCode: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9_-]*$/)
    .optional()
    .nullable(),
  allergiesConfirmed: z.literal(true, { error: "Please confirm each child's allergies." }),
  confirmedChildIds: z.array(uuid).max(20),
  notes: z.string().trim().max(1000).optional().nullable(),
});
