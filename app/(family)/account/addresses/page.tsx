import { AddressManager } from "@/components/family/address-form";
import { PageTitle } from "@/components/family/kit";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getAddresses, getHousehold, getZoneForZip } from "@/lib/family/queries";

export const metadata = { title: "Addresses" };

export default async function AddressesPage({ searchParams }: PageProps<"/account/addresses">) {
  await requireUser("/account/addresses");
  const sp = await searchParams;
  const [c, household] = await Promise.all([getContent(), getHousehold()]);
  const addresses = household ? await getAddresses(household.id) : [];
  const zones = await Promise.all(addresses.map((a) => getZoneForZip(a.zip)));
  // Only same-site paths are honoured for "come back to checkout".
  const returnTo = sp.return === "/checkout" ? "/checkout" : null;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageTitle>{c.text("addr.title")}</PageTitle>
      <AddressManager
        copy={{ ...c.group("addr."), ...c.group("onb.") }}
        returnTo={returnTo}
        addresses={addresses.map((a, i) => ({
          id: a.id,
          label: [a.line1, a.line2, a.city, a.zip].filter(Boolean).join(", "),
          is_default: a.is_default,
          covered: Boolean(zones[i]),
          zip: a.zip,
        }))}
      />
    </div>
  );
}
