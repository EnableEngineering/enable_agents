/**
 * Agent catalog data used by both the Agents Assembly grid and the global
 * AI Assistant panel's recommended-modules list, so the two stay in sync
 * instead of maintaining separate copies of the same 11 entries.
 */

export const BUSINESS_MODULES = [
  {
    name: 'Market Research',
    icon: '/assets/icons/search-analysis.png',
    price: '$29/month',
    status: 'ready',
    description: 'Discover market trends, analyze competitors, and gather customer insights to make data-driven decisions.',
    keywords: ['market analysis', 'competitor research', 'customer insights', 'business intelligence', 'market trends'],
    businessContext: ['retail', 'ecommerce', 'startup', 'product launch', 'competitive analysis'],
    industries: ['retail', 'technology', 'healthcare', 'finance', 'manufacturing'],
    useCases: ['understanding market', 'competitive analysis', 'customer research', 'market validation']
  },
  {
    name: 'Sales Helper Agent',
    icon: '/assets/icons/increase.png',
    price: '$45/month',
    status: 'ready',
    description: 'Supercharge your sales with lead management, CRM integration, and intelligent sales strategy recommendations.',
    keywords: ['sales', 'sales enablement', 'CRM', 'lead management', 'sales strategy'],
    businessContext: ['sales', 'lead generation', 'customer acquisition', 'sales optimization', 'business growth'],
    industries: ['retail', 'technology', 'ecommerce', 'services', 'consulting'],
    useCases: ['sales optimization', 'lead management', 'sales strategy', 'revenue growth']
  },
  {
    name: 'Content Marketing Agent',
    icon: '/assets/icons/bullhorn.png',
    price: '$49/month',
    status: 'ready',
    description: 'Create compelling content, manage campaigns, and boost your brand presence with AI-powered marketing.',
    keywords: ['content marketing', 'content creation', 'marketing strategy', 'brand content', 'SEO'],
    businessContext: ['content marketing', 'brand building', 'digital marketing', 'social media', 'marketing strategy'],
    industries: ['retail', 'technology', 'media', 'education', 'ecommerce'],
    useCases: ['creating marketing content', 'content strategy', 'brand engagement', 'digital marketing']
  },
  {
    name: 'Community Network',
    icon: '/assets/icons/community.png',
    price: '$38/month',
    status: 'ready',
    description: 'Build and engage your community, manage relationships, and grow customer loyalty organically.',
    keywords: ['community management', 'network building', 'customer engagement', 'social platform', 'relationship management'],
    businessContext: ['customer engagement', 'brand building', 'social media', 'community building', 'customer loyalty'],
    industries: ['retail', 'technology', 'media', 'nonprofit', 'education'],
    useCases: ['building community', 'customer engagement', 'network management', 'brand loyalty']
  },
  {
    name: 'Executive Assistant Agent',
    icon: '/assets/icons/checklist.png',
    price: 'Free',
    status: 'ready',
    description: 'Your AI-powered executive assistant for task management, reminders, and stakeholder coordination via email.',
    keywords: ['executive assistant', 'task management', 'reminders', 'email', 'stakeholder updates'],
    businessContext: ['executive', 'management', 'personal productivity', 'team coordination'],
    industries: ['all industries'],
    useCases: ['task reminders', 'stakeholder follow-up', 'email integration', 'executive support']
  },
  {
    name: 'Event Networking Agent',
    icon: '/assets/icons/networking.png',
    price: '$30/month',
    status: 'ready',
    description: 'Maximize event ROI with smart attendee matching and follow-up automation.',
    keywords: ['event networking', 'attendee matching', 'follow-up', 'event ROI'],
    businessContext: ['events', 'networking', 'conferences', 'trade shows'],
    industries: ['all industries'],
    useCases: ['event networking', 'attendee engagement', 'follow-up automation']
  },
  {
    name: 'Email Outreach',
    icon: '/assets/icons/mail.png',
    price: '$25/month',
    status: 'ready',
    description: 'Send personalized bulk emails to suppliers, leads, or contacts with templates and tracking.',
    keywords: ['email outreach', 'bulk email', 'RFQ', 'supplier outreach', 'email campaigns'],
    businessContext: ['sales', 'procurement', 'supplier management', 'lead nurturing'],
    industries: ['manufacturing', 'retail', 'technology', 'consulting'],
    useCases: ['sending RFQs', 'supplier outreach', 'lead nurturing', 'bulk email']
  },
  {
    name: 'Supply Chain Audit',
    icon: '/assets/icons/supply-chain-management.png',
    price: '$40/month',
    status: 'ready',
    description: 'Qualify suppliers through capability and compliance audits with weighted scoring.',
    keywords: ['supply chain', 'supplier audit', 'qualification', 'compliance', 'vendor management'],
    businessContext: ['procurement', 'supplier management', 'quality assurance', 'vendor qualification'],
    industries: ['manufacturing', 'retail', 'automotive', 'aerospace'],
    useCases: ['supplier qualification', 'compliance audits', 'vendor scoring', 'supply chain management']
  }
];

// Ready technical modules, plus coming-soon ones shown as locked cards
// (previously fully hidden - Try/Buy are already disabled by isNotReady
// for any non-'ready' status, this just stops omitting the cards)
export const TECHNICAL_MODULES = [
  {
    name: 'Data Insights',
    icon: '/assets/icons/data-discovery.png',
    price: '$48/month',
    status: 'ready',
    description: 'Explore your data, uncover hidden patterns, and generate actionable business insights with AI-powered document analysis.',
    keywords: ['data analysis', 'data mining', 'insights', 'data exploration', 'RAG'],
    businessContext: ['data analysis', 'business intelligence', 'analytics'],
    industries: ['all industries', 'technology', 'finance'],
    useCases: ['data exploration', 'business insights', 'data analysis', 'document Q&A']
  },
  {
    name: 'Investment Agent',
    icon: '/assets/icons/save-money.png',
    price: '$65/month',
    status: 'coming_soon',
    description: 'Make smarter investment decisions with AI-powered market analysis and portfolio recommendations.',
    keywords: ['investment', 'portfolio', 'market analysis', 'risk assessment'],
    businessContext: ['investment', 'portfolio management', 'financial planning'],
    industries: ['finance', 'all industries'],
    useCases: ['market analysis', 'portfolio tracking', 'risk assessment']
  },
  {
    name: 'Team Performance',
    icon: '/assets/icons/performance.png',
    price: '$39/month',
    status: 'coming_soon',
    description: 'Track team productivity, evaluate performance, and identify areas for improvement with analytics.',
    keywords: ['team performance', 'productivity', 'performance analytics', 'goal management'],
    businessContext: ['team management', 'performance review', 'productivity'],
    industries: ['all industries'],
    useCases: ['performance tracking', 'team analytics', 'goal management']
  }
];

export function findModuleByName(name) {
  return BUSINESS_MODULES.find(m => m.name === name) || TECHNICAL_MODULES.find(m => m.name === name) || null;
}
