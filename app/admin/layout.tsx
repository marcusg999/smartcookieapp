import type { Metadata } from "next";

// Base admin layout: no chrome, no guard. The console layout ((console)/)
// adds the sidebar and requires staff + AAL2; /admin/mfa/* requires staff at
// any assurance level so AAL1 staff can enroll or verify.
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Smart Cookie" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
