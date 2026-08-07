export const mockContacts = [
  {
    id: "c_001",
    name: "Sarah Chen",
    title: "Head of Growth",
    company: "Innovate Solutions",
    email: "sarah.chen@innovate.com",
    avatar_url: "https://i.pravatar.cc/150?u=sarah",
    ai_insights: [
      { label: "Series B Investor", color: "brand" },
      { label: "FinTech Expert", color: "informative" },
      { label: "Loves Golf", color: "warning" },
      { label: "SF-based", color: "severe" }
    ],
    ai_summary: "Sarah is a key investor and growth expert. We last met at TechCrunch; she's interested in our upcoming seed round and mentioned her passion for golf. She tends to reply quickly to emails on Tuesday mornings.",
    timeline: [
      {
        id: "t_01",
        type: "meeting",
        date: "2026-08-03T10:00:00Z",
        title: "Coffee at TechCrunch Cafe, SF",
        source: "calendar"
      },
      {
        id: "t_02",
        type: "email",
        date: "2026-07-30T14:20:00Z",
        title: "Shared Q3 metrics and intro deck",
        source: "outlook_mail"
      },
      {
        id: "t_03",
        type: "email",
        date: "2026-07-15T09:00:00Z",
        title: "Initial warm intro from David",
        source: "outlook_mail"
      }
    ]
  }
];
