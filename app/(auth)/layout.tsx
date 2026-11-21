import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center px-4 py-10" data-shell="auth">
      <Logo className="mb-8" />
      <main id="main" className="w-full max-w-md">
        {children}
      </main>
    </div>
  );
}
