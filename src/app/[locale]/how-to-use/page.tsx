import { Search, GitBranch, Bell, ChevronDown, ChevronRight, HelpCircle, BarChart3, Globe, Shield, Zap, TrendingUp, Network, Newspaper, BookOpen } from 'lucide-react';
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
    title: `How to Use - ${t('homeTitle')}`,
    description: t('homeDescription'),
    path: '/how-to-use',
    locale: params.locale,
  });
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Flowvium?',
      acceptedAnswer: { '@type': 'Answer', text: 'Flowvium is a free institutional supply chain flow tracker. It maps smart money movements through supply chains, showing institutional 13F filings, cascade trading signals, and news gap analysis to uncover hidden market opportunities.' },
    },
    {
      '@type': 'Question',
      name: 'How do I track supply chain flows?',
      acceptedAnswer: { '@type': 'Answer', text: 'Use the Explore tab to search for any publicly traded company. Flowvium displays its complete supply chain map — upstream suppliers, downstream customers, and key relationships. Then use the Cascade tool to simulate how disruptions propagate through interconnected chains.' },
    },
    {
      '@type': 'Question',
      name: 'What are Cascade Signals?',
      acceptedAnswer: { '@type': 'Answer', text: 'Cascade Signals are algorithmic alerts that detect when institutional buying in a large-cap supply chain leader typically precedes movement in mid-cap suppliers or customers. These signals are based on historical 13F filing patterns and real-time SEC data.' },
    },
    {
      '@type': 'Question',
      name: 'What is the News Gap Analyzer?',
      acceptedAnswer: { '@type': 'Answer', text: 'The News Gap Analyzer compares the significance of supply chain activity against the volume of media coverage. It highlights material events that the market has not yet fully priced in — identifying underreported stories that could present early opportunities or emerging risks.' },
    },
    {
      '@type': 'Question',
      name: 'Is Flowvium free to use?',
      acceptedAnswer: { '@type': 'Answer', text: 'Yes, Flowvium is completely free to use. All supply chain maps, cascade signals, institutional flow data, and market intelligence features are available at no cost.' },
    },
    {
      '@type': 'Question',
      name: 'Which markets and countries does Flowvium cover?',
      acceptedAnswer: { '@type': 'Answer', text: 'Flowvium covers US markets (S&P 500, NASDAQ), Korean markets (KOSPI, KOSDAQ), Japanese markets, Chinese markets (Shanghai, Hong Kong), European markets, and more. The Fear & Greed index covers 10 global markets.' },
    },
    {
      '@type': 'Question',
      name: 'What is the Fear & Greed Index on Flowvium?',
      acceptedAnswer: { '@type': 'Answer', text: 'The Fear & Greed Index on Flowvium measures market sentiment across 10 global markets including the US, Korea, Japan, China, Europe, UK, India, Brazil, Taiwan, and Australia. It combines multiple indicators to produce a score from 0 (Extreme Fear) to 100 (Extreme Greed).' },
    },
  ],
};

