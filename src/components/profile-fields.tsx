import { Field, Input } from "@/components/ui";

/** First and last name, ID number, date of birth: the personal details form rows (src/lib/profile.ts). */
export function ProfileFields({ defaults, required = true, autoFocus }: {
  defaults?: { first?: string; last?: string; idNumber?: string | null; birthDate?: string };
  required?: boolean;
  autoFocus?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" required>
          <Input name="firstName" required maxLength={60} autoComplete="given-name" defaultValue={defaults?.first} autoFocus={autoFocus} />
        </Field>
        <Field label="Last name" required>
          <Input name="lastName" required maxLength={60} autoComplete="family-name" defaultValue={defaults?.last} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID number" required={required} hint="Passport, national ID or employee number">
          <Input name="idNumber" required={required} minLength={3} maxLength={40} autoComplete="off" spellCheck={false} className="num uppercase" defaultValue={defaults?.idNumber ?? ""} />
        </Field>
        <Field label="Date of birth" required={required}>
          <Input name="birthDate" type="date" required={required} max={today} min="1920-01-01" autoComplete="bday" className="num" defaultValue={defaults?.birthDate} />
        </Field>
      </div>
    </>
  );
}
