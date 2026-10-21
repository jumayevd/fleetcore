import "server-only";
import { db } from "./db";
import { currentCompanyId } from "./tenant";

/** Per-company key/value settings (AppSetting). */
export async function getSetting(key: string) {
  return db.appSetting.findFirst({ where: { key } });
}

export async function setSetting(key: string, value: string) {
  const companyId = await currentCompanyId();
  return db.appSetting.upsert({
    where: { companyId_key: { companyId, key } },
    update: { value },
    create: { key, value },
  });
}
