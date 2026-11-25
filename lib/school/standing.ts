import type { StandingOrder } from "./queries";

export type StandingOrderInput = Omit<StandingOrder, "id" | "notes" | "classroom_id"> & {
  id?: string;
  classroom_id: string;
  notes: string;
};

export function emptyStandingOrder(classroomId: string, startDate: string): StandingOrderInput {
  return {
    name: "",
    classroom_id: classroomId,
    weekdays: [1, 2, 3, 4, 5],
    start_date: startDate,
    end_date: null,
    status: "active",
    quantity_mode: "per_headcount",
    fixed_quantity: null,
    buffer_percent: 0,
    menu_selection_mode: "chefs_choice",
    day_items: {},
    rotation: [],
    notes: "",
  };
}
