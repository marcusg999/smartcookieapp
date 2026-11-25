import { z } from "zod";

// Phase 7: every school portal input. Amounts never come from the browser:
// prices are set in the database from the menu and the school's price list.

const uuid = z.uuid();
const isoDate = z.iso.date();
const text = (max: number) => z.string().trim().max(max);

export const schoolDetailsSchema = z.object({
  name: z.string().trim().min(2, "Enter your school's name.").max(120),
  billing_email: z.email("Enter a billing email for invoices.").max(254),
  contact_phone: text(32),
  line1: z.string().trim().min(3, "Enter the street address.").max(120),
  city: z.string().trim().min(2, "Enter the city.").max(80),
  state: z.string().trim().min(2, "Enter the state.").max(40),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code."),
  dropoff_entrance: text(200),
  dropoff_contact: text(120),
  dropoff_window: text(80),
  dropoff_instructions: text(1000),
});

export const classroomSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Name the classroom.").max(80),
  teacher_name: text(80),
  grade: text(20),
  headcount: z.number().int().min(0, "Headcount can't be negative.").max(1000),
  dropoff_location: text(200),
});

export const allergyCountsSchema = z.object({
  classroom_id: uuid,
  counts: z.array(z.object({ allergen_id: uuid, count: z.number().int().min(0).max(1000) })).max(40),
});

export const reviewLinkSchema = z.object({ child_id: uuid, approve: z.boolean() });

export const standingOrderSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1, "Give the standing order a name.").max(120),
    classroom_id: uuid,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one weekday.").max(7),
    start_date: isoDate,
    end_date: isoDate.nullable(),
    status: z.enum(["draft", "active", "paused", "ended"]),
    quantity_mode: z.enum(["per_headcount", "fixed"]),
    fixed_quantity: z.number().int().min(1).max(1000).nullable(),
    buffer_percent: z.number().int().min(0).max(50),
    menu_selection_mode: z.enum(["chefs_choice", "specific_items", "category_rotation"]),
    day_items: z.partialRecord(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.array(uuid).max(5)),
    rotation: z.array(z.object({ category_id: uuid, count: z.number().int().min(1).max(3) })).max(6),
    notes: text(2000),
  })
  .refine((v) => v.end_date === null || v.end_date >= v.start_date, {
    message: "The end date must be after the start date.",
    path: ["end_date"],
  })
  .refine((v) => v.quantity_mode !== "fixed" || v.fixed_quantity !== null, {
    message: "Enter how many meals per day.",
    path: ["fixed_quantity"],
  })
  .refine((v) => v.menu_selection_mode !== "category_rotation" || v.rotation.length > 0, {
    message: "Pick at least one category.",
    path: ["rotation"],
  })
  .refine(
    (v) => v.menu_selection_mode !== "specific_items" || Object.values(v.day_items).some((ids) => ids.length > 0),
    { message: "Pick items for at least one day.", path: ["day_items"] },
  );

export const dayChangeSchema = z.object({
  standing_order_id: uuid,
  delivery_date: isoDate,
  headcount: z.number().int().min(0).max(1000).nullable(),
  skip: z.boolean(),
  items: z.array(uuid).min(1).max(5).nullable(),
  note: text(300),
  clear: z.boolean(),
});

export const closureSchema = z.object({ date: isoDate, reason: text(120), closed: z.boolean() });

export const weekReviewSchema = z.object({ menu_week_id: uuid });

export const bulkOrderSchema = z.object({
  menu_week_id: uuid,
  location: z.string().trim().min(2, "Tell us where to deliver.").max(200),
  notes: text(1000),
  items: z
    .array(
      z.object({
        menu_item_id: uuid,
        delivery_date: isoDate,
        quantity: z.number().int().min(1, "At least 1.").max(500),
        classroom_id: uuid.nullable(),
      }),
    )
    .min(1, "Add at least one item.")
    .max(50),
});

export const inviteStaffSchema = z.object({ email: z.email("Enter a valid email.").max(254).toLowerCase() });
export const removeStaffSchema = z.object({ user_id: uuid });
