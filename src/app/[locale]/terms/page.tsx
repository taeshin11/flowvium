import { FileText } from 'lucide-react';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: `Terms of Service - ${t('homeTitle')}`,
    description: t('homeDescription'),
    path: '/terms',
    locale: params.locale,
  });
}

export default function TermsOfServicePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="w-14 h-14 rounded-xl bg-cf-primary/10 flex items-center justify-center mx-auto mb-4">
          <FileText className="w-7 h-7 text-cf-primary" />
        </div>
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          Terms of Service
        </h1>
        <p className="text-sm text-cf-text-secondary">
          Last updated: April 1, 2026
        </p>
      </div>

      <div className="cf-card p-8 space-y-8">
        {/* Introduction */}
        <section>
          <p className="text-cf-text-secondary leading-relaxed">
            Welcome to Flowvium. These Terms of Service (&quot;Terms&quot;) govern your access to and use of
            the Flowvium website located at https://flowvium.net (the &quot;Site&quot;) and the
            supply chain intelligence services provided through the Site (the &quot;Service&quot;). Flowvium is
            operated by THE ELIOT K FINANCIAL (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). By accessing or using the Site and Service,
            you agree to be bound by these Terms. If you do not agree to these Terms, you must not
            access or use the Site or Service.
          </p>
        </section>

        {/* 1. Acceptance of Terms */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            1. Acceptance of Terms
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              By accessing, browsing, or using the Site or Service in any manner, you acknowledge that
              you have read, understood, and agree to be bound by these Terms, as well as our Privacy
              Policy, which is incorporated herein by reference. These Terms constitute a legally
              binding agreement between you and THE ELIOT K FINANCIAL. If you are using the Service on behalf of an
              organization, you represent and warrant that you have the authority to bind that
              organization to these Terms, and &quot;you&quot; refers to both you individually and the
              organization.
            </p>
            <p>
              You represent that you are at least 13 years of age (or the applicable minimum age of
              digital consent in your jurisdiction). If you are under the age of 18 (or the age of
              legal majority in your jurisdiction), you may only use the Service with the consent and
              supervision of a parent or legal guardian who agrees to be bound by these Terms.
            </p>
          </div>
        </section>

        {/* 2. Description of Service */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            2. Description of Service
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              Flowvium is a free, web-based supply chain intelligence platform that provides users
              with tools to explore supply chain relationships, visualize cascade effects of
              disruption events, track institutional investment signals, and identify underreported
              supply chain news. The Service includes, but is not limited to, the following features:
              Supply Chain Explorer, Cascade Visualizer, Institutional Signals dashboard, News Gap
              Analyzer, and related informational content including blog articles and educational
              resources.
            </p>
            <p>
              The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We reserve the right
              to modify, suspend, or discontinue the Service (or any part thereof) at any time,
              with or without notice, and without liability to you. We may also add, remove, or
              modify features, tools, or data sources at our sole discretion. We do not guarantee
              that the Service will be uninterrupted, timely, secure, or error-free.
            </p>
          </div>
        </section>

        {/* 3. User Conduct */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            3. User Conduct
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>You agree to use the Site and Service only for lawful purposes and in accordance with these Terms. You agree not to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Use the Service for any purpose that is illegal or prohibited by these Terms or applicable law.</li>
              <li>Attempt to gain unauthorized access to any part of the Service, other users&apos; accounts, or any systems or networks connected to the Service.</li>
              <li>Use any automated means, including robots, crawlers, scrapers, or spiders, to access the Service or collect data from the Service without our express written consent.</li>
              <li>Interfere with or disrupt the Service, servers, or networks connected to the Service, or violate any requirements, procedures, policies, or regulations of networks connected to the Service.</li>
              <li>Reproduce, duplicate, copy, sell, resell, redistribute, or exploit any portion of the Service, data, or content without our express written permission.</li>
              <li>Use the Service to transmit any viruses, malware, spyware, or other harmful code or materials.</li>
              <li>Impersonate any person or entity, or falsely state or misrepresent your affiliation with any person or entity.</li>
              <li>Collect or harvest any personally identifiable information from the Service or its users.</li>
              <li>Use the Service in any manner that could damage, disable, overburden, or impair the Service or interfere with any other party&apos;s use of the Service.</li>
            </ul>
            <p>
              We reserve the right to terminate or restrict your access to the Service at any time,
              without notice, for any conduct that we, in our sole discretion, determine to be in
              violation of these Terms, harmful to other users, harmful to our business interests, or
              otherwise objectionable.
            </p>
          </div>
        </section>

        {/* 4. Intellectual Property */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            4. Intellectual Property
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              The Site and Service, including all content, features, functionality, software, text,
              images, graphics, logos, icons, data compilations, and the selection and arrangement
              thereof, are the exclusive property of THE ELIOT K FINANCIAL and are protected by United States and
              international copyright, trademark, trade secret, and other intellectual property or
              proprietary rights laws.
            </p>
            <p>
              The Flowvium name, logo, and all related names, logos, product and service names,
              designs, and slogans are trademarks of THE ELIOT K FINANCIAL. You may not use such marks without our
              prior written permission. All other names, logos, product and service names, designs,
              and slogans on the Site are the trademarks of their respective owners.
            </p>
            <p>
              You are granted a limited, non-exclusive, non-transferable, revocable license to access
              and use the Site and Service for personal, non-commercial, informational, and educational
              purposes, subject to these Terms. This license does not include the right to reproduce,
              distribute, modify, create derivative works of, publicly display, publicly perform,
              republish, download, store, or transmit any of the material on the Site, except as
              permitted by these Terms or with our express written consent.
            </p>
          </div>
        </section>

        {/* 5. Disclaimer — NOT Investment Advice */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            5. Disclaimer — Not Investment Advice
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <div className="bg-cf-accent/5 border-l-4 border-cf-accent p-4 rounded-r-lg">
              <p className="font-medium text-cf-text-primary mb-2">Important Notice</p>
              <p>
                Flowvium provides supply chain data, institutional flow analysis, signal detection,
                and related information for <strong>informational and educational purposes only</strong>.
                Nothing on the Site or through the Service constitutes financial advice, investment
                advice, trading advice, tax advice, legal advice, or any other form of professional
                advice.
              </p>
            </div>
            <p>
              You should not treat any content on Flowvium as a recommendation to buy, sell, or
              hold any security, financial product, or investment strategy. Flowvium does not
              recommend that any particular security, transaction, or investment strategy is suitable
              for any specific person. Any investment decisions you make are solely your own
              responsibility. You should always conduct your own independent research and due
              diligence, and consult with a qualified, licensed financial advisor before making any
              investment decisions.
            </p>
            <p>
              The data, analysis, signals, and other information presented on Flowvium may contain
              errors, inaccuracies, or omissions. Supply chain data may be delayed, incomplete, or
              based on estimates and approximations. Historical patterns and signals do not guarantee
              future results. Market conditions can change rapidly, and past performance is not
              indicative of future outcomes. We make no representation or warranty regarding the
              accuracy, completeness, timeliness, or reliability of any information on the Site.
            </p>
          </div>
        </section>

        {/* 6. Limitation of Liability */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            6. Limitation of Liability
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE ELIOT K FINANCIAL, ITS
              DIRECTORS, OFFICERS, EMPLOYEES, AGENTS, AFFILIATES, SUCCESSORS, OR ASSIGNS BE LIABLE
              FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING
              BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES,
              ARISING OUT OF OR IN CONNECTION WITH YOUR ACCESS TO OR USE OF (OR INABILITY TO ACCESS
              OR USE) THE SITE OR SERVICE, WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING
              NEGLIGENCE), STATUTE, OR ANY OTHER LEGAL THEORY, EVEN IF WE HAVE BEEN ADVISED OF THE
              POSSIBILITY OF SUCH DAMAGES.
            </p>
            <p>
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL AGGREGATE LIABILITY TO
              YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE USE OF OR INABILITY TO USE THE
              SITE OR SERVICE SHALL NOT EXCEED THE AMOUNT YOU HAVE PAID TO US IN THE TWELVE (12)
              MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED DOLLARS ($100.00), WHICHEVER IS LESS.
            </p>
            <p>
              WITHOUT LIMITING THE FOREGOING, WE SHALL NOT BE LIABLE FOR ANY LOSSES OR DAMAGES
              ARISING FROM YOUR RELIANCE ON ANY INFORMATION, DATA, SIGNALS, ANALYSIS, OR OTHER
              CONTENT PROVIDED THROUGH THE SERVICE, INCLUDING BUT NOT LIMITED TO INVESTMENT LOSSES,
              TRADING LOSSES, OR ANY OTHER FINANCIAL LOSSES.
            </p>
          </div>
        </section>

        {/* 7. Indemnification */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            7. Indemnification
          </h2>
          <p className="text-cf-text-secondary leading-relaxed">
            You agree to indemnify, defend, and hold harmless THE ELIOT K FINANCIAL, its directors, officers,
            employees, agents, affiliates, successors, and assigns from and against any and all
            claims, liabilities, damages, losses, costs, and expenses (including reasonable
            attorneys&apos; fees) arising out of or in connection with: (a) your use of the Site or
            Service; (b) your violation of these Terms; (c) your violation of any applicable law
            or regulation; (d) your violation of any rights of a third party; or (e) any claim
            that your use of the Service caused damage to a third party. This indemnification
            obligation will survive the termination of these Terms and your use of the Service.
          </p>
        </section>

        {/* 8. Disclaimer of Warranties */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            8. Disclaimer of Warranties
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              THE SITE AND SERVICE ARE PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS, WITHOUT
              WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED
              BY APPLICABLE LAW, THE ELIOT K FINANCIAL DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT
              NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              TITLE, AND NON-INFRINGEMENT.
            </p>
            <p>
              WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, OR
              ERROR-FREE, THAT THE INFORMATION PROVIDED THROUGH THE SERVICE WILL BE ACCURATE,
              RELIABLE, OR COMPLETE, OR THAT ANY DEFECTS IN THE SERVICE WILL BE CORRECTED. NO
              ADVICE OR INFORMATION, WHETHER ORAL OR WRITTEN, OBTAINED FROM US OR THROUGH THE
              SERVICE SHALL CREATE ANY WARRANTY NOT EXPRESSLY STATED IN THESE TERMS.
            </p>
          </div>
        </section>

        {/* 9. Termination */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            9. Termination
          </h2>
          <p className="text-cf-text-secondary leading-relaxed">
            We may terminate or suspend your access to the Site and Service, without prior notice
            or liability, for any reason whatsoever, including, without limitation, if you breach
            these Terms. Upon termination, your right to use the Service will immediately cease.
            All provisions of these Terms that by their nature should survive termination shall
            survive, including, without limitation, ownership provisions, warranty disclaimers,
            indemnification, and limitations of liability. You may stop using the Service at any
            time. No termination of your access shall relieve you of any obligations arising or
            accruing prior to such termination, or limit any liability that you otherwise may have
            to THE ELIOT K FINANCIAL, including without limitation any indemnification obligations.
          </p>
        </section>

        {/* 10. Governing Law */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            10. Governing Law and Dispute Resolution
          </h2>
          <div className="space-y-4 text-cf-text-secondary leading-relaxed">
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              United States, without regard to its conflict of law provisions. Any legal suit,
              action, or proceeding arising out of or related to these Terms or the Service shall
              be instituted exclusively in the federal or state courts located in the United States,
              and you irrevocably submit to the exclusive jurisdiction of such courts in any such
              suit, action, or proceeding.
            </p>
            <p>
              Any dispute arising out of or relating to these Terms or the Service that cannot be
              resolved through informal negotiation shall be resolved through binding arbitration
              in accordance with the rules of the American Arbitration Association. The arbitration
              shall be conducted in the English language. The arbitrator&apos;s decision shall be final
              and binding. Judgment upon the award rendered by the arbitrator may be entered in any
              court of competent jurisdiction.
            </p>
          </div>
        </section>

        {/* 11. Changes to Terms */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            11. Changes to These Terms
          </h2>
          <p className="text-cf-text-secondary leading-relaxed">
            We reserve the right to modify or replace these Terms at any time at our sole discretion.
            If we make material changes to these Terms, we will provide notice by updating the
            &quot;Last updated&quot; date at the top of this page. Your continued use of the Site and Service
            after any changes to these Terms constitutes your acceptance of the revised Terms. It is
            your responsibility to review these Terms periodically for any changes. If you do not
            agree to the modified Terms, you must stop using the Site and Service.
          </p>
        </section>

        {/* 12. Severability */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            12. Severability
          </h2>
          <p className="text-cf-text-secondary leading-relaxed">
            If any provision of these Terms is held to be invalid, illegal, or unenforceable by a
            court of competent jurisdiction, such invalidity, illegality, or unenforceability shall
            not affect the remaining provisions of these Terms, which shall remain in full force
            and effect. The invalid or unenforceable provision shall be deemed modified to the
            minimum extent necessary to make it valid and enforceable while preserving its original
            intent.
          </p>
        </section>

        {/* 13. Entire Agreement */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            13. Entire Agreement
          </h2>
          <p className="text-cf-text-secondary leading-relaxed">
            These Terms, together with our Privacy Policy, constitute the entire agreement between
            you and THE ELIOT K FINANCIAL with respect to the Site and Service and supersede all prior or
            contemporaneous communications, proposals, and agreements, whether oral or written,
            between you and THE ELIOT K FINANCIAL regarding the Site and Service. No waiver of any provision of
            these Terms shall be deemed a further or continuing waiver of such provision or any
            other provision.
          </p>
        </section>

        {/* 14. Contact */}
        <section>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">
            14. Contact Information
          </h2>
          <div className="text-cf-text-secondary leading-relaxed">
            <p className="mb-3">
              If you have any questions or concerns about these Terms, please contact us at:
            </p>
            <div className="bg-cf-background rounded-lg p-4">
              <p className="font-medium text-cf-text-primary">THE ELIOT K FINANCIAL — Flowvium</p>
              <p>Email: <a href="mailto:taeshinkim11@gmail.com" className="text-cf-primary hover:underline">taeshinkim11@gmail.com</a></p>
              <p>Website: <a href="https://flowvium.net" className="text-cf-primary hover:underline">https://flowvium.net</a></p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
