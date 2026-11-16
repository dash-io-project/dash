import { Server } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "~/components/auth/login-form";
import { pageMetadata } from "~/lib/metadata";

const description =
  "Sign in to your Dash Cloud account. A self-hosted Dash has its own sign-in on its own address.";

export const metadata: Metadata = pageMetadata({
  title: "Sign in",
  description,
  path: "/login/",
  index: false,
});

export default function LoginPage() {
  return (
    <section className="h-full bg-surface" aria-labelledby="login-title">
      <div className="container-x flex flex-col items-center pt-14 pb-20 sm:pt-20 sm:pb-28">
        <div className="w-full max-w-md">
          <div className="text-center">
            <p className="eyebrow mb-3">Dash Cloud</p>
            <h1
              id="login-title"
              className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-[2.5rem]"
            >
              Sign in to Dash Cloud.
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground text-pretty">
              Enter the email and password of your Dash Cloud account.
            </p>
          </div>

          <div className="card mt-8 bg-background p-6 shadow-xs sm:p-8">
            <LoginForm />
          </div>

          <p className="mt-6 flex items-start gap-3 text-left text-sm leading-6 text-muted-foreground text-pretty">
            <Server className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>
              Do you self-host Dash? A self-hosted Dash has its own sign-in on its own address.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
