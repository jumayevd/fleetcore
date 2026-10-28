import { usablePasswordLink } from "@/lib/platform";
import { setPasswordWithLink } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, LinkButton } from "@/components/ui";
import { AuthCard, AuthFrame } from "../../login/frame";

export const metadata = { title: "Set your password" };

/** A one-time link from a platform owner: set a password for the account, then go in signed in. */
export default async function ResetPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;
  const link = await usablePasswordLink(token);

  if (!link) {
    return (
      <AuthFrame>
        <AuthCard title="This link can't be used" subtitle="It has expired, or the password was already set with it.">
          <p className="mt-4 text-[13px] text-fg-muted">Ask the person who sent it for a new link. If you set your password already, just sign in.</p>
          <div className="mt-5"><LinkButton href="/login">Sign in</LinkButton></div>
        </AuthCard>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthCard title="Set your password" subtitle={<>For <span className="font-medium text-fg">{link.user.email}</span>. Only you will know it.</>}>
        <ActionForm action={setPasswordWithLink.bind(null, token)} className="mt-6 space-y-4">
          <input type="text" name="username" autoComplete="username" defaultValue={link.user.email} hidden readOnly />
          <Field label="New password" required hint="At least 8 characters">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
          </Field>
          <Field label="Type it again" required>
            <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <SubmitButton className="w-full" pendingText="Saving…">Set password and sign in</SubmitButton>
        </ActionForm>
        <p className="mt-5 border-t border-line pt-4 text-[11px] text-fg-subtle">
          This link works once and expires {link.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
