import { redirect } from "next/navigation";

// The cart lives in the ordering screen's bottom bar; its full view is checkout step 1.
export default function CartPage() {
  redirect("/checkout");
}
