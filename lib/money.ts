/** Integer cents → "$12.50". Safe in server and client code. */
export const formatCents = (cents: number | null | undefined, currency = "usd") =>
  cents === null || cents === undefined
    ? "–"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
