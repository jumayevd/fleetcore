import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";
import { rootDb } from "@/lib/db-root";
import { ROLE_LABELS } from "@/lib/constants";
import { birthDateValue, isProfileComplete, nameParts } from "@/lib/profile";
import { completeProfile } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { ProfileFields } from "@/components/profile-fields";
import { AuthCard, AuthFrame } from "../login/frame";

export const metadata = { title: "Your details" };

/**
 * Asked once of a member who isn't an owner and has no personal details on file (the app layout sends them here):
 * typically an existing account that accepted an invitation. Saving goes on into the company.
 */
export default async function ProfilePage() {
  const ctx = await getSessionContext();
  if (!ctx.accounts.length) redirect("/login");
  if (!ctx.active) redirect("/select");
  const user = await rootDb.user.findUniqueOrThrow({
    where: { id: ctx.active.user.id },
    select: { name: true, email: true, phone: true, firstName: true, lastName: true, idNumber: true, birthDate: true },
  });
  if (isProfileComplete(user)) redirect("/dashboard");
  const { first, last } = nameParts(user);

  return (
    <AuthFrame>
      <AuthCard title="Your details"
        subtitle={<>{ctx.active.company.name} asks everyone on the team for these once, as {ROLE_LABELS[ctx.active.role].toLowerCase()}. Only the company&apos;s owners and admins see them.</>}>
        <ActionForm action={completeProfile} className="mt-6 space-y-4">
          <ProfileFields defaults={{ first, last, idNumber: user.idNumber, birthDate: birthDateValue(user.birthDate) }} autoFocus />
          <Field label="Phone"><Input name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder="+1 555 000 0000" className="num" autoComplete="tel" /></Field>
          <SubmitButton className="w-full" pendingText="Saving…">Save and continue</SubmitButton>
        </ActionForm>
        <p className="mt-5 border-t border-line pt-4 text-[12px] text-fg-muted">
          Signed in as {user.email}. <Link href="/select" className="font-medium text-accent-text hover:underline">Switch account or company</Link>
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
