"use client";

import { useState } from "react";
import { Checkbox, Field, Input } from "@/components/ui";

/** Hold checkbox; the reason input appears only while the box is ticked. */
export function HoldField({ hold, reason }: { hold: boolean; reason: string | null }) {
  const [on, setOn] = useState(hold);
  return (
    <div className="space-y-3">
      <Checkbox name="hold" label="On hold — exclude from dispatch until released" checked={on} onChange={(e) => setOn(e.target.checked)} />
      {on && (
        <Field label="Hold reason" hint="Shown on the board and the roster so dispatchers know why." className="max-w-md">
          <Input name="holdReason" defaultValue={reason ?? ""} placeholder="Licence renewal pending, safety review, unpaid fines…" autoFocus={!hold} />
        </Field>
      )}
    </div>
  );
}
