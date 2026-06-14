import { Mail, ExternalLink, Shield, Eye, Users, Heart, BarChart3, Globe, Zap, Database, TrendingUp, Network } from 'lucide-react';
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
    title: t('aboutTitle'),
    description: t('aboutDescription'),
    path: '/about',
    locale: params.locale,
    keywords: [
      'about Flowvium',
      'THE ELIOT K FINANCIAL',
      'supply chain intelligence',
      'retail investor tools',
    ],
  });
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          About Flowvium
        </h1>
        <p className="text-lg text-cf-text-secondary max-w-2xl mx-auto">
          Supply chain intelligence for the modern investor
        </p>
      </div>

      {/* What is Flowvium */}
      <section className="cf-card p-8 mb-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          What Is Flowvium?
        </h2>
        <div className="space-y-4 text-cf-text-secondary leading-relaxed">
          <p>
            Flowvium is a free, web-based supply chain intelligence platform that tracks how institutional
            buying flows through supply chain relationships — before the headlines catch up. Built for
            investors, analysts, researchers, and anyone who wants a clearer view of global trade dynamics,
            Flowvium transforms complex, fragmented supply chain data into actionable visual insights that
            were previously available only to hedge funds and large institutional trading desks.
          </p>
          <p>
            At its core, Flowvium solves a fundamental problem in modern investing: the information
            asymmetry between institutional investors and everyone else. When a major fund begins
            accumulating positions in a semiconductor supplier, the ripple effects travel through dozens of
            interconnected companies — from raw material providers to logistics firms to end-product
            manufacturers. Traditional financial tools show you price movements after the fact. Flowvium
            shows you the supply chain connections that explain why those movements happen, often before the
            broader market recognizes the pattern.
          </p>
          <p>
            The platform aggregates data from SEC filings, earnings call transcripts, trade databases,
            shipping records, and alternative data sources to build a living map of global supply chain
            relationships. By cross-referencing institutional flow data with these supply chain maps,
            Flowvium identifies early warning signals — such as unusual accumulation patterns in a
            cluster of related companies, or divergences between media coverage and actual supply chain
            activity — that may indicate emerging opportunities or risks.
          </p>
          <p>
            Whether you are a retail investor looking for an edge, a supply chain professional monitoring
            disruption risk, a journalist investigating corporate interconnections, or an academic
            researcher studying global trade networks, Flowvium provides a powerful, intuitive interface
            for exploring the hidden architecture of the global economy. And because we believe supply chain
            transparency should not be a privilege reserved for the few, Flowvium is entirely free to use.
          </p>
        </div>
      </section>

      {/* Who Is Flowvium For */}
      <section className="cf-card p-8 mb-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          Who Is Flowvium For?
        </h2>
        <div className="space-y-4 text-cf-text-secondary leading-relaxed">
          <p>
            Flowvium is designed for a broad range of users who need visibility into supply chain
            relationships and institutional capital flows. Our platform serves several key audiences:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-cf-primary/10 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-cf-primary" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Retail Investors</h3>
                <p className="text-sm">Individual investors seeking institutional-grade supply chain intelligence to make more informed investment decisions and identify emerging trends before they become widely recognized.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-cf-secondary/10 flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-cf-secondary" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Financial Analysts</h3>
                <p className="text-sm">Equity researchers and buy-side analysts who need comprehensive supply chain mapping to understand company exposure, concentration risks, and second-order effects of market events.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-cf-accent/10 flex items-center justify-center flex-shrink-0">
                <Network className="w-5 h-5 text-cf-accent" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Supply Chain Professionals</h3>
                <p className="text-sm">Procurement managers, logistics coordinators, and supply chain risk officers who need real-time visibility into disruption propagation and vendor relationship networks.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-cf-success/10 flex items-center justify-center flex-shrink-0">
                <Globe className="w-5 h-5 text-cf-success" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Researchers &amp; Journalists</h3>
                <p className="text-sm">Academics, investigative journalists, and policy analysts studying global trade patterns, corporate interconnections, and the systemic risks embedded in modern supply chains.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Technology */}
      <section className="cf-card p-8 mb-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          Our Technology &amp; Methodology
        </h2>
        <div className="space-y-4 text-cf-text-secondary leading-relaxed">
          <p>
            Flowvium employs a multi-layered approach to supply chain intelligence that combines data
            aggregation, network analysis, and signal detection into a unified platform. Our methodology
            is built on several key technological pillars:
          </p>
          <div className="space-y-6 mt-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Database className="w-5 h-5 text-cf-primary" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Multi-Source Data Aggregation</h3>
                <p className="text-sm">We ingest and normalize data from SEC filings (13F, 10-K, 10-Q, 8-K), earnings call transcripts, international trade databases, shipping and logistics records, patent filings, corporate press releases, and curated alternative data feeds. This creates a comprehensive, continuously updated picture of who supplies whom, and how capital is flowing through these networks.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-secondary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Network className="w-5 h-5 text-cf-secondary" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Supply Chain Graph Modeling</h3>
                <p className="text-sm">At the heart of Flowvium is a dynamic graph database that models companies, suppliers, customers, and intermediaries as nodes in an interconnected network. Edges represent supply relationships, capital flows, shared risk exposures, and competitive dynamics. This graph structure allows us to compute cascade effects, identify concentration risks, and surface non-obvious connections between seemingly unrelated entities.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-accent/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Zap className="w-5 h-5 text-cf-accent" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">Institutional Signal Detection</h3>
                <p className="text-sm">Our signal detection engine monitors institutional trading patterns, insider activity, and filing anomalies to identify early indicators of supply chain-relevant events. By correlating these signals with our supply chain graph, we can detect when smart money is positioning around supply chain themes — such as reshoring, diversification, or anticipated disruptions — often weeks before mainstream coverage.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cf-success/10 flex items-center justify-center flex-shrink-0 mt-1">
                <BarChart3 className="w-5 h-5 text-cf-success" />
              </div>
              <div>
                <h3 className="font-medium text-cf-text-primary mb-1">News Gap Analysis</h3>
                <p className="text-sm">Flowvium continuously compares the magnitude of supply chain events (as measured by our data feeds and graph analysis) with the level of media and analyst coverage those events have received. When we detect a significant gap — a material event with minimal coverage — we flag it as a potential alpha-generating opportunity for our users.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="mb-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-6 text-center">
          Our Values
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="cf-card p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-cf-primary/10 flex items-center justify-center mx-auto mb-4">
              <Eye className="w-6 h-6 text-cf-primary" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2">
              Transparency
            </h3>
            <p className="text-sm text-cf-text-secondary">We believe information asymmetry creates unfair markets. Our goal is to level the playing field by making supply chain data accessible to all participants, regardless of their institutional resources or trading volume.</p>
          </div>
          <div className="cf-card p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-cf-secondary/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6 text-cf-secondary" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2">
              Accuracy
            </h3>
            <p className="text-sm text-cf-text-secondary">Every data point is verified and cross-referenced against multiple sources. We would rather display fewer data points than risk presenting inaccurate information. Trust is the foundation of everything we build.</p>
          </div>
          <div className="cf-card p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-cf-accent/10 flex items-center justify-center mx-auto mb-4">
              <Users className="w-6 h-6 text-cf-accent" />
            </div>
            <h3 className="font-heading font-bold text-cf-text-primary mb-2">
              Accessibility
            </h3>
            <p className="text-sm text-cf-text-secondary">Powerful analytical tools should be available to everyone, not just institutions with deep pockets. Flowvium is free because we believe democratizing financial intelligence leads to fairer, more efficient markets.</p>
          </div>
        </div>
      </section>

      {/* About THE ELIOT K FINANCIAL */}
      <section className="cf-card p-8 mb-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          About THE ELIOT K FINANCIAL
        </h2>
        <div className="space-y-4 text-cf-text-secondary leading-relaxed">
          <p>
            THE ELIOT K FINANCIAL is a technology company focused on building AI-powered tools that democratize
            access to institutional-grade financial intelligence. We believe that supply chain
            transparency and investment signal detection should not be exclusive to hedge funds and
            investment banks. Our mission is to harness artificial intelligence, alternative data
            analysis, and intuitive design to create products that give every market participant —
            from individual retail investors to independent research firms — the analytical
            capabilities that were once the exclusive domain of Wall Street.
          </p>
          <p>
            Flowvium is the flagship product of THE ELIOT K FINANCIAL, representing our core belief that the most
            valuable investment insights often lie not in traditional financial statements, but in the
            complex web of supply chain relationships that underpin the global economy. We are
            committed to continuous improvement of our platform, incorporating user feedback and
            expanding our data coverage to deliver ever-more-comprehensive supply chain intelligence.
          </p>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="cf-card p-8 mb-8 border-l-4 border-cf-accent">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          Disclaimer
        </h2>
        <p className="text-cf-text-secondary leading-relaxed text-sm">
          Flowvium provides supply chain data and institutional flow analysis for informational
          and educational purposes only. Nothing on this platform constitutes financial advice,
          investment advice, trading advice, or any other sort of advice. You should not treat any
          of the content as such. Flowvium does not recommend that any securities, transactions,
          or investment strategies are suitable for any specific person. The data presented may
          contain inaccuracies or be delayed. Always conduct your own research and consult with a
          licensed financial advisor before making any investment decisions.
        </p>
      </section>

      {/* Contact */}
      <section className="cf-card p-8">
        <h2 className="text-2xl font-heading font-bold text-cf-text-primary mb-6">
          Get in Touch
        </h2>
        <p className="text-cf-text-secondary leading-relaxed mb-6">
          We value feedback from our users and are always looking for ways to improve Flowvium.
          Whether you have a question about the platform, a feature suggestion, a bug report, or a
          business inquiry, we would love to hear from you. Our team reviews every message and
          strives to respond promptly.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-cf-primary/10 flex items-center justify-center flex-shrink-0">
              <Heart className="w-5 h-5 text-cf-primary" />
            </div>
            <div>
              <h3 className="font-medium text-cf-text-primary mb-1">Feedback &amp; Suggestions</h3>
              <a
                href="mailto:taeshinkim11@gmail.com"
                className="text-cf-primary hover:underline flex items-center gap-1 text-sm"
              >
                <Mail className="w-4 h-4" />
                taeshinkim11@gmail.com
              </a>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-cf-accent/10 flex items-center justify-center flex-shrink-0">
              <ExternalLink className="w-5 h-5 text-cf-accent" />
            </div>
            <div>
              <h3 className="font-medium text-cf-text-primary mb-1">Business Inquiries</h3>
              <a
                href="mailto:taeshinkim11@gmail.com"
                className="text-cf-primary hover:underline flex items-center gap-1 text-sm"
              >
                <Mail className="w-4 h-4" />
                taeshinkim11@gmail.com
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
