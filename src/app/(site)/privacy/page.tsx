import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { Eyebrow } from "../parts";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What FleetCore collects, why, and how connected Gmail and Outlook mailboxes are used.",
};

const UPDATED = "23 November 2026";

/** Also the privacy link Google and Microsoft show on their "connect your mailbox" screens. */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
      <Eyebrow>Legal</Eyebrow>
      <h1 className="mt-3 text-[34px] font-semibold tracking-tight sm:text-[40px]">Privacy policy</h1>
      <p className="mt-3 text-[14px] text-fg-subtle">Last updated {UPDATED}</p>

      <div className="mt-10 space-y-9 text-[15px] leading-7 text-fg-muted [&_h2]:mb-2 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-fg [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <p>
            {SITE.name} (made by {SITE.maker}) helps trucking companies keep track of their trucks, trailers, maintenance, paperwork
            and compliance. This page explains what information we hold, why, and the choices you have.
          </p>
        </section>

        <section>
          <h2>What we collect</h2>
          <ul>
            <li><b className="text-fg">Account details:</b> your name, email address and the companies you work for, so you can sign in and see the right fleet.</li>
            <li><b className="text-fg">Fleet records:</b> trucks, trailers, drivers, repairs, inspections, documents and costs that you or your colleagues enter.</li>
            <li><b className="text-fg">Contact form messages:</b> your name, company, email, phone and message when you write to us, so we can answer.</li>
            <li><b className="text-fg">Technical data:</b> cookies that keep you signed in and remember your display preferences.</li>
          </ul>
        </section>

        <section>
          <h2>Connected Gmail and Outlook mailboxes</h2>
          <p>
            You can connect a Gmail or Outlook mailbox so that emails you send from {SITE.name} (for example, a repair order to a
            shop) go out from your own address. When you connect one we ask only for permission to <b className="text-fg">send email as
            you</b> and to learn your email address.
          </p>
          <ul>
            <li>We cannot read, search, delete or change anything in your mailbox.</li>
            <li>We send a message only when you, or a feature you turned on, asks us to.</li>
            <li>The access tokens are stored encrypted and are used for nothing else.</li>
            <li>You can disconnect at any time under Account in {SITE.name}, or from your Google or Microsoft account settings.</li>
          </ul>
          <p className="mt-3">
            {SITE.name}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-accent-text hover:underline">
              Google API Services User Data Policy
            </a>, including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2>How we use information</h2>
          <p>
            Only to run {SITE.name} for you: showing your fleet, sending the emails and reminders you ask for, answering your
            messages and keeping the service secure. We do not sell your information, use it for advertising, or use mailbox data
            to train AI models.
          </p>
        </section>

        <section>
          <h2>Who else handles it</h2>
          <p>
            We use a small number of providers to run the service: hosting (Vercel), the database (Neon) and, when you connect
            them, Google and Microsoft for sending email. They process data only on our behalf. We share information otherwise only
            if the law requires it.
          </p>
        </section>

        <section>
          <h2>Keeping and deleting it</h2>
          <p>
            We keep your information while your company uses {SITE.name}. Ask us and we will delete your account and the data tied to
            it, except where we must keep records by law.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions or requests about your data: write to us through the <Link href="/contact" className="text-accent-text hover:underline">contact page</Link>.
          </p>
        </section>
      </div>
    </article>
  );
}
