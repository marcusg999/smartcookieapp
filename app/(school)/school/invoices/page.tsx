import { redirect } from "next/navigation";

// Phase 7 moved invoices into Billing.
export default function SchoolInvoicesRedirect() {
  redirect("/school/billing");
}