export default function HowToUsePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          How to Use Flowvium
        </h1>
        <p className="text-lg text-cf-text-secondary max-w-2xl mx-auto">
          Your complete guide to tracking institutional supply chain flows and uncovering hidden market signals
        </p>
      </div>

      {/* 3-Step Guide */}
      <section className="mb-16">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-8 text-center">
          Get Started in Three Steps
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Step 1 */}
          <div className="cf-card p-6 text-center relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-cf-primary text-white flex items-center justify-center font-heading font-bold text-sm">
              1
            </div>
            <div className="w-14 h-14 rounded-xl bg-cf-primary/10 flex items-center justify-center mx-auto mb-4 mt-2">
              <Search className="w-7 h-7 text-cf-primary" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 text-lg">
              Explore Supply Chains
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed">
              Start by searching for any publicly traded company in the <strong>Explore</strong> tab.
              Flowvium will display its complete supply chain map — including upstream suppliers,
              downstream customers, key logistics partners, and competitive relationships. Use filters
              to narrow by sector, region, or supplier tier to find exactly the connections you need.
            </p>
          </div>

          {/* Step 2 */}
          <div className="cf-card p-6 text-center relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-cf-secondary text-white flex items-center justify-center font-heading font-bold text-sm">
              2
            </div>
            <div className="w-14 h-14 rounded-xl bg-cf-secondary/10 flex items-center justify-center mx-auto mb-4 mt-2">
              <GitBranch className="w-7 h-7 text-cf-secondary" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 text-lg">
              Analyze Cascades &amp; Signals
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed">
              Use the <strong>Cascade</strong> tool to simulate how a disruption event propagates
              through interconnected supply chains. Then check <strong>Signals</strong> to see
              real-time institutional flow data — insider trades, SEC filing anomalies, unusual
              options activity, and earnings call mentions that may indicate supply chain positioning
              by smart money.
            </p>
          </div>

          {/* Step 3 */}
          <div className="cf-card p-6 text-center relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-cf-accent text-white flex items-center justify-center font-heading font-bold text-sm">
              3
            </div>
            <div className="w-14 h-14 rounded-xl bg-cf-accent/10 flex items-center justify-center mx-auto mb-4 mt-2">
              <Bell className="w-7 h-7 text-cf-accent" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 text-lg">
              Discover News Gaps
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed">
              Visit the <strong>News Gap</strong> analyzer to find material supply chain events that
              the market has not yet fully priced in. Our system compares the significance of supply
              chain activity against the volume of media coverage to highlight underreported stories
              that could present early opportunities or emerging risks.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Deep Dives */}
      <section className="mb-16">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-8 text-center">
          Feature Guide
        </h2>
        <div className="space-y-6">
          <div className="cf-card p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-primary/10 flex items-center justify-center flex-shrink-0">
                <Globe className="w-5 h-5 text-cf-primary" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-cf-text-primary mb-2">Supply Chain Explorer</h3>
                <p className="text-sm text-cf-text-secondary leading-relaxed">
                  The Explorer is your starting point for all supply chain research. Enter any company
                  name or ticker symbol to see its full supply chain network. You can switch between
                  map view, list view, and graph view depending on your preference. Each company node
                  displays key metrics including risk score, market cap, sector, and the number of
                  upstream and downstream connections. Click on any node to drill deeper into that
                  company&apos;s specific supply chain. Use the export function to download data for
                  further analysis in spreadsheets or custom tools.
                </p>
              </div>
            </div>
          </div>

          <div className="cf-card p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-secondary/10 flex items-center justify-center flex-shrink-0">
                <Network className="w-5 h-5 text-cf-secondary" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-cf-text-primary mb-2">Cascade Visualizer</h3>
                <p className="text-sm text-cf-text-secondary leading-relaxed">
                  The Cascade Visualizer lets you model &quot;what-if&quot; scenarios by selecting a disruption
                  event type (natural disaster, geopolitical event, trade policy change, etc.) and an
                  impacted company. The system then simulates how the disruption propagates through the
                  supply chain graph, showing you which companies are directly affected, which face
                  indirect exposure, and the estimated severity and recovery timeline for each. This is
                  invaluable for stress-testing portfolio exposure to supply chain risks.
                </p>
              </div>
            </div>
          </div>

          <div className="cf-card p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-accent/10 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-cf-accent" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-cf-text-primary mb-2">Institutional Signals</h3>
                <p className="text-sm text-cf-text-secondary leading-relaxed">
                  The Signals dashboard aggregates institutional activity indicators from multiple data
                  sources. Filter by signal type (insider trading, SEC filings, earnings call mentions,
                  analyst revisions, institutional flows, unusual options activity, or supply chain
                  alerts), by strength (strong, moderate, weak), and by time range. Each signal card
                  shows the source, detection time, related companies, and a strength rating. Use
                  these signals in conjunction with the supply chain map to understand not just what
                  institutions are doing, but why they might be doing it.
                </p>
              </div>
            </div>
          </div>

          <div className="cf-card p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-success/10 flex items-center justify-center flex-shrink-0">
                <Newspaper className="w-5 h-5 text-cf-success" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-cf-text-primary mb-2">News Gap Analyzer</h3>
                <p className="text-sm text-cf-text-secondary leading-relaxed">
                  The News Gap Analyzer is Flowvium&apos;s most unique feature. It cross-references supply
                  chain data with media coverage to identify stories the market is missing. Each gap
                  entry includes a gap score (measuring the divergence between event magnitude and media
                  attention), the affected sectors, a brief analysis of the potential impact, and links
                  to the underlying data. Stories are categorized as underreported, trending, or
                  emerging. This tool is especially useful for contrarian investors and researchers
                  looking for early-stage narratives.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="mb-12">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-8 text-center">
          Frequently Asked Questions
        </h2>
        <div className="space-y-4">
          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              What exactly are &quot;institutional flows&quot; and why do they matter?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              Institutional flows refer to the buying and selling activity of large financial institutions
              — hedge funds, mutual funds, pension funds, sovereign wealth funds, and other entities that
              manage significant capital. These flows matter because institutions conduct extensive research
              before committing capital, and their trading activity often precedes significant price
              movements. When multiple institutions begin accumulating positions in companies linked by
              supply chain relationships, it can indicate that sophisticated investors have identified an
              emerging theme — such as supply chain reshoring, raw material shortages, or sector rotation —
              before it becomes widely known. Flowvium helps you spot these patterns early.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              Is Flowvium free to use? Are there any hidden costs?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              Yes, Flowvium is completely free to use. There are no hidden fees, no mandatory sign-ups for
              basic features, and no paywall blocking core functionality. We believe that supply chain
              transparency is a public good, and our mission is to make this data accessible to everyone.
              We may introduce optional premium features in the future for power users who need advanced
              analytics, API access, or real-time alerts, but the core platform will always remain free.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              Where does Flowvium get its supply chain data?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              Flowvium aggregates data from a variety of public and alternative sources. These include
              SEC filings (10-K, 10-Q, 8-K, 13F), corporate earnings call transcripts, international
              trade and customs databases, shipping and logistics records, patent filings, corporate
              press releases, news articles, and curated alternative data feeds. We use natural language
              processing and machine learning to extract supply chain relationships from unstructured
              text and validate them against structured data sources. Our database is continuously
              updated to reflect the latest available information.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              How often is the data updated?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              Data update frequency varies by source. SEC filings and institutional holdings data are
              updated as new filings become available (typically within hours of publication). News and
              media coverage are monitored continuously. Supply chain relationship maps are updated as
              new corporate disclosures, earnings reports, and trade data become available. Institutional
              signal detection runs on a near-real-time basis during market hours. For most use cases,
              you can expect the data you see on Flowvium to be current within the past 24 to 48 hours,
              with critical signals flagged more frequently.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              Is Flowvium providing investment advice?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              No. Flowvium is an informational and educational tool only. We do not provide investment
              advice, trading recommendations, or financial planning services. The data, analysis, and
              signals presented on Flowvium are intended to help you conduct your own research. They
              should never be treated as a recommendation to buy, sell, or hold any security. Always
              consult a licensed financial advisor before making investment decisions, and remember that
              past patterns do not guarantee future results. Supply chain data may contain inaccuracies
              or reflect outdated information.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              What is a &quot;News Gap&quot; and how should I interpret the gap score?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              A &quot;News Gap&quot; occurs when there is a significant divergence between the magnitude of a
              supply chain event (as determined by our data analysis) and the amount of media and analyst
              coverage that event has received. The gap score is a numerical measure of this divergence —
              a higher score indicates a larger gap between the event&apos;s potential impact and its current
              media visibility. A high gap score does not automatically mean an investment opportunity
              exists; it simply means the market may not have fully processed or priced in the information
              yet. Always perform your own due diligence before acting on any News Gap finding.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              Can I use Flowvium data for commercial purposes or research publications?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              Flowvium data is provided for personal, informational, and educational use. If you wish
              to reference Flowvium in academic research or publications, you are welcome to cite the
              platform as a source. However, systematic scraping, bulk downloading, redistribution, or
              commercial resale of Flowvium data is prohibited under our Terms of Service. For
              commercial data licensing inquiries or API access for institutional use, please contact
              us at taeshinkim11@gmail.com.
            </p>
          </div>

          <div className="cf-card p-6">
            <h3 className="font-heading font-bold text-cf-text-primary mb-2 flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-cf-primary flex-shrink-0 mt-0.5" />
              How can I report a bug or suggest a new feature?
            </h3>
            <p className="text-sm text-cf-text-secondary leading-relaxed ml-7">
              We welcome all feedback from our users. You can use the feedback widget (the chat icon in
              the bottom-right corner of the screen) to quickly submit bug reports, feature requests,
              or general feedback. Alternatively, you can email us directly at taeshinkim11@gmail.com.
              We review every submission and prioritize improvements based on user feedback. If you have
              a business or partnership inquiry, please reach out to taeshinkim11@gmail.com instead.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cf-card p-8 text-center bg-gradient-to-br from-cf-primary/5 to-cf-secondary/5">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-3">
          Ready to Explore?
        </h2>
        <p className="text-cf-text-secondary mb-6 max-w-lg mx-auto">
          Start uncovering hidden supply chain connections and institutional flow patterns today.
          Flowvium is free and requires no sign-up to begin exploring.
        </p>
        <a
          href="/explore"
          className="inline-flex items-center gap-2 px-6 py-3 bg-cf-primary text-white rounded-lg font-medium hover:bg-cf-primary/90 transition-colors duration-200"
        >
          <Search className="w-4 h-4" />
          Start Exploring
        </a>
      </section>
    </div>
    </>
  );
}
