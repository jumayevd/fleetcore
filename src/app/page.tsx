import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";
import { HOME } from "@/lib/permissions";

export default async function Home() {
  const { accounts, active } = await getSessionContext();
  redirect(active ? HOME : accounts.length ? "/select" : "/login");
}
