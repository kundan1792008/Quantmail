export interface Email {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  read: boolean;
  starred: boolean;
  labels: string[];
}

export const mockEmails: Email[] = [
  {
    id: "1",
    from: "Alex Johnson",
    fromEmail: "alex@techcorp.io",
    subject: "Q3 Product Roadmap — Action Required",
    preview:
      "Hi team, I've finalized the Q3 roadmap. Please review the attached deck and share your feedback by Friday...",
    body: `Hi team,

I've finalized the Q3 product roadmap and I need everyone's input before we present to the board next Monday.

Please review the attached deck carefully. Key highlights:

• AI Feature Suite — shipping in August with smart reply, auto-categorisation, and priority scoring.
• Mobile Redesign — the new split-pane layout goes live in September.
• Performance Sprint — targeting a 2× cold-start improvement by end of Q3.

Please share your written feedback by Friday, 5 PM PT. If you have blocking concerns, flag them directly in the doc.

Thanks,
Alex`,
    date: "10:42 AM",
    read: false,
    starred: true,
    labels: ["Work", "Action Required"],
  },
  {
    id: "2",
    from: "Priya Sharma",
    fromEmail: "priya@designstudio.co",
    subject: "Re: New landing page mockups",
    preview:
      "Hey! I've updated the hero section based on your notes. The gradient now uses the new Quant indigo palette...",
    body: `Hey!

I've updated the hero section based on your notes. The gradient now uses the new Quant indigo palette and the CTA button has stronger contrast.

I also tweaked the mobile breakpoints so the nav collapses cleanly at 768 px.

Let me know if you want a Figma walk-through before I hand off to dev.

– Priya`,
    date: "9:15 AM",
    read: false,
    starred: false,
    labels: ["Design"],
  },
  {
    id: "3",
    from: "GitHub",
    fromEmail: "noreply@github.com",
    subject: "[Quantmail] PR #142 merged: Add biometric auth flow",
    preview:
      "copilot merged pull request #142 into main. 3 files changed, 112 additions, 4 deletions...",
    body: `copilot merged pull request #142 into main.

Add biometric auth flow

3 files changed, 112 additions, 4 deletions

Modified files:
- src/services/livenessService.ts
- src/routes/auth.ts
- prisma/schema.prisma`,
    date: "Yesterday",
    read: true,
    starred: false,
    labels: ["GitHub"],
  },
  {
    id: "4",
    from: "Marcus Lee",
    fromEmail: "marcus@quantfund.vc",
    subject: "Investor update — June metrics look strong",
    preview:
      "Kundan, great numbers this month. MAU is up 34% MoM, and the AI reply feature has a 91% satisfaction score...",
    body: `Kundan,

Great numbers this month. MAU is up 34% MoM, and the AI reply feature has a 91% satisfaction score in the beta cohort.

I'm putting together a follow-on memo for the partnership call on the 18th. Can you share the updated cap table and the latest ARR projection?

Looking forward to seeing what you build next.

Marcus`,
    date: "Yesterday",
    read: true,
    starred: true,
    labels: ["Investors"],
  },
  {
    id: "5",
    from: "Vercel",
    fromEmail: "no-reply@vercel.com",
    subject: "Deployment successful: quantmail-frontend → production",
    preview:
      "Your deployment is live! Branch: main · Commit: f3a91bc · Duration: 47s...",
    body: `Your deployment is live!

Project: quantmail-frontend
Branch: main
Commit: f3a91bc — feat: add SmartReply component
Duration: 47s
URL: https://quantmail-frontend.vercel.app`,
    date: "2 days ago",
    read: true,
    starred: false,
    labels: ["DevOps"],
  },
  {
    id: "6",
    from: "Olivia Chen",
    fromEmail: "olivia@beta-users.quantmail.app",
    subject: "Feedback from beta — the smart reply is incredible",
    preview:
      "I've been using Quantmail for a week now. The smart reply feature alone saves me 30 minutes a day...",
    body: `Hi Kundan,

I've been using Quantmail for a week now and I have to say — this is the best email experience I've ever had.

The smart reply feature alone saves me 30 minutes a day. It actually sounds like me, not a robot.

One request: can you add a keyboard shortcut to trigger the smart reply without reaching for the mouse? Something like Cmd+Shift+R would be perfect.

Keep it up — you're onto something huge.

Olivia`,
    date: "3 days ago",
    read: true,
    starred: false,
    labels: ["Feedback"],
  },
];

export const navItems = [
  { id: "inbox", label: "Inbox", icon: "inbox", count: 2 },
  { id: "sent", label: "Sent", icon: "sent", count: 0 },
  { id: "drafts", label: "Drafts", icon: "draft", count: 3 },
  { id: "spam", label: "Spam", icon: "spam", count: 0 },
  { id: "starred", label: "Starred", icon: "star", count: 2 },
];
